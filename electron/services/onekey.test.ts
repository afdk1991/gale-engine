import { describe, it, expect } from 'vitest'
import { createOneKeyService, NEED_ADMIN_REASON } from './onekey'
import {
  createOptCache,
  type OptLibrary,
  type OptCapabilityMeta,
  type OptContext,
  type OptOutcome
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
