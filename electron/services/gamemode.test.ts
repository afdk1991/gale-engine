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
import type { StorageAdapter } from './settings'

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

/** 内存存储：暴露底层对象，便于断言「失败时凭据是否被误清」 */
function memStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial }
  const adapter: StorageAdapter = {
    get: <T>(key: string, fallback: T): T => (key in data ? (data[key] as T) : fallback),
    set: (key: string, value: unknown): void => {
      data[key] = value
    }
  }
  return { adapter, data }
}

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
    const st = await createGameModeService(runner, undefined, 'win32').status()
    expect(st.active).toBe(BALANCED)
    expect(st.activeName).toBe('Balanced')
    expect(st.boosted).toBe(false)
    expect(st.previous).toBeNull()
  })

  it('boost 切换到高性能并记录上一计划，boosted=true', async () => {
    const { runner } = makeRunner()
    const r = await createGameModeService(runner, undefined, 'win32').boost()
    expect(r.ok).toBe(true)
    expect(r.status.boosted).toBe(true)
    expect(r.status.previous).toBe(BALANCED)
    expect(runner).toBeDefined()
  })

  it('boost 幂等：第二次 boost 不覆盖 previous', async () => {
    const { runner } = makeRunner()
    const svc = createGameModeService(runner, undefined, 'win32')
    await svc.boost()
    const r = await svc.boost()
    expect(r.status.previous).toBe(BALANCED)
  })

  it('restore 还原上一计划并清除 boosted/previous', async () => {
    const { runner, calls } = makeRunner()
    const svc = createGameModeService(runner, undefined, 'win32')
    await svc.boost()
    const r = await svc.restore()
    expect(r.ok).toBe(true)
    expect(r.status.boosted).toBe(false)
    expect(r.status.previous).toBeNull()
    expect(calls.some((c) => c.script.includes(`setactive ${BALANCED}`))).toBe(true)
  })

  it('restore 在未 boost 时不调用 setactive', async () => {
    const { runner, calls } = makeRunner()
    const r = await createGameModeService(runner, undefined, 'win32').restore()
    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.script.includes('setactive'))).toBe(false)
  })

  it('切换失败时回执 ok=false 且带原因（回归：界面曾无论成败都谎报成功）', async () => {
    const { runner } = recordingRunner(() => ({ stdout: '', stderr: '', code: 1 }))
    const svc = createGameModeService(runner, undefined, 'win32')
    const r = await svc.boost()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/操作失败/)
    expect(r.status.boosted).toBe(false)
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

// ─────────────────────────────────────────────────────────────
// 回归：还原凭据经 electron-store 持久化，落盘文件位于用户可写目录，属不可信输入。
// 旧实现把它直接插进 shell（`echo ${prev} | tee`）与 PowerShell
// （`powercfg /setactive ${prev}`），而注释却写「已校验」——实际没有任何校验。
// ─────────────────────────────────────────────────────────────
describe('GameMode 还原凭据校验（防注入）', () => {
  const CASES: { platform: 'win32' | 'darwin' | 'linux'; payloads: string[] }[] = [
    {
      platform: 'win32',
      payloads: [
        `${BALANCED}; Remove-Item -Recurse -Force $HOME`,
        '; Start-Process calc',
        `${BALANCED}" ; calc ; "`,
        'not-a-guid',
        '',
        '{'.repeat(60)
      ]
    },
    {
      platform: 'linux',
      payloads: [
        'powersave; rm -rf ~',
        'powersave$(touch /tmp/pwned)',
        'powersave`id`',
        'powersave | tee /etc/shadow',
        'powersave\nid',
        'Performance', // 大写：内核 governor 名一律小写
        '',
        'a'.repeat(40)
      ]
    },
    {
      platform: 'darwin',
      payloads: ['4567; rm -rf ~', '4567$(id)', '../../etc/passwd', '', 'x'.repeat(64), '-1']
    }
  ]

  for (const { platform, payloads } of CASES) {
    it(`${platform}：非法 prev 一律不拼接，只回传错误`, () => {
      for (const payload of payloads) {
        const script = buildRestoreScript(payload, platform)
        expect(script).toContain('ERR:还原凭据非法')
        // 关键断言：任何情况下都不得把原始输入带进脚本
        if (payload) expect(script).not.toContain(payload)
      }
    })
  }

  it('合法凭据仍生成真实还原脚本', () => {
    expect(buildRestoreScript(BALANCED, 'win32')).toContain(`setactive ${BALANCED}`)
    expect(buildRestoreScript('powersave', 'linux')).toContain('powersave')
    expect(buildRestoreScript('4567', 'darwin')).toContain('kill 4567')
  })

  it('Windows：{GUID} 与大小写差异被规范化为小写裸 GUID', () => {
    const script = buildRestoreScript('{381B4222-F694-41F0-9685-FF5BB260DF2E}', 'win32')
    expect(script).toContain(`setactive ${BALANCED}`)
  })

  it('Linux：合法 governor 仍被引号包裹', () => {
    expect(buildRestoreScript('powersave', 'linux')).toContain('echo "powersave"')
  })

  it('macOS：restore 先探活再 kill（进程已退出属「已完成还原」而非失败）', () => {
    const script = buildRestoreScript('4567', 'darwin')
    expect(script).toContain('kill -0 4567')
    expect(script).not.toContain('进程已结束')
  })
})

// ─────────────────────────────────────────────────────────────
// 回归：还原失败时若清掉凭据，用户会永久停在性能模式且应用再也无从还原。
// ─────────────────────────────────────────────────────────────
describe('GameMode 还原失败不留假状态', () => {
  it('restore 失败时保留凭据与 boosted', async () => {
    const { adapter, data } = memStorage({
      'gamemode.boosted': true,
      'gamemode.previous': 'powersave'
    })
    const { runner } = recordingRunner((s) => {
      if (s.includes('cat /sys')) return ok('ACTIVE:performance')
      if (s.includes('tee')) return ok('ERR:还原调速器失败（需 root 权限）')
      return ok('NONE')
    })
    const svc = createGameModeService(runner, adapter, 'linux')

    const r = await svc.restore()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('root')
    // 还原没成功 → 不能谎报已退出，也不能丢掉「该还原成什么」
    expect(r.status.boosted).toBe(true)
    expect(data['gamemode.previous']).toBe('powersave')
  })

  it('restore 成功后才清除凭据', async () => {
    const { adapter, data } = memStorage({
      'gamemode.boosted': true,
      'gamemode.previous': 'powersave'
    })
    const { runner } = recordingRunner((s) => {
      if (s.includes('cat /sys')) return ok('ACTIVE:performance')
      if (s.includes('tee')) return ok('OK')
      return ok('NONE')
    })
    const svc = createGameModeService(runner, adapter, 'linux')

    const r = await svc.restore()
    expect(r.ok).toBe(true)
    expect(r.status.boosted).toBe(false)
    expect(data['gamemode.previous']).toBeNull()
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
    expect(boosted.ok).toBe(true)
    expect(boosted.status.boosted).toBe(true)
    expect(boosted.status.previous).toBe('4567')
    const restored = await svc.restore()
    expect(restored.ok).toBe(true)
    expect(restored.status.boosted).toBe(false)
    expect(calls.some((c) => c.script.includes('kill 4567'))).toBe(true)
  })

  it('macOS status 解析 ACTIVE 标记', async () => {
    const { runner } = macRunner()
    const svc = createGameModeService(runner, undefined, 'darwin')
    const st = await svc.status()
    expect(st.active).toBe('') // 初始 NONE → 空
  })

  it('macOS 重复 boost 先收掉上一轮 caffeinate（回归：PID 与 previous 共用存储键被覆盖，导致进程泄漏持续阻止休眠）', async () => {
    const pids = ['4567', '8901']
    let n = 0
    const { runner, calls } = recordingRunner((s) => {
      if (s.includes('pgrep')) return ok('NONE')
      if (s.includes('caffeinate -disu')) return ok(pids[n++] ?? '9999')
      if (s.includes('kill')) return ok('OK')
      return ok('NONE')
    })
    const svc = createGameModeService(runner, undefined, 'darwin')

    const first = await svc.boost()
    expect(first.status.previous).toBe('4567')
    await svc.boost()

    // 上一轮的 caffeinate 必须被 kill，否则后台残留进程会持续阻止系统休眠
    expect(calls.some((c) => c.script.includes('kill 4567'))).toBe(true)
    const st = await svc.status()
    expect(st.previous).toBe('8901') // 新 PID 已接管
  })

  it('macOS boost 未拿到合法 PID 时 ok=false 且不把错误输出当 PID 落盘', async () => {
    const { adapter, data } = memStorage()
    const { runner } = recordingRunner((s) => {
      if (s.includes('pgrep')) return ok('NONE')
      if (s.includes('caffeinate -disu')) {
        return { stdout: '', stderr: 'caffeinate: command not found', code: 127 }
      }
      return ok('NONE')
    })
    const svc = createGameModeService(runner, adapter, 'darwin')

    const r = await svc.boost()
    expect(r.ok).toBe(false)
    expect(r.status.boosted).toBe(false)
    expect(data['gamemode.caffeinatePid']).toBeUndefined()
  })

  it('macOS 重复 boost 清理失败时在回执中如实提示（不再静默吞错）', async () => {
    const { adapter } = memStorage({
      'gamemode.boosted': true,
      'gamemode.caffeinatePid': '4567'
    })
    const { runner } = recordingRunner((s) => {
      if (s.includes('pgrep')) return ok('NONE')
      if (s.includes('kill -0')) return ok('ERR:结束 caffeinate 失败')
      if (s.includes('caffeinate -disu')) return ok('8901')
      return ok('NONE')
    })
    const svc = createGameModeService(runner, adapter, 'darwin')

    const r = await svc.boost()
    expect(r.ok).toBe(true) // 新 caffeinate 起来了
    expect(r.message).toContain('4567') // 但旧进程残留必须让用户知道
    expect(r.message).toContain('未能结束')
  })

  it('Linux boost 切换 performance 成功时 boosted=true', async () => {
    const { runner } = linuxRunner(true)
    const svc = createGameModeService(runner, undefined, 'linux')
    const r = await svc.boost()
    expect(r.ok).toBe(true)
    expect(r.status.boosted).toBe(true)
    expect(r.status.previous).toBe('powersave')
  })

  it('Linux boost 权限不足时 ok=false 且 boosted=false（界面据此不再谎报成功）', async () => {
    const { runner } = linuxRunner(false)
    const svc = createGameModeService(runner, undefined, 'linux')
    const r = await svc.boost()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('root')
    expect(r.status.boosted).toBe(false)
  })

  it('parseUnixStatus 解析 ACTIVE 与 NONE', () => {
    expect(parseUnixStatus('ACTIVE:caffeinate\n')).toBe('caffeinate')
    expect(parseUnixStatus('NONE')).toBe('')
    expect(parseUnixStatus('')).toBe('')
  })
})
