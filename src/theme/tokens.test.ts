import { describe, it, expect } from 'vitest'
import { ACCENTS, ACCENT_ORDER, resolveTheme, isAccentKey, applyAccentToDocument } from './tokens'

describe('resolveTheme', () => {
  it('system 模式跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('显式模式直接返回', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('ACCENTS', () => {
  it('包含 6 个完整主题色', () => {
    expect(ACCENT_ORDER).toHaveLength(6)
    for (const key of ACCENT_ORDER) {
      expect(ACCENTS[key].label).toBeTruthy()
      expect(ACCENTS[key].color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(ACCENTS[key].bg).toBeTruthy()
    }
  })
})

describe('isAccentKey', () => {
  it('识别合法与非法主题色键', () => {
    expect(isAccentKey('blue')).toBe(true)
    expect(isAccentKey('gradient')).toBe(true)
    expect(isAccentKey('neon')).toBe(false)
    expect(isAccentKey('toString')).toBe(false)
    expect(isAccentKey('constructor')).toBe(false)
    expect(isAccentKey(42)).toBe(false)
  })
})

describe('applyAccentToDocument', () => {
  it('将主题色写入文档根 CSS 变量', () => {
    applyAccentToDocument('green')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--accent')).toBe('#10b981')
    expect(root.style.getPropertyValue('--accent-soft')).toBe('rgba(16,185,129,0.12)')
  })

  it('渐变主题同时写入渐变背景变量', () => {
    applyAccentToDocument('gradient')
    expect(document.documentElement.style.getPropertyValue('--accent-bg')).toBe(
      'linear-gradient(135deg, #2563eb, #7c3aed)'
    )
  })
})
