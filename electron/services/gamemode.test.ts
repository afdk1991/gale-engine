import { describe, it, expect } from 'vitest'
import { createGameModeService, HIGH_PERFORMANCE_GUID } from './gamemode'
import type { ExecRunner } from './shell'

interface Call {
  script: string
}
function recordingRunner(respond: (script: string) => { stdout: string; stderr: string; code: number }) {
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

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e'

describe('GameMode', () => {
  function makeRunner() {
    return recordingRunner((s) => {
      if (s.includes('getactivescheme')) {
        return { stdout: `Power Scheme GUID: ${BALANCED}  (Balanced)`, stderr: '', code: 0 }
      }
      if (s.includes('setactive')) return ok('OK')
      return ok()
    })
  }

  it('status 解析当前计划，初始未 boost', async () => {
    const { runner } = makeRunner()
    const st = await createGameModeService(runner).status()
    expect(st.active).toBe(BALANCED)
    expect(st.activeName).toBe('Balanced')
    expect(st.boosted).toBe(false)
    expect(st.previous).toBeNull()
  })

  it('boost 切换到高性能并记录上一计划，boosted=true', async () => {
    const { runner } = makeRunner()
    const st = await createGameModeService(runner).boost()
    expect(st.boosted).toBe(true)
    expect(st.previous).toBe(BALANCED)
    expect(runner).toBeDefined()
  })

  it('boost 幂等：第二次 boost 不覆盖 previous', async () => {
    const { runner } = makeRunner()
    const svc = createGameModeService(runner)
    await svc.boost()
    const st = await svc.boost()
    expect(st.previous).toBe(BALANCED)
  })

  it('restore 还原上一计划并清除 boosted/previous', async () => {
    const { runner, calls } = makeRunner()
    const svc = createGameModeService(runner)
    await svc.boost()
    const st = await svc.restore()
    expect(st.boosted).toBe(false)
    expect(st.previous).toBeNull()
    expect(calls.some((c) => c.script.includes(`setactive ${BALANCED}`))).toBe(true)
  })

  it('restore 在未 boost 时不调用 setactive', async () => {
    const { runner, calls } = makeRunner()
    await createGameModeService(runner).restore()
    expect(calls.some((c) => c.script.includes('setactive'))).toBe(false)
  })

  it('HIGH_PERFORMANCE_GUID 为 Windows 固定值', () => {
    expect(HIGH_PERFORMANCE_GUID).toBe('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
  })
})
