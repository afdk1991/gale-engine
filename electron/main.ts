import { app, BrowserWindow, ipcMain, shell as electronShell } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { createSettingsService, createAppPrefsService, type StorageAdapter } from './services/settings'
import { createMonitorService } from './services/monitor'
import { createHardwareService } from './services/hardware'
import { createHistoryService } from './services/history'
import { createOptimizerService } from './services/optimizer'
import { createSpaceMeter, createSystemInformationSpaceFetcher } from './services/space'
import { createDiskService } from './services/disk'
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
import { createElectronElevator } from './services/elevate.electron'
import { createOptLibrary, buildCapabilityRegistry } from './services/optlib'
import { createOneKeyService } from './services/onekey'
import {
  createCapabilityFeedService,
  createHttpManifestFetcher,
  DEFAULT_FEED_URL
} from './services/capabilityFeed'
import { createDllService } from './services/dllrepair'
import type { ExecRunner } from './services/shell'
import type { DllRepairKind } from '../shared/types'

// 跨平台：按当前 OS 选择执行器（Windows→PowerShell，macOS/Linux→bash）
const runner = createPlatformRunner()
const platform = detectPlatform()
const store = new Store()
const settingsService = createSettingsService(store as unknown as StorageAdapter)
const appPrefsService = createAppPrefsService(store as unknown as StorageAdapter)
const monitorService = createMonitorService()
const hardwareService = createHardwareService()
const historyService = createHistoryService(store as unknown as StorageAdapter)
// 磁盘可用空间实测器：**全应用共享一份**。
// 「释放了多少」必须实测清理前后的卷可用空间差，不能只信命令退出码；
// 三个 optimizer 实例（普通 / 提权 / 一键优化的提权集）共用它，避免重复创建 fetcher。
const spaceMeter = createSpaceMeter(createSystemInformationSpaceFetcher())
const optimizerService = createOptimizerService(runner, platform, spaceMeter)
const diskService = createDiskService(runner, platform)
const gameModeService = createGameModeService(runner, store as unknown as StorageAdapter)
const toolboxService = createToolboxService(runner, platform)
const processService = createProcessService(runner, platform)
const networkService = createNetworkService(runner, platform)
const firewallService = createFirewallService(runner, platform)
const tasksService = createTasksService(runner, platform)
const winServicesService = createWinServicesService(runner, platform)
// ── 自动更新 ──────────────────────────────────────────────────
// 三类平台的能力差异（mac 只认 zip、Linux 仅 AppImage 可自更新等）在
// update.capability.ts 里探测，界面据此诚实地展示「能否自更新 + 替代方案」。
const updaterApi = createElectronUpdaterApi()
const updateService = createUpdateService(updaterApi)
// 用户偏好（自动检查 / 自动下载 / 退出自动安装）下发到底层更新器
updaterApi.configure?.(appPrefsService.get())

const autoLaunchService = createAutoLaunchService(createElectronLoginItemApi(app), platform)

// ── 提权与优化能力动态库 ──────────────────────────────────────
// 普通执行器继承当前进程权限；adminRunner 把同一段脚本交给提权子进程执行
// （Windows ShellExecute runas 弹 UAC，unix 走 pkexec/sudo），从而让
// 高权限优化项（更新缓存 / WinSxS / SFC）在无管理员启动时也能按需完成。
const elevator = createElectronElevator(runner)
const adminRunner: ExecRunner = { run: (script) => elevator.runElevated(script) }
// 提权版磁盘服务：SFC / DISM 这类必须管理员权限的操作复用它（optlib 与 DLL 修复共用一份）
const adminDiskService = createDiskService(adminRunner, platform)

// DLL 缺失检测与修复：扫描走普通权限，修复（SFC/DISM/装运行库）走提权通道
const dllService = createDllService({
  runner,
  adminRunner,
  platform,
  repairSystemFiles: (kind) => adminDiskService.repairSystemFiles(kind)
})

// ── 可独立更新的能力库（本项目的「DLL」热更新通道）────────────────
// 远端清单只能覆盖元信息 + 用白名单调用编排「配方能力」，不能下发可执行代码。
// 取用点是惰性函数，因此清单生效后无需重启应用即可用上新能力。
const capabilityFeed = createCapabilityFeedService({
  fetchManifest: createHttpManifestFetcher(
    process.env.GALE_CAPABILITY_FEED || DEFAULT_FEED_URL
  ),
  storage: store as unknown as StorageAdapter,
  appVersion: app.getVersion(),
  builtinMetas: () => buildCapabilityRegistry().map((c) => c.meta),
  dll: { scan: () => dllService.scan(), repair: (kind) => dllService.repair(kind) },
  feedUrl: process.env.GALE_CAPABILITY_FEED || DEFAULT_FEED_URL
})

const optLibrary = createOptLibrary({
  platform,
  normal: { optimizer: optimizerService, disk: diskService, toolbox: toolboxService },
  admin: {
    optimizer: createOptimizerService(adminRunner, platform, spaceMeter),
    disk: adminDiskService,
    toolbox: createToolboxService(adminRunner, platform)
  },
  isElevated: () => elevator.isElevated(),
  externalCapabilities: () => capabilityFeed.externalCapabilities(),
  metaOverrides: () => capabilityFeed.metaOverrides()
})
const oneKeyService = createOneKeyService({
  library: optLibrary,
  isElevated: () => elevator.isElevated()
})

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
  // 优化能力动态库（DLL）：列出全部单项能力 / 独立调用其中任意一项
  ipcMain.handle('optlib:listCapabilities', () => optLibrary.listCapabilities())
  ipcMain.handle('optlib:runSingle', (_event, id) => optLibrary.runSingle(String(id)))
  // 能力库（可独立更新的「DLL」）：查看状态 / 检查更新 / 生效 / 回退内置
  ipcMain.handle('optlib:libraryState', () => capabilityFeed.state())
  ipcMain.handle('optlib:checkLibrary', () => capabilityFeed.check())
  ipcMain.handle('optlib:applyLibrary', () => capabilityFeed.apply())
  ipcMain.handle('optlib:resetLibrary', () => capabilityFeed.reset())
  // 一键优化：start 返回汇总；进度由下方 webContents 推送给渲染进程
  ipcMain.handle('onekey:start', (_event, ids) =>
    oneKeyService.start(Array.isArray(ids) ? ids.map(String) : undefined)
  )
  ipcMain.handle('onekey:cancel', () => oneKeyService.cancel())
  ipcMain.handle('onekey:retry', () => oneKeyService.retryFailed())
  ipcMain.handle('onekey:state', () => oneKeyService.getState())
  ipcMain.handle('disk:volumes', () => diskService.volumes())
  ipcMain.handle('disk:scanDeepCleanup', () => diskService.scanDeepCleanup())
  ipcMain.handle('disk:runDeepCleanup', (_event, items) => diskService.runDeepCleanup(items ?? []))
  ipcMain.handle('disk:checkVolume', (_event, mount, fix) =>
    diskService.checkVolume(String(mount), Boolean(fix))
  )
  ipcMain.handle('disk:repairSystemFiles', (_event, kind) => {
    // 仅允许两个合法工具，其余一律收敛为 sfc，避免任意字符串透传
    const k = String(kind) === 'dism-restore' ? 'dism-restore' : 'sfc'
    return diskService.repairSystemFiles(k)
  })
  // DLL 缺失检测与修复（渲染进程传什么都先过白名单）
  ipcMain.handle('dll:scan', () => dllService.scan())
  ipcMain.handle('dll:advice', () => dllService.advice())
  ipcMain.handle('dll:repair', (_event, kind) => {
    const allowed: DllRepairKind[] = ['sfc', 'dism-restore', 'vcredist-x64', 'vcredist-x86']
    const k = String(kind) as DllRepairKind
    return dllService.repair(allowed.includes(k) ? k : 'sfc')
  })
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
  ipcMain.handle('app:getUpdateState', () => updateService.state())
  ipcMain.handle('app:getUpdateCapability', () => updateService.capability())
  ipcMain.handle('app:getUpdatePrefs', () => appPrefsService.get())
  ipcMain.handle('app:setUpdatePrefs', (_event, patch) => {
    const next = appPrefsService.set(patch ?? {})
    // 偏好立即下发给底层更新器，无需重启应用
    updaterApi.configure?.(next)
    return next
  })
  ipcMain.handle('app:installUpdate', () => {
    updateService.installUpdate()
  })
  ipcMain.handle('app:getAutoLaunch', () => autoLaunchService.get())
  ipcMain.handle('app:setAutoLaunch', (_event, enable) => autoLaunchService.set(Boolean(enable)))
  ipcMain.handle('app:isElevated', () => elevator.isElevated())
  ipcMain.handle('app:restartElevated', () => elevator.restartElevated())
  ipcMain.handle('app:openExternal', async (_event, url) => {
    const target = String(url ?? '')
    if (!isAllowedExternal(target)) {
      return { ok: false, message: '已拒绝打开：链接不在允许列表内' }
    }
    try {
      await electronShell.openExternal(target)
      return { ok: true, message: target }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  // 一键优化进度推送（主进程 → 所有窗口）。放在 registerIpc 内只订阅一次，
  // 避免每次调用都叠加一个监听器导致重复推送。
  oneKeyService.onProgress((progress) => {
    broadcast('onekey:progress', progress)
  })

  // 更新状态推送（检查中 / 下载进度 / 已下载 / 失败）——所有窗口保持一致
  updateService.onState((state) => {
    broadcast('app:update', state)
  })
}

/** 向所有存活窗口广播事件（窗口可能多个：主窗 + 未来的独立窗口） */
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/**
 * 启动后台静默检查更新。
 * - 延迟若干秒，避开启动瞬间的界面渲染与硬件采集（避免抢网络/CPU）。
 * - 失败静默（silent=true）：离线启动不该给用户弹错误。
 * - 仅在偏好开启且平台支持自更新时执行。
 */
function scheduleStartupUpdateCheck(): void {
  if (!appPrefsService.get().autoCheck) return
  if (!updateService.capability().canAutoUpdate) return
  const timer = setTimeout(() => {
    updateService.checkUpdate({ silent: true }).catch((error) => {
      console.error('启动静默检查更新失败', error)
    })
  }, STARTUP_UPDATE_DELAY_MS)
  // 不阻止进程退出
  if (typeof timer.unref === 'function') timer.unref()
}

/** 启动后多久做后台静默检查（毫秒） */
const STARTUP_UPDATE_DELAY_MS = 8000

/**
 * 允许用系统浏览器打开的外部主机白名单。
 * 渲染进程传来的 URL 一律经此校验——否则一旦有 XSS/供应链问题，
 * 攻击者就能借 openExternal 拉起任意协议（file:/ms-*: 等）的可执行内容。
 */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'aka.ms',
  'learn.microsoft.com',
  'support.microsoft.com'
])

function isAllowedExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
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
  scheduleStartupUpdateCheck()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
