import { describe, it, expect } from 'vitest'
import { createSettingsService, normalizeSettings, DEFAULT_SETTINGS } from './settings'
import type { StorageAdapter } from './settings'

function memoryStorage(initial: Record<string, unknown> = {}): StorageAdapter & { data: Record<string, unknown> } {
  const data = { ...initial }
  return {
    data,
    get<T>(key: string, fallback: T): T {
      return (key in data ? data[key] : fallback) as T
    },
    set(key: string, value: unknown): void {
      data[key] = value
    }
  }
}

describe('normalizeSettings', () => {
  it('非法字段回退默认值，合法字段保留', () => {
    expect(normalizeSettings({ appearance: 'dark', accent: 'nope' })).toEqual({
      appearance: 'dark',
      accent: 'blue'
    })
  })

  it('非对象输入整体回退默认值', () => {
    expect(normalizeSettings('junk')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })
})

describe('createSettingsService', () => {
  it('读取已持久化的设置', () => {
    const storage = memoryStorage({ theme: { appearance: 'dark', accent: 'green' } })
    const service = createSettingsService(storage)
    expect(service.get()).toEqual({ appearance: 'dark', accent: 'green' })
  })

  it('空存储返回默认设置', () => {
    expect(createSettingsService(memoryStorage()).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('set 合并补丁、归一化并写回存储', () => {
    const storage = memoryStorage()
    const service = createSettingsService(storage)
    const result = service.set({ accent: 'orange' })
    expect(result).toEqual({ appearance: 'system', accent: 'orange' })
    expect(storage.data.theme).toEqual({ appearance: 'system', accent: 'orange' })
    expect(service.get().accent).toBe('orange')
  })

  it('set 中的非法值被归一化丢弃', () => {
    const storage = memoryStorage()
    const service = createSettingsService(storage)
    const result = service.set({ appearance: 'neon' } as never)
    expect(result.appearance).toBe('system')
  })
})
