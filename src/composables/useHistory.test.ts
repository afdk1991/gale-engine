import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeHistory } from './useHistory'

/**
 * 注入 window.gale 的 history.add 实现。
 * 渲染层测试里 window.gale 由 preload 提供，这里用最小替身替换。
 */
function installGale(add: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { gale: unknown }).gale = { history: { add } }
}

describe('writeHistory', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).gale
  })

  it('正常写入时原样透传入参', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'x1' })
    installGale(add)
    await writeHistory({ type: 'cleanup', label: '清理 3 项垃圾', detail: 'temp、recycle' })
    expect(add).toHaveBeenCalledWith({
      type: 'cleanup',
      label: '清理 3 项垃圾',
      detail: 'temp、recycle'
    })
  })

  // 核心回归点：historyService.add 在入参不合法或写盘失败时会抛错。
  // 若它由调用方的 try 捕获，会用「历史记录参数不合法」覆盖真实操作回执，
  // 并跳过随后的 refresh()。writeHistory 必须吞掉该异常。
  it('history.add 抛错时静默吞掉，不向上冒泡', async () => {
    const add = vi.fn().mockRejectedValue(new Error('历史记录参数不合法'))
    installGale(add)
    await expect(writeHistory({ type: 'toolbox', label: '刷新 DNS' })).resolves.toBeUndefined()
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('window.gale 缺失（preload 未注入）时也不抛出', async () => {
    delete (window as unknown as Record<string, unknown>).gale
    await expect(writeHistory({ type: 'optimize', label: '结束进程' })).resolves.toBeUndefined()
  })
})
