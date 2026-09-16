import type {
  CleanupPlan,
  CleanupResult,
  StartupItem,
  OptimizerTargetKind
} from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'
import { createSpaceMeter, createSystemInformationSpaceFetcher, diffReleasedBytes, type SpaceMeter } from './space'
import { parseActionOutcome } from './actionResult'
import { escapeDesktopExecArg, escapeDesktopValue } from './desktopEntry'

/**
 * 脚本回传的删除统计。旧脚本只 echo 一个 "OK"，
 * 导致被占用文件一个没删时照样报成功 —— 这是「清理完成但空间没变」的直接成因。
 */
export interface CleanupStats {
  deletedBytes: number
  deletedCount: number
  failedCount: number
  locked: string[]
}

/** 解析清理脚本的 JSON 统计；非 JSON（旧格式）时返回 null，由调用方按 "OK" 兜底判定 */
export function parseCleanupStats(stdout: string): CleanupStats | null {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>
    const num = (v: unknown): number => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
    }
    const locked = Array.isArray(raw.locked) ? raw.locked.map((x) => String(x)).slice(0, 5) : []
    return {
      deletedBytes: num(raw.deletedBytes),
      deletedCount: num(raw.deletedCount),
      failedCount: num(raw.failedCount),
      locked
    }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// 安全白名单（按平台）
// ─────────────────────────────────────────────────────────────

/** 允许的临时目录白名单（仅这些路径下的清理被视为 safe） */
function allowedTempRoots(platform: Platform): string[] {
  if (platform === 'win32') {
    const temp = process.env.TEMP || process.env.TMP || ''
    const sysroot = process.env.SystemRoot || 'C:\\Windows'
    return [temp, `${sysroot}\\Temp`].filter(Boolean)
  }
  const tmp = process.env.TMPDIR || '/tmp'
  return [tmp, '/var/tmp'].filter(Boolean)
}

/** 允许的浏览器缓存根目录（仅白名单内指定浏览器的缓存） */
function allowedBrowserRoots(platform: Platform): string[] {
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || ''
    if (!local) return []
    return [
      `${local}\\Google\\Chrome\\User Data`,
      `${local}\\Microsoft\\Edge\\User Data`
    ].filter(Boolean)
  }
  const home = process.env.HOME || ''
  if (!home) return []
  if (platform === 'darwin') {
    return [
      `${home}/Library/Caches/Google/Chrome`,
      `${home}/Library/Caches/Microsoft Edge`
    ].filter(Boolean)
  }
  return [
    `${home}/.cache/google-chrome`,
    `${home}/.cache/microsoft-edge`
  ].filter(Boolean)
}

// ─────────────────────────────────────────────────────────────
// Windows：PowerShell 脚本
// ─────────────────────────────────────────────────────────────

// ★ 容量一律用 [long]（Int64），**不可用 [int]**：
//   [int] 是 Int32，上限 2,147,483,647（约 2.1GB）。临时目录 / 回收站 / 浏览器缓存一旦超过
//   该量级，PowerShell 5.1 会抛「Value was either too large or too small for an Int32」，
//   整个扫描脚本中断或输出非法 JSON，界面反而显示「暂无垃圾项」——垃圾越多越扫不出来。
//   disk.ts 的同类脚本已正确使用 [int64]，此处对齐。
const SCAN_SCRIPT_WIN = `
$temps = @($env:TEMP, "$env:SystemRoot\\Temp") | Where-Object { $_ -and (Test-Path $_) }
$plans = @()
foreach ($t in $temps) {
  $sz = (Get-ChildItem $t -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
  $plans += [pscustomobject]@{ id="temp:$b64"; kind="temp"; label="临时文件：$t"; path=$t; size=[long]([double]$sz); safe=$true }
}
try {
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(10)
  $sz = 0
  foreach ($i in $rb.Items()) { $sz += $i.Size }
  $plans += [pscustomobject]@{ id="recycle"; kind="recycle"; label="回收站"; path="RecycleBin"; size=[long]$sz; safe=$true }
} catch {}
$browsers = @(
  @{ name = 'Chrome'; base = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default" },
  @{ name = 'Edge';   base = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default" }
)
foreach ($b in $browsers) {
  foreach ($sub in @('Cache', 'Code Cache')) {
    $p = Join-Path $b.base $sub
    if (Test-Path $p) {
      $sz = (Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p))
      $plans += [pscustomobject]@{ id="browser:$b64"; kind="browser"; label="$($b.name) 缓存：$sub"; path=$p; size=[long]([double]$sz); safe=$true }
    }
  }
}
$plans | ConvertTo-Json -Compress
`

const STARTUP_SCRIPT_WIN = `
$skip = @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider')
$pairs = @(
  @{ loc='HKCU'; live='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; parked='HKCU:\\Software\\GaleEngine\\DisabledStartup' },
  @{ loc='HKLM'; live='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; parked='HKLM:\\Software\\GaleEngine\\DisabledStartup' }
)
$items = @()
foreach ($p in $pairs) {
  if (Test-Path $p.live) {
    $props = Get-ItemProperty $p.live
    $props.PSObject.Properties | Where-Object { $_.Name -notin $skip } | ForEach-Object {
      $items += [pscustomobject]@{ name=$_.Name; command=[string]$_.Value; location=$p.loc; enabled=$true }
    }
  }
  # 被禁用的启动项被搬到自有键保存（Windows 不读取该键，故不会自启），
  # 这里一并列出，用户才能再次启用 —— 原先直接删除会让条目彻底消失。
  if (Test-Path $p.parked) {
    $props = Get-ItemProperty $p.parked
    $props.PSObject.Properties | Where-Object { $_.Name -notin $skip } | ForEach-Object {
      $items += [pscustomobject]@{ name=$_.Name; command=[string]$_.Value; location=$p.loc; enabled=$false }
    }
  }
}
$items | ConvertTo-Json -Compress
`

// ─────────────────────────────────────────────────────────────
// macOS / Linux：POSIX bash 脚本（兼容 bash 3.2）
// ─────────────────────────────────────────────────────────────

/** 扫描清理项：临时目录 + 回收站（~/.Trash 或 XDG Trash）+ Chrome/Edge 缓存 */
const SCAN_SCRIPT_UNIX = `
home="$HOME"
esc() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'; }
first=1
emit() { if [ "$first" = "1" ]; then first=0; else printf ','; fi; printf '%s' "$1"; }
printf '['
for t in "\${TMPDIR:-/tmp}" /var/tmp; do
  if [ -d "$t" ]; then
    sz=$(du -sk "$t" 2>/dev/null | awk '{print $1}')
    [ -z "$sz" ] && sz=0
    size=$((sz * 1024))
    b64=$(printf '%s' "$t" | base64)
    lt=$(esc "$t")
    emit "{\\"id\\":\\"temp:$b64\\",\\"kind\\":\\"temp\\",\\"label\\":\\"临时文件：$lt\\",\\"path\\":\\"$lt\\",\\"size\\":$size,\\"safe\\":true}"
  fi
done
for rb in "$home/.Trash" "$home/.local/share/Trash"; do
  if [ -d "$rb" ]; then
    sz=$(du -sk "$rb" 2>/dev/null | awk '{print $1}')
    [ -z "$sz" ] && sz=0
    size=$((sz * 1024))
    lrb=$(esc "$rb")
    emit "{\\"id\\":\\"recycle\\",\\"kind\\":\\"recycle\\",\\"label\\":\\"回收站\\",\\"path\\":\\"$lrb\\",\\"size\\":$size,\\"safe\\":true}"
  fi
done
if [ "$(uname)" = "Darwin" ]; then
  chrome="$home/Library/Caches/Google/Chrome/Default"
  edge="$home/Library/Caches/Microsoft Edge/Default"
else
  chrome="$home/.cache/google-chrome/Default"
  edge="$home/.cache/microsoft-edge/Default"
fi
for b in "Chrome|$chrome" "Edge|$edge"; do
  bname="\${b%%|*}"; base="\${b#*|}"
  for sub in "Cache" "Code Cache"; do
    p="$base/$sub"
    if [ -d "$p" ]; then
      sz=$(du -sk "$p" 2>/dev/null | awk '{print $1}')
      [ -z "$sz" ] && sz=0
      size=$((sz * 1024))
      b64=$(printf '%s' "$p" | base64)
      lp=$(esc "$p")
      emit "{\\"id\\":\\"browser:$b64\\",\\"kind\\":\\"browser\\",\\"label\\":\\"$bname 缓存：$sub\\",\\"path\\":\\"$lp\\",\\"size\\":$size,\\"safe\\":true}"
    fi
  done
done
printf ']'
`

/** unix 启动项列表：mac=launchd plist，linux=XDG autostart .desktop */
const STARTUP_SCRIPT_UNIX = `
home="$HOME"
esc() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'; }
first=1
emit() { if [ "$first" = "1" ]; then first=0; else printf ','; fi; printf '%s' "$1"; }
printf '['
if [ "$(uname)" = "Darwin" ]; then
  for f in "$home/Library/LaunchAgents/"*.plist "$home/Library/LaunchAgents/"*.plist.disabled; do
    [ -f "$f" ] || continue
    # .plist.disabled 是「已禁用」标记（launchd 只加载 .plist），文件保留故可再启用
    en=true
    case "$f" in *.plist.disabled) en=false ;; esac
    name=$(/usr/libexec/PlistBuddy -c "Print :Label" "$f" 2>/dev/null)
    [ -n "$name" ] || name=$(basename "$f" .plist)
    # 注意 \${...} 必须转义：这是 shell 参数展开，不是 JS 模板插值
    name=\${name%.disabled}
    cmd=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$f" 2>/dev/null | sed -n '2p' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    n=$(esc "$name"); c=$(esc "$cmd")
    emit "{\\"id\\":\\"launchd:$n\\",\\"name\\":\\"$n\\",\\"command\\":\\"$c\\",\\"location\\":\\"launchd\\",\\"enabled\\":$en}"
  done
else
  for f in "$home/.config/autostart/"*.desktop; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .desktop)
    name=$(sed -n 's/^Name=//p' "$f" | head -1)
    cmd=$(sed -n 's/^Exec=//p' "$f" | head -1)
    # XDG 标准：Hidden=true 即「已禁用」，文件保留因此仍可再次启用
    en=true
    if grep -qi '^[[:space:]]*Hidden=true' "$f" 2>/dev/null; then en=false; fi
    n=$(esc "$name"); c=$(esc "$cmd")
    emit "{\\"id\\":\\"autostart:$id\\",\\"name\\":\\"$n\\",\\"command\\":\\"$c\\",\\"location\\":\\"autostart\\",\\"enabled\\":$en}"
  done
fi
printf ']'
`

/** shell 单引号转义：' → '\'' */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** PowerShell 单引号字面量转义：' → '' */
function psSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** XML 文本转义（launchd plist 内容） */
function xmlEsc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** mac 启动项 plist 文件内容（XML） */
function buildPlistContent(label: string, cmd: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEsc(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEsc(cmd)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`
}

/** Linux XDG autostart .desktop 文件内容（字段按 Desktop Entry 规范转义） */
function buildDesktopContent(name: string, cmd: string): string {
  return `[Desktop Entry]
Type=Application
Name=${escapeDesktopValue(name)}
Exec=${escapeDesktopExecArg(cmd)}
X-GNOME-Autostart-enabled=true`
}

// ─────────────────────────────────────────────────────────────
// 平台分发生成器（win32 → PowerShell，其余 → bash）
// ─────────────────────────────────────────────────────────────

export function buildScanScript(platform: Platform = detectPlatform()): string {
  return platform === 'win32' ? SCAN_SCRIPT_WIN : SCAN_SCRIPT_UNIX
}

export function buildRecycleCleanupScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32':
      // 无参 Clear-RecycleBin 只清当前用户在各卷的回收站，且遇到无权限卷会静默失败。
      // 这里显式遍历所有固定磁盘逐个清空，才能真正把 $Recycle.Bin 占的空间吐出来。
      //
      // 注意（曾有的假成功）：旧写法全程 `-ErrorAction SilentlyContinue` 后无条件 `"OK"`，
      // 权限不足、卷被占用时用户看到「清理成功」而空间没变。现在逐个盘 try/catch，
      // 有失败就回 ERR: 并带上原因；「回收站本已为空」不算失败（Clear-RecycleBin 对此会报错）。
      return [
        '$ErrorActionPreference = "Continue"',
        '$failed = @()',
        '$drives = @($env:SystemDrive.Substring(0,1))',
        '$drives += @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object { $_.DeviceID.Substring(0,1) })',
        'foreach ($d in ($drives | Select-Object -Unique)) {',
        '  try { Clear-RecycleBin -DriveLetter $d -Force -ErrorAction Stop }',
        '  catch {',
        '    $m = [string]$_.Exception.Message',
        '    if ($m -match "empty|已空|找不到|0x80070002|cannot find") { continue }',
        '    $failed += "$d 盘：$m"',
        '  }',
        '}',
        'if ($failed.Count -gt 0) { "ERR:部分回收站未能清空（" + ($failed -join "；") + "）" } else { "OK" }'
      ].join('\n')
    case 'darwin':
      return `osascript -e 'tell application "Finder" to empty trash' >/dev/null 2>&1 || rm -rf "$HOME/.Trash/"* 2>/dev/null; echo "OK"`
    default:
      return `rm -rf "$HOME/.local/share/Trash/files/"* "$HOME/.local/share/Trash/files/".[!.]* 2>/dev/null; echo "OK"`
  }
}

/**
 * 目录清理脚本（保留目录本身，只删内容）。
 *
 * 关键改动：逐项 try/catch 统计「真实删掉的字节数 / 文件数 / 失败数 / 被占用样例」，
 * 以 JSON 回传。此前是 `Get-ChildItem | Remove-Item -ErrorAction SilentlyContinue`，
 * 被占用文件全部静默跳过，随后 `if ($?)` 因 SilentlyContinue 恒为 true 而误报成功。
 */
export function buildPathCleanupScript(path: string, platform: Platform = detectPlatform()): string {
  if (platform === 'win32') {
    const p = psSingleQuote(path)
    return [
      '$ErrorActionPreference = "Continue"',
      '$deleted = [int64]0; $deletedCount = 0; $failedCount = 0',
      '$locked = New-Object System.Collections.ArrayList',
      `if (Test-Path -LiteralPath ${p}) {`,
      // 先文件后目录：避免目录非空导致 Remove-Item 整棵失败
      '  $items = @(Get-ChildItem -LiteralPath ' +
        p +
        ' -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object -Property PSIsContainer)',
      '  foreach ($i in $items) {',
      '    try {',
      '      $n = [int64]0',
      '      if (-not $i.PSIsContainer) { $n = [int64]$i.Length }',
      '      Remove-Item -LiteralPath $i.FullName -Recurse -Force -ErrorAction Stop',
      '      $deleted += $n; $deletedCount++',
      '    } catch {',
      '      $failedCount++',
      '      if ($locked.Count -lt 5) { [void]$locked.Add([string]$i.FullName) }',
      '    }',
      '  }',
      '}',
      '[pscustomobject]@{ deletedBytes=$deleted; deletedCount=$deletedCount; failedCount=$failedCount; locked=@($locked) } | ConvertTo-Json -Compress'
    ].join('\n')
  }
  // find -mindepth 1 -depth -delete：只删内容不删路径本身；BSD find(mac) 与 GNU find(linux) 均支持
  return `p=${shq(path)}
if [ -d "$p" ]; then
  before=$(du -sk "$p" 2>/dev/null | awk '{print $1}'); [ -z "$before" ] && before=0
  b=$(find "$p" -mindepth 1 2>/dev/null | wc -l | tr -d ' ')
  find "$p" -mindepth 1 -depth -delete 2>/dev/null
  after=$(du -sk "$p" 2>/dev/null | awk '{print $1}'); [ -z "$after" ] && after=0
  a=$(find "$p" -mindepth 1 2>/dev/null | wc -l | tr -d ' ')
  db=$(( (before - after) * 1024 )); [ "$db" -lt 0 ] && db=0
  dc=$(( b - a )); [ "$dc" -lt 0 ] && dc=0
  printf '{"deletedBytes":%s,"deletedCount":%s,"failedCount":%s,"locked":[]}' "$db" "$dc" "$a"
else
  printf '{"deletedBytes":0,"deletedCount":0,"failedCount":0,"locked":[]}'
fi`
}

export function buildStartupListScript(platform: Platform = detectPlatform()): string {
  return platform === 'win32' ? STARTUP_SCRIPT_WIN : STARTUP_SCRIPT_UNIX
}

/**
 * 启动项名称白名单。
 *
 * 名称来自系统（注册表值名 / launchd Label / .desktop 文件名），可能含中文、
 * 空格与点号，但绝不该含引号、反引号、`$`、反斜杠或控制字符 —— 这些正是脚本
 * 注入的载体。渲染进程经 IPC 传入的 id 必须先过这道闸。
 */
const STARTUP_NAME_RE = /^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff .@()_+-]{0,127}$/

/** 允许的 location 前缀白名单：绝不把 id 里的任意前缀拼进路径或命令 */
const STARTUP_LOCATIONS = ['HKCU', 'HKLM', 'launchd', 'autostart']

/** Windows 上存放「已禁用启动项」的自有键（Windows 不读取，故不会自启） */
const DISABLED_RUN_KEY = 'Software\\GaleEngine\\DisabledStartup'

/**
 * 切换启动项。返回脚本；location 或名称非法时返回 null（调用方按失败处理）。
 * id 格式：win `HKCU:Name`/`HKLM:Name`；mac `launchd:Label`；linux `autostart:Name`。
 *
 * 「禁用」一律采用**可逆表示**而非删除，否则条目会从列表消失、用户再也无法启用：
 * - win：把值从 `Run` 搬到自有键 `Software\GaleEngine\DisabledStartup`
 * - mac：`Label.plist` ↔ `Label.plist.disabled`（launchd 只加载 `.plist`）
 * - linux：写 `Hidden=true`（XDG 标准的禁用标记），文件保留
 */
export function buildToggleStartupScript(
  id: string,
  enable: boolean,
  command: string | undefined,
  platform: Platform = detectPlatform()
): string | null {
  const idx = id.indexOf(':')
  const rawLoc = idx > 0 ? id.slice(0, idx) : ''
  const name = (idx > 0 ? id.slice(idx + 1) : id).trim()
  if (!name || !STARTUP_NAME_RE.test(name)) return null

  const location = STARTUP_LOCATIONS.includes(rawLoc)
    ? rawLoc
    : platform === 'win32'
      ? 'HKCU' // Windows 上无前缀的旧式 id 视作当前用户
      : null
  if (!location) return null

  if (location === 'HKCU' || location === 'HKLM') {
    const live = `${location}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
    const parked = `${location}:\\${DISABLED_RUN_KEY}`
    // 一律使用 PowerShell **单引号字面量**：单引号内不解析 `$` 与反引号。
    // 原先用双引号包裹且只转义 `"`，命令里的 `$(...)` 会被真实执行（注入面）。
    return [
      '$ErrorActionPreference = "Stop"',
      `$live = ${psSingleQuote(live)}`,
      `$parked = ${psSingleQuote(parked)}`,
      `$name = ${psSingleQuote(name)}`,
      'try {',
      '  $pick = { param($k) if (Test-Path $k) { (Get-ItemProperty -Path $k -Name $name -ErrorAction SilentlyContinue).$name } else { $null } }',
      enable
        ? [
            '  # 启用：优先取回被搬运的原命令，其次用本次传入的命令',
            '  $v = & $pick $parked',
            `  if ($null -eq $v) { $v = ${psSingleQuote(command ?? '')} }`,
            '  if ([string]::IsNullOrWhiteSpace([string]$v)) { throw "缺少可恢复的启动命令" }',
            '  if (-not (Test-Path $live)) { New-Item -Path $live -Force | Out-Null }',
            '  Set-ItemProperty -Path $live -Name $name -Value $v',
            '  if (Test-Path $parked) { Remove-ItemProperty -Path $parked -Name $name -ErrorAction SilentlyContinue }'
          ].join('\n')
        : [
            '  # 禁用：搬到自有键保存（Windows 不读取该键），条目仍在列表中可再启用',
            '  $v = & $pick $live',
            '  if ($null -ne $v) {',
            '    if (-not (Test-Path $parked)) { New-Item -Path $parked -Force | Out-Null }',
            '    Set-ItemProperty -Path $parked -Name $name -Value $v',
            '    Remove-ItemProperty -Path $live -Name $name',
            '  }'
          ].join('\n'),
      '  "OK"',
      '} catch { "ERR:$($_.Exception.Message)" }'
    ].join('\n')
  }

  if (location === 'launchd') {
    // 名称已过白名单（不含引号/`$`/反引号），可直接嵌入双引号路径
    const plist = `"$HOME/Library/LaunchAgents/${name}.plist"`
    if (enable) {
      const content = buildPlistContent(name, command ?? '')
      return `mkdir -p "$HOME/Library/LaunchAgents"
mv -f ${plist}.disabled ${plist} 2>/dev/null
cat > ${plist} <<'GALE_PLIST_EOF'
${content}
GALE_PLIST_EOF
[ -f ${plist} ] && echo "OK" || echo "ERR:写入启动项失败"`
    }
    return `mv -f ${plist} ${plist}.disabled 2>/dev/null && echo "OK" || echo "ERR:禁用启动项失败"`
  }

  if (location === 'autostart') {
    const file = `"$HOME/.config/autostart/${name}.desktop"`
    if (enable) {
      const content = buildDesktopContent(name, command ?? '')
      return `mkdir -p "$HOME/.config/autostart"
cat > ${file} <<'GALE_DESKTOP_EOF'
${content}
GALE_DESKTOP_EOF
[ -f ${file} ] && echo "OK" || echo "ERR:写入启动项失败"`
    }
    // Hidden=true 是 XDG 标准的禁用标记：文件保留，用户可再次启用
    return `if [ ! -f ${file} ]; then echo "OK"; elif grep -qi '^[[:space:]]*Hidden=true' ${file}; then echo "OK"; elif printf 'Hidden=true\\n' >> ${file}; then echo "OK"; else echo "ERR:禁用启动项失败"; fi`
  }

  return null
}

// ─────────────────────────────────────────────────────────────
// 解析器（平台无关，统一解析 JSON）
// ─────────────────────────────────────────────────────────────

function parseJsonArray(stdout: string): unknown[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    return JSON.parse(trimmed) as unknown[]
  } catch {
    return []
  }
}

function toPlan(raw: Record<string, unknown>): CleanupPlan {
  const kind = raw.kind
  const validKind: OptimizerTargetKind =
    kind === 'recycle' || kind === 'browser' || kind === 'temp' ? kind : 'temp'
  const size = raw.size
  return {
    id: String(raw.id ?? ''),
    kind: validKind,
    label: String(raw.label ?? ''),
    path: String(raw.path ?? ''),
    sizeBytes: typeof size === 'number' ? size : Number(size) || 0,
    safe: raw.safe === true || raw.safe === 'True'
  }
}

function toStartupItem(raw: Record<string, unknown>): StartupItem {
  const loc = raw.location
  const validLoc: StartupItem['location'] =
    loc === 'HKLM' || loc === 'launchd' || loc === 'autostart' ? loc : 'HKCU'
  const name = String(raw.name ?? '')
  return {
    id: `${validLoc}:${name}`,
    name,
    command: String(raw.command ?? ''),
    location: validLoc,
    enabled: raw.enabled !== false
  }
}

// ─────────────────────────────────────────────────────────────
// Service 工厂（接口不变，内部按平台分发脚本）
// ─────────────────────────────────────────────────────────────

/**
 * 优化中心服务。
 *
 * `meter` 拥有**默认实现**（systeminformation 实测卷可用空间）。
 * 这一点很重要：此前它是可选参数而调用方（main.ts）忘了传，导致优化中心与一键优化里
 * temp / browser / recycle 类项目的「释放了多少」永远为 0，而同类磁盘项却正常 ——
 * 用户看到的是「清理成功但空间没变」。默认实现让「忘记注入」不再可能发生。
 */
export function createOptimizerService(
  runner: ExecRunner,
  platform: Platform = detectPlatform(),
  meter: SpaceMeter = createSpaceMeter(createSystemInformationSpaceFetcher())
) {
  const scanCleanup = async (): Promise<CleanupPlan[]> => {
    const { stdout } = await runner.run(buildScanScript(platform))
    return parseJsonArray(stdout).map((r) => toPlan(r as Record<string, unknown>))
  }

  const runCleanup = async (
    items: { id: string; path: string; kind: OptimizerTargetKind }[]
  ): Promise<CleanupResult[]> => {
    const roots = [...allowedTempRoots(platform), ...allowedBrowserRoots(platform)]
    const isSafePath = (p: string): boolean =>
      roots.some((r) => p === r || p.startsWith(r + '\\') || p.startsWith(r + '/'))
    const results: CleanupResult[] = []
    for (const item of items) {
      // 实测：清理前后各量一次该卷的可用空间，差值才是真实释放量
      const before = await meter.freeBytesForPath(item.path, platform)

      let raw: CleanupResult
      if (item.kind === 'recycle') {
        const { code, stdout, stderr } = await runner.run(buildRecycleCleanupScript(platform))
        // 严格判定：脚本按约定回传 OK / ERR:原因。
        // 旧写法 `code === 0 || stdout.includes('OK')` 会因脚本本身无条件输出 OK 而永远成功。
        const outcome = parseActionOutcome(stdout, code)
        raw = {
          id: item.id,
          ok: outcome.ok,
          error: outcome.ok ? undefined : outcome.message || stderr.trim() || '清理回收站失败（可能需要管理员权限）'
        }
      } else if (!isSafePath(item.path)) {
        raw = { id: item.id, ok: false, error: '路径不在安全白名单内，已跳过' }
      } else {
        const { code, stdout, stderr } = await runner.run(buildPathCleanupScript(item.path, platform))
        const stats = parseCleanupStats(stdout)
        if (code !== 0 && !stats) {
          raw = { id: item.id, ok: false, error: stderr.trim() || '清理失败（可能需要管理员权限）' }
        } else if (stats) {
          // 只要删掉了东西就算成功；全部被占用（一个都没删掉）则如实报失败
          const ok = stats.failedCount === 0 || stats.deletedCount > 0
          raw = {
            id: item.id,
            ok,
            error:
              stats.failedCount > 0
                ? `${stats.failedCount} 个文件被占用或无权删除，已跳过${
                    stats.locked.length ? `（如 ${stats.locked[0]}）` : ''
                  }`
                : undefined,
            deletedCount: stats.deletedCount,
            failedCount: stats.failedCount,
            locked: stats.locked.length ? stats.locked : undefined
          }
        } else {
          const ok = code === 0 && stdout.includes('OK')
          raw = { id: item.id, ok, error: ok ? undefined : stderr.trim() || '清理失败' }
        }
      }

      const after = await meter.freeBytesForPath(item.path, platform)
      const released = diffReleasedBytes(before, after)
      results.push(released === undefined ? raw : { ...raw, releasedBytes: released })
    }
    return results
  }

  const listStartup = async (): Promise<StartupItem[]> => {
    const { stdout } = await runner.run(buildStartupListScript(platform))
    return parseJsonArray(stdout).map((r) => toStartupItem(r as Record<string, unknown>))
  }

  const toggleStartup = async (
    id: string,
    enable: boolean,
    command?: string
  ): Promise<StartupItem[]> => {
    const script = buildToggleStartupScript(id, enable, command, platform)
    if (script) await runner.run(script)
    return listStartup()
  }

  return { scanCleanup, runCleanup, listStartup, toggleStartup }
}
