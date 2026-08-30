import type { App } from 'electron'

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

/**
 * 纯逻辑服务：读写“开机自启”开关。
 * 不依赖 Electron，可注入假 LoginItemApi 单测。
 */
export function createAutoLaunchService(api: LoginItemApi): AutoLaunchService {
  return {
    get(): boolean {
      return api.getLoginItemSettings().openAtLogin === true
    },
    set(enable: boolean): boolean {
      const next = Boolean(enable)
      api.setLoginItemSettings({ openAtLogin: next })
      return next
    }
  }
}

/** 真实实现：包装 Electron app 的登录项 API */
export function createElectronLoginItemApi(electronApp: App): LoginItemApi {
  return {
    getLoginItemSettings: () => electronApp.getLoginItemSettings(),
    setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings)
  }
}
