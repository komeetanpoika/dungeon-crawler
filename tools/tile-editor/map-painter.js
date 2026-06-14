// Build tab: paint a room with real tile sprites on two layers (base + overlay),
// tag them, then derive base-skin rules AND overlay placement rules from the
// painting into the active ruleset. Deps come from editor.js:
//   state      - { rulesets, active } shared ruleset state
//   imageFor   - async (name) => HTMLImageElement (cached)
//   tilesReady - Promise<string[]> of all library tile names

import { deriveRules } from './derive-rules.js'
import { renderSample } from './sample-preview.js'

// Merge a derived fragment into a ruleset: overwrite tile weights/tags and each
// painted tag's role + adjacency (+ overlays on base tags), but preserve any
// hand-authored allow/forbid/directional on tags that already exist. Unpainted
// tags are left untouched.
function mergeFragment(ruleset, frag) {
  ruleset.tiles = ruleset.tiles ?? {}
  ruleset.tags = ruleset.tags ?? {}
  for (const [name, def] of Object.entries(frag.tiles)) ruleset.tiles[name] = def
  for (const [tag, def] of Object.entries(frag.tags)) {
    const existing = ruleset.tags[tag]
    if (!existing) { ruleset.tags[tag] = def; continue }
    const merged = { ...existing, role: def.role, adjacency: def.adjacency }
    if (def.overlays) merged.overlays = def.overlays
    ruleset.tags[tag] = merged
  }
}

const CELL = 26  // px per cell on the paint canvas

export function initMapPainter({ state, imageFor, tilesReady }) {
  const canvas = document.getElementById('paint-canvas')
  const ctx = canvas.getContext('2d')
  const paletteEl = document.getElementById('paint-palette')
  const wInput = document.getElementById('paint-w')
  const hInput = document.getElementById('paint-h')

  const blank = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => null))
  const grid = {
    base: blank(Number(wInput.value), Number(hInput.value)),
    overlay: blank(Number(wInput.value), Number(hInput.value)),
  }
  let active = null          // active brush tile name; null = eraser
  let layer = 'base'         // 'base' | 'overlay' — which grid the brush writes
  let painting = false
  const images = new Map()   // name -> Image

  function sizeCanvas() {
    canvas.width = grid.base[0].length * CELL
    canvas.height = grid.base.length * CELL
  }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    for (let y = 0; y < grid.base.length; y++) {
      for (let x = 0; x < grid.base[y].length; x++) {
        ctx.fillStyle = '#15151d'
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        const b = grid.base[y][x], bi = b && images.get(b)
        if (bi) ctx.drawImage(bi, x * CELL, y * CELL, CELL, CELL)
        const o = grid.overlay[y][x], oi = o && images.get(o)
        if (oi) ctx.drawImage(oi, x * CELL, y * CELL, CELL, CELL)
        ctx.strokeStyle = layer === 'overlay' ? '#7fd6' : '#0006'
        ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL)
      }
    }
  }
  function gridUses(name) {
    return grid.base.some(r => r.includes(name)) || grid.overlay.some(r => r.includes(name))
  }
  async function ensureImage(name) {
    if (!name || images.has(name)) return
    images.set(name, await imageFor(name))
    if (gridUses(name)) render()
  }

  function markActive(name) {
    paletteEl.querySelectorAll('img').forEach(i => i.classList.toggle('active', i.dataset.name === name))
  }
  function setActive(name) {
    active = name
    markActive(name)
    if (name) ensureImage(name)
    renderTagging()
  }

  // Append one tile thumbnail to the palette (skip if already present), so a
  // tile saved in the Draw tab shows up here without restarting the editor.
  async function addPaletteTile(name) {
    if (paletteEl.querySelector(`img[data-name="${CSS.escape(name)}"]`)) return
    const img = document.createElement('img')
    img.src = await window.editorAPI.readTile(name)
    img.title = name
    img.dataset.name = name
    img.addEventListener('click', () => setActive(name))
    paletteEl.appendChild(img)
  }
  async function buildPalette(names) {
    paletteEl.innerHTML = ''
    const erase = document.createElement('button')
    erase.className = 'erase'
    erase.textContent = '✖ erase'
    erase.addEventListener('click', () => setActive(null))
    paletteEl.appendChild(erase)
    for (const name of names) await addPaletteTile(name)
  }
  // A tile saved elsewhere in the editor (Draw tab) becomes paintable here.
  document.addEventListener('tile-saved', e => { addPaletteTile(e.detail.name) })

  function setLayer(which) {
    layer = which
    document.getElementById('layer-base').classList.toggle('on', which === 'base')
    document.getElementById('layer-overlay').classList.toggle('on', which === 'overlay')
    render()
  }
  document.getElementById('layer-base').addEventListener('click', () => setLayer('base'))
  document.getElementById('layer-overlay').addEventListener('click', () => setLayer('overlay'))

  function cellAt(ev) {
    const r = canvas.getBoundingClientRect()
    return { x: Math.floor((ev.clientX - r.left) / CELL), y: Math.floor((ev.clientY - r.top) / CELL) }
  }
  function paint(ev) {
    const { x, y } = cellAt(ev)
    if (grid[layer][y]?.[x] === undefined) return
    grid[layer][y][x] = active   // active === null erases the active layer's slot
    render()
  }
  canvas.addEventListener('mousedown', e => { painting = true; paint(e) })
  canvas.addEventListener('mousemove', e => { if (painting) paint(e) })
  window.addEventListener('mouseup', () => { painting = false })

  document.getElementById('paint-resize').addEventListener('click', () => {
    const w = Math.max(2, Math.min(60, Number(wInput.value) | 0))
    const h = Math.max(2, Math.min(40, Number(hInput.value) | 0))
    const resize = (g) => Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => g[y]?.[x] ?? null))
    grid.base = resize(grid.base)
    grid.overlay = resize(grid.overlay)
    sizeCanvas(); render()
  })

  const taggingEl = document.getElementById('paint-tagging')
  const reportEl = document.getElementById('derive-report')
  const previewCanvas = document.getElementById('paint-preview')

  function ensureRuleset() {
    if (!state.active) {
      state.active = 'derived'
      document.dispatchEvent(new Event('ruleset-changed'))
    }
    state.rulesets[state.active] = state.rulesets[state.active] ?? { tiles: {}, tags: {} }
    return state.rulesets[state.active]
  }

  // Inline role+tag assignment for the active brush tile (role includes overlay).
  function renderTagging() {
    taggingEl.innerHTML = ''
    if (!active) { taggingEl.textContent = 'Pick a tile to tag…'; return }
    const rs = state.rulesets[state.active]
    const curTag = rs?.tiles?.[active]?.tags?.[0] ?? ''
    const lbl = document.createElement('div')
    lbl.className = 'label'
    lbl.textContent = `Tag ${active}` + (curTag ? ` (now: ${curTag})` : ' (untagged)')
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option'); o.value = o.textContent = r; roleSel.appendChild(o)
    }
    if (curTag && rs?.tags?.[curTag]?.role) roleSel.value = rs.tags[curTag].role
    const tagInput = document.createElement('input')
    tagInput.placeholder = 'overlay.barrel'; tagInput.value = curTag; tagInput.style.width = '100%'
    const apply = document.createElement('button')
    apply.textContent = 'apply tag'
    apply.addEventListener('click', () => {
      const tag = tagInput.value.trim()
      if (!tag) return
      const r = ensureRuleset()
      r.tiles[active] = { tags: [tag], weight: r.tiles[active]?.weight ?? 1 }
      if (!r.tags[tag]) {
        r.tags[tag] = { role: roleSel.value, allow: ['*'], forbid: [], directional: {}, adjacency: { n: {}, e: {}, s: {}, w: {} } }
      } else {
        r.tags[tag].role = roleSel.value
      }
      renderTagging()
    })
    taggingEl.append(lbl, roleSel, tagInput, apply)
  }

  function tileMetaFromRuleset(rs) {
    const meta = new Map()
    for (const [name, def] of Object.entries(rs.tiles ?? {})) {
      const tag0 = def.tags?.[0]
      const role = tag0 && rs.tags?.[tag0]?.role
      if (def.tags?.length && role) meta.set(name, { role, tags: def.tags })
    }
    return meta
  }

  async function refreshPreview() {
    const rs = state.rulesets[state.active]
    if (!rs) return
    await Promise.all(Object.keys(rs.tiles ?? {}).map(ensureImage))
    renderSample(previewCanvas, rs, images)
  }

  document.getElementById('derive-btn').addEventListener('click', async () => {
    const rs = state.rulesets[state.active]
    if (!rs) { reportEl.textContent = 'Select or create a ruleset first (top bar).'; return }
    const frag = deriveRules(grid.base, grid.overlay, tileMetaFromRuleset(rs))
    if (Object.keys(frag.tiles).length === 0) {
      reportEl.textContent = 'Nothing derived — paint some tagged tiles first.' +
        (frag.skipped ? ` (${frag.skipped} untagged cells skipped)` : '')
      return
    }
    mergeFragment(rs, frag)
    try {
      await window.editorAPI.saveRulesets(state.rulesets)
      document.dispatchEvent(new Event('ruleset-changed'))
      const adj = Object.values(frag.tags).reduce((s, t) =>
        s + ['n', 'e', 's', 'w'].reduce((a, d) => a + Object.keys(t.adjacency[d]).length, 0), 0)
      reportEl.textContent =
        `Derived ${Object.keys(frag.tiles).length} tiles, ${Object.keys(frag.tags).length} tags, ${adj} adjacencies` +
        (frag.skipped ? ` — ${frag.skipped} untagged cells skipped` : '')
      refreshPreview()
    } catch (err) {
      reportEl.textContent = `Save failed: ${err.message}`
    }
  })
  document.getElementById('paint-reroll').addEventListener('click', refreshPreview)

  tilesReady.then(buildPalette).catch(err => console.error('[map-painter] palette load failed:', err))
  sizeCanvas()
  render()
}
