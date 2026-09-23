import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AppUpdatePrefs, AppUpdateResult, UpdateCapability } from '../../shared/types'

// ─────────────────────────────────────────────────────────────
// 全局唯一的「应用更新」状态单例（与 themeController 同一模式）
//
// 为什么必须是单例而不是每个页面各自 useState：
//   自动更新是一个**跨页面共享的长生命周期流程**——后台静默检查可能在首页
//   发起，之后用户切到设置页看进度、再切回侧边栏点「立即安装」。若每个页面
//   各自持有状态，就会出现「首页说发现新版本、设置页说已是最新」这种自相矛盾。
//   主进程侧 UpdateService 已是唯一状态源，渲染进程这边也必须只有一份镜像。
// ─────────────────────────────────────────────────────────────

const state = ref<AppUpdateResult>({ status: 'idle' })
const capability = ref<UpdateCapability | null>(null)
/** 前台检查进行中（点击「检查更新」到返回结果之间） */
const checking = ref(false)
const prefs = ref<AppUpdatePrefs | null>(null)
/** 偏好写入失败原因（IPC 异常等）；成功写入后清空 */
const prefError = ref<string | null>(null)

let inited = false
let dispose: (() => void) | null = null

function app(): Window['gale']['app'] | undefined {
  return typeof window !== 'undefined' ? window.gale?.app : undefined
}

async function init(): Promise<void> {
  if (inited) return
  inited = true
  const a = app()
  if (!a) return
  try {
    capability.value = await a.getUpdateCapability()
  } catch {
    /* 能力探测失败时按「未知」处理，界面会走保守文案 */
  }
  try {
    state.value = await a.getUpdateState()
  } catch {
    /* 读快照失败保持 idle */
  }
  try {
    prefs.value = await a.getUpdatePrefs()
  } catch {
    /* 偏好读取失败：不阻塞界面 */
  }
  try {
    dispose = a.onUpdateEvent((s) => {
      state.value = s
      // 主进程推送了终态就说明前台这次检查有结果了
      if (s.status !== 'checking') checking.value = false
    })
  } catch {
    /* 事件订阅不可用时退化为纯被动查询 */
  }
}

/**
 * 主动检查更新（前台，失败会重试并展示原因）。
 *
 * 本函数**不向上抛异常**：界面通过 `@click="check"` 直接绑定，Vue 不会捕获
 * 事件处理器返回的 promise rejection，抛出去就变成未捕获拒绝（控制台报错、
 * 界面停在「检查中」）。IPC 层失败统一收敛成 `status: 'error'` 状态。
 */
async function check(): Promise<AppUpdateResult> {
  const a = app()
  if (!a) return state.value
  checking.value = true
  try {
    const res = await a.checkUpdate()
    state.value = res
    return res
  } catch (e) {
    const failed: AppUpdateResult = {
      status: 'error',
      error: e instanceof Error ? e.message : String(e)
    }
    state.value = failed
    return failed
  } finally {
    checking.value = false
  }
}

/** 退出并安装已下载的更新（同样不向上抛，失败回落到 error 状态） */
async function install(): Promise<void> {
  try {
    await app()?.installUpdate()
  } catch (e) {
    state.value = { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/** M6：手动下载已发现的更新（autoDownload=false 时 available 态的下载出口） */
async function downloadUpdate(): Promise<void> {
  try {
    const res = await app()?.downloadUpdate()
    if (res) state.value = res
  } catch (e) {
    state.value = { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 更新偏好（自动检查 / 自动下载 / 退出自动安装）。写入失败时保留原值并记录原因。 */
async function setPrefs(patch: Partial<AppUpdatePrefs>): Promise<void> {
  const a = app()
  if (!a) return
  prefError.value = null
  try {
    prefs.value = await a.setUpdatePrefs(patch)
  } catch (e) {
    // prefs 保持原值，界面据此回滚勾选状态——不制造「看着开了其实没开」的假象
    prefError.value = e instanceof Error ? e.message : String(e)
  }
}

export interface UseAppUpdate {
  state: Ref<AppUpdateResult>
  capability: Ref<UpdateCapability | null>
  prefs: Ref<AppUpdatePrefs | null>
  /** 偏好写入失败原因（null 表示无错误） */
  prefError: Ref<string | null>
  checking: Ref<boolean>
  /** 正在检查或下载 */
  busy: ComputedRef<boolean>
  /** 已发现可用更新（尚未下载完） */
  hasUpdate: ComputedRef<boolean>
  /** 下载完成可安装 */
  ready: ComputedRef<boolean>
  /** 当前平台是否支持应用内自更新 */
  supported: ComputedRef<boolean>
  /** 状态文案 */
  label: ComputedRef<string>
  /** 下载进度 0-100；非下载态为 null */
  percent: ComputedRef<number | null>
  /** 是否可以再次点「检查更新」 */
  canCheck: ComputedRef<boolean>
  check: () => Promise<AppUpdateResult>
  install: () => Promise<void>
  /** 手动下载已发现的更新（available 态） */
  downloadUpdate: () => Promise<void>
  setPrefs: (patch: Partial<AppUpdatePrefs>) => Promise<void>
  init: () => Promise<void>
}

export function useAppUpdate(): UseAppUpdate {
  void init()

  const busy = computed(() => checking.value || state.value.status === 'downloading')
  const hasUpdate = computed(
    () => state.value.status === 'available' || state.value.status === 'downloading'
  )
  const ready = computed(() => state.value.status === 'downloaded')
  const supported = computed(() => capability.value?.canAutoUpdate !== false)
  const percent = computed(() =>
    state.value.status === 'downloading' ? (state.value.percent ?? 0) : null
  )

  const label = computed<string>(() => {
    const s = state.value
    switch (s.status) {
      case 'idle':
        return supported.value ? '点击检查更新' : (capability.value?.reason ?? '当前平台不支持应用内更新')
      case 'checking':
        return '正在检查更新…'
      case 'up-to-date':
        return '当前已是最新版本'
      case 'available':
        return `发现新版本 v${s.version ?? '—'}，正在下载…`
      case 'downloading':
        return `正在下载 v${s.version ?? ''} ${percent.value ?? 0}%`
      case 'downloaded':
        return `v${s.version ?? '新版本'} 已下载，可立即安装`
      case 'unsupported':
        return s.reason ?? '当前平台不支持应用内自动更新'
      case 'error':
        return `检查更新失败：${s.error ?? '未知错误'}`
      default:
        return ''
    }
  })

  const canCheck = computed(() => !busy.value && !ready.value)

  return {
    state,
    capability,
    prefs,
    prefError,
    checking,
    busy,
    hasUpdate,
    ready,
    supported,
    label,
    percent,
    canCheck,
    check,
    install,
    downloadUpdate,
    setPrefs,
    init
  }
}

/** 仅供测试：重置单例内部状态 */
export function __resetAppUpdateForTest(): void {
  dispose?.()
  dispose = null
  inited = false
  state.value = { status: 'idle' }
  capability.value = null
  prefs.value = null
  prefError.value = null
  checking.value = false
}
