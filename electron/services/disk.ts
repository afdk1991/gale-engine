import type {
  DiskVolume,
  DeepCleanupPlan,
  DeepCleanupKind,
  DiskRepairResult,
  SystemRepairKind,
  CleanupResult
} from '../../shared/types'
import * as si from 'systeminformation'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'
import { createSpaceMeter, diffReleasedBytes } from './space'
import { parseActionOutcome } from './actionResult'
import { parseCleanupStats } from './optimizer'

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 已用百分比达到该值视为空间不足 */
export const LOW_SPACE_PERCENT = 90
/** 可用空间低于该值（10 GiB）视为空间不足 */
export const LOW_SPACE_BYTES = 10 * 1024 * 1024 * 1024
/** 回显给界面的原始输出最大尾部长度 */
const OUTPUT_TAIL = 1500

/** fsSize 原始结构（只取用到的字段，避免绑定库版本类型） */
interface FsSizeRaw {
  mount: string
  fs?: string
  type?: string
  size: number
  used: number
  available?: number
  use?: number
}

/** 磁盘空间采集器，默认走 systeminformation，测试可注入 fake */
export interface DiskFetcher {
  fsSize(): Promise<FsSizeRaw[]>
}

export function createSystemInformationDiskFetcher(): DiskFetcher {
  return {
    async fsSize() {
      return (await si.fsSize()) as unknown as FsSizeRaw[]
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 深度清理「权威清单」：id → 目标，全部由服务端按环境变量生成，
// 客户端只能传 id，无法注入任意路径。
// ─────────────────────────────────────────────────────────────

export interface DeepCatalogEntry {
  id: string
  kind: DeepCleanupKind
  label: string
  detail: string
  /** kind=path 时的绝对路径（来自环境变量白名单根） */
  path: string
  /** 仅删除匹配的文件名通配（为空则递归清空目录内容但保留目录本身） */
  patterns: string[]
  needsAdmin: boolean
  defaultChecked: boolean
  /** kind=action 时的维护命令脚本 */
  action: string
}

type EnvLike = Record<string, string | undefined>

/** 深度清理允许的根目录（纵深防御：清单路径必须落在这些根下） */
function allowedRoots(platform: Platform, env: EnvLike): string[] {
  if (platform === 'win32') {
    const sysroot = env.SystemRoot || 'C:\\Windows'
    const local = env.LOCALAPPDATA || ''
    const programData = env.ProgramData || 'C:\\ProgramData'
    return [sysroot, local, programData].filter(Boolean)
  }
  return [env.HOME || '/home']
}

/** 生成当前平台的深度清理权威清单 */
export function buildDeepCatalog(
  platform: Platform = detectPlatform(),
  env: EnvLike = process.env
): DeepCatalogEntry[] {
  if (platform === 'win32') {
    const sysroot = env.SystemRoot || 'C:\\Windows'
    const local = env.LOCALAPPDATA || ''
    const programData = env.ProgramData || 'C:\\ProgramData'
    const entries: DeepCatalogEntry[] = [
      {
        id: 'win-update-cache',
        kind: 'path',
        label: 'Windows 更新下载缓存',
        detail: `${sysroot}\\SoftwareDistribution\\Download`,
        path: `${sysroot}\\SoftwareDistribution\\Download`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'win-system-temp',
        kind: 'path',
        label: 'Windows 系统临时文件',
        detail: `${sysroot}\\Temp`,
        path: `${sysroot}\\Temp`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'win-thumbnail',
        kind: 'path',
        label: '缩略图与图标缓存',
        detail: `${local}\\Microsoft\\Windows\\Explorer（仅 thumbcache/iconcache）`,
        path: `${local}\\Microsoft\\Windows\\Explorer`,
        patterns: ['thumbcache_*.db', 'iconcache_*.db'],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'win-wer',
        kind: 'path',
        label: 'Windows 错误报告队列',
        detail: `${programData}\\Microsoft\\Windows\\WER`,
        path: `${programData}\\Microsoft\\Windows\\WER`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'win-delivery',
        kind: 'path',
        label: '传递优化缓存',
        detail: 'Delivery Optimization Cache（需管理员）',
        path: `${sysroot}\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache`,
        patterns: [],
        needsAdmin: true,
        defaultChecked: false,
        action: ''
      },
      {
        id: 'win-explorer-thumb',
        kind: 'action',
        label: '重启资源管理器并清理缩略图缓存',
        detail: 'thumbcache/iconcache 常被 explorer.exe 占用而删不掉；结束后删除并自动重启资源管理器',
        path: '',
        patterns: [],
        needsAdmin: false,
        defaultChecked: false, // 会短暂重启桌面外壳，默认不勾，由用户按需执行
        action: [
          '$ErrorActionPreference = "Continue"',
          '$p = Join-Path $env:LOCALAPPDATA "Microsoft\\Windows\\Explorer"',
          'Get-Process explorer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
          'Start-Sleep -Seconds 1',
          // 逐个 try/catch 统计删除失败：原先 Remove-Item -ErrorAction SilentlyContinue 吞掉所有错误，
          // 末尾又无条件 "OK"，于是缓存被占用删不掉也报成功。
          '$failed = 0',
          'if (Test-Path -LiteralPath $p) {',
          '  $files = Get-ChildItem -LiteralPath $p -File -Force -ErrorAction SilentlyContinue |',
          '    Where-Object { $_.Name -like "thumbcache_*.db" -or $_.Name -like "iconcache_*.db" }',
          '  foreach ($f in $files) {',
          '    try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch { $failed++ }',
          '  }',
          '}',
          // 无论前面是否出错都必须把外壳拉回来，避免用户桌面消失
          'if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }',
          // 诚实回执：有缓存删不掉（被占用/无权）就回 ERR: 并不以 0 退出，不再无条件 OK
          'if ($failed -gt 0) { "ERR:部分缩略图缓存被占用或无权删除，未能完全清理"; exit 1 }',
          '"OK"'
        ].join('\n')
      },
      {
        id: 'win-prefetch',
        kind: 'path',
        label: '预读取文件 Prefetch',
        detail: `${sysroot}\\Prefetch（系统会自动重建）`,
        path: `${sysroot}\\Prefetch`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'win-dism-cleanup',
        kind: 'action',
        label: '组件存储清理（WinSxS）',
        detail: 'DISM StartComponentCleanup，清理旧组件（需管理员，耗时数分钟）',
        path: '',
        patterns: [],
        needsAdmin: true,
        defaultChecked: false,
        // 不使用 /ResetBase：保留卸载已装更新的能力，安全可逆
        action: 'Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet'
      },
      {
        id: 'win-hibernate-off',
        kind: 'action',
        label: '关闭休眠以释放 hiberfil.sys',
        detail: '释放约等于内存大小的空间；如需恢复，以管理员执行 powercfg /hibernate on',
        path: '',
        patterns: [],
        needsAdmin: true,
        defaultChecked: false, // 改变系统行为（休眠/快速启动），默认不勾
        action: 'powercfg /hibernate off'
      }
    ]
    return entries.filter((e) => e.kind === 'action' || e.path)
  }

  const home = env.HOME || ''
  if (platform === 'darwin') {
    return [
      {
        id: 'mac-user-cache',
        kind: 'path',
        label: '用户缓存 ~/Library/Caches',
        detail: `${home}/Library/Caches`,
        path: `${home}/Library/Caches`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'mac-user-logs',
        kind: 'path',
        label: '用户日志 ~/Library/Logs',
        detail: `${home}/Library/Logs`,
        path: `${home}/Library/Logs`,
        patterns: [],
        needsAdmin: false,
        defaultChecked: true,
        action: ''
      },
      {
        id: 'mac-brew-cleanup',
        kind: 'action',
        label: 'Homebrew 旧版本与缓存清理',
        detail: 'brew cleanup -s（未安装 Homebrew 时自动跳过）',
        path: '',
        patterns: [],
        needsAdmin: false,
        defaultChecked: false,
        // 未装 brew 视为「可跳过」（exit 0）；但 brew 已装却 cleanup 失败必须如实报错。
        // 原先 `… && brew cleanup -s; echo OK` 的 `; echo OK` 使退出码恒 0，失败也报成功。
        action: [
          'if ! command -v brew >/dev/null 2>&1; then echo OK; exit 0; fi',
          'brew cleanup -s || { echo "ERR:brew cleanup 失败"; exit 1; }',
          'echo OK'
        ].join('\n')
      }
    ]
  }

  // linux / other
  return [
    {
      id: 'linux-user-cache',
      kind: 'path',
      label: '用户缓存 ~/.cache',
      detail: `${home}/.cache`,
      path: `${home}/.cache`,
      patterns: [],
      needsAdmin: false,
      defaultChecked: true,
      action: ''
    },
    {
      id: 'linux-journal-vacuum',
      kind: 'action',
      label: 'systemd 日志压缩到 100MB',
      detail: 'journalctl --vacuum-size=100M（需 root 与 systemd）',
      path: '',
      patterns: [],
      needsAdmin: true,
      defaultChecked: false,
      // 诚实回执：原先 `… && journalctl …; echo OK` 末尾 echo OK 使退出码恒 0，
      // 非 root 导致 vacuum 失败仍报成功。现按命令真实退出码收尾，失败回 ERR: 并 exit 1。
      action: [
        'command -v journalctl >/dev/null 2>&1 && journalctl --vacuum-size=100M || { echo "ERR:journalctl vacuum 失败（需 root 与 systemd）"; exit 1; }',
        'echo OK'
      ].join('\n')
    },
    {
      id: 'linux-apt-clean',
      kind: 'action',
      label: 'apt 已下载安装包缓存',
      detail: 'apt-get clean（Debian/Ubuntu，需 root）',
      path: '',
      patterns: [],
      needsAdmin: true,
      defaultChecked: false,
      // 诚实回执：非 root 导致 apt-get clean 失败不得再被 `; echo OK` 吞成成功。
      action: [
        'command -v apt-get >/dev/null 2>&1 && apt-get clean || { echo "ERR:apt-get clean 失败（需 root）"; exit 1; }',
        'echo OK'
      ].join('\n')
    }
  ]
}

// ─────────────────────────────────────────────────────────────
// 深度清理：扫描脚本（测量 path 项体积；action 项由 JS 直接补充）
// ─────────────────────────────────────────────────────────────

/** PowerShell 单引号字面量转义 */
function psSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** shell 单引号转义：' → '\'' */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function buildDeepScanScriptWin(catalog: DeepCatalogEntry[]): string {
  const lines: string[] = [
    'function __galeSizeDir($p){ if($p -and (Test-Path $p)){ [int64]((Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum) } else { 0 } }',
    'function __galeLike($n,[string[]]$pats){ foreach($p in $pats){ if($n -like $p){ return $true } }; return $false }',
    'function __galeSizeFiles($p,[string[]]$pats){ if($p -and (Test-Path $p)){ [int64]((Get-ChildItem $p -File -Force -ErrorAction SilentlyContinue | Where-Object { __galeLike $_.Name $pats } | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum) } else { 0 } }',
    '$plans = @()'
  ]
  for (const e of catalog.filter((c) => c.kind === 'path')) {
    const p = psSingleQuote(e.path)
    const measure =
      e.patterns.length > 0
        ? `__galeSizeFiles ${p} @(${e.patterns.map((x) => psSingleQuote(x)).join(',')})`
        : `__galeSizeDir ${p}`
    lines.push(
      `$sz = ${measure}; $plans += [pscustomobject]@{ id=${psSingleQuote(e.id)}; kind='path'; label=${psSingleQuote(
        e.label
      )}; detail=${psSingleQuote(e.detail)}; path=${p}; size=[int64]$sz; needsAdmin=$${e.needsAdmin ? 'true' : 'false'}; safe=$true; defaultChecked=$${
        e.defaultChecked ? 'true' : 'false'
      } }`
    )
  }
  lines.push('$plans | ConvertTo-Json -Compress -Depth 3')
  return lines.join('\n')
}

function buildDeepScanScriptUnix(catalog: DeepCatalogEntry[]): string {
  const lines: string[] = [
    'esc() { printf \'%s\' "$1" | sed \'s/\\\\/\\\\\\\\/g; s/"/\\\\"/g\'; }',
    'first=1',
    'emit() { if [ "$first" = "1" ]; then first=0; else printf \',\'; fi; printf \'%s\' "$1"; }',
    "printf '['"
  ]
  for (const e of catalog.filter((c) => c.kind === 'path')) {
    const p = shq(e.path)
    lines.push(`p=${p}`)
    lines.push('if [ -d "$p" ]; then sz=$(du -sk "$p" 2>/dev/null | awk \'{print $1}\'); [ -z "$sz" ] && sz=0; size=$((sz*1024)); else size=0; fi')
    lines.push(
      `lp=$(esc "$p"); ll=$(esc ${shq(e.label)}); ld=$(esc ${shq(e.detail)}); emit "{\\"id\\":\\"${e.id}\\",\\"kind\\":\\"path\\",\\"label\\":\\"$ll\\",\\"detail\\":\\"$ld\\",\\"path\\":\\"$lp\\",\\"size\\":$size,\\"needsAdmin\\":${e.needsAdmin}, \\"safe\\":true,\\"defaultChecked\\":${e.defaultChecked}}"`
    )
  }
  lines.push("printf ']'")
  return lines.join('\n')
}

export function buildDeepScanScript(
  platform: Platform = detectPlatform(),
  catalog: DeepCatalogEntry[] = buildDeepCatalog(platform)
): string {
  return platform === 'win32'
    ? buildDeepScanScriptWin(catalog)
    : buildDeepScanScriptUnix(catalog)
}

// ─────────────────────────────────────────────────────────────
// 深度清理：单项执行脚本
// ─────────────────────────────────────────────────────────────

/**
 * 单个目录的清理脚本（保留目录本身，只删内容）。
 *
 * 与优化中心同理：改为逐项 try/catch 统计并以 JSON 回传。
 * 旧实现的 `Get-ChildItem | Remove-Item -ErrorAction SilentlyContinue` 会把
 * 被 explorer/系统占用的文件全部静默跳过，然后无条件 echo "OK"，
 * 于是界面显示「清理成功」而磁盘空间纹丝不动。
 */
export function buildDeepCleanScript(entry: DeepCatalogEntry, platform: Platform): string {
  if (entry.kind === 'action') return entry.action

  if (platform === 'win32') {
    const p = psSingleQuote(entry.path)
    // 有 patterns 时只删匹配文件；否则递归清空（先文件后目录，避免目录非空导致整棵失败）
    const select =
      entry.patterns.length > 0
        ? `Get-ChildItem -LiteralPath ${p} -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like ${entry.patterns
            .map((x) => psSingleQuote(x))
            .join(' -or $_.Name -like ')} }`
        : `Get-ChildItem -LiteralPath ${p} -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object -Property PSIsContainer`
    return [
      '$ErrorActionPreference = "Continue"',
      '$deleted = [int64]0; $deletedCount = 0; $failedCount = 0',
      '$locked = New-Object System.Collections.ArrayList',
      `if (Test-Path -LiteralPath ${p}) {`,
      `  $items = @(${select})`,
      '  foreach ($i in $items) {',
      '    try {',
      '      $n = [int64]0',
      '      if (-not $i.PSIsContainer) { $n = [int64]$i.Length }',
      // 有 patterns 时只删文件（不递归）；否则删目录内容（目录可能非空，需 -Recurse）
      `      Remove-Item -LiteralPath $i.FullName${entry.patterns.length > 0 ? '' : ' -Recurse'} -Force -ErrorAction Stop`,
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

  // find -mindepth 1 -depth -delete：只删内容不删路径本身（BSD/GNU find 均支持）
  return `p=${shq(entry.path)}
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

// ─────────────────────────────────────────────────────────────
// 磁盘错误检查 / 修复（chkdsk / diskutil）
// ─────────────────────────────────────────────────────────────

const WIN_DRIVE_RE = /^([A-Za-z]):[\\/]?$/
const UNIX_MOUNT_RE = /^\/[A-Za-z0-9_.\/ -]*$/

/** Windows 挂载点 → 盘符（X:）；非法返回 null */
export function toWinDrive(mount: string): string | null {
  const m = String(mount).match(WIN_DRIVE_RE)
  return m ? `${m[1].toUpperCase()}:` : null
}

/**
 * 生成文件系统检查/修复脚本。
 * - win：检查=只读 chkdsk X:；修复=chkdsk X: /scan（NTFS 在线，无需重启/不锁定）
 * - mac：diskutil verifyVolume / repairVolume
 * - linux：返回 null（挂载态 fsck 不安全，诚实降级）
 * 非法挂载点返回 null（调用方拒绝且不执行命令）。
 */
export function buildCheckVolumeScript(
  mount: string,
  fix: boolean,
  platform: Platform = detectPlatform()
): string | null {
  if (platform === 'win32') {
    const drive = toWinDrive(mount)
    if (!drive) return null
    return fix ? `chkdsk ${drive} /scan` : `chkdsk ${drive}`
  }
  if (platform === 'darwin') {
    if (!UNIX_MOUNT_RE.test(mount)) return null
    return fix ? `diskutil repairVolume ${shq(mount)}` : `diskutil verifyVolume ${shq(mount)}`
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 系统文件 / DLL 修复（sfc / dism，仅 Windows）
// ─────────────────────────────────────────────────────────────

export function buildSystemRepairScript(
  kind: SystemRepairKind,
  platform: Platform = detectPlatform()
): string | null {
  if (platform !== 'win32') return null
  if (kind === 'sfc') return 'sfc /scannow'
  if (kind === 'dism-restore') return 'Dism.exe /Online /Cleanup-Image /RestoreHealth'
  return null
}

// ─────────────────────────────────────────────────────────────
// 解析器（平台无关）
// ─────────────────────────────────────────────────────────────

function parseJsonArray(stdout: string): unknown[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    const v = JSON.parse(trimmed)
    return Array.isArray(v) ? v : [v] // PowerShell 单元素时输出对象而非数组
  } catch {
    return []
  }
}

function toDeepPlan(raw: Record<string, unknown>): DeepCleanupPlan {
  const size = raw.size
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind === 'action' ? 'action' : 'path',
    label: String(raw.label ?? ''),
    detail: String(raw.detail ?? ''),
    sizeBytes: typeof size === 'number' ? size : Number(size) || 0,
    needsAdmin: raw.needsAdmin === true,
    safe: raw.safe !== false,
    defaultChecked: raw.defaultChecked === true
  }
}

function tail(text: string): string {
  const t = (text || '').trim()
  return t.length > OUTPUT_TAIL ? t.slice(-OUTPUT_TAIL) : t
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

function toVolume(raw: FsSizeRaw): DiskVolume {
  const size = Number(raw.size) || 0
  const used = Number(raw.used) || 0
  const free =
    typeof raw.available === 'number' && Number.isFinite(raw.available)
      ? Math.max(0, raw.available)
      : Math.max(0, size - used)
  const percent = size > 0 ? (used / size) * 100 : Number(raw.use) || 0
  return {
    mount: String(raw.mount ?? ''),
    label: String(raw.fs ?? raw.mount ?? ''),
    fsType: String(raw.type ?? ''),
    sizeBytes: size,
    usedBytes: used,
    freeBytes: free,
    percent: clampPct(percent),
    lowSpace: size > 0 && (clampPct(percent) >= LOW_SPACE_PERCENT || (free > 0 && free < LOW_SPACE_BYTES))
  }
}

// ─────────────────────────────────────────────────────────────
// Service 工厂
// ─────────────────────────────────────────────────────────────

export function createDiskService(
  runner: ExecRunner,
  platform: Platform = detectPlatform(),
  fetcher?: Partial<DiskFetcher>
) {
  const f: DiskFetcher = { ...createSystemInformationDiskFetcher(), ...(fetcher ?? {}) }
  const catalog = buildDeepCatalog(platform)
  const roots = allowedRoots(platform, process.env)

  /** 纵深防御：路径必须落在允许根下（Windows 用反斜杠/正斜杠双重判断） */
  const isSafeRoot = (p: string): boolean =>
    roots.some((r) => p === r || p.startsWith(r + '\\') || p.startsWith(r + '/'))

  const volumes = async (): Promise<DiskVolume[]> => {
    const list = await f.fsSize()
    return (list ?? [])
      .filter((d) => Number(d.size) > 0)
      .map(toVolume)
      .sort((a, b) => a.mount.localeCompare(b.mount))
  }

  const scanDeepCleanup = async (): Promise<DeepCleanupPlan[]> => {
    const { stdout } = await runner.run(buildDeepScanScript(platform, catalog))
    const pathPlans = parseJsonArray(stdout).map((r) => toDeepPlan(r as Record<string, unknown>))
    // action 项体积执行前不可预估，直接由权威清单补充
    const actionPlans: DeepCleanupPlan[] = catalog
      .filter((e) => e.kind === 'action')
      .map((e) => ({
        id: e.id,
        kind: 'action' as const,
        label: e.label,
        detail: e.detail,
        sizeBytes: 0,
        needsAdmin: e.needsAdmin,
        safe: true,
        defaultChecked: e.defaultChecked
      }))
    return [...pathPlans, ...actionPlans]
  }

  const runDeepCleanup = async (ids: string[]): Promise<CleanupResult[]> => {
    // 复用已有的卷信息采集器做「清理前/后」空间实测
    const meter = createSpaceMeter({ fsSize: () => f.fsSize() })
    const results: CleanupResult[] = []
    // 只认服务端权威清单里的 id；去重后逐个解析出真实路径与类型
    for (const id of [...new Set((ids ?? []).map((v) => String(v)))]) {
      const entry = catalog.find((e) => e.id === id)
      if (!entry) {
        results.push({ id, ok: false, error: '未知清理项，已跳过' })
        continue
      }
      if (entry.kind === 'path' && !isSafeRoot(entry.path)) {
        results.push({ id, ok: false, error: '路径不在安全白名单内，已跳过' })
        continue
      }
      // action 项没有目录，按系统卷测（win → C:，unix → /）
      const probe = entry.path || (platform === 'win32' ? 'C:\\' : '/')
      const before = await meter.freeBytesForPath(probe, platform)

      const script = buildDeepCleanScript(entry, platform)
      const { code, stdout, stderr } = await runner.run(script)

      let raw: CleanupResult
      if (entry.kind === 'action') {
        // action 项脚本自带 echo OK / 兜底
        // action 项多为系统工具（DISM 等），输出不一定是 OK 令牌，故以退出码为准；
        // 但脚本显式回了 ERR: 时必须如实报错（原先只看退出码会漏报）
        const explicitErr = /^ERR:/m.test(stdout)
        const ok = code === 0 && !explicitErr
        raw = {
          id,
          ok,
          error: ok
            ? undefined
            : explicitErr
              ? parseActionOutcome(stdout, code).message
              : stderr.trim() || '执行失败（可能需要管理员权限）'
        }
      } else {
        const stats = parseCleanupStats(stdout)
        if (code !== 0 && !stats) {
          raw = { id, ok: false, error: stderr.trim() || '清理失败（可能需要管理员权限）' }
        } else if (stats) {
          const ok = stats.failedCount === 0 || stats.deletedCount > 0
          raw = {
            id,
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
          // 兜底：脚本没回传统计 JSON（旧脚本或异常路径）时按统一令牌判定。
          // 不可用 stdout.includes('OK') —— 错误信息里含 "OK" 字样会被误判为成功。
          const outcome = parseActionOutcome(stdout, code)
          raw = { id, ok: outcome.ok, error: outcome.ok ? undefined : outcome.message }
        }
      }

      const after = await meter.freeBytesForPath(probe, platform)
      const released = diffReleasedBytes(before, after)
      results.push(released === undefined ? raw : { ...raw, releasedBytes: released })
    }
    return results
  }

  const checkVolume = async (mount: string, fix: boolean): Promise<DiskRepairResult> => {
    const script = buildCheckVolumeScript(mount, fix, platform)
    if (!script) {
      // linux：挂载状态下 fsck 有损坏风险，诚实降级不执行
      if (platform === 'linux') {
        return {
          target: mount,
          ok: false,
          repaired: false,
          summary: 'Linux 需在卸载状态下由 root 执行 fsck，应用内不做在线修复以保护数据',
          output: '',
          needsAdmin: true,
          unsupported: true
        }
      }
      return {
        target: mount,
        ok: false,
        repaired: false,
        summary: '盘符/挂载点格式非法，已拒绝执行',
        output: '',
        needsAdmin: false,
        unsupported: false
      }
    }

    const { code, stdout, stderr } = await runner.run(script)
    const out = tail(`${stdout}\n${stderr}`)
    const noProblem = /no problems|did not find|appears to be OK|未发现|没有发现|没有问题/i.test(stdout)
    const fixed = /successfully repaired|successfully fixed|finished (repair|verifying)|已修复|修复完成/i.test(stdout)

    let summary: string
    if (platform === 'win32') {
      if (code === 0 && noProblem) summary = '未检测到文件系统错误'
      else if (code === 0 && fix) summary = fixed ? '在线扫描修复已完成' : '在线扫描已完成，未发现需修复项'
      else if (code === 0) summary = '检查已完成'
      else summary = fix ? '在线修复未完成，可能需要管理员权限' : '检查发现问题或需要管理员权限，可尝试在线修复'
    } else {
      summary = code === 0 ? (fixed ? '卷修复已完成' : '未检测到文件系统错误') : '验证/修复未完成，可能需要 root 权限'
    }

    return {
      target: mount,
      ok: code === 0,
      repaired: fix && fixed,
      summary,
      output: out,
      needsAdmin: code !== 0,
      unsupported: false
    }
  }

  const repairSystemFiles = async (kind: SystemRepairKind): Promise<DiskRepairResult> => {
    const targetName = kind === 'sfc' ? 'SFC 系统文件检查器' : 'DISM 组件存储修复'
    const script = buildSystemRepairScript(kind, platform)
    if (!script) {
      return {
        target: targetName,
        ok: false,
        repaired: false,
        summary: '系统文件 / DLL 修复（SFC、DISM）仅 Windows 提供，当前系统不支持',
        output: '',
        needsAdmin: false,
        unsupported: platform !== 'win32'
      }
    }

    const { code, stdout, stderr } = await runner.run(script)
    const out = tail(`${stdout}\n${stderr}`)
    const clean = /did not find any integrity violations|未找到任何完整性冲突|no component store corruption|未检测到组件存储损坏/i.test(stdout)
    const fixed = /successfully repaired|成功修复|已修复|restore.*completed|repair operation completed/i.test(stdout)
    const needAdmin = /administrator|管理员|权限|elevat/i.test(`${stdout}\n${stderr}`)

    let summary: string
    if (kind === 'sfc') {
      if (code === 0 && clean) summary = '系统文件完整，未发现损坏（含 DLL）'
      else if (code === 0 && fixed) summary = '发现损坏的系统文件并已成功修复'
      else if (code === 0) summary = 'SFC 扫描已完成'
      else summary = 'SFC 修复未完成，请以管理员身份运行后重试'
    } else {
      if (code === 0 && clean) summary = '组件存储状态正常，无需修复'
      else if (code === 0) summary = 'DISM 组件存储扫描与修复已完成'
      else summary = 'DISM 修复未完成，需管理员权限与可用网络'
    }

    return {
      target: targetName,
      ok: code === 0,
      repaired: fixed,
      summary,
      output: out,
      needsAdmin: code !== 0 || needAdmin,
      unsupported: false
    }
  }

  return { volumes, scanDeepCleanup, runDeepCleanup, checkVolume, repairSystemFiles }
}
