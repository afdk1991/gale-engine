import type { FirewallProfile, FirewallRule, ToolResult } from '../../shared/types'
import type { ExecRunner } from './shell'

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

export function createFirewallService(runner: ExecRunner) {
  const profiles = async (): Promise<FirewallProfile[]> => {
    const { stdout } = await runner.run(PROFILES_SCRIPT)
    return parseProfiles(stdout)
  }

  const listRules = async (): Promise<FirewallRule[]> => {
    const { stdout } = await runner.run(RULES_SCRIPT)
    return parseRules(stdout)
  }

  const setProfileEnabled = async (profile: string, enable: boolean): Promise<ToolResult> => {
    const valid = (FIREWALL_PROFILES as readonly string[]).includes(profile)
    if (!valid) return { ok: false, message: '无效的配置文件（须为 Domain/Private/Public）' }
    const state = enable ? 'True' : 'False'
    const { stdout } = await runner.run(
      `try { Set-NetFirewallProfile -Name ${profile} -Enabled ${state} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    )
    return parseFirewallResult(stdout)
  }

  const toggleRule = async (name: string, enable: boolean): Promise<ToolResult> => {
    if (!isSafeFirewallToken(name)) return { ok: false, message: '规则名包含非法字符' }
    const verb = enable ? 'Enable-NetFirewallRule' : 'Disable-NetFirewallRule'
    const { stdout } = await runner.run(
      `try { ${verb} -Name '${name}' -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    )
    return parseFirewallResult(stdout)
  }

  return { profiles, listRules, setProfileEnabled, toggleRule }
}
