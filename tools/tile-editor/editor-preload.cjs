const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('editorAPI', {
  listTiles:    () => ipcRenderer.invoke('editor-list-tiles'),
  readTile:     (name) => ipcRenderer.invoke('editor-read-tile', name),
  tileExists:   (name) => ipcRenderer.invoke('editor-tile-exists', name),
  saveTile:     (name, dataURL) => ipcRenderer.invoke('editor-save-tile', name, dataURL),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  saveRulesets: (data) => ipcRenderer.invoke('save-rulesets', data),
  loadTemplates: () => ipcRenderer.invoke('load-templates'),
  saveTemplates: (data) => ipcRenderer.invoke('save-templates', data),
})
