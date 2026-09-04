import type { GameModeStatus } from '../../shared/types'
import type { ExecRunner } from './shell'
import type { StorageAdapter } from './settings'

/** 高性能电源计划（Windows 固定 GUID） */
export const HIGH_PERFORMANCE_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

const KEY_BOOSTED = 'gamemode.boosted'
const KEY_PREVIOUS = 'gamemode.previous'

const GUID_RE =
  /\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?/

function parseScheme(output: string): { guid: string; name: string } {
  const m = output.match(GUID_RE)
  const guid = m ? m[1].toLowerCase() : ''
  const nameMatch = output.match(/\(([^)]+)\)/)
  const name = nameMatch ? nameMatch[1].trim() : ''
  return { guid, name }
}

/**
 * 游戏模式服务。
 * - boost：切换到高性能电源计划，并记录 boost 前的计划用于还原
 * - restore：切回上一计划
 * - status：读取当前激活计划 + 是否处于游戏模式
 * 依赖 ExecRunner（执行 powercfg）与可选 StorageAdapter（跨重启记住上一计划）。
 */
export function createGameModeService(runner: ExecRunner, storage?: StorageAdapter) {
  const mem: Record<string, unknown> = {}
  const read = <T>(key: string, fallback: T): T =>
    storage ? storage.get<T>(key, fallback) : ((mem[key] as T) ?? fallback)
  const write = (key: string, value: unknown): void => {
    if (storage) storage.set(key, value)
    else mem[key] = value
  }

  const status = async (): Promise<GameModeStatus> => {
    const { stdout } = await runner.run('powercfg /getactivescheme')
    const { guid, name } = parseScheme(stdout)
    return {
      active: guid,
      activeName: name,
      boosted: read<boolean>(KEY_BOOSTED, false),
      previous: read<string | null>(KEY_PREVIOUS, null)
    }
  }

  const boost = async (): Promise<GameModeStatus> => {
    const cur = await status()
    if (!cur.boosted && cur.active) {
      write(KEY_PREVIOUS, cur.active)
    }
    await runner.run(`powercfg /setactive ${HIGH_PERFORMANCE_GUID}`)
    write(KEY_BOOSTED, true)
    return status()
  }

  const restore = async (): Promise<GameModeStatus> => {
    const prev = read<string | null>(KEY_PREVIOUS, null)
    if (prev) {
      await runner.run(`powercfg /setactive ${prev}`)
    }
    write(KEY_BOOSTED, false)
    write(KEY_PREVIOUS, null)
    return status()
  }

  return { status, boost, restore }
}
