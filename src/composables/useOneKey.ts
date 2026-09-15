import { computed, ref } from 'vue'
import type {
  OneKeyProgress,
  OneKeySummary,
  OptCapabilityMeta,
  OptOutcome
} from '../../shared/types'

// ─────────────────────────────────────────────────────────────
// 一键优化的共享状态（模块级单例）
//
// 之所以抽成 composable 而不是塞进组件：首页 Hero 上的「一键优化」按钮
// 和下方的执行面板必须操作同一份状态，否则点 Hero 按钮时面板收不到进度。
// ─────────────────────────────────────────────────────────────

const progress = ref<OneKeyProgress | null>(null)
const summary = ref<OneKeySummary | null>(null)
const capabilities = ref<OptCapabilityMeta[]>([])
const selected = ref<Set<string>>(new Set())
const elevated = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

let unsub: (() => void) | null = null
let loaded = false

const running = computed(() => {
  const p = progress.value
  return p !== null && (p.phase === 'running' || p.phase === 'cancelling')
})

const finished = computed(() => {
  const p = progress.value
  return p !== null && (p.phase === 'done' || p.phase === 'cancelled')
})

/** 结果明细：优先用推送中的实时进度，结束后用汇总里附带的明细 */
const outcomes = computed<OptOutcome[]>(() => {
  if (progress.value && progress.value.outcomes.length > 0) return progress.value.outcomes
  return summary.value?.outcomes ?? []
})

/** 本轮中失败的项（供「重试失败项」按钮判断可用性） */
const failedIds = computed(() => outcomes.value.filter((o) => o.status === 'failed').map((o) => o.id))

const percent = computed(() => {
  const p = progress.value
  if (!p || p.total === 0) return 0
  return Math.round((p.completed / p.total) * 100)
})

/** 订阅主进程推送。重复调用安全，只订阅一次。 */
function subscribe(): void {
  if (unsub) return
  unsub = window.gale.onekey.onProgress((p) => {
    progress.value = p
    if (p.phase === 'done' || p.phase === 'cancelled') busy.value = false
  })
}

async function loadCapabilities(): Promise<void> {
  subscribe()
  if (loaded) return
  try {
    capabilities.value = await window.gale.optlib.listCapabilities()
    // 默认勾选 defaultEnabled 的项
    selected.value = new Set(capabilities.value.filter((c) => c.defaultEnabled).map((c) => c.id))
    loaded = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function refreshElevated(): Promise<void> {
  try {
    elevated.value = await window.gale.app.isElevated()
  } catch {
    elevated.value = false
  }
}

/** 恢复上一轮状态（切页面回来时不至于空白） */
async function restore(): Promise<void> {
  subscribe()
  try {
    const s = await window.gale.onekey.state()
    if (s && s.outcomes.length > 0) {
      progress.value = s
      summary.value = null
    }
  } catch {
    /* 未运行过或 IPC 不可用，忽略 */
  }
}

async function start(): Promise<void> {
  subscribe()
  error.value = null
  summary.value = null
  busy.value = true
  try {
    // 未勾选任何项时回退到服务端默认集合
    const ids = selected.value.size > 0 ? [...selected.value] : undefined
    const s = await window.gale.onekey.start(ids)
    summary.value = s
    if (s.error) error.value = s.error
    busy.value = false
    await writeHistory(s)
  } catch (e) {
    busy.value = false
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function cancel(): Promise<void> {
  try {
    await window.gale.onekey.cancel()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function retryFailed(): Promise<void> {
  if (failedIds.value.length === 0) return
  error.value = null
  busy.value = true
  try {
    const s = await window.gale.onekey.retryFailed()
    summary.value = s
    if (s.error) error.value = s.error
    busy.value = false
  } catch (e) {
    busy.value = false
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function toggle(id: string): void {
  if (running.value) return
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAll(): void {
  if (running.value) return
  selected.value = new Set(capabilities.value.map((c) => c.id))
}

function clearAll(): void {
  if (running.value) return
  selected.value = new Set()
}

/** 把本轮结果写进「优化记录」，与既有 History 模块打通 */
async function writeHistory(s: OneKeySummary): Promise<void> {
  if (s.total === 0) return
  try {
    await window.gale.history.add({
      type: 'optimize',
      label: s.cancelled ? '一键优化（已取消）' : '一键优化',
      detail: `成功 ${s.success} / 失败 ${s.failed} / 跳过 ${s.skipped}，释放 ${formatSize(s.releasedBytes)}，耗时 ${formatDuration(s.durationMs)}`
    })
  } catch {
    /* 记录写入失败不影响主流程 */
  }
}

export function formatSize(bytes: number): string {
  const b = Number(bytes) || 0
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  const v = Number(ms) || 0
  if (v < 1000) return `${v} ms`
  const s = v / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  return `${m} 分 ${Math.round(s % 60)} 秒`
}

export function useOneKey() {
  return {
    progress,
    summary,
    capabilities,
    selected,
    elevated,
    error,
    busy,
    running,
    finished,
    outcomes,
    failedIds,
    percent,
    loadCapabilities,
    refreshElevated,
    restore,
    start,
    cancel,
    retryFailed,
    toggle,
    selectAll,
    clearAll,
    formatSize,
    formatDuration
  }
}
