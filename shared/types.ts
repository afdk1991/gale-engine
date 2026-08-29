export type AppearanceMode = 'system' | 'light' | 'dark'

export type AccentKey = 'blue' | 'cyan' | 'violet' | 'green' | 'orange' | 'gradient'

export interface ThemeSettings {
  appearance: AppearanceMode
  accent: AccentKey
}

export interface GaleApi {
  settings: {
    get(): Promise<ThemeSettings>
    set(patch: Partial<ThemeSettings>): Promise<ThemeSettings>
  }
}
