import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { createSettingsService, type StorageAdapter } from './services/settings'
import { createMonitorService } from './services/monitor'
import { createHistoryService } from './services/history'

const store = new Store()
const settingsService = createSettingsService(store as unknown as StorageAdapter)
const monitorService = createMonitorService()
const historyService = createHistoryService(store as unknown as StorageAdapter)

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
  ipcMain.handle('history:list', () => historyService.list())
  ipcMain.handle('history:add', (_event, entry) => historyService.add(entry ?? {}))
  ipcMain.handle('history:clear', () => historyService.clear())
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
