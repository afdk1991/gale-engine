import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { inferTone, useFlash, FLASH_TTL_MS } from './useFlash'

describe('inferTone — 按文案推断语气（兜底）', () => {
  it('含「成功」判为 ok', () => {
    expect(inferTone('操作成功')).toBe('ok')
    expect(inferTone('已成功启用')).toBe('ok')
  })
  it('含失败类措辞判为 bad', () => {
    for (const m of [
      '拒绝访问',
      '操作失败',
      '无效的配置文件（须为 Domain/Private/Public）',
      '当前平台暂不支持单条防火墙规则开关',
      '需要管理员权限',
      '未安装 VC++ 运行库',
      '✗ 结束进程失败'
    ]) {
      expect(inferTone(m)).toBe('bad')
    }
  })
  it('中性文案判为 info', () => {
    expect(inferTone('已提交，等待重启')).toBe('info')
    expect(inferTone('')).toBe('info')
  })
})

describe('useFlash — 反馈提示', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('写入后可按 key 读取文案与语气', () => {
    const { flash, feedback, tone } = useFlash()
    flash('svc-a', '操作成功')
    expect(feedback.value['svc-a']).toBe('操作成功')
    expect(tone('svc-a')).toBe('ok')
  })

  it('显式 tone 优先于文案推断', () => {
    const { flash, tone } = useFlash()
    // 文案像成功、但调用方明确知道失败了
    flash('svc-b', '操作成功（服务仍为 Stopped）', 'bad')
    expect(tone('svc-b')).toBe('bad')
  })

  it('数字键同样可用（进程 PID）', () => {
    const { flash, feedback, tone } = useFlash()
    flash(4242, '拒绝访问', 'bad')
    expect(feedback.value[4242]).toBe('拒绝访问')
    expect(tone(4242)).toBe('bad')
  })

  it('未写入的 key 语气为 info 且文案为空', () => {
    const { feedback, tone } = useFlash()
    expect(feedback.value['nope']).toBeUndefined()
    expect(tone('nope')).toBe('info')
  })

  it('TTL 到期后自动清除文案与语气', () => {
    const { flash, feedback, tone } = useFlash(1000)
    flash('k', '操作成功')
    expect(feedback.value['k']).toBe('操作成功')
    vi.advanceTimersByTime(999)
    expect(feedback.value['k']).toBe('操作成功')
    vi.advanceTimersByTime(1)
    expect(feedback.value['k']).toBeUndefined()
    expect(tone('k')).toBe('info')
  })

  it('同 key 重复写入会重置计时器（不会提前消失）', () => {
    const { flash, feedback } = useFlash(1000)
    flash('k', '第一次')
    vi.advanceTimersByTime(800)
    flash('k', '第二次')
    vi.advanceTimersByTime(800) // 距第二次仅 800ms
    expect(feedback.value['k']).toBe('第二次')
    vi.advanceTimersByTime(200)
    expect(feedback.value['k']).toBeUndefined()
  })

  it('clear 立即清空全部', () => {
    const { flash, feedback, tone, clear } = useFlash()
    flash('a', '操作成功')
    flash('b', '失败')
    clear()
    expect(feedback.value).toEqual({})
    expect(tone('a')).toBe('info')
  })

  // ★ 回归：原实现各自在页面里写 setTimeout 且不清理，卸载后仍会写 ref
  it('默认 TTL 为 3 秒（与既有页面行为一致）', () => {
    expect(FLASH_TTL_MS).toBe(3000)
  })
})
