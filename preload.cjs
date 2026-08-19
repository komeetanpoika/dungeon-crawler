const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
  saveCaves: (data) => ipcRenderer.invoke('save-caves', data),
  loadCaves: () => ipcRenderer.invoke('load-caves'),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  loadStructures: () => ipcRenderer.invoke('load-structures'),
  loadArenaConfig: () => ipcRenderer.invoke('load-arena-config'),
  openEditor: () => ipcRenderer.invoke('open-editor'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
})
