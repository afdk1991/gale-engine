import { describe, it, expect } from 'vitest'
import {
  createFirewallService,
  parseProfiles,
  parseRules,
  parseFirewallResult,
  isSafeFirewallToken,
  FIREWALL_PROFILES,
  buildProfilesScript,
  buildRulesScript,
  buildSetEnabledScript,
  parseUnixProfiles,
  parseUnixRules
} from './firewall'
import type { ExecRunner } from './shell'

function recordingRunner(respond: (script: string) => { stdout: string; stderr: string; code: number }) {
  const calls: string[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push(script)
      return Promise.resolve(respond(script))
    }
  }
  return { runner, calls }
}

const ok = (stdout = 'OK'): { stdout: string; stderr: string; code: number } => ({
  stdout,
  stderr: '',
  code: 0
})

describe('isSafeFirewallToken', () => {
  it('常规规则名通过', () => {
    expect(isSafeFirewallToken('FPS-ICMP4-ERQ-In')).toBe(true)
    expect(isSafeFirewallToken('远程桌面-用户模式(TCP-In)')).toBe(true)
  })
  it('注入向量拒绝', () => {
    expect(isSafeFirewallToken("a';b")).toBe(false)
    expect(isSafeFirewallToken('a|b')).toBe(false)
    expect(isSafeFirewallToken('')).toBe(false)
  })
})

describe('parseProfiles', () => {
  it('解析三个配置文件', () => {
    const raw = [
      { name: 'Domain', enabled: true, inbound: 'Block', outbound: 'Allow' },
      { name: 'Private', enabled: true, inbound: 'Block', outbound: 'Allow' },
      { name: 'Public', enabled: false, inbound: 'Block', outbound: 'Allow' }
    ]
    const list = parseProfiles(JSON.stringify(raw))
    expect(list).toHaveLength(3)
    expect(list[2]).toMatchObject({ name: 'Public', enabled: false })
  })
  it('空 / 非法 / 字符串布尔容错', () => {
    expect(parseProfiles('')).toEqual([])
    expect(parseProfiles('bad')).toEqual([])
    const list = parseProfiles(JSON.stringify([{ name: 'Domain', enabled: 'True' }]))
    expect(list[0].enabled).toBe(true)
  })
})

describe('parseRules', () => {
  it('解析规则并对齐字段', () => {
    const raw = [
      { name: 'FPS-ICMP4-ERQ-In', displayName: '文件和打印机共享', enabled: true, direction: 'Inbound', action: 'Allow', profile: 'Any' },
      { name: 'X-Block-Out', displayName: '拦截示例', enabled: false, direction: 'Outbound', action: 'Block', profile: 'Public' }
    ]
    const list = parseRules(JSON.stringify(raw))
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ name: 'FPS-ICMP4-ERQ-In', direction: 'Inbound', action: 'Allow' })
    expect(list[1].enabled).toBe(false)
  })
  it('空 / 非法容错', () => {
    expect(parseRules('')).toEqual([])
    expect(parseRules('bad')).toEqual([])
  })
})

describe('parseFirewallResult', () => {
  it('OK / ERR / 未知', () => {
    expect(parseFirewallResult('OK')).toEqual({ ok: true, message: '操作成功' })
    expect(parseFirewallResult('ERR:需要管理员权限')).toEqual({ ok: false, message: '需要管理员权限' })
    expect(parseFirewallResult('').ok).toBe(false)
  })
})

describe('createFirewallService', () => {
  it('setProfileEnabled(true) 生成 Set-NetFirewallProfile -Enabled True', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createFirewallService(runner).setProfileEnabled('Public', true)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('Set-NetFirewallProfile -Name Public -Enabled True')
  })

  it('setProfileEnabled(false) 关闭配置文件', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createFirewallService(runner).setProfileEnabled('Domain', false)
    expect(calls[0]).toContain('-Enabled False')
  })

  it('setProfileEnabled 非法配置文件直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createFirewallService(runner).setProfileEnabled('Home', true)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('toggleRule(true) 生成 Enable-NetFirewallRule 且注入规则名', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createFirewallService(runner).toggleRule('FPS-ICMP4-ERQ-In', true)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain("Enable-NetFirewallRule -Name 'FPS-ICMP4-ERQ-In'")
  })

  it('toggleRule(false) 生成 Disable-NetFirewallRule', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createFirewallService(runner).toggleRule('X', false)
    expect(calls[0]).toContain('Disable-NetFirewallRule')
  })

  it('非法规则名直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createFirewallService(runner).toggleRule("a';b", true)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('profiles 脚本使用 Get-NetFirewallProfile', async () => {
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: '[]' }))
    await createFirewallService(runner).profiles()
    expect(calls[0]).toContain('Get-NetFirewallProfile')
  })

  it('listRules 脚本使用 Get-NetFirewallRule 并限 200 条', async () => {
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: '[]' }))
    await createFirewallService(runner).listRules()
    expect(calls[0]).toContain('Get-NetFirewallRule')
    expect(calls[0]).toContain('Select-Object -First 200')
  })
})

describe('常量', () => {
  it('FIREWALL_PROFILES 恰好三个合法配置文件', () => {
    expect([...FIREWALL_PROFILES].sort()).toEqual(['Domain', 'Private', 'Public'])
  })
})

describe('防火墙跨平台脚本分发', () => {
  it('profiles 脚本按平台分发', () => {
    expect(buildProfilesScript('win32')).toContain('Get-NetFirewallProfile')
    expect(buildProfilesScript('darwin')).toContain('pfctl')
    expect(buildProfilesScript('linux')).toContain('ufw')
  })

  it('rules 脚本按平台分发', () => {
    expect(buildRulesScript('win32')).toContain('Get-NetFirewallRule')
    expect(buildRulesScript('darwin')).toContain('pfctl -sr')
    expect(buildRulesScript('linux')).toContain('ufw')
  })

  it('启用脚本按平台分发', () => {
    expect(buildSetEnabledScript(true, 'darwin')).toContain('pfctl -e')
    expect(buildSetEnabledScript(false, 'darwin')).toContain('pfctl -d')
    expect(buildSetEnabledScript(true, 'linux')).toContain('ufw enable')
    expect(buildSetEnabledScript(false, 'linux')).toContain('ufw disable')
  })
})

describe('防火墙 unix 解析器', () => {
  it('parseUnixProfiles 识别启用状态', () => {
    const on = parseUnixProfiles('ON')
    expect(on[0]).toMatchObject({ name: 'Firewall', enabled: true })
    const off = parseUnixProfiles('OFF')
    expect(off[0].enabled).toBe(false)
    // ufw active
    expect(parseUnixProfiles('Status: active')[0].enabled).toBe(true)
  })

  it('parseUnixRules 将规则文本映射为 FirewallRule', () => {
    const rules = parseUnixRules('Status: active\nallow from 192.168.1.1\nblock in quick on en0 from 10.0.0.0/8\n')
    expect(rules.length).toBe(2)
    expect(rules[0]).toMatchObject({ name: 'rule-1', action: 'Allow', direction: 'Any' })
    expect(rules[1]).toMatchObject({ action: 'Block', direction: 'Inbound' })
  })
})

describe('防火墙 unix 服务行为', () => {
  function unixRunner(platform: 'darwin' | 'linux', stdout = 'ON') {
    return recordingRunner((s) => {
      if (s.includes('pfctl') || s.includes('ufw')) return ok(stdout)
      return ok('[]')
    })
  }

  it('macOS profiles 返回单一 Firewall 配置文件', async () => {
    const { runner } = unixRunner('darwin', 'ON')
    const list = await createFirewallService(runner, 'darwin').profiles()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Firewall')
    expect(list[0].enabled).toBe(true)
  })

  it('Linux setProfileEnabled(true) 调用 ufw enable', async () => {
    const { runner, calls } = unixRunner('linux', 'OK')
    const res = await createFirewallService(runner, 'linux').setProfileEnabled('Firewall', true)
    expect(res.ok).toBe(true)
    expect(calls.some((c) => c.includes('ufw enable'))).toBe(true)
  })

  it('unix toggleRule 诚实降级返回不支持', async () => {
    const { runner, calls } = unixRunner('darwin')
    const res = await createFirewallService(runner, 'darwin').toggleRule('any-rule', true)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('暂不支持')
    expect(calls).toHaveLength(0)
  })
})
