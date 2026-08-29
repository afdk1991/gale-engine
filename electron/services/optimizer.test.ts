import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createOptimizerService } from './optimizer'
import type { ExecRunner } from './shell'

interface Call {
  script: string
}
interface Fake {
  runner: ExecRunner
  calls: Call[]
}

function recordingRunner(
  respond: (script: string) => { stdout: string; stderr: string; code: number }
): Fake {
  const calls: Call[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push({ script })
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

const fail = (stderr = 'err'): { stdout: string; stderr: string; code: number } => ({
  stdout: '',
  stderr,
  code: 1
})

const ORIG_TEMP = process.env.TEMP
const ORIG_SYSTEMROOT = process.env.SystemRoot

beforeAll(() => {
  // 固化安全白名单根，避免测试机真实环境变量影响断言
  process.env.TEMP = 'C:\\TESTTEMP'
  process.env.SystemRoot = 'C:\\WIN'
})

afterAll(() => {
  process.env.TEMP = ORIG_TEMP
  process.env.SystemRoot = ORIG_SYSTEMROOT
})

describe('scanCleanup', () => {
  it('解析合法 JSON 数组为 CleanupPlan', async () => {
    const raw = [
      { id: 'temp:abc', kind: 'temp', label: '临时文件：C:\\TESTTEMP', path: 'C:\\TESTTEMP', size: 1234, safe: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const plans = await createOptimizerService(runner).scanCleanup()
    expect(plans).toHaveLength(1)
    expect(plans[0].sizeBytes).toBe(1234)
    expect(plans[0].kind).toBe('temp')
  })

  it('空输出返回空数组', async () => {
    const { runner } = recordingRunner(() => ok(''))
    const plans = await createOptimizerService(runner).scanCleanup()
    expect(plans).toEqual([])
  })

  it('非法 JSON 容错返回空数组（不抛异常）', async () => {
    const { runner } = recordingRunner(() => ok('not json at all'))
    const plans = await createOptimizerService(runner).scanCleanup()
    expect(plans).toEqual([])
  })
})

describe('runCleanup', () => {
  it('回收站项走 Clear-RecycleBin 并返回成功', async () => {
    const { runner } = recordingRunner((s) =>
      s.includes('Clear-RecycleBin') ? ok('OK') : fail()
    )
    const res = await createOptimizerService(runner).runCleanup([
      { id: 'recycle', path: 'RecycleBin', kind: 'recycle' }
    ])
    expect(res).toHaveLength(1)
    expect(res[0].ok).toBe(true)
    expect(res[0].error).toBeUndefined()
  })

  it('白名单内临时路径执行 Remove-Item 并返回成功', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createOptimizerService(runner).runCleanup([
      { id: 'temp:1', path: 'C:\\TESTTEMP', kind: 'temp' }
    ])
    expect(res[0].ok).toBe(true)
    expect(calls.some((c) => c.script.includes('Remove-Item'))).toBe(true)
  })

  it('不在白名单内的路径被跳过且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => fail('should-not-run'))
    const res = await createOptimizerService(runner).runCleanup([
      { id: 'bad', path: 'C:\\Users\\x\\Documents', kind: 'temp' }
    ])
    expect(res[0].ok).toBe(false)
    expect(res[0].error).toContain('安全白名单')
    expect(calls).toHaveLength(0)
  })

  it('混合安全/非安全项：分别给出成功与跳过结果', async () => {
    const { runner } = recordingRunner(() => ok())
    const res = await createOptimizerService(runner).runCleanup([
      { id: 't1', path: 'C:\\TESTTEMP', kind: 'temp' },
      { id: 'bad', path: 'C:\\Windows\\System32', kind: 'temp' }
    ])
    expect(res).toHaveLength(2)
    expect(res[0].ok).toBe(true)
    expect(res[1].ok).toBe(false)
  })
})

describe('listStartup', () => {
  it('解析注册表项 JSON 为 StartupItem，并处理 HKLM/HKCU 位置', async () => {
    const raw = [
      { name: 'OneDrive', command: 'C:\\OneDrive.exe', location: 'HKCU', enabled: true },
      { name: 'Svc', command: 'C:\\svc.exe', location: 'HKLM', enabled: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const items = await createOptimizerService(runner).listStartup()
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('HKCU:OneDrive')
    expect(items[1].id).toBe('HKLM:Svc')
  })
})

describe('toggleStartup', () => {
  it('enable 调用 Set-ItemProperty 并返回更新后的列表', async () => {
    const updated = [{ name: 'App', command: 'C:\\app.exe', location: 'HKCU', enabled: true }]
    const { runner, calls } = recordingRunner((s) =>
      s.includes('Set-ItemProperty')
        ? ok('OK')
        : { ...ok(), stdout: JSON.stringify(updated) }
    )
    const res = await createOptimizerService(runner).toggleStartup('HKCU:App', true, 'C:\\app.exe')
    expect(calls.some((c) => c.script.includes('Set-ItemProperty'))).toBe(true)
    expect(res).toHaveLength(1)
    expect(res[0].enabled).toBe(true)
  })

  it('disable 调用 Remove-ItemProperty', async () => {
    const { runner, calls } = recordingRunner((s) =>
      s.includes('Remove-ItemProperty') ? ok() : fail()
    )
    await createOptimizerService(runner).toggleStartup('HKCU:App', false)
    expect(calls.some((c) => c.script.includes('Remove-ItemProperty'))).toBe(true)
  })
})
