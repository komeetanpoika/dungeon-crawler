// Build tab: paint a room with real tile sprites, then derive adjacency rules
// from it (derive/tagging/preview added in a later step). Deps come from
// editor.js: { state, imageFor, tilesReady }.
//   state      - { rulesets, active } shared ruleset state
//   imageFor   - async (name) => HTMLImageElement (cached)
//   tilesReady - Promise<string[]> of all library tile names

const CELL = 26  // px per cell on the paint canvas

export function initMapPainter({ state, imageFor, tilesReady }) {
  const canvas = document.getElementById('paint-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('paint-palette')
  const wInput = document.getElementById('paint-w')
  const hInput = document.getElementById('paint-h')

  const blank = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => null))
  const grid = { cells: blank(Number(wInput.value), Number(hInput.value)) }
  let active = null          // active brush tile name; null = eraser
  let painting = false
  const images = new Map()   // name -> Image

  function sizeCanvas() {
    canvas.width = grid.cells[0].length * CELL
    canvas.height = grid.cells.length * CELL
  }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    grid.cells.forEach((row, y) => row.forEach((name, x) => {
      ctx.fillStyle = '#15151d'
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
      const img = name && images.get(name)
      if (img) ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL)
      ctx.strokeStyle = '#0006'
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
    }))
  }
  async function ensureImage(name) {
    if (!name || images.has(name)) return
    images.set(name, await imageFor(name))
    render()
  }

  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
  }
  function setActive(name) {
    active = name
    markActive(name)
    if (name) ensureImage(name)
  }

  async function buildPalette(names) {
    paletteEl.innerHTML = ''
    const erase = document.createElement('button')
    erase.className = 'erase'
    erase.textContent = '✖ erase'
    erase.addEventListener('click', () => setActive(null))
    paletteEl.appendChild(erase)
    for (const name of names) {
      const img = document.createElement('img')
      img.src = await window.editorAPI.readTile(name)
      img.title = name
      img.dataset.name = name
      img.addEventListener('click', () => setActive(name))
      paletteEl.appendChild(img)
    }
  }

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    return { x: Math.floor((ev.clientX - r.left) / CELL), y: Math.floor((ev.clientY - r.top) / CELL) }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid.cells[y]?.[x] === undefined) return
    grid.cells[y][x] = active   // active === null erases
    render()
  }
  canvas.addEventListener('mousedown', e => { painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (painting) paint(e) })
  window.addEventListener('mouseup', () => { painting = false })

  document.getElementById('paint-resize').addEventListener('click', () => {
    const w = Math.max(2, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(2, Math.min(40, Number(hInput.value) | 0))
    grid.cells = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => grid.cells[y]?.[x] ?? null))
    sizeCanvas(); render()
  })

  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
}
