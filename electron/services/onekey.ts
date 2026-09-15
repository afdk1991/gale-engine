import type {
  OneKeyPhase,
  OneKeyProgress,
  OneKeySummary,
  OptOutcome,
  OptStatus
} from '../../shared/types'
import type { OptLibrary } from './optlib'

// ─────────────────────────────────────────────────────────────
// 一键优化编排器
//
// 职责：按序执行一组优化能力，实时向界面推送进度，支持中途取消与失败自动重试。
//
// 关键设计：
//  1. **顺序执行**：清理类操作会争抢同一批目录（例如 temp 与系统缓存有交集），
//     并行跑会导致彼此把对方的文件句柄锁死，删除失败率飙升。串行最稳。
//  2. **共享上下文**：整轮复用同一个 OptContext，扫描结果（scanCleanup /
//     scanDeepCleanup）走缓存，一轮里只扫一次，否则光扫描就要几十秒。
//  3. **协作式取消**：底层 ExecRunner 没有 abort 通道（PowerShell 子进程无法
//     从 Node 侧安全中断），所以取消不是"强杀"，而是让当前这一项跑完就停。
//     界面对此是诚实的：点取消后阶段显示"正在停止"。
//  4. **权限预检**：需要管理员的项（WinSxS / 更新缓存 / SFC）在**整轮开始前**
//     统一检测一次。若未提权则直接标记 skipped，而不是逐项弹 UAC——否则用户
//     会被连续弹窗轰炸。
// ─────────────────────────────────────────────────────────────

/** 未提权时，管理员项的统一跳过原因 */
export const NEED_ADMIN_REASON =
  '需要管理员权限，请以管理员身份重启本程序后重试（设置 → 关于 → 以管理员身份重启）'

export interface OneKeyDeps {
  library: OptLibrary
  /** 提权状态探测；不传则视为未提权 */
  isElevated?: () => Promise<boolean>
  /** 单项失败后的自动重试次数（默认 1） */
  maxRetries?: number
  /** 重试前的等待毫秒（默认 400ms，给句柄释放留时间） */
  retryDelayMs?: number
  /** 时间戳注入（测试用） */
  now?: () => number
  /** 等待注入（测试用） */
  sleep?: (ms: number) => Promise<void>
}

interface RunState {
  runId: string
  phase: OneKeyPhase
  total: number
  completed: number
  currentId: string | null
  currentLabel: string | null
  outcomes: OptOutcome[]
  startedAt: number
  finishedAt: number | null
  releasedBytes: number
  elevated: boolean
  /** 收到取消请求（当前项跑完即停） */
  cancelRequested: boolean
}

export interface OneKeyService {
  /** 开始一轮优化；ids 省略时执行全部默认启用项 */
  start(ids?: string[]): Promise<OneKeySummary>
  /** 请求取消（当前项结束后停止） */
  cancel(): Promise<void>
  /** 重试上一轮中失败的项 */
  retryFailed(): Promise<OneKeySummary>
  /** 订阅进度，返回退订函数 */
  onProgress(cb: (p: OneKeyProgress) => void): () => void
  /** 当前进度快照；从未运行过为 null */
  getState(): OneKeyProgress | null
  isRunning(): boolean
}

function newRunId(now: number): string {
  return `ok-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function countBy(outcomes: OptOutcome[], status: OptStatus): number {
  return outcomes.filter((o) => o.status === status).length
}

export function toSummary(s: RunState): OneKeySummary {
  return {
    runId: s.runId,
    total: s.total,
    success: countBy(s.outcomes, 'success'),
    failed: countBy(s.outcomes, 'failed'),
    skipped: countBy(s.outcomes, 'skipped'),
    releasedBytes: s.releasedBytes,
    durationMs: (s.finishedAt ?? s.startedAt) - s.startedAt,
    cancelled: s.phase === 'cancelled',
    outcomes: [...s.outcomes]
  }
}

export function createOneKeyService(deps: OneKeyDeps): OneKeyService {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxRetries = Math.max(0, deps.maxRetries ?? 1)
  const retryDelayMs = Math.max(0, deps.retryDelayMs ?? 400)

  const listeners = new Set<(p: OneKeyProgress) => void>()
  let state: RunState | null = null

  const snapshot = (): OneKeyProgress | null =>
    state === null
      ? null
      : {
          runId: state.runId,
          phase: state.phase,
          total: state.total,
          completed: state.completed,
          currentId: state.currentId,
          currentLabel: state.currentLabel,
          outcomes: [...state.outcomes],
          startedAt: state.startedAt,
          finishedAt: state.finishedAt,
          releasedBytes: state.releasedBytes,
          elevated: state.elevated
        }

  const emit = (): void => {
    const snap = snapshot()
    if (!snap) return
    for (const cb of [...listeners]) {
      try {
        cb(snap)
      } catch {
        // 订阅方回调异常不能中断编排主流程
      }
    }
  }

  /** 带自动重试地执行单项；返回合并耗时后的最终 outcome */
  const runWithRetry = async (
    ctx: Parameters<OptLibrary['runInContext']>[0],
    id: string
  ): Promise<{ outcome: OptOutcome; durationMs: number }> => {
    const attempts = maxRetries + 1
    let last: OptOutcome | null = null
    let durationMs = 0
    let tried = 0

    for (let i = 0; i < attempts; i++) {
      last = await deps.library.runInContext(ctx, id)
      durationMs += last.durationMs
      tried = i + 1
      if (last.status !== 'failed') break
      // 已请求取消 → 不再重试，直接收尾
      if (state?.cancelRequested) break
      if (i < attempts - 1) await sleep(retryDelayMs)
    }

    const outcome: OptOutcome = { ...(last as OptOutcome), durationMs, attempts: tried }
    return { outcome, durationMs }
  }

  const start = async (ids?: string[]): Promise<OneKeySummary> => {
    if (state && (state.phase === 'running' || state.phase === 'cancelling')) {
      return {
        runId: state.runId,
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        releasedBytes: 0,
        durationMs: 0,
        cancelled: false,
        outcomes: [],
        error: '已有一键优化任务正在执行，请等待完成或先取消'
      }
    }

    const caps = deps.library.listCapabilities()
    const metaMap = new Map(caps.map((c) => [c.id, c]))
    const requested =
      Array.isArray(ids) && ids.length > 0
        ? ids.map(String)
        : caps.filter((c) => c.defaultEnabled).map((c) => c.id)

    // 去重 + 过滤未知 id（渲染进程传什么都得先过这道闸）
    const plan = [...new Set(requested)].filter((id) => metaMap.has(id))
    if (plan.length === 0) {
      return {
        runId: '',
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        releasedBytes: 0,
        durationMs: 0,
        cancelled: false,
        outcomes: [],
        error: '没有可执行的优化项'
      }
    }

    const elevated = deps.isElevated ? await deps.isElevated() : false
    const ctx = deps.library.createContext()

    const run: RunState = {
      runId: newRunId(now()),
      phase: 'running',
      total: plan.length,
      completed: 0,
      currentId: null,
      currentLabel: null,
      outcomes: [],
      startedAt: now(),
      finishedAt: null,
      releasedBytes: 0,
      elevated,
      cancelRequested: false
    }
    state = run
    emit()

    for (const id of plan) {
      if (run.cancelRequested) break
      const meta = metaMap.get(id)
      if (!meta) continue

      run.currentId = id
      run.currentLabel = meta.label
      emit()

      let outcome: OptOutcome
      if (meta.needsAdmin && !elevated) {
        // 统一预检：不逐项弹 UAC，直接跳过并给出可执行指引
        outcome = {
          id,
          label: meta.label,
          status: 'skipped',
          durationMs: 0,
          reason: NEED_ADMIN_REASON,
          needsAdmin: true,
          attempts: 0
        }
      } else {
        const r = await runWithRetry(ctx, id)
        outcome = r.outcome
      }

      run.outcomes.push(outcome)
      run.completed += 1
      run.releasedBytes += outcome.releasedBytes ?? 0
      run.currentId = null
      run.currentLabel = null
      emit()
    }

    run.finishedAt = now()
    run.phase = run.cancelRequested ? 'cancelled' : 'done'
    emit()
    return toSummary(run)
  }

  const cancel = async (): Promise<void> => {
    if (!state || (state.phase !== 'running' && state.phase !== 'cancelling')) return
    state.cancelRequested = true
    state.phase = 'cancelling'
    emit()
  }

  const retryFailed = async (): Promise<OneKeySummary> => {
    const failedIds = (state?.outcomes ?? []).filter((o) => o.status === 'failed').map((o) => o.id)
    if (failedIds.length === 0) {
      return {
        runId: state?.runId ?? '',
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        releasedBytes: 0,
        durationMs: 0,
        cancelled: false,
        outcomes: [],
        error: '没有需要重试的失败项'
      }
    }
    // 让上一轮结束态退出 running，避免被并发守卫拦下
    if (state) state.phase = 'done'
    return start(failedIds)
  }

  return {
    start,
    cancel,
    retryFailed,
    onProgress: (cb) => {
      listeners.add(cb)
      const snap = snapshot()
      if (snap) cb(snap) // 订阅即补发当前状态，避免界面刷新后空白
      return () => listeners.delete(cb)
    },
    getState: snapshot,
    isRunning: () => state !== null && (state.phase === 'running' || state.phase === 'cancelling')
  }
}
