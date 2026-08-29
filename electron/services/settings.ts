import type { AccentKey, AppearanceMode, ThemeSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: ThemeSettings = { appearance: 'system', accent: 'blue' }

const APPEARANCES: AppearanceMode[] = ['system', 'light', 'dark']
const ACCENTS: AccentKey[] = ['blue', 'cyan', 'violet', 'green', 'orange', 'gradient']

/** 存储适配器：生产环境用 electron-store，测试注入内存实现 */
export interface StorageAdapter {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}

/** 任意输入（含损坏数据）归一化为合法 ThemeSettings */
export function normalizeSettings(raw: unknown): ThemeSettings {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const appearance = APPEARANCES.includes(obj.appearance as AppearanceMode)
    ? (obj.appearance as AppearanceMode)
    : DEFAULT_SETTINGS.appearance
  const accent = ACCENTS.includes(obj.accent as AccentKey)
    ? (obj.accent as AccentKey)
    : DEFAULT_SETTINGS.accent
  return { appearance, accent }
}

export function createSettingsService(storage: StorageAdapter) {
  const get = (): ThemeSettings => normalizeSettings(storage.get('theme', DEFAULT_SETTINGS))

  const set = (patch: Partial<ThemeSettings>): ThemeSettings => {
    const next = normalizeSettings({ ...get(), ...patch })
    storage.set('theme', next)
    return next
  }

  return { get, set }
}
