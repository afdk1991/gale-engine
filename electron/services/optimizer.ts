import type {
  CleanupPlan,
  CleanupResult,
  StartupItem,
  OptimizerTargetKind
} from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

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

const SCAN_SCRIPT_WIN = `
$temps = @($env:TEMP, "$env:SystemRoot\\Temp") | Where-Object { $_ -and (Test-Path $_) }
$plans = @()
foreach ($t in $temps) {
  $sz = (Get-ChildItem $t -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
  $plans += [pscustomobject]@{ id="temp:$b64"; kind="temp"; label="临时文件：$t"; path=$t; size=[int]([double]$sz); safe=$true }
}
try {
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(10)
  $sz = 0
  foreach ($i in $rb.Items()) { $sz += $i.Size }
  $plans += [pscustomobject]@{ id="recycle"; kind="recycle"; label="回收站"; path="RecycleBin"; size=[int]$sz; safe=$true }
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
      $plans += [pscustomobject]@{ id="browser:$b64"; kind="browser"; label="$($b.name) 缓存：$sub"; path=$p; size=[int]([double]$sz); safe=$true }
    }
  }
}
$plans | ConvertTo-Json -Compress
`

const STARTUP_SCRIPT_WIN = `
$keys = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
$items = @()
foreach ($k in $keys) {
  if (Test-Path $k) {
    $loc = if ($k.StartsWith('HKCU')) { 'HKCU' } else { 'HKLM' }
    $props = Get-ItemProperty $k
    $props.PSObject.Properties | Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') } | ForEach-Object {
      $items += [pscustomobject]@{ name=$_.Name; command=[string]$_.Value; location=$loc; enabled=$true }
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
  for f in "$home/Library/LaunchAgents/"*.plist; do
    [ -f "$f" ] || continue
    name=$(/usr/libexec/PlistBuddy -c "Print :Label" "$f" 2>/dev/null)
    [ -n "$name" ] || name=$(basename "$f" .plist)
    cmd=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$f" 2>/dev/null | sed -n '2p' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    n=$(esc "$name"); c=$(esc "$cmd")
    emit "{\\"id\\":\\"launchd:$n\\",\\"name\\":\\"$n\\",\\"command\\":\\"$c\\",\\"location\\":\\"launchd\\",\\"enabled\\":true}"
  done
else
  for f in "$home/.config/autostart/"*.desktop; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .desktop)
    name=$(sed -n 's/^Name=//p' "$f" | head -1)
    cmd=$(sed -n 's/^Exec=//p' "$f" | head -1)
    n=$(esc "$name"); c=$(esc "$cmd")
    emit "{\\"id\\":\\"autostart:$id\\",\\"name\\":\\"$n\\",\\"command\\":\\"$c\\",\\"location\\":\\"autostart\\",\\"enabled\\":true}"
  done
fi
printf ']'
`

/** shell 单引号转义：' → '\'' */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
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

/** Linux XDG autostart .desktop 文件内容 */
function buildDesktopContent(name: string, cmd: string): string {
  return `[Desktop Entry]
Type=Application
Name=${name}
Exec=${cmd}
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
      return 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue; if ($?) { "OK" } else { "FAIL" }'
    case 'darwin':
      return `osascript -e 'tell application "Finder" to empty trash' >/dev/null 2>&1 && echo "OK" || { rm -rf "$HOME/.Trash/"* 2>/dev/null; echo "OK"; }`
    default:
      return `rm -rf "$HOME/.local/share/Trash/files/"* "$HOME/.local/share/Trash/files/".[!.]* 2>/dev/null; echo "OK"`
  }
}

export function buildPathCleanupScript(path: string, platform: Platform = detectPlatform()): string {
  if (platform === 'win32') {
    return `Get-ChildItem "${path}" -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; if ($?) { "OK" } else { "FAIL" }`
  }
  // find -mindepth 1 -delete：只删内容不删路径本身；BSD find(mac) 与 GNU find(linux) 均支持
  return `[ -d ${shq(path)} ] || { echo "OK"; exit 0; }
find ${shq(path)} -mindepth 1 -delete 2>/dev/null
echo "OK"`
}

export function buildStartupListScript(platform: Platform = detectPlatform()): string {
  return platform === 'win32' ? STARTUP_SCRIPT_WIN : STARTUP_SCRIPT_UNIX
}

/**
 * 切换启动项。返回脚本；无法解析 location 时返回 null（调用方按失败处理）。
 * id 格式：win `HKCU:Name`/`HKLM:Name`；mac `launchd:Label`；linux `autostart:Name`。
 */
export function buildToggleStartupScript(
  id: string,
  enable: boolean,
  command: string | undefined,
  platform: Platform = detectPlatform()
): string | null {
  const idx = id.indexOf(':')
  const location = idx > 0 ? id.slice(0, idx) : 'HKCU'
  const name = idx > 0 ? id.slice(idx + 1) : id
  if (!name) return null

  if (platform === 'win32' || location === 'HKCU' || location === 'HKLM') {
    const regKey = `${location}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
    if (enable) {
      const cmd = (command ?? '').replace(/"/g, '`"')
      return `Set-ItemProperty -Path "${regKey}" -Name "${name}" -Value "${cmd}" -ErrorAction Stop; "OK"`
    }
    return `Remove-ItemProperty -Path "${regKey}" -Name "${name}" -ErrorAction SilentlyContinue; "OK"`
  }

  if (location === 'launchd') {
    const plist = `"$HOME/Library/LaunchAgents/${name}.plist"`
    if (enable) {
      const content = buildPlistContent(name, command ?? '')
      return `cat > ${plist} <<'GALE_PLIST_EOF'
${content}
GALE_PLIST_EOF
echo "OK"`
    }
    return `rm -f ${plist} 2>/dev/null; echo "OK"`
  }

  if (location === 'autostart') {
    const file = `"$HOME/.config/autostart/${name}.desktop"`
    if (enable) {
      const content = buildDesktopContent(name, command ?? '')
      return `mkdir -p "$HOME/.config/autostart"
cat > ${file} <<'GALE_DESKTOP_EOF'
${content}
GALE_DESKTOP_EOF
echo "OK"`
    }
    return `rm -f ${file} 2>/dev/null; echo "OK"`
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

export function createOptimizerService(runner: ExecRunner, platform: Platform = detectPlatform()) {
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
      if (item.kind === 'recycle') {
        const { code, stderr } = await runner.run(buildRecycleCleanupScript(platform))
        results.push({
          id: item.id,
          ok: code === 0,
          error: code === 0 ? undefined : stderr.trim() || '清理回收站失败'
        })
        continue
      }
      if (!isSafePath(item.path)) {
        results.push({ id: item.id, ok: false, error: '路径不在安全白名单内，已跳过' })
        continue
      }
      const script = buildPathCleanupScript(item.path, platform)
      const { code, stdout, stderr } = await runner.run(script)
      const ok = code === 0 && stdout.includes('OK')
      results.push({ id: item.id, ok, error: ok ? undefined : stderr.trim() || '清理失败' })
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
