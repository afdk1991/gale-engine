import { describe, it, expect } from 'vitest'
import {
  createWinServicesService,
  parseServiceList,
  parseServiceResult,
  isSafeServiceName,
  PROTECTED_SERVICES
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

describe('createWinServicesService', () => {
  it('start 脚本包含 Start-Service 与运行中守卫', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner).start('wuauserv')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain("Start-Service -Name 'wuauserv'")
    expect(calls[0]).toContain('服务已在运行中')
  })

  it('stop 脚本包含关键服务保护校验', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner).stop('Spooler')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('系统关键服务，已拒绝停止')
    expect(calls[0]).toContain("Stop-Service -Name 'Spooler'")
    expect(calls[0]).toContain("'RpcSs'")
  })

  it('setStartupType 合法类型映射为 Set-Service', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner).setStartupType('wuauserv', 'disabled')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('Set-Service')
    expect(calls[0]).toContain('-StartupType Disabled')
  })

  it('setStartupType 非法类型直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner).setStartupType('wuauserv', 'boot' as never)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('非法服务名直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createWinServicesService(runner).stop("a';b")
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('list 脚本查询 Win32_Service 并包含保护名单', async () => {
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: '[]' }))
    await createWinServicesService(runner).list()
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
})
