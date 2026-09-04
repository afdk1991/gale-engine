import type { AppUpdateResult } from '../../shared/types'

/**
 * 对 electron-updater 的 autoUpdater 的抽象，便于在单测中注入假实现。
 * 真实实现见 ./update.electron.ts（createElectronUpdaterApi）。
 */
export interface UpdaterApi {
  /** 当前应用版本号 */
  readonly currentVersion: string
  /**
   * 检查更新。返回 { isUpdateAvailable, updateInfo }：
   * - 有更新：isUpdateAvailable=true，updateInfo.version 为最新版本号
   * - 无更新：isUpdateAvailable=false（electron-updater 在“无更新”时 resolve(null)）
   * - 网络/配置错误：reject
   */
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo?: { version?: string | number } }>
  /** 退出应用并安装已下载的更新 */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateService {
  readonly currentVersion: string
  /** 检查更新并归一化为 AppUpdateResult */
  checkUpdate(): Promise<AppUpdateResult>
  /** 安装已下载的更新（会退出当前进程） */
  installUpdate(): void
}

/**
 * 纯逻辑服务：把底层 UpdaterApi 的结果归一化为前端友好的 AppUpdateResult。
 * 不依赖 Electron / 网络，可注入假 UpdaterApi 单测。
 */
export function createUpdateService(updater: UpdaterApi): UpdateService {
  return {
    currentVersion: updater.currentVersion,
    async checkUpdate(): Promise<AppUpdateResult> {
      try {
        const res = await updater.checkForUpdates()
        if (res.isUpdateAvailable && res.updateInfo?.version != null) {
          return { status: 'available', version: String(res.updateInfo.version) }
        }
        return { status: 'up-to-date' }
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    },
    installUpdate(): void {
      updater.quitAndInstall(false, true)
    }
  }
}
