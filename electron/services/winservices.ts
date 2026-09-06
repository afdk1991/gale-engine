import type { ServiceStartupType, ToolResult, WinService } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

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

/** unix 平台关键守护进程白名单（launchd / systemd），拒绝 stop/disable */
export const PROTECTED_UNIX_UNITS = [
  // macOS launchd 关键系统服务
  'com.apple.launchd',
  'com.apple.SystemStarter',
  'com.apple.notifyd',
  'com.apple.configd',
  'com.apple.opendirectoryd',
  // Linux systemd 关键系统服务
  'systemd-journald',
  'systemd-udevd',
  'dbus',
  'NetworkManager',
  'systemd-resolved',
  'sshd'
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

/** unix 单元名校验（launchd label / systemd unit 字符集） */
export function isSafeUnixUnitName(name: string): boolean {
  return /^[A-Za-z0-9._@-]{1,200}$/.test(name)
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

// ─────────────────────────────────────────────────────────────
// 平台脚本（macOS launchctl / Linux systemctl）
// ─────────────────────────────────────────────────────────────

/**
 * 列表脚本：
 * - Windows：Get-CimInstance Win32_Service（JSON）
 * - macOS：launchctl list（系统域 + 用户域）
 * - Linux：systemctl list-units --type=service --all（限 200 条）
 */
export function buildServicesListScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32':
      return LIST_SCRIPT
    case 'darwin':
      // launchctl list 输出：PID  Status  Label（PID=- 表示未运行）
      // 同时列系统域和用户域（best-effort）
      return `{ launchctl list 2>/dev/null | tail -n +2; echo '---SYSTEM---'; sudo -n launchctl list 2>/dev/null | tail -n +2; }`
    case 'linux':
      // systemctl 列出所有服务单元（含未激活），输出：UNIT LOAD ACTIVE SUB DESCRIPTION
      return `systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | head -200`
    default:
      return `echo '[]'`
  }
}

/** unix 服务操作脚本 */
export function buildServiceOpScript(
  op: 'start' | 'stop' | 'enable' | 'disable',
  name: string,
  platform: Platform = detectPlatform()
): string {
  if (platform === 'darwin') {
    switch (op) {
      case 'start':
        return `launchctl kickstart -k system/${name} 2>/dev/null || launchctl kickstart -k gui/$(id -u)/${name} 2>&1 && echo OK || echo 'ERR:服务不存在或无法启动'`
      // launchd 的 enable/disable 语义与 Windows 差异大（需 bootout/bootstrap + 权限），
      // v1 诚实降级，引导用户用系统设置
      case 'stop':
      case 'enable':
      case 'disable':
        return `echo 'ERR:macOS 请在「系统设置 → 通用 → 登录项」中管理服务，或使用 launchctl 命令行（需 sudo）'`
    }
  }
  if (platform === 'linux') {
    switch (op) {
      case 'start':
        return `systemctl start ${name} 2>&1 && echo OK || echo 'ERR:服务不存在或无法启动'`
      case 'stop':
        return `systemctl stop ${name} 2>&1 && echo OK || echo 'ERR:服务不存在或无法停止'`
      case 'enable':
        return `systemctl enable ${name} 2>&1 && echo OK || echo 'ERR:服务不存在或无法启用'`
      case 'disable':
        return `systemctl disable ${name} 2>&1 && echo OK || echo 'ERR:服务不存在或无法禁用'`
    }
  }
  return `echo 'ERR:不支持的平台'`
}

/**
 * 解析 unix 服务列表文本为 WinService[]（best-effort，字段有限）。
 * - macOS launchctl list：每行 "PID Status Label"
 * - Linux：systemctl list-units 行 "UNIT LOAD ACTIVE SUB DESCRIPTION"
 */
export function parseUnixServiceList(stdout: string, platform: Platform = detectPlatform()): WinService[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const services: WinService[] = []
  const seen = new Set<string>()

  if (platform === 'darwin') {
    let inSystem = false
    for (const line of lines) {
      if (line.includes('---SYSTEM---')) { inSystem = true; continue }
      // launchctl list 列顺序：PID Status Label
      const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)$/)
      if (!m) continue
      const [, pid, status, label] = m
      if (seen.has(label)) continue
      seen.add(label)
      const running = pid !== '-' && pid !== '0'
      const errored = !running && status !== '-' && status !== '0'
      const isProtected = PROTECTED_UNIX_UNITS.includes(label)
      services.push({
        name: label,
        displayName: label,
        status: running ? 'Running' : errored ? 'Error' : 'Stopped',
        startType: 'Automatic',
        canStop: running && !isProtected,
        protected: isProtected
      })
    }
    return services.slice(0, 400)
  }

  if (platform === 'linux') {
    for (const line of lines) {
      // systemctl 列：UNIT LOAD ACTIVE SUB DESCRIPTION（至少 4 列）
      const parts = line.split(/\s+/)
      if (parts.length < 4) continue
      const unit = parts[0]
      const load = parts[1]
      const active = parts[2]
      const sub = parts[3]
      if (!unit.endsWith('.service')) continue
      const name = unit.replace(/\.service$/, '')
      if (seen.has(name)) continue
      seen.add(name)
      const isProtected = PROTECTED_UNIX_UNITS.includes(name)
      const running = active === 'active' && (sub === 'running' || sub === 'listening')
      // 从 systemctl is-enabled 判断启动类型（best-effort，list-units 不直接给出，用 LOAD 近似）
      const startType: ServiceStartupType = load === 'loaded' ? 'auto' : 'manual'
      services.push({
        name,
        displayName: parts.length > 4 ? parts.slice(4).join(' ') : name,
        status: running ? 'Running' : active === 'active' ? 'Active' : 'Stopped',
        startType: startType === 'auto' ? 'Automatic' : 'Manual',
        canStop: running && !isProtected,
        protected: isProtected
      })
    }
    return services.slice(0, 400)
  }

  return []
}

/** 判断 unix 单元是否受保护 */
export function isProtectedUnixUnit(name: string): boolean {
  return PROTECTED_UNIX_UNITS.includes(name)
}

export function createWinServicesService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const isWin = platform === 'win32'

  const list = async (): Promise<WinService[]> => {
    const { stdout } = await runner.run(buildServicesListScript(platform))
    return isWin ? parseServiceList(stdout) : parseUnixServiceList(stdout, platform)
  }

  const start = async (name: string): Promise<ToolResult> => {
    if (isWin) {
      if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
      const script = `${buildGuard(name, 'start')}\ntry { Start-Service -Name '${name}' -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      const { stdout } = await runner.run(script)
      return parseServiceResult(stdout)
    }
    if (!isSafeUnixUnitName(name)) return { ok: false, message: '服务名包含非法字符' }
    const { stdout } = await runner.run(buildServiceOpScript('start', name, platform))
    return parseServiceResult(stdout)
  }

  const stop = async (name: string): Promise<ToolResult> => {
    if (isWin) {
      if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
      const script = `${buildGuard(name, 'stop')}\ntry { Stop-Service -Name '${name}' -Force -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      const { stdout } = await runner.run(script)
      return parseServiceResult(stdout)
    }
    if (!isSafeUnixUnitName(name)) return { ok: false, message: '服务名包含非法字符' }
    if (isProtectedUnixUnit(name)) return { ok: false, message: '系统关键服务，已拒绝停止' }
    if (platform === 'darwin') {
      // macOS launchd stop 诚实降级
      const { stdout } = await runner.run(buildServiceOpScript('stop', name, platform))
      return parseServiceResult(stdout)
    }
    const { stdout } = await runner.run(buildServiceOpScript('stop', name, platform))
    return parseServiceResult(stdout)
  }

  const setStartupType = async (name: string, startType: ServiceStartupType): Promise<ToolResult> => {
    if (isWin) {
      if (!isSafeServiceName(name)) return { ok: false, message: '服务名包含非法字符' }
      const mapped = STARTUP_TYPE_MAP[startType]
      if (!mapped) return { ok: false, message: '无效的启动类型' }
      const script = `$s = Get-Service -Name '${name}' -ErrorAction SilentlyContinue\nif (-not $s) { "ERR:服务不存在"; exit }\ntry { Set-Service -Name '${name}' -StartupType ${mapped} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      const { stdout } = await runner.run(script)
      return parseServiceResult(stdout)
    }
    if (!isSafeUnixUnitName(name)) return { ok: false, message: '服务名包含非法字符' }
    if (isProtectedUnixUnit(name)) return { ok: false, message: '系统关键服务，已拒绝修改启动类型' }
    // macOS launchd 不支持动态修改启动类型，诚实降级
    if (platform === 'darwin') {
      return { ok: false, message: 'macOS 请在「系统设置 → 通用 → 登录项」中管理启动项' }
    }
    // Linux：enable/disable 对应 systemctl enable/disable；manual 无直接对应，用 disable 近似
    const op: 'enable' | 'disable' = startType === 'auto' ? 'enable' : 'disable'
    const { stdout } = await runner.run(buildServiceOpScript(op, name, platform))
    return parseServiceResult(stdout)
  }

  return { list, start, stop, setStartupType }
}
