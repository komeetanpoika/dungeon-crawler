const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
  saveCaves: (data) => ipcRenderer.invoke('save-caves', data),
  loadCaves: () => ipcRenderer.invoke('load-caves'),
  saveTimewarp: (data) => ipcRenderer.invoke('save-timewarp', data),
  loadTimewarp: () => ipcRenderer.invoke('load-timewarp'),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  loadMonsters: () => ipcRenderer.invoke('load-monsters'),
  loadStructures: () => ipcRenderer.invoke('load-structures'),
  loadArenaConfig: () => ipcRenderer.invoke('load-arena-config'),
  openEditor: () => ipcRenderer.invoke('open-editor'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
})
