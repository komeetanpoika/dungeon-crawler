const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saveAPI', {
  saveMeta: (data) => ipcRenderer.invoke('save-meta', data),
  loadMeta: () => ipcRenderer.invoke('load-meta'),
  deleteRun: () => ipcRenderer.invoke('delete-run'),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
})
