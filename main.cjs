const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// WSL2/WSLg: the hardware GPU process fails to initialize and can hang the
// app before any window appears — always use software rendering.
app.disableHardwareAcceleration()

const SAVE_DIR = path.join(app.getPath('userData'), 'dungeon-crawler')
const RUN_FILE = path.join(SAVE_DIR, 'run.json')
const META_FILE = path.join(SAVE_DIR, 'meta.json')
const RULESETS_FILE = path.join(__dirname, 'renderer', 'data', 'rulesets.json')
const PAINTER_MAPS_FILE = path.join(__dirname, 'renderer', 'data', 'painter-maps.json')
const STRUCTURES_FILE = path.join(__dirname, 'renderer', 'data', 'structures.json')
const TILES_DIR = path.join(__dirname, 'renderer', 'assets', 'tiles')

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

function createEditorWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'tools', 'tile-editor', 'editor-preload.cjs'),
      contextIsolation: true,
    },
  })
  win.loadFile('tools/tile-editor/index.html')
}

app.whenReady().then(() => {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  if (process.argv.includes('--editor')) createEditorWindow()
  else createWindow()
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})

ipcMain.handle('save-meta', (_e, data) => fs.writeFileSync(META_FILE, JSON.stringify(data)))
ipcMain.handle('load-meta', () => {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) } catch { return null }
})
ipcMain.handle('delete-run', () => { try { fs.unlinkSync(RUN_FILE) } catch {} })
ipcMain.handle('open-editor', () => createEditorWindow())
ipcMain.handle('quit-app', () => app.quit())
ipcMain.handle('load-rulesets', () => {
  try { return JSON.parse(fs.readFileSync(RULESETS_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-rulesets', (_e, data) =>
  fs.writeFileSync(RULESETS_FILE, JSON.stringify(data, null, 2)))

ipcMain.handle('load-painter-maps', () => {
  try { return JSON.parse(fs.readFileSync(PAINTER_MAPS_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-painter-maps', (_e, data) =>
  fs.writeFileSync(PAINTER_MAPS_FILE, JSON.stringify(data, null, 2)))

ipcMain.handle('load-structures', () => {
  try { return JSON.parse(fs.readFileSync(STRUCTURES_FILE, 'utf8')) } catch { return {} }
})
ipcMain.handle('save-structures', (_e, data) =>
  fs.writeFileSync(STRUCTURES_FILE, JSON.stringify(data, null, 2)))

ipcMain.handle('editor-list-tiles', () =>
  fs.readdirSync(TILES_DIR).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort())
ipcMain.handle('editor-read-tile', (_e, name) =>
  // data: URL so the editor canvas stays untainted (file:// images taint it)
  'data:image/png;base64,' +
  fs.readFileSync(path.join(TILES_DIR, `${path.basename(name)}.png`)).toString('base64'))
ipcMain.handle('editor-tile-exists', (_e, name) =>
  fs.existsSync(path.join(TILES_DIR, `${path.basename(name)}.png`)))
ipcMain.handle('editor-save-tile', (_e, name, dataURL) => {
  // Kenney originals are never writable: custom_ prefix is enforced here,
  // not just in the UI.
  if (!/^custom_[a-z0-9_]+$/.test(name)) throw new Error(`Invalid tile name: ${name}`)
  if (!String(dataURL).startsWith('data:image/png;base64,')) throw new Error('Expected PNG data URL')
  const b64 = String(dataURL).replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(path.join(TILES_DIR, `${name}.png`), Buffer.from(b64, 'base64'))
})
