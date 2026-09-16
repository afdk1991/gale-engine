import type { AccentKey, AppearanceMode, AppUpdatePrefs, ThemeSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: ThemeSettings = { appearance: 'system', accent: 'blue' }

/** 自动更新默认全开：用户点一次「检查更新」后，下载与安装都不再需要额外点击 */
export const DEFAULT_APP_PREFS: AppUpdatePrefs = {
  autoCheck: true,
  autoDownload: true,
  autoInstallOnQuit: true
}

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

/** 任意输入（含损坏数据）归一化为合法 AppUpdatePrefs（只接受布尔值，其余回落默认） */
export function normalizeAppPrefs(raw: unknown): AppUpdatePrefs {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pick = (key: keyof AppUpdatePrefs): boolean =>
    typeof obj[key] === 'boolean' ? (obj[key] as boolean) : DEFAULT_APP_PREFS[key]
  return { autoCheck: pick('autoCheck'), autoDownload: pick('autoDownload'), autoInstallOnQuit: pick('autoInstallOnQuit') }
}

/**
 * 自动更新偏好服务。
 * 与主题设置分开存储（键 'appPrefs'），避免主题损坏时连带更新配置一起丢失。
 */
export function createAppPrefsService(storage: StorageAdapter) {
  const get = (): AppUpdatePrefs => normalizeAppPrefs(storage.get('appPrefs', DEFAULT_APP_PREFS))

  const set = (patch: Partial<AppUpdatePrefs>): AppUpdatePrefs => {
    const next = normalizeAppPrefs({ ...get(), ...patch })
    storage.set('appPrefs', next)
    return next
  }

  return { get, set }
}
