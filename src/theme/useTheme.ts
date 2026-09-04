import { ref } from 'vue'
import type { AccentKey, AppearanceMode, ThemeSettings } from '../../shared/types'
import { applyAccentToDocument, resolveTheme } from './tokens'

/** 可注入的 matchMedia 形状（便于测试） */
interface SystemMediaLike {
  matches: boolean
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

export interface ThemeController {
  appearance: { value: AppearanceMode }
  accent: { value: AccentKey }
  resolved: { value: 'light' | 'dark' }
  init(): Promise<void>
  setAppearance(mode: AppearanceMode): Promise<void>
  setAccent(key: AccentKey): Promise<void>
  dispose(): void
}

export function createThemeController(opts: {
  loadSettings: () => Promise<ThemeSettings>
  saveSettings: (patch: Partial<ThemeSettings>) => Promise<ThemeSettings>
  media?: SystemMediaLike
  doc?: Document
}): ThemeController {
  const doc = opts.doc ?? document
  const media: SystemMediaLike =
    opts.media ?? window.matchMedia('(prefers-color-scheme: dark)')

  const appearance = ref<AppearanceMode>('system')
  const accent = ref<AccentKey>('blue')
  const resolved = ref<'light' | 'dark'>('light')
  let onMediaChange = (): void => {}

  function applyResolved(): void {
    resolved.value = resolveTheme(appearance.value, media.matches)
    doc.documentElement.dataset.theme = resolved.value
    applyAccentToDocument(accent.value, doc)
  }

  async function init(): Promise<void> {
    const settings = await opts.loadSettings().catch(() => ({
      appearance: 'system' as AppearanceMode,
      accent: 'blue' as AccentKey
    }))
    appearance.value = settings.appearance
    accent.value = settings.accent
    applyResolved()
    onMediaChange = () => {
      if (appearance.value === 'system') applyResolved()
    }
    media.addEventListener('change', onMediaChange)
  }

  async function setAppearance(mode: AppearanceMode): Promise<void> {
    appearance.value = mode
    applyResolved()
    await opts.saveSettings({ appearance: mode })
  }

  async function setAccent(key: AccentKey): Promise<void> {
    accent.value = key
    applyResolved()
    await opts.saveSettings({ accent: key })
  }

  function dispose(): void {
    media.removeEventListener('change', onMediaChange)
  }

  return { appearance, accent, resolved, init, setAppearance, setAccent, dispose }
}
