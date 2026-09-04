import type { ServiceStartupType, ToolResult, WinService } from '../../shared/types'
import type { ExecRunner } from './shell'

/**
 * 系统关键服务：停止一律拒绝（JS 白名单 + PowerShell 端 CanStop 双保险）。
 * 这些服务被停止会直接导致系统失去 RPC / COM / WMI / 计划任务等基础能力。
 */
export const PROTECTED_SERVICES = [
  'RpcSs',
  'RpcEptMapper',
  'DcomLaunch',
  'Winmgmt',
  'Schedule',
  'EventLog',
  'WinLogon',
  'ProfSvc',
  'CryptSvc',
  'msiserver'
]

const STARTUP_TYPE_MAP: Record<ServiceStartupType, string> = {
  auto: 'Automatic',
  manual: 'Manual',
  disabled: 'Disabled'
}

/** 服务名单字符校验：防 PowerShell 注入（服务名不含单引号/分号等） */
export function isSafeServiceName(name: string): boolean {
  if (!name || name.length > 80) return false
  if (/['`;|$&<>\r\n]/.test(name)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return false
  return true
}

/** 解析 Win32_Service 查询输出的 JSON 数组 */
export function parseServiceList(stdout: string): WinService[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  const arr: unknown[] = Array.isArray(raw) ? raw : [raw]
  return arr.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      name: String(o.name ?? ''),
      displayName: String(o.displayName ?? ''),
      status: String(o.status ?? 'Unknown'),
      startType: String(o.startType ?? 'Unknown'),
      canStop: o.canStop === true || o.canStop === 'True',
      protected: o.protected === true || o.protected === 'True'
    }
  })
}

export function parseServiceResult(stdout: string): ToolResult {
  const text = stdout.trim()
  if (text.startsWith('ERR:')) return { ok: false, message: text.slice(4) }
  if (text.includes('OK')) return { ok: true, message: '操作成功' }
  return { ok: false, message: text || '操作失败' }
}

const PROTECTED_PS_LIST = `@(${PROTECTED_SERVICES.map((n) => `'${n}'`).join(',')})`

const LIST_SCRIPT = `
$protected = ${PROTECTED_PS_LIST}
$rows = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Select-Object -First 400 | ForEach-Object {
  $st = switch ($_.StartMode) {
    'Auto' { 'Automatic' }
    'Manual' { 'Manual' }
    'Disabled' { 'Disabled' }
    default { [string]$_.StartMode }
  }
  [pscustomobject]@{
    name = $_.Name
    displayName = $_.DisplayName
    status = $_.State
    startType = $st
    canStop = [bool]$_.AcceptStop
    protected = ($protected -contains $_.Name)
  }
}
$rows | ConvertTo-Json -Compress -Depth 3
`

/** 服务存在性 + 关键服务保护校验（PowerShell 端权威） */
function buildGuard(name: string, action: 'stop' | 'start'): string {
  const check =
    action === 'stop'
      ? `if ($protected -contains $s.Name) { "ERR:系统关键服务，已拒绝停止"; exit } if (-not $s.AcceptStop) { "ERR:该服务当前不可停止"; exit }`
      : `if ($s.State -eq 'Running') { "ERR:服务已在运行中"; exit }`
  return (
    `$protected = ${PROTECTED_PS_LIST}\n` +
    `$s = Get-Service -Name '${name}' -ErrorAction SilentlyContinue\n` +
    `if (-not $s) { "ERR:服务不存在"; exit }\n` +
    check
  )
}

export function createWinServicesService(runner: ExecRunner) {
  const list = async (): Promise<WinService[]> => {
    const { stdout } = await runner.run(LIST_SCRIPT)
    return parseServiceList(stdout)
  }

  const start = async (name: string): Promise<ToolResult> => {
    if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
    const script = `${buildGuard(name, 'start')}\ntry { Start-Service -Name '${name}' -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    const { stdout } = await runner.run(script)
    return parseServiceResult(stdout)
  }

  const stop = async (name: string): Promise<ToolResult> => {
    if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
    const script = `${buildGuard(name, 'stop')}\ntry { Stop-Service -Name '${name}' -Force -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    const { stdout } = await runner.run(script)
    return parseServiceResult(stdout)
  }

  const setStartupType = async (name: string, startType: ServiceStartupType): Promise<ToolResult> => {
    if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
    const mapped = STARTUP_TYPE_MAP[startType]
    if (!mapped) return { ok: false, message: '无效的启动类型' }
    const script = `$s = Get-Service -Name '${name}' -ErrorAction SilentlyContinue\nif (-not $s) { "ERR:服务不存在"; exit }\ntry { Set-Service -Name '${name}' -StartupType ${mapped} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    const { stdout } = await runner.run(script)
    return parseServiceResult(stdout)
  }

  return { list, start, stop, setStartupType }
}
