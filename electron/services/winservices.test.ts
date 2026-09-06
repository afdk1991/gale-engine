import { describe, it, expect } from 'vitest'
import {
  createWinServicesService,
  parseServiceList,
  parseServiceResult,
  isSafeServiceName,
  isSafeUnixUnitName,
  isProtectedUnixUnit,
  buildServicesListScript,
  buildServiceOpScript,
  parseUnixServiceList,
  PROTECTED_SERVICES,
  PROTECTED_UNIX_UNITS
} from './winservices'
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

describe('isSafeServiceName', () => {
  it('常规服务名通过', () => {
    expect(isSafeServiceName('wuauserv')).toBe(true)
    expect(isSafeServiceName('Spooler')).toBe(true)
  })
  it('注入向量拒绝', () => {
    expect(isSafeServiceName("a';b")).toBe(false)
    expect(isSafeServiceName('a;b')).toBe(false)
    expect(isSafeServiceName('a$b')).toBe(false)
    expect(isSafeServiceName('')).toBe(false)
    expect(isSafeServiceName('x'.repeat(81))).toBe(false)
  })
})

describe('parseServiceList', () => {
  it('解析 JSON 数组并对齐 WinService 字段', () => {
    const raw = [
      { name: 'wuauserv', displayName: 'Windows Update', status: 'Running', startType: 'Manual', canStop: true, protected: false },
      { name: 'RpcSs', displayName: 'Remote Procedure Call', status: 'Running', startType: 'Automatic', canStop: false, protected: true }
    ]
    const list = parseServiceList(JSON.stringify(raw))
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ name: 'wuauserv', status: 'Running', startType: 'Manual', canStop: true, protected: false })
    expect(list[1].protected).toBe(true)
  })
  it('空 / 非法 JSON / 单对象 / 字段缺失容错', () => {
    expect(parseServiceList('')).toEqual([])
    expect(parseServiceList('bad')).toEqual([])
    expect(parseServiceList(JSON.stringify({ name: 'x' }))).toHaveLength(1)
    const list = parseServiceList(JSON.stringify([{}]))
    expect(list[0]).toMatchObject({ name: '', status: 'Unknown', startType: 'Unknown', canStop: false, protected: false })
  })
})

describe('parseServiceResult', () => {
  it('OK / ERR / 未知', () => {
    expect(parseServiceResult('OK')).toEqual({ ok: true, message: '操作成功' })
    expect(parseServiceResult('ERR:拒绝访问')).toEqual({ ok: false, message: '拒绝访问' })
    expect(parseServiceResult('').ok).toBe(false)
  })
})

describe('createWinServicesService (Windows)', () => {
  it('start 脚本包含 Start-Service 与运行中守卫', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner, 'win32').start('wuauserv')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain("Start-Service -Name 'wuauserv'")
    expect(calls[0]).toContain('服务已在运行中')
  })

  it('stop 脚本包含关键服务保护校验', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner, 'win32').stop('Spooler')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('系统关键服务，已拒绝停止')
    expect(calls[0]).toContain("Stop-Service -Name 'Spooler'")
    expect(calls[0]).toContain("'RpcSs'")
  })

  it('setStartupType 合法类型映射为 Set-Service', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner, 'win32').setStartupType('wuauserv', 'disabled')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('Set-Service')
    expect(calls[0]).toContain('-StartupType Disabled')
  })

  it('setStartupType 非法类型直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner, 'win32').setStartupType('wuauserv', 'boot' as never)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('非法服务名直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner, 'win32').stop("a';b")
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('list 脚本查询 Win32_Service 并包含保护名单', async () => {
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: '[]' }))
    await createWinServicesService(runner, 'win32').list()
    expect(calls[0]).toContain('Win32_Service')
    expect(calls[0]).toContain('AcceptStop')
  })
})

describe('常量', () => {
  it('PROTECTED_SERVICES 包含核心系统服务', () => {
    expect(PROTECTED_SERVICES).toContain('RpcSs')
    expect(PROTECTED_SERVICES).toContain('DcomLaunch')
    expect(PROTECTED_SERVICES).toContain('Winmgmt')
    expect(PROTECTED_SERVICES).toContain('Schedule')
  })
  it('PROTECTED_UNIX_UNITS 包含关键守护进程', () => {
    expect(PROTECTED_UNIX_UNITS).toContain('systemd-journald')
    expect(PROTECTED_UNIX_UNITS).toContain('dbus')
    expect(PROTECTED_UNIX_UNITS).toContain('com.apple.launchd')
  })
})

describe('isSafeUnixUnitName', () => {
  it('合法 launchd label / systemd unit 通过', () => {
    expect(isSafeUnixUnitName('com.apple.periodic-daily')).toBe(true)
    expect(isSafeUnixUnitName('nginx.service')).toBe(true)
    expect(isSafeUnixUnitName('gale-engine')).toBe(true)
  })
  it('含注入字符/空格拒绝', () => {
    expect(isSafeUnixUnitName('a;b')).toBe(false)
    expect(isSafeUnixUnitName('a b')).toBe(false)
    expect(isSafeUnixUnitName('a$b')).toBe(false)
    expect(isSafeUnixUnitName('')).toBe(false)
  })
})

describe('isProtectedUnixUnit', () => {
  it('关键守护进程返回 true', () => {
    expect(isProtectedUnixUnit('systemd-journald')).toBe(true)
    expect(isProtectedUnixUnit('dbus')).toBe(true)
    expect(isProtectedUnixUnit('nginx')).toBe(false)
  })
})

describe('服务跨平台脚本分发', () => {
  it('list 脚本按平台分发', () => {
    expect(buildServicesListScript('win32')).toContain('Win32_Service')
    expect(buildServicesListScript('darwin')).toContain('launchctl list')
    expect(buildServicesListScript('linux')).toContain('systemctl list-units')
  })

  it('macOS start 用 launchctl kickstart，stop/enable/disable 诚实降级', () => {
    expect(buildServiceOpScript('start', 'com.apple.x', 'darwin')).toContain('kickstart')
    expect(buildServiceOpScript('stop', 'com.apple.x', 'darwin')).toContain('登录项')
    expect(buildServiceOpScript('enable', 'com.apple.x', 'darwin')).toContain('登录项')
    expect(buildServiceOpScript('disable', 'com.apple.x', 'darwin')).toContain('登录项')
  })

  it('Linux start/stop/enable/disable 用 systemctl', () => {
    expect(buildServiceOpScript('start', 'nginx', 'linux')).toContain('systemctl start nginx')
    expect(buildServiceOpScript('stop', 'nginx', 'linux')).toContain('systemctl stop nginx')
    expect(buildServiceOpScript('enable', 'nginx', 'linux')).toContain('systemctl enable nginx')
    expect(buildServiceOpScript('disable', 'nginx', 'linux')).toContain('systemctl disable nginx')
  })
})

describe('服务 unix 解析器', () => {
  it('macOS launchctl list 行映射为服务', () => {
    const out = `-	0	com.apple.ready
1234	0	com.apple.running
-	1	com.apple.error
---SYSTEM---
-	0	system.ready`
    const list = parseUnixServiceList(out, 'darwin')
    expect(list.length).toBeGreaterThanOrEqual(3)
    const ready = list.find((s) => s.name === 'com.apple.ready')
    const running = list.find((s) => s.name === 'com.apple.running')
    const errored = list.find((s) => s.name === 'com.apple.error')
    expect(ready).toMatchObject({ name: 'com.apple.ready', status: 'Stopped', protected: false })
    expect(running).toMatchObject({ name: 'com.apple.running', status: 'Running', canStop: true })
    expect(errored).toMatchObject({ name: 'com.apple.error', status: 'Error' })
  })

  it('macOS 关键守护进程标记 protected', () => {
    const out = `-	0	com.apple.launchd`
    const list = parseUnixServiceList(out, 'darwin')
    expect(list[0].protected).toBe(true)
    expect(list[0].canStop).toBe(false)
  })

  it('Linux systemctl list-units 行映射', () => {
    const out = `UNIT              LOAD   ACTIVE SUB     DESCRIPTION
nginx.service     loaded active running A high performance web server
cron.service      loaded active running Regular background program processing daemon
sshd.service      loaded active running OpenSSH server daemon
stopped.service   loaded inactive dead  A stopped service`
    const list = parseUnixServiceList(out, 'linux')
    expect(list.length).toBeGreaterThanOrEqual(3)
    const nginx = list.find((s) => s.name === 'nginx')
    expect(nginx).toBeDefined()
    expect(nginx?.status).toBe('Running')
    expect(nginx?.name).toBe('nginx')
    expect(nginx?.displayName).toContain('web server')
    const sshd = list.find((s) => s.name === 'sshd')
    expect(sshd?.protected).toBe(true)
  })
})

describe('服务 unix 服务行为', () => {
  function unixRunner(platform: 'darwin' | 'linux', stdout = 'OK') {
    return recordingRunner(() => ok(stdout))
  }

  it('Linux start 调用 systemctl start', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createWinServicesService(runner, 'linux').start('nginx')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('systemctl start nginx')
  })

  it('Linux stop 调用 systemctl stop', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createWinServicesService(runner, 'linux').stop('nginx')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('systemctl stop nginx')
  })

  it('Linux stop 关键守护进程被拒绝', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createWinServicesService(runner, 'linux').stop('dbus')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('关键服务')
    expect(calls).toHaveLength(0)
  })

  it('Linux setStartupType auto → enable', async () => {
    const { runner, calls } = unixRunner('linux')
    await createWinServicesService(runner, 'linux').setStartupType('nginx', 'auto')
    expect(calls[0]).toContain('systemctl enable nginx')
  })

  it('Linux setStartupType disabled → disable', async () => {
    const { runner, calls } = unixRunner('linux')
    await createWinServicesService(runner, 'linux').setStartupType('nginx', 'disabled')
    expect(calls[0]).toContain('systemctl disable nginx')
  })

  it('macOS setStartupType 诚实降级', async () => {
    const { runner, calls } = unixRunner('darwin')
    const res = await createWinServicesService(runner, 'darwin').setStartupType('com.apple.x', 'auto')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('登录项')
    expect(calls).toHaveLength(0)
  })

  it('macOS stop 诚实降级', async () => {
    const { runner, calls } = recordingRunner((script) => ok(script.includes('ERR:') ? "ERR:macOS 请在系统设置中管理" : 'OK'))
    const res = await createWinServicesService(runner, 'darwin').stop('com.apple.x')
    expect(res.ok).toBe(false)
    expect(calls[0]).toContain('登录项')
  })

  it('unix 非法单元名拒绝且不调用执行器', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createWinServicesService(runner, 'linux').stop('bad name')
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('macOS list 解析 launchctl 输出', async () => {
    const { runner } = recordingRunner(() => ok(`-	0	com.apple.app
123	0	com.apple.run`))
    const list = await createWinServicesService(runner, 'darwin').list()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('com.apple.app')
  })
})
