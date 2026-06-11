import { PixelEditor } from './pixel-editor.js'
import { dataURLToImageData, extractPalette } from './palette.js'
import { buildLibrary } from './library.js'
import { sanitizeTileName } from './lib.js'
import { initRulesUI } from './rules-ui.js'
import { renderSample } from './sample-preview.js'
import { textPrompt } from './text-prompt.js'

const drawView = document.getElementById('draw-view')
const rulesView = document.getElementById('rules-view')
const tabDraw = document.getElementById('tab-draw')
const tabRules = document.getElementById('tab-rules')
const saveTileBtn = document.getElementById('save-tile')
const saveRulesBtn = document.getElementById('save-rules')

function showTab(tab) {
  const draw = tab === 'draw'
  drawView.style.display = draw ? 'flex' : 'none'
  rulesView.style.display = draw ? 'none' : 'flex'
  tabDraw.classList.toggle('active', draw)
  tabRules.classList.toggle('active', !draw)
  saveTileBtn.style.display = draw ? '' : 'none'
  saveRulesBtn.style.display = draw ? 'none' : ''
}
tabDraw.addEventListener('click', () => showTab('draw'))
tabRules.addEventListener('click', () => showTab('rules'))
showTab('draw')

const preview1x = document.getElementById('preview-1x')
const preview3x = document.getElementById('preview-3x')

function renderPreviews() {
  const tile = pixelEditor.toCanvas()
  const c1 = preview1x.getContext('2d')
  c1.clearRect(0, 0, 16, 16)
  c1.drawImage(tile, 0, 0)
  const c3 = preview3x.getContext('2d')
  c3.imageSmoothingEnabled = false
  c3.clearRect(0, 0, 96, 96)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++)
    c3.drawImage(tile, x * 32, y * 32, 32, 32)
}

const pixelEditor = new PixelEditor(document.getElementById('pixel-canvas'), {
  onChange: renderPreviews,
  onPickColor: (hex) => setActiveColor(hex),
})

let activeColor = '#5a5a72ff'
function setActiveColor(hex) {
  activeColor = hex.length === 7 ? hex + 'ff' : hex
  pixelEditor.color = activeColor
  document.querySelectorAll('#palette .swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color === activeColor))
}

// Toolbar
document.querySelectorAll('#toolbar [data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    pixelEditor.tool = btn.dataset.tool
    document.querySelectorAll('#toolbar [data-tool]').forEach(b =>
      b.classList.toggle('active', b === btn))
  })
})
document.getElementById('undo').addEventListener('click', () => pixelEditor.undo())
document.getElementById('redo').addEventListener('click', () => pixelEditor.redo())
const wrapBtn = document.getElementById('wrap-toggle')
wrapBtn.addEventListener('click', () => {
  pixelEditor.wrap = !pixelEditor.wrap
  wrapBtn.textContent = pixelEditor.wrap ? '⟳ wrap ON' : '⟳ wrap OFF'
  wrapBtn.classList.toggle('on', pixelEditor.wrap)
})
document.getElementById('custom-color').addEventListener('input', e =>
  setActiveColor(e.target.value))

renderPreviews()

// Cache of name → ImageData for every tile on disk; reused by the library
// strip and load-as-base in later tasks.
const tileImageData = new Map()

// name → Image for the sample preview
const tileImages = new Map()

async function loadAllTiles() {
  const names = await window.editorAPI.listTiles()
  await Promise.all(names.map(async name => {
    const dataURL = await window.editorAPI.readTile(name)
    tileImageData.set(name, await dataURLToImageData(dataURL))
  }))
  return names
}

function renderPalette(colors) {
  const el = document.getElementById('palette')
  el.innerHTML = ''
  for (const color of colors) {
    const sw = document.createElement('div')
    sw.className = 'swatch'
    sw.dataset.color = color
    sw.style.background = color
    sw.addEventListener('click', () => setActiveColor(color))
    el.appendChild(sw)
  }
}

async function initTiles() {
  const names = await loadAllTiles()
  renderPalette(extractPalette([...tileImageData.values()]))
  return names
}

const tilesReady = initTiles()
tilesReady.catch(err => console.error('[tile-editor] palette load failed:', err))

let library
tilesReady.then(async names => {
  library = await buildLibrary(names, {
    onPick: (name) => {
      const data = tileImageData.get(name)
      if (data) pixelEditor.loadImageData(data)
      // Force a conscious new name — originals are never overwritten.
      document.getElementById('tile-name').value = ''
    },
  })
})

const state = { rulesets: {}, active: null }
const rulesetSelect = document.getElementById('ruleset-select')

function renderRulesetSelect() {
  rulesetSelect.innerHTML = ''
  for (const name of Object.keys(state.rulesets)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    opt.selected = name === state.active
    rulesetSelect.appendChild(opt)
  }
}

rulesetSelect.addEventListener('change', () => {
  state.active = rulesetSelect.value
  document.dispatchEvent(new Event('ruleset-changed'))
})

document.getElementById('new-ruleset').addEventListener('click', async () => {
  const name = ((await textPrompt('Ruleset name (e.g. catacombs):')) ?? '').trim().toLowerCase()
  if (!name) return
  if (!state.rulesets[name]) state.rulesets[name] = { tiles: {}, tags: {} }
  state.active = name
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
})

async function initRulesets() {
  state.rulesets = (await window.editorAPI.loadRulesets()) ?? {}
  state.active = Object.keys(state.rulesets)[0] ?? null
  renderRulesetSelect()
  document.dispatchEvent(new Event('ruleset-changed'))
}
initRulesets()

document.getElementById('save-tile').addEventListener('click', async () => {
  const name = sanitizeTileName(document.getElementById('tile-name').value)
  if (!name) { alert('Enter a tile name first.'); return }
  if (await window.editorAPI.tileExists(name) &&
      !confirm(`${name}.png already exists. Overwrite it?`)) return
  try {
    const dataURL = pixelEditor.toCanvas().toDataURL('image/png')
    await window.editorAPI.saveTile(name, dataURL)
    tileImageData.set(name, await dataURLToImageData(dataURL))
    tileImages.delete(name)
    if (library) library.add(name, dataURL)

    const tags = document.getElementById('tile-tags').value
      .split(',').map(s => s.trim()).filter(Boolean)
    const rs = state.rulesets[state.active]
    if (rs && tags.length) {
      rs.tiles[name] = { tags, weight: rs.tiles[name]?.weight ?? 1 }
      for (const tag of tags) {
        if (!rs.tags[tag]) {
          const role = tag.startsWith('wall') ? 'wall' : 'floor'
          rs.tags[tag] = { role, allow: ['*'], forbid: [], directional: {} }
        }
      }
      await window.editorAPI.saveRulesets(state.rulesets)
      document.dispatchEvent(new Event('ruleset-changed'))
      alert(`Saved ${name}.png and registered in '${state.active}'`)
    } else {
      alert(`Saved ${name}.png (no tags or no active ruleset — not registered in a ruleset)`)
    }
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
})

initRulesUI(state)

saveRulesBtn.addEventListener('click', async () => {
  try {
    await window.editorAPI.saveRulesets(state.rulesets)
    alert('Rules saved to renderer/data/rulesets.json')
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
})

async function imageFor(name) {
  if (!tileImages.has(name)) {
    const img = new Image()
    img.src = await window.editorAPI.readTile(name)
    await new Promise(res => { img.onload = res; img.onerror = res })
    tileImages.set(name, img)
  }
  return tileImages.get(name)
}

const sampleCanvas = document.getElementById('sample-canvas')
async function refreshSample() {
  const rs = state.rulesets[state.active]
  if (rs) await Promise.all(Object.keys(rs.tiles).map(imageFor))
  renderSample(sampleCanvas, rs, tileImages)
}

document.addEventListener('rules-edited', refreshSample)
document.addEventListener('ruleset-changed', refreshSample)
document.getElementById('reroll').addEventListener('click', refreshSample)
