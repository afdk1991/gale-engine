import { describe, it, expect, vi } from 'vitest'
import { createThemeController } from './useTheme'
import type { ThemeSettings } from '../../shared/types'

const defaults: ThemeSettings = { appearance: 'system', accent: 'blue' }

function fakeMedia(matches: boolean) {
  const listeners: Array<() => void> = []
  return {
    matches,
    addEventListener(_type: string, cb: () => void) { listeners.push(cb) },
    removeEventListener(_type: string, cb: () => void) {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    },
    trigger() { listeners.forEach((cb) => cb()) }
  }
}

function fakeDoc(): Document {
  const style = new Map<string, string>()
  const dataset: Record<string, string> = {}
  return {
    documentElement: {
      dataset,
      style: {
        setProperty: (k: string, v: string) => void style.set(k, v),
        getPropertyValue: (k: string) => style.get(k) ?? ''
      }
    }
  } as unknown as Document
}

describe('createThemeController', () => {
  it('init 应用持久化的外观与主题色', async () => {
    const media = fakeMedia(true)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => ({ appearance: 'dark', accent: 'green' }),
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('dark')
    expect(doc.documentElement.style.getPropertyValue('--accent')).toBe('#10b981')
  })

  it('loadSettings 失败时回退默认主题', async () => {
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => { throw new Error('ipc down') },
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media: fakeMedia(false),
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(controller.accent.value).toBe('blue')
  })

  it('setAccent 更新 DOM 并持久化补丁', async () => {
    const save = vi.fn(async (p: Partial<ThemeSettings>) => ({ ...defaults, ...p }))
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: save,
      media: fakeMedia(false),
      doc
    })
    await controller.init()
    await controller.setAccent('orange')
    expect(save).toHaveBeenCalledWith({ accent: 'orange' })
    expect(doc.documentElement.style.getPropertyValue('--accent')).toBe('#f97316')
  })

  it('setAppearance 持久化且立即生效', async () => {
    const save = vi.fn(async (p: Partial<ThemeSettings>) => ({ ...defaults, ...p }))
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: save,
      media: fakeMedia(true),
      doc
    })
    await controller.init()
    await controller.setAppearance('light')
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(save).toHaveBeenCalledWith({ appearance: 'light' })
  })

  it('system 模式响应系统主题变化', async () => {
    const media = fakeMedia(false)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('light')
    media.matches = true
    media.trigger()
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })

  it('dispose 移除系统主题监听', async () => {
    const media = fakeMedia(false)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    controller.dispose()
    media.matches = true
    media.trigger()
    expect(doc.documentElement.dataset.theme).toBe('light')
  })

  it('显式模式忽略系统主题变化', async () => {
    const media = fakeMedia(true)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    await controller.setAppearance('light')
    media.matches = false
    media.trigger()
    expect(doc.documentElement.dataset.theme).toBe('light')
  })
})
