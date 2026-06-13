import { TEMPLATE_LEGEND, TEMPLATES as BUILTIN_TEMPLATES } from '../../renderer/data/levels.js'
import { createBlankGrid, resizeGrid, gridToTemplate, gridFromTemplate, sanitizeTemplateName } from './template-grid.js'
import { textPrompt } from './text-prompt.js'

const CELL = 22  // px per cell on the canvas

export function initTemplateBuilder() {
  const canvas = document.getElementById('template-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('build-palette')
  const wInput = document.getElementById('template-w')
  const hInput = document.getElementById('template-h')

  const state = {
    grid: createBlankGrid(Number(wInput.value), Number(hInput.value)),
    active: '.',          // default paint symbol = floor
    painting: false,
  }
  // Exposed so Task 7 (save/load) can reach the grid + helpers.
  initTemplateBuilder.state = state
  initTemplateBuilder.setGrid = (g) => { state.grid = g; sizeCanvas(); render() }

  function sizeCanvas() {
    canvas.width = state.grid[0].length * CELL
    canvas.height = state.grid.length * CELL
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${CELL - 6}px monospace`
    state.grid.forEach((row, y) => row.forEach((ch, x) => {
      const e = TEMPLATE_LEGEND[ch] ?? TEMPLATE_LEGEND['.']
      ctx.fillStyle = e.color
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
      ctx.strokeStyle = '#0008'
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
      if (e.icon) { ctx.fillStyle = '#fff'; ctx.fillText(e.icon, x * CELL + CELL / 2, y * CELL + CELL / 2 + 1) }
    }))
  }

  function renderPalette() {
    paletteEl.innerHTML = ''
    for (const [ch, e] of Object.entries(TEMPLATE_LEGEND)) {
      const row = document.createElement('div')
      row.className = 'legend' + (ch === state.active ? ' active' : '')
      row.dataset.ch = ch
      const sw = document.createElement('div')
      sw.className = 'sw'
      sw.style.background = e.color
      const label = document.createElement('span')
      label.textContent = `${e.icon ?? ch} ${e.label}`
      row.append(sw, label)
      row.addEventListener('click', () => {
        state.active = ch
        paletteEl.querySelectorAll('.legend').forEach(n =>
          n.classList.toggle('active', n.dataset.ch === ch))
      })
      paletteEl.appendChild(row)
    }
  }

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    const x = Math.floor((ev.clientX - r.left) / CELL)
    const y = Math.floor((ev.clientY - r.top) / CELL)
    return { x, y }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (state.grid[y]?.[x] === undefined) return
    state.grid[y][x] = state.active
    render()
  }
  canvas.addEventListener('mousedown', e => { state.painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (state.painting) paint(e) })
  window.addEventListener('mouseup', () => { state.painting = false })

  document.getElementById('template-resize').addEventListener('click', () => {
    const w = Math.max(1, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(1, Math.min(40, Number(hInput.value) | 0))
    state.grid = resizeGrid(state.grid, w, h)
    sizeCanvas(); render()
  })

  renderPalette()
  sizeCanvas()
  render()

  const listEl = document.getElementById('template-list')
  const nameInput = document.getElementById('template-name')
  let custom = {}   // name -> template, from templates.json

  async function loadTemplates() {
    custom = (await window.editorAPI.loadTemplates()) ?? {}
    renderList()
  }

  function loadIntoEditor(tmpl, name) {
    state.grid = gridFromTemplate(tmpl)
    wInput.value = tmpl.width
    hInput.value = tmpl.height
    nameInput.value = name && !BUILTIN_TEMPLATES[name] ? name : ''  // force a new name for built-ins
    sizeCanvas(); render()
  }

  function renderList() {
    listEl.innerHTML = ''
    const builtin = Object.keys(BUILTIN_TEMPLATES).filter(n => !custom[n])
    const entries = [
      ...builtin.map(n => ({ name: n, tmpl: BUILTIN_TEMPLATES[n], builtin: true })),
      ...Object.keys(custom).map(n => ({ name: n, tmpl: custom[n], builtin: false })),
    ]
    for (const { name, tmpl, builtin } of entries) {
      const row = document.createElement('div')
      row.className = 'trow' + (builtin ? ' builtin' : '')
      row.textContent = builtin ? `${name} (built-in)` : name
      row.addEventListener('click', () => loadIntoEditor(tmpl, name))
      listEl.appendChild(row)
    }
  }

  initTemplateBuilder.save = async function save() {
    const name = sanitizeTemplateName(nameInput.value)
    if (!name) { alert('Enter a template name first.'); return }
    if (BUILTIN_TEMPLATES[name]) {
      alert(`'${name}' is a built-in template name and cannot be overwritten. Choose another name.`)
      return
    }
    if (custom[name]) {
      const ok = await textPrompt(`'${name}' already exists. Type the name again to overwrite, or Cancel.`)
      if (ok !== name) return
    }
    custom[name] = gridToTemplate(state.grid)
    try {
      await window.editorAPI.saveTemplates(custom)
      renderList()
      alert(`Saved template '${name}' to renderer/data/templates.json`)
    } catch (err) {
      delete custom[name]
      alert(`Save failed: ${err.message}`)
    }
  }

  loadTemplates()
}
