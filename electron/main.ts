import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { createSettingsService, type StorageAdapter } from './services/settings'
import { createMonitorService } from './services/monitor'
import { createHardwareService } from './services/hardware'
import { createHistoryService } from './services/history'
import { createOptimizerService } from './services/optimizer'
import { createGameModeService } from './services/gamemode'
import { createToolboxService } from './services/toolbox'
import { createProcessService } from './services/process'
import { createNetworkService } from './services/network'
import { createFirewallService } from './services/firewall'
import { createTasksService } from './services/tasks'
import { createWinServicesService } from './services/winservices'
import { createPlatformRunner, detectPlatform } from './services/shell'
import { createUpdateService } from './services/update'
import { createElectronUpdaterApi } from './services/update.electron'
import { createAutoLaunchService, createElectronLoginItemApi } from './services/autolaunch'

// 跨平台：按当前 OS 选择执行器（Windows→PowerShell，macOS/Linux→bash）
const runner = createPlatformRunner()
const platform = detectPlatform()
const store = new Store()
const settingsService = createSettingsService(store as unknown as StorageAdapter)
const monitorService = createMonitorService()
const hardwareService = createHardwareService()
const historyService = createHistoryService(store as unknown as StorageAdapter)
const optimizerService = createOptimizerService(runner)
const gameModeService = createGameModeService(runner, store as unknown as StorageAdapter)
const toolboxService = createToolboxService(runner)
const processService = createProcessService(runner)
const networkService = createNetworkService(runner, platform)
const firewallService = createFirewallService(runner)
const tasksService = createTasksService(runner)
const winServicesService = createWinServicesService(runner)
const updateService = createUpdateService(createElectronUpdaterApi())
const autoLaunchService = createAutoLaunchService(createElectronLoginItemApi(app))

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settingsService.get())
  ipcMain.handle('settings:set', (_event, patch) => {
    try {
      return settingsService.set(patch ?? {})
    } catch (error) {
      console.error('settings:set 持久化失败，返回当前设置', error)
      return settingsService.get()
    }
  })
  ipcMain.handle('monitor:snapshot', () => monitorService.snapshot())
  ipcMain.handle('hardware:info', () => hardwareService.info())
  ipcMain.handle('history:list', () => historyService.list())
  ipcMain.handle('history:add', (_event, entry) => historyService.add(entry ?? {}))
  ipcMain.handle('history:clear', () => historyService.clear())
  ipcMain.handle('optimizer:scanCleanup', () => optimizerService.scanCleanup())
  ipcMain.handle('optimizer:runCleanup', (_event, items) => optimizerService.runCleanup(items ?? []))
  ipcMain.handle('optimizer:listStartup', () => optimizerService.listStartup())
  ipcMain.handle('optimizer:toggleStartup', (_event, id, enable, command) =>
    optimizerService.toggleStartup(id, Boolean(enable), command)
  )
  ipcMain.handle('gameMode:status', () => gameModeService.status())
  ipcMain.handle('gameMode:boost', () => gameModeService.boost())
  ipcMain.handle('gameMode:restore', () => gameModeService.restore())
  ipcMain.handle('toolbox:flushDns', () => toolboxService.flushDns())
  ipcMain.handle('toolbox:emptyRecycleBin', () => toolboxService.emptyRecycleBin())
  ipcMain.handle('toolbox:clearClipboard', () => toolboxService.clearClipboard())
  ipcMain.handle('toolbox:toggleDarkMode', (_event, enable) => toolboxService.toggleDarkMode(Boolean(enable)))
  ipcMain.handle('process:list', (_event, sort) => processService.list(sort))
  ipcMain.handle('process:kill', (_event, pid) => processService.kill(Number(pid)))
  ipcMain.handle('process:suspend', (_event, pid) => processService.suspend(Number(pid)))
  ipcMain.handle('process:resume', (_event, pid) => processService.resume(Number(pid)))
  ipcMain.handle('process:priority', (_event, pid, level) => processService.priority(Number(pid), level))
  ipcMain.handle('network:ping', (_event, host, count) => networkService.ping(host, count))
  ipcMain.handle('network:interfaces', () => networkService.interfaces())
  ipcMain.handle('firewall:profiles', () => firewallService.profiles())
  ipcMain.handle('firewall:listRules', () => firewallService.listRules())
  ipcMain.handle('firewall:setProfileEnabled', (_event, profile, enable) =>
    firewallService.setProfileEnabled(String(profile), Boolean(enable))
  )
  ipcMain.handle('firewall:toggleRule', (_event, name, enable) =>
    firewallService.toggleRule(String(name), Boolean(enable))
  )
  ipcMain.handle('tasks:list', () => tasksService.list())
  ipcMain.handle('tasks:setEnabled', (_event, path, name, enable) =>
    tasksService.setEnabled(String(path), String(name), Boolean(enable))
  )
  ipcMain.handle('tasks:run', (_event, path, name) => tasksService.run(String(path), String(name)))
  ipcMain.handle('tasks:stop', (_event, path, name) => tasksService.stop(String(path), String(name)))
  ipcMain.handle('winServices:list', () => winServicesService.list())
  ipcMain.handle('winServices:start', (_event, name) => winServicesService.start(String(name)))
  ipcMain.handle('winServices:stop', (_event, name) => winServicesService.stop(String(name)))
  ipcMain.handle('winServices:setStartupType', (_event, name, startType) =>
    winServicesService.setStartupType(String(name), startType)
  )
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:checkUpdate', () => updateService.checkUpdate())
  ipcMain.handle('app:installUpdate', () => {
    updateService.installUpdate()
  })
  ipcMain.handle('app:getAutoLaunch', () => autoLaunchService.get())
  ipcMain.handle('app:setAutoLaunch', (_event, enable) => autoLaunchService.set(Boolean(enable)))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: '疾风引擎',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      // sandbox 保持关闭：preload 仅使用 contextBridge/ipcRenderer（沙箱可用），
      // 但后续里程碑可能需要在 preload 引入 Node 能力；M6 加固时统一复查
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
      console.error('加载渲染页面失败', error)
      win.show()
    })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      console.error('加载渲染页面失败', error)
      win.show()
    })
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
