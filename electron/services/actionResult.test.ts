import { describe, it, expect } from 'vitest'
import { parseActionOutcome, fromExitCode } from './actionResult'

describe('parseActionOutcome', () => {
  it('独立一行的 OK 判成功', () => {
    expect(parseActionOutcome('OK')).toEqual({ ok: true, message: '操作成功', raw: 'OK' })
  })

  it('容忍前后空白与多行输出中的 OK 行', () => {
    const r = parseActionOutcome('  some progress\n  OK  \n')
    expect(r.ok).toBe(true)
    expect(r.message).toBe('操作成功')
  })

  it('OK:细节 回传更具体的信息', () => {
    expect(parseActionOutcome('OK:已直接清理回收站（Finder 自动化不可用）').message).toBe(
      '已直接清理回收站（Finder 自动化不可用）'
    )
  })

  it('ERR: 优先于 OK —— 错误信息里夹带 OK 字样也不能判成功', () => {
    // 这正是旧实现 `includes('OK')` 翻车的地方：'permission OK? no' 含 "OK"
    const r = parseActionOutcome('permission OK? no')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('permission OK? no')
  })

  it('ERR: 但同一输出里也有 OK 时，仍判失败', () => {
    const r = parseActionOutcome('OK\nERR:拒绝访问')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('拒绝访问')
  })

  it('子串 OK 不算成功（"xxx OK yyy" 不是令牌）', () => {
    const r = parseActionOutcome('the operation OK but nothing removed', 0)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('the operation OK')
  })

  it('空输出判失败而非成功', () => {
    const r = parseActionOutcome('')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('脚本无输出')
  })

  it('空输出 + 非零退出码时把退出码带进文案', () => {
    expect(parseActionOutcome('', 5).message).toContain('退出码 5')
  })

  it('无令牌且退出码非 0 → 失败并带上退出码', () => {
    const r = parseActionOutcome('permission denied', 1)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('退出码 1')
    expect(r.message).toContain('permission denied')
  })

  it('无令牌且退出码为 0 → 仍判失败（脚本没有确认成功）', () => {
    const r = parseActionOutcome('something happened', 0)
    expect(r.ok).toBe(false)
    expect(r.message).toBe('something happened')
  })

  it('ERR: 无原因时给出兜底文案，不返回空消息', () => {
    const r = parseActionOutcome('ERR:')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('操作失败')
  })

  it('取首条 ERR: 的原因作为展示文案（多行细节留在 raw 里）', () => {
    const r = parseActionOutcome('ERR:第一行\n第二行')
    expect(r.message).toBe('第一行')
    expect(r.raw).toBe('ERR:第一行\n第二行')
  })

  it('多条 ERR: 时取第一条（通常是根因）', () => {
    const r = parseActionOutcome('ERR:根因\nERR:衍生错误')
    expect(r.message).toBe('根因')
    expect(r.raw).toContain('衍生错误')
  })

  it('raw 始终保留原始输出，便于排查', () => {
    expect(parseActionOutcome('  OK  ').raw).toBe('OK')
  })

  it('CRLF 换行也能正确识别令牌', () => {
    expect(parseActionOutcome('progress\r\nOK\r\n').ok).toBe(true)
    expect(parseActionOutcome('ERR:失败\r\n').ok).toBe(false)
  })
})

describe('fromExitCode', () => {
  it('退出码 0 返回成功文案', () => {
    expect(fromExitCode(0, '', '', '已刷新', '刷新失败')).toEqual({ ok: true, message: '已刷新' })
  })

  it('非 0 优先用 stderr 作为原因', () => {
    const r = fromExitCode(1, 'stdout text', 'stderr text', 'ok', '兜底')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('stderr text')
  })

  it('无 stderr 时退回 stdout，再退回兜底文案', () => {
    expect(fromExitCode(1, 'stdout text', '', 'ok', '兜底').message).toBe('stdout text')
    expect(fromExitCode(1, '', '', 'ok', '兜底').message).toBe('兜底')
  })
})
