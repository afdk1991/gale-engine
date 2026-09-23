import type {
  AppUpdatePrefs,
  AppUpdateResult,
  UpdateCapability
} from '../../shared/types'

/**
 * 对 electron-updater 的 autoUpdater 的抽象，便于在单测中注入假实现。
 * 真实实现见 ./update.electron.ts（createElectronUpdaterApi）。
 */
export interface UpdaterApi {
  /** 当前应用版本号 */
  readonly currentVersion: string
  /**
   * 当前平台+安装方式的自动更新能力探测。
   * 缺省视为「支持」，以保持对旧实现的向后兼容。
   */
  readonly capability?: UpdateCapability
  /**
   * 检查更新。返回 { isUpdateAvailable, updateInfo }：
   * - 有更新：isUpdateAvailable=true，updateInfo.version 为最新版本号
   * - 无更新：isUpdateAvailable=false
   * - 网络/配置错误：reject
   *
   * 注意：底层 electron-updater 的 checkForUpdates() 在「无更新」时并**不**返回 null，
   * 而是返回 { isUpdateAvailable: false }（null 只在更新器未启用时出现）。
   * 归一化由 update.capability.ts 的 interpretCheckResult() 负责。
   */
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo?: { version?: string | number } }>
  /** 退出应用并安装已下载的更新 */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  /**
   * M6：手动触发下载。autoDownload=false 时，checkUpdate 停在 available 态不会自动下载，
   * 需要用户点「下载更新」后显式调用它。底层进度经 progress/downloaded 事件推给状态机。
   */
  downloadUpdate(): Promise<void>
  /** 订阅底层事件（下载进度 / 完成 / 失败）；不实现表示无事件源 */
  onEvent?(cb: (e: UpdaterEvent) => void): () => void
  /** 把用户偏好下发到底层（自动下载开关等） */
  configure?(prefs: AppUpdatePrefs): void
}

/** 底层更新器事件（electron-updater 的事件归一化） */
export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'none' }
  | { type: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export interface UpdateService {
  readonly currentVersion: string
  /** 平台自动更新能力探测结果 */
  capability(): UpdateCapability
  /** 读取当前状态快照（不发网络请求） */
  state(): AppUpdateResult
  /**
   * 检查更新。
   * - silent=true（启动后台自检）：失败不进入用户可见的 error 态也不重试轰炸，
   *   仅在返回结果里带 silent 标记，由界面决定是否展示。
   * - 有可用更新时，底层已按偏好自动下载，进度经 onState 推送。
   */
  checkUpdate(opts?: { silent?: boolean }): Promise<AppUpdateResult>
  /** 安装已下载的更新（会退出当前进程） */
  installUpdate(): void
  /** M6：手动下载已发现的更新（仅在 available 态生效，其它态为空操作） */
  downloadUpdate(): Promise<AppUpdateResult>
  /** 订阅状态变化，返回退订函数 */
  onState(cb: (s: AppUpdateResult) => void): () => void
}

/** 缺省能力探测：未提供时按「支持」处理，避免把旧实现误判为不可更新 */
const DEFAULT_CAPABILITY: UpdateCapability = {
  canAutoUpdate: true,
  platform: 'other',
  packageKind: 'unknown',
  reason: null
}

export interface UpdateServiceDeps {
  /** 失败自动重试次数（默认 2 次，共 3 次尝试）；silent 检查不重试 */
  retries?: number
  /** 重试间隔毫秒（默认 1200ms） */
  retryDelayMs?: number
  /** 时间戳注入（测试用） */
  now?: () => number
  /** 等待注入（测试用） */
  sleep?: (ms: number) => Promise<void>
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

/**
 * 纯逻辑服务：把底层 UpdaterApi 的结果归一化为前端友好的 AppUpdateResult 状态机。
 * 不依赖 Electron / 网络，可注入假 UpdaterApi 单测。
 *
 * 之所以做成状态机（而不只是一次性返回值）：自动更新的完整生命周期是
 * 检查 → 可用 → 下载（带进度）→ 已下载 → 安装，界面要在任意时刻打开都能
 * 直接读到当前进展（所以有 state() 快照 + onState 订阅两个出口）。
 */
export function createUpdateService(
  updater: UpdaterApi,
  deps: UpdateServiceDeps = {}
): UpdateService {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = Math.max(0, deps.retries ?? 2)
  const retryDelayMs = Math.max(0, deps.retryDelayMs ?? 1200)
  const cap = updater.capability ?? DEFAULT_CAPABILITY

  const listeners = new Set<(s: AppUpdateResult) => void>()
  let current: AppUpdateResult = {
    status: 'idle',
    currentVersion: updater.currentVersion,
    capability: cap,
    at: now()
  }

  const emit = (patch: Partial<AppUpdateResult>): AppUpdateResult => {
    current = { ...current, ...patch, at: now() }
    for (const cb of [...listeners]) {
      try {
        cb({ ...current })
      } catch {
        // 订阅方回调异常不能中断更新状态机
      }
    }
    return { ...current }
  }

  // 注意：这里**不**下发默认偏好——偏好由主进程从持久化配置读取后
  // 经 updater.configure() 注入（见 main.ts），否则会用默认值覆盖用户设置。

  // 底层事件（真实实现里来自 electron-updater）驱动状态机
  updater.onEvent?.((e) => {
    switch (e.type) {
      case 'checking':
        // 静默自检不把界面切到「检查中」，避免启动瞬间闪动
        if (!current.silent) emit({ status: 'checking' })
        break
      case 'available':
        emit({ status: 'available', version: e.version })
        break
      case 'progress':
        emit({
          status: 'downloading',
          percent: clampPercent(e.percent),
          transferred: Math.max(0, e.transferred || 0),
          total: e.total > 0 ? e.total : undefined,
          bytesPerSecond: Math.max(0, e.bytesPerSecond || 0)
        })
        break
      case 'downloaded':
        emit({ status: 'downloaded', version: e.version, percent: 100 })
        break
      case 'error':
        // 静默自检期间的底层错误不打扰用户（例如离线启动）
        if (!current.silent) emit({ status: 'error', error: e.message })
        break
      case 'none':
      default:
        // 无更新由 checkForUpdates 的返回值统一处理，避免两处状态互相覆盖
        break
    }
  })

  const isDownloadedOrDownloading = (): boolean =>
    current.status === 'downloaded' || current.status === 'downloading'

  const checkUpdate = async (opts?: { silent?: boolean }): Promise<AppUpdateResult> => {
    const silent = opts?.silent === true

    if (!cap.canAutoUpdate) {
      return emit({
        status: 'unsupported',
        silent,
        reason: cap.reason ?? '当前平台不支持应用内自动更新'
      })
    }

    // 已在下载/已下载时不退回「检查中」：用户重复点检查不应把进度条擦掉
    if (!isDownloadedOrDownloading()) emit({ status: 'checking', silent, error: undefined })

    const attempts = silent ? 1 : retries + 1
    let lastError = ''

    for (let i = 0; i < attempts; i++) {
      try {
        const res = await updater.checkForUpdates()
        if (res.isUpdateAvailable && res.updateInfo?.version != null) {
          const version = String(res.updateInfo.version)
          // 下载态优先：事件已把状态推进到下载/已下载，且版本一致时不被检查结果回退
          if (isDownloadedOrDownloading() && current.version === version) {
            return { ...current }
          }
          return emit({ status: 'available', version, silent, error: undefined })
        }
        if (isDownloadedOrDownloading()) return { ...current }
        return emit({ status: 'up-to-date', silent, version: undefined, error: undefined })
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (i < attempts - 1) await sleep(retryDelayMs)
      }
    }

    return emit({ status: 'error', error: lastError, silent })
  }

  const downloadUpdate = async (): Promise<AppUpdateResult> => {
    if (!cap.canAutoUpdate) {
      return emit({ status: 'unsupported', reason: cap.reason ?? '当前平台不支持应用内自动更新' })
    }
    // 只有「已发现可用更新、尚未开始下载」时才触发；重复点、已在下载/已下载都为空操作，
    // 避免重复下载或把进度擦掉。
    if (current.status !== 'available') return { ...current }
    try {
      await updater.downloadUpdate()
    } catch (error) {
      return emit({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
    // 底层 progress/downloaded 事件已把状态推到 downloading/downloaded，返回最新快照
    return { ...current }
  }

  return {
    currentVersion: updater.currentVersion,
    capability: () => ({ ...cap }),
    state: () => ({ ...current }),
    checkUpdate,
    installUpdate(): void {
      updater.quitAndInstall(false, true)
    },
    downloadUpdate,
    onState: (cb) => {
      listeners.add(cb)
      // 订阅即补发当前状态，避免界面重进后空白；补发同样要隔离订阅方异常
      try {
        cb({ ...current })
      } catch {
        // 忽略订阅方自身异常
      }
      return () => listeners.delete(cb)
    }
  }
}
