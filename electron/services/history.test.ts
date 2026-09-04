import { describe, it, expect } from 'vitest'
import { createHistoryService, normalizeEntry } from './history'
import type { StorageAdapter } from './settings'

function memoryStorage(
  initial: Record<string, unknown> = {}
): StorageAdapter & { data: Record<string, unknown> } {
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

describe('normalizeEntry', () => {
  it('合法项保留字段', () => {
    expect(normalizeEntry({ id: 'a', type: 'cleanup', label: 'x', at: 1 })).toEqual({
      id: 'a',
      type: 'cleanup',
      label: 'x',
      at: 1
    })
  })
  it('损坏项（非对象 / 缺 id / 非法 type）返回 null', () => {
    expect(normalizeEntry(null)).toBeNull()
    expect(normalizeEntry({ id: 'a', type: 'bogus' })).toBeNull()
    expect(normalizeEntry({ type: 'cleanup' })).toBeNull()
  })
})

describe('createHistoryService', () => {
  it('add 写入并回传条目，list 按时间倒序', () => {
    let n = 0
    const svc = createHistoryService(memoryStorage(), () => `id-${++n}`)
    const a = svc.add({ type: 'cleanup', label: '清理 Temp' })
    const b = svc.add({ type: 'gameMode', label: '进入游戏模式' })
    expect(a.id).toBe('id-1')
    expect(b.id).toBe('id-2')
    expect(svc.list().map((e) => e.id)).toEqual(['id-2', 'id-1'])
  })

  it('持久化到 storage', () => {
    const storage = memoryStorage()
    const svc = createHistoryService(storage)
    svc.add({ type: 'toolbox', label: '刷新 DNS' })
    expect(Array.isArray(storage.data.history)).toBe(true)
    expect((storage.data.history as unknown[]).length).toBe(1)
  })

  it('list 过滤存储中的损坏项', () => {
    const storage = memoryStorage({
      history: [
        { id: 'ok', type: 'cleanup', label: 'x', at: 2 },
        { id: 'bad', type: '???' }
      ]
    })
    const svc = createHistoryService(storage)
    expect(svc.list().map((e) => e.id)).toEqual(['ok'])
  })

  it('clear 清空记录', () => {
    const storage = memoryStorage()
    const svc = createHistoryService(storage)
    svc.add({ type: 'optimize', label: '优化' })
    svc.clear()
    expect(svc.list()).toEqual([])
  })

  it('超过上限时裁剪最旧条目', () => {
    const svc = createHistoryService(memoryStorage(), () => `k${Math.random()}`)
    for (let i = 0; i < 205; i++) svc.add({ type: 'cleanup', label: `n${i}` })
    expect(svc.list().length).toBe(200)
  })
})
