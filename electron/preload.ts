import { contextBridge, ipcRenderer } from 'electron'
import type { GaleApi } from '../shared/types'

const api: GaleApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  monitor: {
    snapshot: () => ipcRenderer.invoke('monitor:snapshot')
  },
  hardware: {
    info: () => ipcRenderer.invoke('hardware:info')
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear')
  },
  optimizer: {
    scanCleanup: () => ipcRenderer.invoke('optimizer:scanCleanup'),
    runCleanup: (ids) => ipcRenderer.invoke('optimizer:runCleanup', ids),
    listStartup: () => ipcRenderer.invoke('optimizer:listStartup'),
    toggleStartup: (id, enable, command) => ipcRenderer.invoke('optimizer:toggleStartup', id, enable, command)
  },
  // 优化能力动态库（DLL）——单项能力可独立调用
  optlib: {
    listCapabilities: () => ipcRenderer.invoke('optlib:listCapabilities'),
    runSingle: (id) => ipcRenderer.invoke('optlib:runSingle', id),
    libraryState: () => ipcRenderer.invoke('optlib:libraryState'),
    checkLibrary: () => ipcRenderer.invoke('optlib:checkLibrary'),
    applyLibrary: () => ipcRenderer.invoke('optlib:applyLibrary'),
    resetLibrary: () => ipcRenderer.invoke('optlib:resetLibrary')
  },
  // 一键优化
  onekey: {
    start: (ids) => ipcRenderer.invoke('onekey:start', ids),
    cancel: () => ipcRenderer.invoke('onekey:cancel'),
    retryFailed: () => ipcRenderer.invoke('onekey:retry'),
    state: () => ipcRenderer.invoke('onekey:state'),
    onProgress: (cb) => {
      const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress)
      ipcRenderer.on('onekey:progress', listener)
      return () => ipcRenderer.removeListener('onekey:progress', listener)
    }
  },
  disk: {
    volumes: () => ipcRenderer.invoke('disk:volumes'),
    scanDeepCleanup: () => ipcRenderer.invoke('disk:scanDeepCleanup'),
    runDeepCleanup: (items) => ipcRenderer.invoke('disk:runDeepCleanup', items),
    checkVolume: (mount, fix) => ipcRenderer.invoke('disk:checkVolume', mount, fix),
    repairSystemFiles: (kind) => ipcRenderer.invoke('disk:repairSystemFiles', kind)
  },
  // DLL（动态链接库）缺失检测与修复
  dll: {
    scan: () => ipcRenderer.invoke('dll:scan'),
    advice: () => ipcRenderer.invoke('dll:advice'),
    repair: (kind) => ipcRenderer.invoke('dll:repair', kind)
  },
  gameMode: {
    status: () => ipcRenderer.invoke('gameMode:status'),
    boost: () => ipcRenderer.invoke('gameMode:boost'),
    restore: () => ipcRenderer.invoke('gameMode:restore')
  },
  toolbox: {
    flushDns: () => ipcRenderer.invoke('toolbox:flushDns'),
    emptyRecycleBin: () => ipcRenderer.invoke('toolbox:emptyRecycleBin'),
    clearClipboard: () => ipcRenderer.invoke('toolbox:clearClipboard'),
    toggleDarkMode: (enable) => ipcRenderer.invoke('toolbox:toggleDarkMode', enable)
  },
  process: {
    list: (sort) => ipcRenderer.invoke('process:list', sort),
    kill: (pid) => ipcRenderer.invoke('process:kill', pid),
    suspend: (pid) => ipcRenderer.invoke('process:suspend', pid),
    resume: (pid) => ipcRenderer.invoke('process:resume', pid),
    priority: (pid, level) => ipcRenderer.invoke('process:priority', pid, level)
  },
  network: {
    ping: (host, count) => ipcRenderer.invoke('network:ping', host, count),
    interfaces: () => ipcRenderer.invoke('network:interfaces')
  },
  firewall: {
    profiles: () => ipcRenderer.invoke('firewall:profiles'),
    listRules: () => ipcRenderer.invoke('firewall:listRules'),
    setProfileEnabled: (profile, enable, options) => ipcRenderer.invoke('firewall:setProfileEnabled', profile, enable, options),
    toggleRule: (name, enable) => ipcRenderer.invoke('firewall:toggleRule', name, enable)
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    setEnabled: (path, name, enable) => ipcRenderer.invoke('tasks:setEnabled', path, name, enable),
    run: (path, name) => ipcRenderer.invoke('tasks:run', path, name),
    stop: (path, name) => ipcRenderer.invoke('tasks:stop', path, name)
  },
  winServices: {
    list: () => ipcRenderer.invoke('winServices:list'),
    start: (name) => ipcRenderer.invoke('winServices:start', name),
    stop: (name) => ipcRenderer.invoke('winServices:stop', name),
    setStartupType: (name, startType) => ipcRenderer.invoke('winServices:setStartupType', name, startType)
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
    getUpdateCapability: () => ipcRenderer.invoke('app:getUpdateCapability'),
    getUpdatePrefs: () => ipcRenderer.invoke('app:getUpdatePrefs'),
    setUpdatePrefs: (patch) => ipcRenderer.invoke('app:setUpdatePrefs', patch),
    onUpdateEvent: (cb) => {
      const listener = (_event: unknown, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on('app:update', listener)
      return () => ipcRenderer.removeListener('app:update', listener)
    },
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
    setAutoLaunch: (enable) => ipcRenderer.invoke('app:setAutoLaunch', enable),
    isElevated: () => ipcRenderer.invoke('app:isElevated'),
    restartElevated: () => ipcRenderer.invoke('app:restartElevated'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('gale', api)
