import { describe, it, expect } from 'vitest'
import { createOneKeyService, NEED_ADMIN_REASON } from './onekey'
import type { OptCapabilityMeta, OptOutcome } from '../../shared/types'
import {
  createOptCache,
  type OptLibrary,
  type OptContext
} from './optlib'
import type { OneKeyProgress } from '../../shared/types'

function makeLibrary(opts: { failIds?: string[]; pauseFirst?: boolean } = {}) {
  const failSet = new Set(opts.failIds ?? [])
  const metas: OptCapabilityMeta[] = [
    { id: 'a', label: 'A', description: '', needsAdmin: false, defaultEnabled: true },
    { id: 'b', label: 'B', description: '', needsAdmin: false, defaultEnabled: true },
    { id: 'admin', label: 'Admin', description: '', needsAdmin: true, defaultEnabled: true }
  ]
  let runCount = 0
  let release: (() => void) | null = null
  let pausedOnce = false
  const ctx: OptContext = {
    platform: 'win32',
    normal: {} as never,
    admin: {} as never,
    isElevated: async () => false,
    cache: createOptCache()
  }
  const library: OptLibrary = {
    listCapabilities: () => metas,
    createContext: () => ctx,
    runInContext: async (_c: OptContext, id: string): Promise<OptOutcome> => {
      runCount++
      if (opts.pauseFirst && !pausedOnce) {
        pausedOnce = true
        await new Promise<void>((r) => { release = r })
      }
      if (failSet.has(id)) {
        return { id, label: id, status: 'failed', durationMs: 1, error: 'boom', attempts: 1 }
      }
      return { id, label: id, status: 'success', durationMs: 1, releasedBytes: 100, attempts: 1 }
    },
    runSingle: (id: string) => library.runInContext(ctx, id)
  }
  return {
    library,
    metas,
    getRunCount: () => runCount,
    clearFails: () => failSet.clear(),
    release: () => release && release()
  }
}

const okDeps = (lib: OptLibrary) => ({ library: lib, maxRetries: 0, retryDelayMs: 0 })

describe('一键优化编排', () => {
  it('默认顺序执行全部 defaultEnabled 项并汇总', async () => {
    const { library } = makeLibrary()
    const svc = createOneKeyService(okDeps(library))
    const phases: string[] = []
    svc.onProgress((p: OneKeyProgress) => phases.push(p.phase))

    const summary = await svc.start()
    expect(summary.total).toBe(3)
    expect(summary.success).toBe(2) // a、b 成功；admin 未提权跳过
    expect(summary.skipped).toBe(1)
    expect(summary.failed).toBe(0)
    expect(summary.releasedBytes).toBe(200)
    expect(summary.cancelled).toBe(false)
    expect(summary.outcomes).toHaveLength(3)
    expect(phases).toContain('done')
  })

  it('管理员项未提权时直接跳过并给出指引', async () => {
    const { library } = makeLibrary()
    const svc = createOneKeyService(okDeps(library))
    const summary = await svc.start()
    const admin = summary.outcomes.find((o) => o.id === 'admin')
    expect(admin?.status).toBe('skipped')
    expect(admin?.reason).toBe(NEED_ADMIN_REASON)
  })

  it('中途取消：当前项完成后停止，不跑剩余项', async () => {
    const { library, release } = makeLibrary({ pauseFirst: true })
    const svc = createOneKeyService(okDeps(library))
    const p = svc.start()
    // 此时首项正确卡在暂停点；请求取消
    await svc.cancel()
    release()
    const summary = await p
    expect(summary.cancelled).toBe(true)
    expect(summary.outcomes).toHaveLength(1)
  })

  it('start() 卡在 await isElevated 期间即被守卫拦下（回归：并发窗口期导致两轮任务并行）', async () => {
    // 这是原实现的真实缺陷：守卫只看 state.phase，而 state 要等 await isElevated()
    // 之后才建立。两次快速调用（双击按钮 / 界面重试与自动重试撞车）会同时通过守卫，
    // 于是两轮任务并行、进度互相覆盖、同一批目录被并发清理。
    const gate: { release: (() => void) | null } = { release: null }
    const gatePromise = new Promise<void>((r) => {
      gate.release = r
    })
    const { library, getRunCount } = makeLibrary()
    const svc = createOneKeyService({
      library,
      isElevated: async () => {
        await gatePromise
        return false
      },
      maxRetries: 0,
      retryDelayMs: 0
    })

    const first = svc.start()
    // 此刻 first 仍卡在 await isElevated()，state 尚未建立 —— 第二轮必须被挡
    const blocked = await svc.start()
    expect(blocked.total).toBe(0)
    expect(blocked.error).toContain('正在执行')
    expect(svc.isRunning()).toBe(false) // 尚未真正开始

    gate.release?.()
    const summary = await first
    expect(summary.total).toBe(3)
    // a、b 各执行一次（admin 未提权被预检跳过，不进执行器）；
    // 若守卫失效，第二轮会插进来把这两项再跑一遍变成 4 次。
    expect(getRunCount()).toBe(2)
  })

  it('轮次结束后守卫放开，可再次 start', async () => {
    const { library } = makeLibrary()
    const svc = createOneKeyService(okDeps(library))
    await svc.start()
    const second = await svc.start()
    expect(second.total).toBe(3)
    expect(second.error).toBeUndefined()
  })

  it('失败项可重试：先失败，清除失败源后重试成功', async () => {
    const { library, clearFails } = makeLibrary({ failIds: ['b'] })
    const svc = createOneKeyService(okDeps(library))

    const first = await svc.start()
    expect(first.failed).toBe(1)
    expect(first.outcomes.find((o) => o.id === 'b')?.status).toBe('failed')

    clearFails()
    const retry = await svc.retryFailed()
    expect(retry.total).toBe(1)
    expect(retry.failed).toBe(0)
    expect(retry.outcomes.find((o) => o.id === 'b')?.status).toBe('success')
  })

  it('并发守卫：运行中再次 start 返回提示而非新开任务', async () => {
    const { library, release } = makeLibrary({ pauseFirst: true })
    const svc = createOneKeyService(okDeps(library))
    const p = svc.start()
    const second = await svc.start()
    release()
    await p
    expect(second.error).toContain('正在执行')
  })
})
