import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { AppUpdatePrefs } from '../../shared/types'
import type { UpdaterApi, UpdaterEvent } from './update'
import { detectUpdateCapability, describeUpdateError, interpretCheckResult } from './update.capability'

export { detectUpdateCapability, describeUpdateError } from './update.capability'

/**
 * 真实实现：包装 electron-updater 的 autoUpdater 单例。
 * - 能力探测见 ./update.capability.ts（纯函数，可单测）。
 * - 按偏好自动下载（autoDownload）与退出时自动安装（autoInstallOnAppQuit）。
 * - 把 autoUpdater 的事件归一化为 UpdaterEvent 推给 UpdateService 状态机。
 *
 * 注意：autoUpdater 是单例，本函数只应在主进程初始化时调用一次。
 */
export function createElectronUpdaterApi(): UpdaterApi {
  const capability = detectUpdateCapability({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE
  })

  // 当前生效的更新偏好。构造期先落一份与 settings.ts 的 DEFAULT_APP_PREFS 一致的默认值，
  // 真正的用户偏好由 configure()（main.ts 启动时调用）覆盖。
  // 注意：此处不再写死 autoDownload / autoInstallOnAppQuit —— 它们是用户可配置项，
  // 写死会让「设置」里的开关失去约束力。
  let prefs: AppUpdatePrefs = { autoCheck: true, autoDownload: true, autoInstallOnQuit: true }

  const applyPrefs = (p: AppUpdatePrefs): void => {
    prefs = p
    autoUpdater.autoDownload = p.autoDownload
    autoUpdater.autoInstallOnAppQuit = p.autoInstallOnQuit
  }
  applyPrefs(prefs)

  // 待执行的自动安装定时器句柄。保存它有两个用途：
  // 1) 用户点「立即重启」时取消待执行的那次，避免 quitAndInstall 被调用两次；
  // 2) 偏好被改为关闭时可以取消已排队的重启。
  let autoInstallTimer: ReturnType<typeof setTimeout> | null = null
  const cancelAutoInstall = (): void => {
    if (autoInstallTimer !== null) {
      clearTimeout(autoInstallTimer)
      autoInstallTimer = null
    }
  }
  /** 退出并安装。手动触发与自动触发共用，保证任何时刻只会真正执行一次。 */
  const quitAndInstallOnce = (): void => {
    cancelAutoInstall()
    autoUpdater.quitAndInstall(false, true)
  }

  // allowDowngrade 默认关闭：否则用户手动装回旧版后会被自动推回新版。
  autoUpdater.allowDowngrade = false
  autoUpdater.autoRunAppAfterInstall = true
  try {
    // Windows：只走静默 NSIS 安装包，不走 web 安装器（需浏览器交互，易失败）
    ;(autoUpdater as unknown as { disableWebInstaller?: boolean }).disableWebInstaller = true
  } catch {
    // 非 NSIS 平台没有该属性，忽略
  }

  const listeners = new Set<(e: UpdaterEvent) => void>()
  const emit = (e: UpdaterEvent): void => {
    for (const cb of [...listeners]) {
      try {
        cb(e)
      } catch {
        // 单个订阅方异常不影响其它订阅方
      }
    }
  }

  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    emit({ type: 'available', version: String(info?.version ?? '') })
  )
  autoUpdater.on('update-not-available', () => emit({ type: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    emit({
      type: 'progress',
      percent: p?.percent ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
      bytesPerSecond: p?.bytesPerSecond ?? 0
    })
  )
  autoUpdater.on('update-downloaded', (info) => {
    emit({ type: 'downloaded', version: String(info?.version ?? '') })
    // 仅当用户开启了「下载完成后退出应用即自动安装」且处于打包环境时，
    // 才延迟 3 秒自动重启安装（3 秒缓冲让用户看到「已下载，即将重启」）。
    //
    // 修复前此处是无条件的 setTimeout(quitAndInstall)，后果：
    //   - 用户在设置里关掉该开关也照杀不误，开关形同虚设；
    //   - 下载完成瞬间强杀进程，正在进行的任务（如一键优化的子进程）被中断，
    //     可能留下半成品状态且用户无任何防备。
    if (app.isPackaged && prefs.autoInstallOnQuit) {
      cancelAutoInstall()
      autoInstallTimer = setTimeout(quitAndInstallOnce, 3000)
    }
  })
  autoUpdater.on('error', (err) =>
    emit({
      type: 'error',
      message: describeUpdateError(err?.message ?? String(err), process.platform)
    })
  )

  return {
    currentVersion: app.getVersion(),
    capability,
    checkForUpdates() {
      // 返回值语义容易踩错（null ≠ 无更新），统一交给纯函数解释，见 update.capability.ts
      return autoUpdater.checkForUpdates().then(interpretCheckResult)
    },
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
      // 走同一入口，取消可能已排队的自动安装定时器，避免重启两次。
      cancelAutoInstall()
      autoUpdater.quitAndInstall(Boolean(isSilent), Boolean(isForceRunAfter))
    },
    async downloadUpdate(): Promise<void> {
      await autoUpdater.downloadUpdate()
    },
    onEvent(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    configure(next: AppUpdatePrefs) {
      applyPrefs(next)
      // 用户在下载完成后把开关关掉：撤销已排队的自动重启。
      if (!next.autoInstallOnQuit) cancelAutoInstall()
    }
  }
}
