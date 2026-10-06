import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AppUpdatePrefs, AppUpdateResult, UpdateCapability } from '../../shared/types'

const state = ref<AppUpdateResult>({ status: 'idle' })
const capability = ref<UpdateCapability | null>(null)
const checking = ref(false)
const prefs = ref<AppUpdatePrefs | null>(null)
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
  } catch {}
  try {
    state.value = await a.getUpdateState()
  } catch {}
  try {
    prefs.value = await a.getUpdatePrefs()
  } catch {}
  try {
    dispose = a.onUpdateEvent((s) => {
      state.value = s
      if (s.status !== 'checking') checking.value = false
    })
  } catch {}
}

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

async function install(): Promise<void> {
  try {
    await app()?.installUpdate()
  } catch (e) {
    state.value = { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

async function downloadUpdate(): Promise<void> {
  try {
    const res = await app()?.downloadUpdate()
    if (res) state.value = res
  } catch (e) {
    state.value = { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

async function setPrefs(patch: Partial<AppUpdatePrefs>): Promise<void> {
  const a = app()
  if (!a) return
  prefError.value = null
  try {
    prefs.value = await a.setUpdatePrefs(patch)
  } catch (e) {
    prefError.value = e instanceof Error ? e.message : String(e)
  }
}

export interface UseAppUpdate {
  state: Ref<AppUpdateResult>
  capability: Ref<UpdateCapability | null>
  prefs: Ref<AppUpdatePrefs | null>
  prefError: Ref<string | null>
  checking: Ref<boolean>
  busy: ComputedRef<boolean>
  hasUpdate: ComputedRef<boolean>
  ready: ComputedRef<boolean>
  supported: ComputedRef<boolean>
  label: ComputedRef<string>
  percent: ComputedRef<number | null>
  canCheck: ComputedRef<boolean>
  check: () => Promise<AppUpdateResult>
  install: () => Promise<void>
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
        return `发现新版本 v${s.version ?? '—'}，可下载更新`
      case 'downloading':
        return `正在下载 v${s.version ?? ''} ${percent.value ?? 0}%`
      case 'downloaded':
        return `v${s.version ?? '新版本'} 已下载，即将自动重启…`
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
