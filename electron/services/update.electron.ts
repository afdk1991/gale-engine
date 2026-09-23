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

  // allowDowngrade 默认关闭：否则用户手动装回旧版后会被自动推回新版。
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
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
  autoUpdater.on('update-downloaded', (info) =>
    emit({ type: 'downloaded', version: String(info?.version ?? '') })
  )
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
      autoUpdater.quitAndInstall(Boolean(isSilent), Boolean(isForceRunAfter))
    },
    async downloadUpdate(): Promise<void> {
      await autoUpdater.downloadUpdate()
    },
    onEvent(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    configure(prefs: AppUpdatePrefs) {
      autoUpdater.autoDownload = prefs.autoDownload
      autoUpdater.autoInstallOnAppQuit = prefs.autoInstallOnQuit
    }
  }
}
