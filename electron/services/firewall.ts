import type { FirewallProfile, FirewallRule, ToolResult } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

/** 防火墙配置文件名白名单（PowerShell 端同样枚举校验，双保险） */
export const FIREWALL_PROFILES = ['Domain', 'Private', 'Public'] as const
export type FirewallProfileName = (typeof FIREWALL_PROFILES)[number]

/** 规则名 / 配置文件名注入校验 */
export function isSafeFirewallToken(token: string): boolean {
  if (!token || token.length > 260) return false
  if (/['`;|$&<>\r\n]/.test(token)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(token)) return false
  return true
}

/** 解析 Get-NetFirewallProfile 输出 */
export function parseProfiles(stdout: string): FirewallProfile[] {
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
      enabled: o.enabled === true || o.enabled === 'True',
      inbound: String(o.inbound ?? ''),
      outbound: String(o.outbound ?? '')
    }
  })
}

/** 解析 Get-NetFirewallRule 输出 */
export function parseRules(stdout: string): FirewallRule[] {
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
      enabled: o.enabled === true || o.enabled === 'True',
      direction: String(o.direction ?? ''),
      action: String(o.action ?? ''),
      profile: String(o.profile ?? '')
    }
  })
}

export function parseFirewallResult(stdout: string): ToolResult {
  const text = stdout.trim()
  if (text.startsWith('ERR:')) return { ok: false, message: text.slice(4) }
  if (text.includes('OK')) return { ok: true, message: '操作成功' }
  return { ok: false, message: text || '操作失败' }
}

const PROFILES_SCRIPT = `
Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    name = $_.Name
    enabled = [bool]$_.Enabled
    inbound = [string]$_.DefaultInboundAction
    outbound = [string]$_.DefaultOutboundAction
  }
} | ConvertTo-Json -Compress -Depth 3
`

/** 规则列表：默认取前 200 条（按 DisplayName 排序，覆盖常用场景且输出可控） */
const RULES_SCRIPT = `
Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Sort-Object DisplayName |
  Select-Object -First 200 |
  ForEach-Object {
    [pscustomobject]@{
      name = $_.Name
      displayName = $_.DisplayName
      enabled = [bool]$_.Enabled
      direction = [string]$_.Direction
      action = [string]$_.Action
      profile = [string]$_.Profile
    }
  } | ConvertTo-Json -Compress -Depth 3
`

// ─────────────────────────────────────────────────────────────
// 平台脚本生成
// ─────────────────────────────────────────────────────────────

/**
 * profiles 脚本：
 * - Windows：Get-NetFirewallProfile 三配置文件（JSON）
 * - macOS：pfctl 包过滤（启用状态）
 * - Linux：ufw status（回退 iptables）
 */
export function buildProfilesScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32':
      return PROFILES_SCRIPT
    case 'darwin':
      // pfctl -s info 输出含 "Status: Enabled/Disabled"；无 root 读取也可
      return `if pfctl -s info 2>/dev/null | grep -qi 'Status: Enabled'; then echo 'ON'; else echo 'OFF'; fi`
    case 'linux':
      // 优先 ufw；无 ufw 时用 iptables 是否有规则粗略判断
      return `if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | head -1
else
  if iptables -L -n 2>/dev/null | grep -qE '^Chain (INPUT|FORWARD)'; then echo 'ON'; else echo 'OFF'; fi
fi`
    default:
      return `echo '[]'`
  }
}

/**
 * listRules 脚本：
 * - Windows：Get-NetFirewallRule（JSON，限 200 条）
 * - macOS：pfctl -sr 列出锚点规则
 * - Linux：ufw status numbered（回退 iptables -S）
 */
export function buildRulesScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32':
      return RULES_SCRIPT
    case 'darwin':
      return `pfctl -sr 2>/dev/null || echo ''`
    case 'linux':
      return `if command -v ufw >/dev/null 2>&1; then ufw status 2>/dev/null; else iptables -S 2>/dev/null; fi`
    default:
      return `echo '[]'`
  }
}

/** 设置防火墙整体启用/禁用的脚本（unix） */
export function buildSetEnabledScript(enable: boolean, platform: Platform = detectPlatform()): string {
  if (platform === 'darwin') {
    // pfctl -e 启用 / -d 禁用，需 root
    return enable ? `pfctl -e 2>&1 && echo OK || echo 'ERR:需要管理员权限'` : `pfctl -d 2>&1 && echo OK || echo 'ERR:需要管理员权限'`
  }
  if (platform === 'linux') {
    // 无 ufw 的最小系统不直接操作 iptables 默认策略（误设 DROP 会断网），安全降级
    return enable
      ? `if command -v ufw >/dev/null 2>&1; then ufw enable 2>&1 && echo OK || echo 'ERR:需要管理员权限'; else echo 'ERR:未检测到 ufw，请安装后再操作'; fi`
      : `if command -v ufw >/dev/null 2>&1; then ufw disable 2>&1 && echo OK || echo 'ERR:需要管理员权限'; else echo 'ERR:未检测到 ufw，请手动放行'; fi`
  }
  return `echo 'ERR:不支持的平台'`
}

/**
 * 解析 unix profiles 输出为 FirewallProfile[]。
 * mac/linux 无"三配置文件"概念，映射为单一 "Firewall" 配置文件。
 */
export function parseUnixProfiles(stdout: string): FirewallProfile[] {
  const text = stdout.trim()
  const enabled = /\bON\b/i.test(text) || /Status:\s*active/i.test(text) || /Status: Enabled/i.test(text)
  return [{ name: 'Firewall', enabled, inbound: enabled ? 'Block' : 'Allow', outbound: 'Allow' }]
}

/**
 * 解析 unix 规则文本为 FirewallRule[]（每行一条，字段有限）。
 */
export function parseUnixRules(stdout: string): FirewallRule[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Status:/i.test(l) && l.toLowerCase() !== 'off' && !/^To\s+Action/i.test(l))
    .slice(0, 200)
    .map((line, i) => ({
      name: `rule-${i + 1}`,
      displayName: line.length > 80 ? line.slice(0, 77) + '...' : line,
      enabled: true,
      direction: /in|input/i.test(line) ? 'Inbound' : /out|output/i.test(line) ? 'Outbound' : 'Any',
      action: /deny|drop|reject|block/i.test(line) ? 'Block' : 'Allow',
      profile: 'Any'
    }))
}

export function createFirewallService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const isWin = platform === 'win32'

  const profiles = async (): Promise<FirewallProfile[]> => {
    const { stdout } = await runner.run(buildProfilesScript(platform))
    return isWin ? parseProfiles(stdout) : parseUnixProfiles(stdout)
  }

  const listRules = async (): Promise<FirewallRule[]> => {
    const { stdout } = await runner.run(buildRulesScript(platform))
    return isWin ? parseRules(stdout) : parseUnixRules(stdout)
  }

  const setProfileEnabled = async (profile: string, enable: boolean): Promise<ToolResult> => {
    if (isWin) {
      const valid = (FIREWALL_PROFILES as readonly string[]).includes(profile)
      if (!valid) return { ok: false, message: '无效的配置文件（须为 Domain/Private/Public）' }
      const state = enable ? 'True' : 'False'
      const { stdout } = await runner.run(
        `try { Set-NetFirewallProfile -Name ${profile} -Enabled ${state} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      )
      return parseFirewallResult(stdout)
    }
    // mac/linux：三配置文件概念不存在，仅接受整体开关（profile 任意值）
    const { stdout } = await runner.run(buildSetEnabledScript(enable, platform))
    return parseFirewallResult(stdout)
  }

  const toggleRule = async (name: string, enable: boolean): Promise<ToolResult> => {
    if (isWin) {
      if (!isSafeFirewallToken(name)) return { ok: false, message: '规则名包含非法字符' }
      const verb = enable ? 'Enable-NetFirewallRule' : 'Disable-NetFirewallRule'
      const { stdout } = await runner.run(
        `try { ${verb} -Name '${name}' -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      )
      return parseFirewallResult(stdout)
    }
    // unix：规则级开关涉及 pf/iptables 规则编辑，风险高且语义不一，v1 诚实降级
    return { ok: false, message: '当前平台暂不支持单条防火墙规则开关（请使用系统防火墙设置）' }
  }

  return { profiles, listRules, setProfileEnabled, toggleRule }
}
