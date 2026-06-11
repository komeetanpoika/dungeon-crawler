const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const SAVE_DIR = path.join(app.getPath('userData'), 'dungeon-crawler')
const RUN_FILE = path.join(SAVE_DIR, 'run.json')
const META_FILE = path.join(SAVE_DIR, 'meta.json')
const RULESETS_FILE = path.join(__dirname, 'renderer', 'data', 'rulesets.json')

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(() => {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  createWindow()
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})

ipcMain.handle('save-meta', (_e, data) => fs.writeFileSync(META_FILE, JSON.stringify(data)))
ipcMain.handle('load-meta', () => {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch { return null }
})
ipcMain.handle('delete-run', () => { try { fs.unlinkSync(RUN_FILE) } catch {} })
ipcMain.handle('load-rulesets', () => {
  try { return JSON.parse(fs.readFileSync(RULESETS_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-rulesets', (_e, data) =>
  fs.writeFileSync(RULESETS_FILE, JSON.stringify(data, null, 2)))
