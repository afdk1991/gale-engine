import { describe, it, expect } from 'vitest'
import { escapeDesktopExecArg, escapeDesktopValue } from './desktopEntry'

describe('escapeDesktopExecArg（M9：.desktop Exec= 转义）', () => {
  it('普通路径用双引号包裹', () => {
    expect(escapeDesktopExecArg('/usr/bin/gale')).toBe('"/usr/bin/gale"')
  })

  it('含空格的路径保留在引号内', () => {
    expect(escapeDesktopExecArg('/opt/My App/gale')).toBe('"/opt/My App/gale"')
  })

  it('双引号被反斜杠转义（防止逃逸引号上下文）', () => {
    expect(escapeDesktopExecArg('a"b')).toBe('"a\\"b"')
  })

  it('$ 被转义（防止被 desktop 解析器按 shell 变量求值）', () => {
    expect(escapeDesktopExecArg('/opt/My $App/gale')).toBe('"/opt/My \\$App/gale"')
  })

  it('反引号被转义（防止命令替换注入）', () => {
    // 输入 a`b
    expect(escapeDesktopExecArg('a`b')).toBe('"a\\`b"')
  })

  it('反斜杠被转义', () => {
    // 输入 a\b
    expect(escapeDesktopExecArg('a\\b')).toBe('"a\\\\b"')
  })

  it('分号保留在引号内，不构成命令分隔', () => {
    // 分号在双引号内是字面量；关键是整体仍被一对引号包裹，没有被拆出
    const out = escapeDesktopExecArg('/path;rm -rf /')
    expect(out).toMatch(/^".*"$/)
    expect(out).toContain(';')
  })

  it('回车/换行被剔除（防止破坏 .desktop 文件结构）', () => {
    expect(escapeDesktopExecArg('a\nb')).toBe('"ab"')
    expect(escapeDesktopExecArg('a\r\nb')).toBe('"ab"')
  })

  it('null/undefined 兜底为空引号', () => {
    expect(escapeDesktopExecArg(undefined as unknown as string)).toBe('""')
    expect(escapeDesktopExecArg(null as unknown as string)).toBe('""')
  })

  it('注入向量综合：引号/$/反引号/反斜杠同时出现时全部转义', () => {
    const out = escapeDesktopExecArg('p"$`\\q')
    // p " $ ` \ q  → 每个特殊字符都被 \ 转义，且首尾各一对引号
    expect(out).toBe('"p\\"\\$\\`\\\\q"')
  })
})

describe('escapeDesktopValue（普通字符串字段）', () => {
  it('单行保留、去首尾空白', () => {
    expect(escapeDesktopValue('  Gale Engine  ')).toBe('Gale Engine')
  })

  it('换行替换为空格', () => {
    expect(escapeDesktopValue('a\nb')).toBe('a b')
  })

  it('null/undefined 兜底空串', () => {
    expect(escapeDesktopValue(undefined as unknown as string)).toBe('')
  })
})
