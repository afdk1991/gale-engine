import type {
  ProcessActionResult,
  ProcessInfo,
  ProcessPriorityLevel,
  ProcessSortKey
} from '../../shared/types'
import type { ExecRunner } from './shell'

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

const PROTECTED_JSON = JSON.stringify(PROTECTED_NAMES)

/** PowerShell 单引号数组字面量（含空格的项必须用单引号，@([".."]) JSON 语法会解析失败） */
const PROTECTED_PS_LIST = `@(${PROTECTED_NAMES.map((n) => `'${n}'`).join(',')})`

/**
 * 采集进程列表：双采样 CPU 累计秒差值 → 估算 CPU%。
 * 输出 JSON 数组，字段与 ProcessInfo 对齐。
 */
const LIST_SCRIPT = `
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

/** 进程存在性与系统保护校验（PowerShell 端权威） */
function buildGuard(pid: number): string {
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

export function createProcessService(runner: ExecRunner) {
  const list = async (sort?: ProcessSortKey): Promise<ProcessInfo[]> => {
    const { stdout } = await runner.run(LIST_SCRIPT)
    return sortProcesses(parseProcessList(stdout), sort)
  }

  const kill = async (pid: number): Promise<ProcessActionResult> => {
    const script = `${buildGuard(pid)}\nStop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; "OK"`
    const { stdout } = await runner.run(script)
    return parseActionResult(stdout)
  }

  const suspend = async (pid: number): Promise<ProcessActionResult> => {
    const script = `${SUSPEND_TYPE}\n${buildGuard(pid)}\n$h = [GaleProc]::OpenProcess(0x1F0FFF, $false, ${pid})\nif ($h -eq [IntPtr]::Zero) { "ERR:无法打开进程（可能需要管理员权限）" } else {\n  $r = [GaleProc]::NtSuspendProcess($h)\n  [GaleProc]::CloseHandle($h) | Out-Null\n  if ($r -eq 0) { "OK" } else { "ERR:系统调用失败（代码 $r）" }\n}`
    const { stdout } = await runner.run(script)
    return parseActionResult(stdout)
  }

  const resume = async (pid: number): Promise<ProcessActionResult> => {
    const script = `${SUSPEND_TYPE}\n${buildGuard(pid)}\n$h = [GaleProc]::OpenProcess(0x1F0FFF, $false, ${pid})\nif ($h -eq [IntPtr]::Zero) { "ERR:无法打开进程（可能需要管理员权限）" } else {\n  $r = [GaleProc]::NtResumeProcess($h)\n  [GaleProc]::CloseHandle($h) | Out-Null\n  if ($r -eq 0) { "OK" } else { "ERR:系统调用失败（代码 $r）" }\n}`
    const { stdout } = await runner.run(script)
    return parseActionResult(stdout)
  }

  const priority = async (pid: number, level: ProcessPriorityLevel): Promise<ProcessActionResult> => {
    const cls = PRIORITY_CLASS[level]
    if (!cls) return { ok: false, message: '无效的优先级等级' }
    const script = `${buildGuard(pid)}\ntry { (Get-Process -Id ${pid} -ErrorAction Stop).PriorityClass = "${cls}"; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    const { stdout } = await runner.run(script)
    return parseActionResult(stdout)
  }

  return { list, kill, suspend, resume, priority }
}
