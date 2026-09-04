import type { AccentKey, AppearanceMode } from '../../shared/types'

export interface AccentToken {
  key: AccentKey
  label: string
  /** 主色（渐变主题取起点色，用于文字、描边等纯色场景） */
  color: string
  /** 强调元素背景（纯色或渐变，用于按钮、品牌标等） */
  bg: string
  hover: string
  /** 柔和底色（选中态、悬浮态背景） */
  soft: string
}

export const ACCENTS: Record<AccentKey, AccentToken> = {
  blue: { key: 'blue', label: '科技蓝', color: '#3b82f6', bg: '#3b82f6', hover: '#2563eb', soft: 'rgba(59,130,246,0.12)' },
  cyan: { key: 'cyan', label: '极客青', color: '#06b6d4', bg: '#06b6d4', hover: '#0891b2', soft: 'rgba(6,182,212,0.12)' },
  violet: { key: 'violet', label: '活力紫', color: '#8b5cf6', bg: '#8b5cf6', hover: '#7c3aed', soft: 'rgba(139,92,246,0.12)' },
  green: { key: 'green', label: '健康绿', color: '#10b981', bg: '#10b981', hover: '#059669', soft: 'rgba(16,185,129,0.12)' },
  orange: { key: 'orange', label: '能量橙', color: '#f97316', bg: '#f97316', hover: '#ea580c', soft: 'rgba(249,115,22,0.12)' },
  gradient: { key: 'gradient', label: '渐变蓝紫', color: '#2563eb', bg: 'linear-gradient(135deg, #2563eb, #7c3aed)', hover: '#4f46e5', soft: 'rgba(99,102,241,0.12)' }
}

export const ACCENT_ORDER: AccentKey[] = ['blue', 'cyan', 'violet', 'green', 'orange', 'gradient']

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === 'string' && Object.hasOwn(ACCENTS, value)
}

/** system 模式依据系统偏好解析为 light / dark */
export function resolveTheme(mode: AppearanceMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

/** 将主题色 CSS 变量注入文档根（内联样式优先级高于 theme.css 的默认值） */
export function applyAccentToDocument(accent: AccentKey, doc: Document = document): void {
  const token = ACCENTS[accent]
  const root = doc.documentElement
  root.style.setProperty('--accent', token.color)
  root.style.setProperty('--accent-bg', token.bg)
  root.style.setProperty('--accent-hover', token.hover)
  root.style.setProperty('--accent-soft', token.soft)
}
