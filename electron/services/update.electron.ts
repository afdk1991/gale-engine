import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { UpdaterApi } from './update'

/**
 * 真实实现：包装 electron-updater 的 autoUpdater 单例。
 * 自动下载可用更新，应用退出时自动安装。
 */
export function createElectronUpdaterApi(): UpdaterApi {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  return {
    currentVersion: app.getVersion(),
    checkForUpdates() {
      return autoUpdater.checkForUpdates().then((res) => {
        if (!res) return { isUpdateAvailable: false }
        return { isUpdateAvailable: true, updateInfo: { version: res.versionInfo.version } }
      })
    },
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
      autoUpdater.quitAndInstall(Boolean(isSilent), Boolean(isForceRunAfter))
    }
  }
}
