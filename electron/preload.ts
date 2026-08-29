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
  }
}

contextBridge.exposeInMainWorld('gale', api)
