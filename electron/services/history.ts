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

/**
 * 入参合法性校验。
 *
 * 修复前 add() 直接把 input.type / input.label 落成 HistoryEntry 并返回成功，
 * 但 read() 里的 normalizeEntry 又会把这条非法记录过滤掉 —— 结果是「写入成功、返回成功、
 * 下次列表里凭空消失」，属于静默的脏数据写入。这里改为写入前显式拒绝。
 */
export function isValidHistoryInput(input: unknown): input is HistoryInput {
  if (typeof input !== 'object' || input === null) return false
  const o = input as Record<string, unknown>
  if (!TYPES.includes(o.type as HistoryType)) return false
  if (typeof o.label !== 'string' || o.label.trim() === '') return false
  return true
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
    if (!isValidHistoryInput(input)) {
      throw new Error(
        `历史记录参数不合法：type 需为 ${TYPES.join('/')} 之一，label 需为非空字符串`
      )
    }
    const entry: HistoryEntry = {
      id: makeId(),
      type: input.type,
      label: input.label,
      detail: typeof input.detail === 'string' ? input.detail : undefined,
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
