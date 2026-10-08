import type { HistoryType } from '../../shared/types'

/** 写「优化记录」的入参（与 window.gale.history.add 的契约一致） */
export interface HistoryWriteInput {
  type: HistoryType
  label: string
  detail?: string
}

/**
 * 写「优化记录」，**失败不影响主流程**。
 *
 * 为什么必须单独抽出来：historyService.add 在入参不合法（type 不在白名单 / label 为空）
 * 或 store 写盘失败时会**抛错**（见 electron/services/history.ts 的 add）。
 * 若把它和真正的操作、以及随后的列表刷新放进同一个 try，一旦抛出就会：
 *   1. 用「历史记录参数不合法…」覆盖掉刚拿到的真实操作回执 —— 把成功报成失败；
 *   2. 跳过后面的 `await refresh()`，列表停在旧状态，UI 与系统实际状态不一致。
 *
 * 与 GameMode.vue 的 record() / useOneKey.ts 的 writeHistory() 同范式：
 * 留痕只是附加行为，它的成败不应反向影响主操作的结果呈现。
 */
export async function writeHistory(input: HistoryWriteInput): Promise<void> {
  try {
    await window.gale.history.add(input)
  } catch {
    /* 历史写入失败不影响本次操作结果 */
  }
}
