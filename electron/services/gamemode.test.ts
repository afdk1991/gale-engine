import { describe, it, expect } from 'vitest'
import {
  createGameModeService,
  HIGH_PERFORMANCE_GUID,
  PERFORMANCE_GOVERNOR,
  buildBoostScript,
  buildStatusScript,
  buildRestoreScript,
  parseUnixStatus
} from './gamemode'
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

  it('Windows boost 脚本含成功回显（powercfg 成功无 stdout）', () => {
    const script = buildBoostScript('win32')
    expect(script).toContain('powercfg /setactive')
    expect(script).toContain('$LASTEXITCODE')
    expect(script).toContain('echo OK')
  })
})

describe('GameMode 跨平台脚本分发', () => {
  it('status 脚本按平台分发', () => {
    expect(buildStatusScript('win32')).toContain('powercfg /getactivescheme')
    expect(buildStatusScript('darwin')).toContain('pgrep -x caffeinate')
    expect(buildStatusScript('linux')).toContain('scaling_governor')
  })

  it('boost 脚本按平台分发', () => {
    expect(buildBoostScript('darwin')).toContain('caffeinate -disu')
    expect(buildBoostScript('linux')).toContain(PERFORMANCE_GOVERNOR)
  })

  it('restore 脚本按平台分发且携带 prev', () => {
    expect(buildRestoreScript('12345', 'darwin')).toContain('kill 12345')
    expect(buildRestoreScript('powersave', 'linux')).toContain('powersave')
  })
})

describe('GameMode unix 运行时（注入假 runner）', () => {
  // macOS runner：status 返回 ACTIVE:caffeinate，boost 返回 PID
  function macRunner() {
    return recordingRunner((s) => {
      if (s.includes('pgrep')) return ok('NONE')
      if (s.includes('caffeinate -disu')) return ok('4567')
      if (s.includes('kill')) return ok('OK')
      return ok('NONE')
    })
  }

  // Linux runner：status 返回当前 governor，boost/restore 按 err 标志回显
  function linuxRunner(boostOk = true) {
    return recordingRunner((s) => {
      if (s.includes('cat /sys')) return ok('ACTIVE:powersave')
      if (s.includes('tee') && s.includes(PERFORMANCE_GOVERNOR)) {
        return boostOk ? ok('OK') : ok('ERR:需 root 权限切换 CPU 调速器')
      }
      if (s.includes('tee') && s.includes('powersave')) return ok('OK')
      return ok('NONE')
    })
  }

  it('macOS boost 记录 caffeinate PID，restore 按 PID kill', async () => {
    const { runner, calls } = macRunner()
    const svc = createGameModeService(runner, undefined, 'darwin')
    const boosted = await svc.boost()
    expect(boosted.boosted).toBe(true)
    expect(boosted.previous).toBe('4567')
    const restored = await svc.restore()
    expect(restored.boosted).toBe(false)
    expect(calls.some((c) => c.script.includes('kill 4567'))).toBe(true)
  })

  it('macOS status 解析 ACTIVE 标记', async () => {
    const { runner } = macRunner()
    const svc = createGameModeService(runner, undefined, 'darwin')
    const st = await svc.status()
    expect(st.active).toBe('') // 初始 NONE → 空
  })

  it('Linux boost 切换 performance 成功时 boosted=true', async () => {
    const { runner } = linuxRunner(true)
    const svc = createGameModeService(runner, undefined, 'linux')
    const st = await svc.boost()
    expect(st.boosted).toBe(true)
    expect(st.previous).toBe('powersave')
  })

  it('Linux boost 权限不足时 boosted=false', async () => {
    const { runner } = linuxRunner(false)
    const svc = createGameModeService(runner, undefined, 'linux')
    const st = await svc.boost()
    expect(st.boosted).toBe(false)
  })

  it('parseUnixStatus 解析 ACTIVE 与 NONE', () => {
    expect(parseUnixStatus('ACTIVE:caffeinate\n')).toBe('caffeinate')
    expect(parseUnixStatus('NONE')).toBe('')
    expect(parseUnixStatus('')).toBe('')
  })
})
