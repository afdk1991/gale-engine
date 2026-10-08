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

  /**
   * 切换外观并持久化；**失败时回滚内存值再抛出**。
   *
   * 为什么必须回滚：旧实现先乐观改内存再 `await saveSettings`，且 await 无 try/catch——
   * 保存失败（IPC/store 异常）时既产生未捕获 rejection，又留下「界面已切换、
   * 重启后却回滚」的不一致，且界面零提示。现在保存失败就还原内存值并重新应用，
   * 保证「界面所见」与「已持久化」始终一致；是否提示交由调用方决定。
   */
  async function setAppearance(mode: AppearanceMode): Promise<void> {
    const prev = appearance.value
    appearance.value = mode
    applyResolved()
    try {
      await opts.saveSettings({ appearance: mode })
    } catch (error) {
      appearance.value = prev
      applyResolved()
      throw error
    }
  }

  async function setAccent(key: AccentKey): Promise<void> {
    const prev = accent.value
    accent.value = key
    applyResolved()
    try {
      await opts.saveSettings({ accent: key })
    } catch (error) {
      accent.value = prev
      applyResolved()
      throw error
    }
  }

  function dispose(): void {
    media.removeEventListener('change', onMediaChange)
  }

  return { appearance, accent, resolved, init, setAppearance, setAccent, dispose }
}
