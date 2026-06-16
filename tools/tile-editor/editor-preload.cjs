const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('editorAPI', {
  listTiles:    () => ipcRenderer.invoke('editor-list-tiles'),
  readTile:     (name) => ipcRenderer.invoke('editor-read-tile', name),
  tileExists:   (name) => ipcRenderer.invoke('editor-tile-exists', name),
  saveTile:     (name, dataURL) => ipcRenderer.invoke('editor-save-tile', name, dataURL),
  loadRulesets: () => ipcRenderer.invoke('load-rulesets'),
  saveRulesets: (data) => ipcRenderer.invoke('save-rulesets', data),
  loadPainterMaps: () => ipcRenderer.invoke('load-painter-maps'),
  savePainterMaps: (data) => ipcRenderer.invoke('save-painter-maps', data),
  loadStructures: () => ipcRenderer.invoke('load-structures'),
  saveStructures: (data) => ipcRenderer.invoke('save-structures', data),
})
