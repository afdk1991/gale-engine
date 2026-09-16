import { describe, it, expect, vi } from 'vitest'
import { createUpdateService, type UpdaterApi, type UpdaterEvent } from './update'
import type { UpdateCapability } from '../../shared/types'

type CheckResult = { isUpdateAvailable: boolean; updateInfo?: { version?: string | number } }

function makeUpdater(
  opts: {
    /** 依次返回的检查结果；用完后重复最后一项 */
    results?: CheckResult[]
    /** 每次都 reject 的错误 */
    error?: Error
    /** 先失败 N 次再成功 */
    failTimes?: number
    success?: CheckResult
    capability?: UpdateCapability
  } = {}
) {
  let quitCalls = 0
  let checkCalls = 0
  let failRemaining = opts.failTimes ?? 0
  const events = new Set<(e: UpdaterEvent) => void>()

  const api: UpdaterApi = {
    currentVersion: '0.1.9',
    capability: opts.capability,
    checkForUpdates: async () => {
      checkCalls++
      if (opts.error) throw opts.error
      if (failRemaining > 0) {
        failRemaining--
        throw new Error('temporary network failure')
      }
      const list = opts.results ?? []
      const idx = Math.min(checkCalls - 1, Math.max(0, list.length - 1))
      return list.length > 0 ? list[idx] : (opts.success ?? { isUpdateAvailable: false })
    },
    quitAndInstall: () => {
      quitCalls++
    },
    onEvent: (cb) => {
      events.add(cb)
      return () => events.delete(cb)
    }
  }
  return {
    api,
    getQuitCalls: () => quitCalls,
    getCheckCalls: () => checkCalls,
    fire: (e: UpdaterEvent) => {
      for (const cb of events) cb(e)
    }
  }
}

const noWait = { sleep: async () => {}, retryDelayMs: 0 }

describe('createUpdateService — 基础状态归一化', () => {
  it('把「有更新」映射为 status=available 且带版本号', async () => {
    const { api } = makeUpdater({
      results: [{ isUpdateAvailable: true, updateInfo: { version: '0.1.10' } }]
    })
    const res = await createUpdateService(api, noWait).checkUpdate()
    expect(res.status).toBe('available')
    expect(res.version).toBe('0.1.10')
  })

  it('把「无更新」映射为 status=up-to-date 且不带版本号', async () => {
    const { api } = makeUpdater({ results: [{ isUpdateAvailable: false }] })
    const res = await createUpdateService(api, noWait).checkUpdate()
    expect(res.status).toBe('up-to-date')
    expect(res.version).toBeUndefined()
  })

  it('检查抛错时映射为 status=error 并保留原因', async () => {
    const { api } = makeUpdater({ error: new Error('network down') })
    const res = await createUpdateService(api, noWait).checkUpdate()
    expect(res.status).toBe('error')
    expect(res.error).toContain('network down')
  })

  it('installUpdate 恰好触发一次 quitAndInstall', () => {
    const { api, getQuitCalls } = makeUpdater()
    createUpdateService(api, noWait).installUpdate()
    expect(getQuitCalls()).toBe(1)
  })

  it('透传 currentVersion 与能力探测结果', () => {
    const capability: UpdateCapability = {
      canAutoUpdate: true,
      platform: 'win32',
      packageKind: 'nsis',
      reason: null
    }
    const { api } = makeUpdater({ capability })
    const svc = createUpdateService(api, noWait)
    expect(svc.currentVersion).toBe('0.1.9')
    expect(svc.capability()).toEqual(capability)
  })

  it('初始状态为 idle', () => {
    const { api } = makeUpdater()
    expect(createUpdateService(api, noWait).state().status).toBe('idle')
  })
})

describe('createUpdateService — 失败重试与静默自检', () => {
  it('前台检查失败后自动重试，成功则返回最新结果', async () => {
    const { api, getCheckCalls } = makeUpdater({
      failTimes: 1,
      success: { isUpdateAvailable: true, updateInfo: { version: '0.1.10' } }
    })
    const res = await createUpdateService(api, noWait).checkUpdate()
    expect(res.status).toBe('available')
    expect(getCheckCalls()).toBe(2)
  })

  it('重试次数用尽后仍失败才进入 error', async () => {
    const { api, getCheckCalls } = makeUpdater({ error: new Error('still down') })
    const res = await createUpdateService(api, { retries: 2, sleep: async () => {} }).checkUpdate()
    expect(res.status).toBe('error')
    expect(getCheckCalls()).toBe(3)
  })

  it('静默自检不重试，且结果带 silent 标记', async () => {
    const { api, getCheckCalls } = makeUpdater({ error: new Error('offline') })
    const res = await createUpdateService(api, noWait).checkUpdate({ silent: true })
    expect(res.status).toBe('error')
    expect(res.silent).toBe(true)
    expect(getCheckCalls()).toBe(1)
  })
})

describe('createUpdateService — 平台不支持自更新时诚实降级', () => {
  it('capability.canAutoUpdate=false 时直接返回 unsupported 且不发网络请求', async () => {
    const capability: UpdateCapability = {
      canAutoUpdate: false,
      platform: 'linux',
      packageKind: 'deb',
      reason: '请用包管理器升级'
    }
    const { api, getCheckCalls } = makeUpdater({ capability })
    const res = await createUpdateService(api, noWait).checkUpdate()
    expect(res.status).toBe('unsupported')
    expect(res.reason).toContain('包管理器')
    expect(getCheckCalls()).toBe(0)
  })
})

describe('createUpdateService — 下载生命周期（事件驱动）', () => {
  it('进度事件把状态推进到 downloading 并带百分比', async () => {
    const { api, fire } = makeUpdater()
    const svc = createUpdateService(api, noWait)
    fire({ type: 'progress', percent: 42.34, transferred: 100, total: 200, bytesPerSecond: 50 })
    const s = svc.state()
    expect(s.status).toBe('downloading')
    expect(s.percent).toBe(42.3)
    expect(s.total).toBe(200)
  })

  it('下载完成事件把状态推进到 downloaded', async () => {
    const { api, fire } = makeUpdater()
    const svc = createUpdateService(api, noWait)
    fire({ type: 'downloaded', version: '0.1.10' })
    const s = svc.state()
    expect(s.status).toBe('downloaded')
    expect(s.version).toBe('0.1.10')
    expect(s.percent).toBe(100)
  })

  it('已进入下载态时，检查结果不会把状态回退到 available', async () => {
    const { api, fire } = makeUpdater({
      results: [{ isUpdateAvailable: true, updateInfo: { version: '0.1.10' } }]
    })
    const svc = createUpdateService(api, noWait)
    fire({ type: 'downloaded', version: '0.1.10' })
    const res = await svc.checkUpdate()
    expect(res.status).toBe('downloaded')
  })

  it('静默自检期间底层报错不进入用户可见的 error 态', async () => {
    const { api, fire } = makeUpdater({ results: [{ isUpdateAvailable: false }] })
    const svc = createUpdateService(api, noWait)
    await svc.checkUpdate({ silent: true })
    fire({ type: 'error', message: '后台错误' })
    expect(svc.state().status).toBe('up-to-date')
  })

  it('非静默状态下底层报错会进入 error 态', async () => {
    const { api, fire } = makeUpdater({ results: [{ isUpdateAvailable: false }] })
    const svc = createUpdateService(api, noWait)
    await svc.checkUpdate()
    fire({ type: 'error', message: '下载失败' })
    expect(svc.state().status).toBe('error')
    expect(svc.state().error).toBe('下载失败')
  })
})

describe('createUpdateService — 订阅', () => {
  it('onState 订阅时立即补发当前状态，并在变化时再次推送', async () => {
    const { api } = makeUpdater({
      results: [{ isUpdateAvailable: true, updateInfo: { version: '0.1.10' } }]
    })
    const svc = createUpdateService(api, noWait)
    const seen: string[] = []
    const off = svc.onState((s) => seen.push(s.status))
    expect(seen).toEqual(['idle'])
    await svc.checkUpdate()
    expect(seen).toContain('checking')
    expect(seen[seen.length - 1]).toBe('available')
    off()
  })

  it('退订后不再收到推送', async () => {
    const { api, fire } = makeUpdater()
    const svc = createUpdateService(api, noWait)
    const spy = vi.fn()
    const off = svc.onState(spy)
    off()
    fire({ type: 'downloaded', version: '1.0.0' })
    expect(spy).toHaveBeenCalledTimes(1) // 仅订阅时的补发
  })

  it('单个订阅方抛错不影响其它订阅方与状态机', async () => {
    const { api, fire } = makeUpdater()
    const svc = createUpdateService(api, noWait)
    const good = vi.fn()
    svc.onState(() => {
      throw new Error('bad subscriber')
    })
    svc.onState(good)
    fire({ type: 'downloaded', version: '1.0.0' })
    expect(svc.state().status).toBe('downloaded')
    expect(good).toHaveBeenCalled()
  })
})
