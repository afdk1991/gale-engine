import { app } from 'electron'
import { createElevator, type Elevator } from './elevate'
import type { ExecRunner } from './shell'
import { detectPlatform } from './shell'

/**
 * Electron 侧组装提权器：把 app.getPath('exe') 与 app.quit 注入纯逻辑模块。
 * 与 update.electron.ts / autolaunch.ts 保持同样的「纯逻辑 + Electron 适配层」分层。
 */
export function createElectronElevator(runner: ExecRunner): Elevator {
  return createElevator({
    runner,
    platform: detectPlatform(),
    exePath: app.getPath('exe'),
    quit: () => app.quit()
  })
}
