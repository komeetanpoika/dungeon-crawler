const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  loadStructures: () => ipcRenderer.invoke('load-structures'),
  openEditor: () => ipcRenderer.invoke('open-editor'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
})
