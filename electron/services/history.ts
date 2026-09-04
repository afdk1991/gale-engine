import type { HistoryEntry, HistoryType } from '../../shared/types'
import type { StorageAdapter } from './settings'

const HISTORY_KEY = 'history'
const MAX_ENTRIES = 200

const TYPES: HistoryType[] = ['cleanup', 'startup', 'gameMode', 'toolbox', 'optimize']

/** 将未知输入规整为合法 HistoryEntry，损坏项返回 null（过滤掉） */
export function normalizeEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string') return null
  if (!TYPES.includes(o.type as HistoryType)) return null
  return {
    id: o.id,
    type: o.type as HistoryType,
    label: typeof o.label === 'string' ? o.label : '',
    detail: typeof o.detail === 'string' ? o.detail : undefined,
    at: typeof o.at === 'number' ? o.at : 0
  }
}

export interface HistoryInput {
  type: HistoryType
  label: string
  detail?: string
}

export function createHistoryService(
  storage: StorageAdapter,
  makeId: () => string = defaultId
) {
  const read = (): HistoryEntry[] => {
    const raw = storage.get<unknown[]>(HISTORY_KEY, [])
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeEntry).filter((e): e is HistoryEntry => e !== null)
  }

  const write = (list: HistoryEntry[]): void => {
    storage.set(HISTORY_KEY, list)
  }

  const list = (): HistoryEntry[] => read().sort((a, b) => b.at - a.at)

  const add = (input: HistoryInput): HistoryEntry => {
    const entry: HistoryEntry = {
      id: makeId(),
      type: input.type,
      label: input.label,
      detail: input.detail,
      at: Date.now()
    }
    const next = [entry, ...read()].slice(0, MAX_ENTRIES)
    write(next)
    return entry
  }

  const clear = (): void => {
    write([])
  }

  return { list, add, clear }
}

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
