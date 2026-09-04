import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import type { App } from 'electron'
import type { Platform } from './shell'
import { detectPlatform } from './shell'

/** 对 Electron app 登录项 API 的抽象，便于注入测试 */
export interface LoginItemApi {
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean; path?: string; args?: string[] }): void
}

export interface AutoLaunchService {
  /** 读取开机自启状态 */
  get(): boolean
  /** 设置开机自启，返回设置后的状态 */
  set(enable: boolean): boolean
}

/** Linux XDG autostart .desktop 文件名（固定为 gale-engine） */
export const AUTOSTART_FILE_NAME = 'gale-engine.desktop'

/** Linux autostart 目录（可注入 baseDir 便于测试） */
export function autostartDir(baseDir = homedir()): string {
  return path.join(baseDir, '.config', 'autostart')
}

export function autostartFilePath(baseDir = homedir()): string {
  return path.join(autostartDir(baseDir), AUTOSTART_FILE_NAME)
}

/** Linux XDG autostart .desktop 内容 */
export function buildAutostartContent(execPath: string, appName = '疾风引擎'): string {
  return `[Desktop Entry]
Type=Application
Name=${appName}
Exec="${execPath}"
X-GNOME-Autostart-enabled=true`
}

/**
 * 开机自启服务。
 * - win32 / darwin：走 Electron app 登录项 API（Windows 写注册表 Run，macOS 写 LaunchAgents，天然跨平台）
 * - linux：Electron 不提供登录项支持，改用 XDG autostart（~/.config/autostart/gale-engine.desktop），
 *   用 Node fs 同步实现以保持 get()/set() 同步接口。
 */
export function createAutoLaunchService(
  api: LoginItemApi,
  platform: Platform = detectPlatform(),
  opts: { baseDir?: string; execPath?: string } = {}
): AutoLaunchService {
  const isLinux = platform === 'linux'
  const file = () => autostartFilePath(opts.baseDir)
  const exec = opts.execPath ?? (process.execPath || '')

  const get = (): boolean => {
    if (!isLinux) return api.getLoginItemSettings().openAtLogin === true
    return fs.existsSync(file())
  }

  const set = (enable: boolean): boolean => {
    const next = Boolean(enable)
    if (!isLinux) {
      api.setLoginItemSettings({ openAtLogin: next })
      return next
    }
    const target = file()
    if (next) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, buildAutostartContent(exec), { encoding: 'utf8' })
    } else {
      try {
        fs.unlinkSync(target)
      } catch {
        // 文件不存在视为已关闭
      }
    }
    return next
  }

  return { get, set }
}

/** 真实实现：包装 Electron app 的登录项 API */
export function createElectronLoginItemApi(electronApp: App): LoginItemApi {
  return {
    getLoginItemSettings: () => electronApp.getLoginItemSettings(),
    setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings)
  }
}
