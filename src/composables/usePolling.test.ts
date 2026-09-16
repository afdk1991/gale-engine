import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePolling } from './usePolling'

/** 可手动控制何时 resolve 的 promise */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按间隔反复执行任务', async () => {
    const task = vi.fn(async () => {})
    const poll = usePolling(task, 1000)
    poll.start()

    await vi.advanceTimersByTimeAsync(3000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('上一次未返回时跳过本次，不叠加请求（回归：慢采集导致请求堆积）', async () => {
    const d = deferred()
    const task = vi.fn(() => d.promise)
    const poll = usePolling(task, 1000)
    poll.start()

    // 第一次触发后任务挂住不返回；后续 3 个周期都应被跳过
    await vi.advanceTimersByTimeAsync(3000)
    expect(task).toHaveBeenCalledTimes(1)
    expect(poll.skipped.value).toBe(2)
    expect(poll.busy.value).toBe(true)

    // 任务返回后恢复轮询
    d.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(poll.busy.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('任务抛错不会产生未捕获 rejection，且不阻塞后续轮询', async () => {
    const task = vi.fn(async () => {
      throw new Error('采集失败')
    })
    const poll = usePolling(task, 1000)
    poll.start()

    await vi.advanceTimersByTimeAsync(2000)
    expect(task).toHaveBeenCalledTimes(2)
    expect(poll.busy.value).toBe(false)
  })

  it('重复 start 不会叠加多个定时器', async () => {
    const task = vi.fn(async () => {})
    const poll = usePolling(task, 1000)
    poll.start()
    poll.start()
    poll.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('stop 之后不再触发，且 active 归位', async () => {
    const task = vi.fn(async () => {})
    const poll = usePolling(task, 1000)
    poll.start()
    await vi.advanceTimersByTimeAsync(1000)
    poll.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(1)
    expect(poll.active.value).toBe(false)
  })

  it('tick 可手动触发一次（用于页面初始化立即取数，不受 busy 状态影响）', async () => {
    const task = vi.fn(async () => {})
    const poll = usePolling(task, 1000)
    await poll.tick()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('组件外调用不会注册生命周期钩子（不抛错、不告警）', () => {
    expect(() => usePolling(async () => {}, 1000)).not.toThrow()
  })
})
