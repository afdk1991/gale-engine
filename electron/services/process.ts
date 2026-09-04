import type {
  ProcessActionResult,
  ProcessInfo,
  ProcessPriorityLevel,
  ProcessSortKey
} from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

/** 系统关键进程名：结束 / 挂起一律拒绝（双保险：JS 构造 guard + PowerShell 权威校验） */
export const PROTECTED_NAMES = [
  'System',
  'Idle',
  'Registry',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'Memory Compression'
]

export const PRIORITY_CLASS: Record<ProcessPriorityLevel, string> = {
  low: 'Idle',
  belowNormal: 'BelowNormal',
  normal: 'Normal',
  aboveNormal: 'AboveNormal',
  high: 'High'
}

/** unix 优先级映射：renice 的 nice 值（大=低优先级；负值需 root） */
export const PRIORITY_NICE: Record<ProcessPriorityLevel, number> = {
  low: 19,
  belowNormal: 10,
  normal: 0,
  aboveNormal: -5,
  high: -10
}

/** unix 关键系统进程名（内核/init 层）：kill/suspend/resume 一律拒绝 */
export const PROTECTED_UNIX_NAMES = [
  'kernel_task',
  'launchd',
  'systemd',
  'init',
  'kthreadd',
  'swapper',
  'sched',
  'mach_init'
]

const PROTECTED_JSON = JSON.stringify(PROTECTED_NAMES)

/** PowerShell 单引号数组字面量（含空格的项必须用单引号，@([".."]) JSON 语法会解析失败） */
const PROTECTED_PS_LIST = `@(${PROTECTED_NAMES.map((n) => `'${n}'`).join(',')})`

// ─────────────────────────────────────────────────────────────
// Windows：PowerShell 脚本
// ─────────────────────────────────────────────────────────────

/**
 * 采集进程列表：双采样 CPU 累计秒差值 → 估算 CPU%。
 * 输出 JSON 数组，字段与 ProcessInfo 对齐。
 */
const LIST_SCRIPT_WIN = `
$cores = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).NumberOfLogicalProcessors
if (-not $cores) { $cores = [int]$env:NUMBER_OF_PROCESSORS }
if (-not $cores) { $cores = 1 }
$s1 = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $s1[[int]$_.Id] = [double]$_.CPU }
Start-Sleep -Milliseconds 600
$protectedNames = ${PROTECTED_PS_LIST}
$items = @()
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $id = [int]$_.Id
  $cur = [double]$_.CPU
  $prev = if ($s1.ContainsKey($id)) { [double]$s1[$id] } else { $cur }
  $delta = [math]::Max(0.0, $cur - $prev)
  $cpu = [math]::Round($delta / 0.6 / [math]::Max(1, $cores) * 100.0, 1)
  $prot = ($id -le 4) -or ($protectedNames -contains $_.ProcessName)
  $items += [pscustomobject]@{
    pid = $id
    name = $_.ProcessName
    cpu = $cpu
    mem = [math]::Round([double]$_.WorkingSet64 / 1MB, 1)
    status = if ($_.Responding -eq $false) { 'suspended' } else { 'running' }
    protected = [bool]$prot
  }
}
$items | ConvertTo-Json -Compress
`

/** Windows：进程存在性与系统保护校验（PowerShell 端权威） */
function buildGuardWin(pid: number): string {
  return (
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if (-not $p) { "ERR:进程不存在"; exit } ` +
    `if ($p.Id -le 4 -or ${PROTECTED_PS_LIST} -contains $p.ProcessName) { "ERR:受保护的系统进程，已拒绝"; exit }`
  )
}

/** P/Invoke 挂起/恢复定义，每次 powershell 进程内重新 Add-Type */
const SUSPEND_TYPE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GaleProc {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool b, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@ -ErrorAction Stop
`

// ─────────────────────────────────────────────────────────────
// macOS / Linux：POSIX bash 脚本（兼容 bash 3.2，macOS 默认）
// ─────────────────────────────────────────────────────────────

/**
 * unix 采集进程列表：双采样 CPU 累计时间(ps time 字段)差值 → 估算 CPU%。
 * - ps -o time 格式 [[dd-]hh:]mm:ss，awk 换算为秒。
 * - rss 单位 KB → MB。
 * - stat 含 T/t（stopped）→ suspended。
 * - 输出 JSON 数组，字段与 ProcessInfo 对齐。
 */
const LIST_SCRIPT_UNIX = `
cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null)
case "$cores" in ''|*[!0-9]*) cores=1 ;; esac
t1=$(mktemp 2>/dev/null) || t1=/tmp/gale-ps1.$$
t2=$(mktemp 2>/dev/null) || t2=/tmp/gale-ps2.$$
ps -axo pid=,comm=,time=,rss=,stat= 2>/dev/null > "$t1"
sleep 0.6
ps -axo pid=,comm=,time=,rss=,stat= 2>/dev/null > "$t2"
awk -v cores="$cores" '
function tsec(t,   a,b,h,m,s,n) {
  n = split(t, a, ":")
  s = a[n] + 0
  m = (n >= 2 ? a[n-1] : 0) + 0
  h = (n >= 3 ? a[n-2] : 0) + 0
  if (a[1] ~ /-/) { split(a[1], b, "-"); h = h + b[1] * 24 }
  return s + m * 60 + h * 3600
}
function esc(s) { gsub(/\\\\/, "\\\\\\\\", s); gsub(/"/, "\\\\\\"", s); return s }
NR == FNR {
  pid = $1; t1[pid] = tsec($3); rss1[pid] = $4; stat1[pid] = $5
  next
}
{
  pid = $1; comm = esc($2); cur = tsec($3); rss = $4; st = $5
  prev = (pid in t1) ? t1[pid] : cur
  delta = cur - prev; if (delta < 0) delta = 0
  cpu = delta / 0.6 / cores * 100
  if (cpu < 0.05) cpu = 0
  mem = rss / 1024
  status = (st ~ /[Tt]/) ? "suspended" : "running"
  prot = (pid <= 1 || comm == "kernel_task" || comm == "launchd" || comm == "systemd" || comm == "init" || comm == "kthreadd" || comm == "swapper")
  printf "%s{\\"pid\\":%d,\\"name\\":\\"%s\\",\\"cpu\\":%.1f,\\"mem\\":%.1f,\\"status\\":\\"%s\\",\\"protected\\":%s}", (n ? "," : ""), pid, comm, cpu, mem, status, (prot ? "true" : "false")
  n = 1
}
END { print "" }
' "$t1" "$t2"
rm -f "$t1" "$t2"
`

/** unix：进程存在性与系统保护校验（bash） */
function buildGuardUnix(pid: number): string {
  return `pid=${pid}
if ! kill -0 "$pid" 2>/dev/null; then echo "ERR:进程不存在"; exit 0; fi
name=$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')
case "$name" in
  kernel_task|launchd|systemd|init|kthreadd|swapper|sched|mach_init)
    echo "ERR:受保护的系统进程，已拒绝"; exit 0 ;;
esac`
}

// ─────────────────────────────────────────────────────────────
// 平台分发生成器（win32 → PowerShell，其余 → bash）
// ─────────────────────────────────────────────────────────────

export function buildListScript(platform: Platform = detectPlatform()): string {
  return platform === 'win32' ? LIST_SCRIPT_WIN : LIST_SCRIPT_UNIX
}

export function buildKillScript(pid: number, platform: Platform = detectPlatform()): string {
  return platform === 'win32'
    ? `${buildGuardWin(pid)}\nStop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; "OK"`
    : `${buildGuardUnix(pid)}\nkill -9 "$pid" 2>/dev/null && echo "OK" || { echo "ERR:结束进程失败（可能需要管理员权限）"; exit 0; }`
}

export function buildSuspendScript(pid: number, platform: Platform = detectPlatform()): string {
  return platform === 'win32'
    ? `${SUSPEND_TYPE}\n${buildGuardWin(pid)}\n$h = [GaleProc]::OpenProcess(0x1F0FFF, $false, ${pid})\nif ($h -eq [IntPtr]::Zero) { "ERR:无法打开进程（可能需要管理员权限）" } else {\n  $r = [GaleProc]::NtSuspendProcess($h)\n  [GaleProc]::CloseHandle($h) | Out-Null\n  if ($r -eq 0) { "OK" } else { "ERR:系统调用失败（代码 $r）" }\n}`
    : `${buildGuardUnix(pid)}\nkill -STOP "$pid" 2>/dev/null && echo "OK" || { echo "ERR:挂起进程失败（可能需要管理员权限）"; exit 0; }`
}

export function buildResumeScript(pid: number, platform: Platform = detectPlatform()): string {
  return platform === 'win32'
    ? `${SUSPEND_TYPE}\n${buildGuardWin(pid)}\n$h = [GaleProc]::OpenProcess(0x1F0FFF, $false, ${pid})\nif ($h -eq [IntPtr]::Zero) { "ERR:无法打开进程（可能需要管理员权限）" } else {\n  $r = [GaleProc]::NtResumeProcess($h)\n  [GaleProc]::CloseHandle($h) | Out-Null\n  if ($r -eq 0) { "OK" } else { "ERR:系统调用失败（代码 $r）" }\n}`
    : `${buildGuardUnix(pid)}\nkill -CONT "$pid" 2>/dev/null && echo "OK" || { echo "ERR:恢复进程失败（可能需要管理员权限）"; exit 0; }`
}

export function buildPriorityScript(
  pid: number,
  level: ProcessPriorityLevel,
  platform: Platform = detectPlatform()
): string {
  const cls = PRIORITY_CLASS[level]
  const nice = PRIORITY_NICE[level]
  if (platform === 'win32') {
    if (!cls) return ''
    return `${buildGuardWin(pid)}\ntry { (Get-Process -Id ${pid} -ErrorAction Stop).PriorityClass = "${cls}"; "OK" } catch { "ERR:$($_.Exception.Message)" }`
  }
  if (nice === undefined) return ''
  return `${buildGuardUnix(pid)}\nif renice -n ${nice} "$pid" >/dev/null 2>&1; then echo "OK"; else echo "ERR:设置优先级失败（可能需要管理员权限）"; exit 0; fi`
}

// ─────────────────────────────────────────────────────────────
// 解析器（平台无关，统一解析 JSON / 文本输出）
// ─────────────────────────────────────────────────────────────

export function parseProcessList(stdout: string): ProcessInfo[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  let raw: unknown[]
  try {
    raw = JSON.parse(trimmed) as unknown[]
  } catch {
    return []
  }
  return raw.map((r) => toProcessInfo(r as Record<string, unknown>))
}

function toProcessInfo(raw: Record<string, unknown>): ProcessInfo {
  const pid = Number(raw.pid)
  const mem = Number(raw.mem)
  const cpu = Number(raw.cpu)
  return {
    pid: Number.isFinite(pid) ? Math.trunc(pid) : 0,
    name: String(raw.name ?? ''),
    cpuPercent: Number.isFinite(cpu) ? cpu : 0,
    memMB: Number.isFinite(mem) ? mem : 0,
    status: raw.status === 'suspended' ? 'suspended' : 'running',
    protected: raw.protected === true || raw.protected === 'True'
  }
}

export function sortProcesses(list: ProcessInfo[], sort?: ProcessSortKey): ProcessInfo[] {
  const arr = [...list]
  switch (sort) {
    case 'cpu':
      arr.sort((a, b) => b.cpuPercent - a.cpuPercent)
      break
    case 'mem':
      arr.sort((a, b) => b.memMB - a.memMB)
      break
    case 'name':
      arr.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
      break
    default:
      break
  }
  return arr
}

export function parseActionResult(stdout: string): ProcessActionResult {
  const text = stdout.trim()
  if (text.startsWith('ERR:')) return { ok: false, message: text.slice(4) }
  if (text.includes('OK')) return { ok: true, message: '操作成功' }
  return { ok: false, message: text || '操作失败' }
}

export function createProcessService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const list = async (sort?: ProcessSortKey): Promise<ProcessInfo[]> => {
    const { stdout } = await runner.run(buildListScript(platform))
    return sortProcesses(parseProcessList(stdout), sort)
  }

  const kill = async (pid: number): Promise<ProcessActionResult> => {
    const { stdout } = await runner.run(buildKillScript(pid, platform))
    return parseActionResult(stdout)
  }

  const suspend = async (pid: number): Promise<ProcessActionResult> => {
    const { stdout } = await runner.run(buildSuspendScript(pid, platform))
    return parseActionResult(stdout)
  }

  const resume = async (pid: number): Promise<ProcessActionResult> => {
    const { stdout } = await runner.run(buildResumeScript(pid, platform))
    return parseActionResult(stdout)
  }

  const priority = async (pid: number, level: ProcessPriorityLevel): Promise<ProcessActionResult> => {
    const script = buildPriorityScript(pid, level, platform)
    if (!script) return { ok: false, message: '无效的优先级等级' }
    const { stdout } = await runner.run(script)
    return parseActionResult(stdout)
  }

  return { list, kill, suspend, resume, priority }
}
