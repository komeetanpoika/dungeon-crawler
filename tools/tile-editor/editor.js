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

import { PixelEditor } from './pixel-editor.js'

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
