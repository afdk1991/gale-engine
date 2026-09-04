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
    runCleanup: (items) => ipcRenderer.invoke('optimizer:runCleanup', items),
    listStartup: () => ipcRenderer.invoke('optimizer:listStartup'),
    toggleStartup: (id, enable, command) => ipcRenderer.invoke('optimizer:toggleStartup', id, enable, command)
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
    setProfileEnabled: (profile, enable) => ipcRenderer.invoke('firewall:setProfileEnabled', profile, enable),
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
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
    setAutoLaunch: (enable) => ipcRenderer.invoke('app:setAutoLaunch', enable)
  }
}

contextBridge.exposeInMainWorld('gale', api)
