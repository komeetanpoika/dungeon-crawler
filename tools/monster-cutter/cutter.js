// The monster cutter page: wiring only. State and undo history live here;
// pure edits come from cut-model.js, drawing from overlay.js, the editor's
// pointer tools from interact.js, the side-panel lists from panels.js and the
// live preview from preview-pane.js.
import { autoMask, applyStrokes, keepMain, decodeMask } from './mask.js'
import { validateCut } from './cut-format.js'
import { segment } from './segment.js'
import { findPieces } from './finder.js'
import * as M from './cut-model.js'
import { buildLayer, drawEditor, PALETTE, hexRgb } from './overlay.js'
import { makeView, fitView, attachEditor } from './interact.js'
import { renderPieces, renderPoints, renderWarnings, ask } from './panels.js'
import { makePreviewPane } from './preview-pane.js'
import { toast } from '/tools/tile-editor/toast.js'

const $ = id => document.getElementById(id)
const NAME_RE = /^[a-z0-9_]+$/
const HISTORY = 100

const S = {
  src: null, cut: null, savedCut: null,
  mask: null, maskRuns: null, maskDirty: false, // the decoded cut.mask (ahead of it while a brush stroke runs)
  strokes: [], invert: false, tolerance: 40,     // how the mask was made, so a new tolerance keeps the brushwork
  seg: null, leaks: new Set(), behind: [],
  selected: null, tool: 'edit', brush: 12, pointName: 'head',
  split: null, cursor: null, hot: null, discs: null,
  undo: [], redo: [], showTint: true, showRemoved: true,
}
const colours = new Map() // piece id -> colour, stable while an image is open
const colourOf = id => { if (!colours.has(id)) colours.set(id, PALETTE[colours.size % PALETTE.length]); return colours.get(id) }
const view = makeView()
const srcCanvas = document.createElement('canvas'), layerCanvas = document.createElement('canvas')
const canvas = $('editor'), wrap = $('canvas-wrap'), ectx = canvas.getContext('2d')
let cssW = 0, cssH = 0

// ---- drawing and recompute ----
let drawQueued = false
function redraw() {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    drawEditor(ectx, { cssW, cssH, view, layer: layerCanvas, cut: S.cut, leaks: S.leaks, selected: S.selected, hot: S.hot,
      colourOf, tool: S.tool, cursor: S.cursor, brush: S.brush, split: S.split, discs: S.discs })
  })
}
new ResizeObserver(() => {
  const r = wrap.getBoundingClientRect(), dpr = devicePixelRatio || 1
  cssW = r.width; cssH = r.height
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`
  ectx.setTransform(dpr, 0, 0, dpr, 0, 0)
  redraw()
}).observe(wrap)
const fit = () => { if (S.cut) { fitView(view, S.cut.w, S.cut.h, cssW, cssH); redraw() } }

function syncMask() {
  if (S.maskDirty || S.maskRuns === S.cut.mask) return
  S.mask = decodeMask(S.cut.mask, S.cut.w * S.cut.h)
  S.maskRuns = S.cut.mask
}

let segTimer = null
const scheduleSegment = () => { clearTimeout(segTimer); segTimer = setTimeout(recompute, 90) }
function recompute() {
  clearTimeout(segTimer)
  if (!S.cut) return
  syncMask()
  const { w, h, pieces } = S.cut
  S.seg = segment(S.mask, w, h, pieces)
  S.leaks = new Set(S.seg.leaks)
  S.behind = M.behindClaims(S.cut, S.seg.base)
  layerCanvas.width = w; layerCanvas.height = h
  const rgba = buildLayer(S.src, S.mask, S.seg.owner, pieces.map(p => hexRgb(colourOf(p.id))), { tint: S.showTint, showRemoved: S.showRemoved })
  layerCanvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0)
  refreshPanels()
  redraw()
}
const pixelOf = (arr, [x, y]) => {
  if (!S.seg || x < 0 || y < 0 || x >= S.cut.w || y >= S.cut.h) return -1
  const o = arr[y * S.cut.w + x]
  return o < S.cut.pieces.length ? o : -1
}
const ownerAt = xy => pixelOf(S.seg?.owner, xy)
const baseAt = xy => pixelOf(S.seg?.base, xy)

// ---- history: every change is a new cut; a drag is one undo step ----
const snap = () => ({ cut: S.cut, strokes: S.strokes, invert: S.invert, tolerance: S.tolerance })
let pending = null
function pushUndo(entry) { S.undo.push(entry); if (S.undo.length > HISTORY) S.undo.shift(); S.redo = [] }
function changed() { recompute(); schedulePreview(); syncControls() }
function begin() { if (!pending) pending = snap() }
function preview(cut) { S.cut = cut; scheduleSegment(); redraw() }
function end() {
  if (S.maskDirty) { S.maskDirty = false; S.cut = M.setMask(S.cut, S.mask); S.maskRuns = S.cut.mask }
  S.discs = null
  const before = pending
  pending = null
  if (before && (before.cut !== S.cut || before.strokes !== S.strokes || before.invert !== S.invert)) pushUndo(before)
  changed()
}
function commit(cut) { pushUndo(snap()); S.cut = cut; changed() }
const act = fn => {
  try { commit(fn(S.cut)); return true } catch (err) { toast(err.message, 'error'); syncControls(); refreshPanels(); return false }
}
function restore(entry) {
  Object.assign(S, entry)
  if (!S.cut.pieces.some(p => p.id === S.selected)) S.selected = null
  changed()
}
function undo() { if (!pending && S.undo.length) { S.redo.push(snap()); restore(S.undo.pop()) } }
function redo() { if (!pending && S.redo.length) { S.undo.push(snap()); restore(S.redo.pop()) } }
const dirty = () => !!S.cut && S.undo.length > 0 && S.cut !== S.savedCut

// ---- the background mask ----
function guessMask(src, tolerance, invert) {
  let m = autoMask(src, { tolerance })
  if (invert) m = m.map(v => 1 - v)
  return keepMain(m, src.w, src.h, Math.round(Math.max(src.w, src.h) * 0.02))
}
function rebuildMask() {
  const m = applyStrokes(guessMask(S.src, S.tolerance, S.invert), S.src.w, S.src.h, S.strokes)
  S.maskDirty = false
  preview(M.setMask(S.cut, m))
}
function paintMask(discs) {
  syncMask()
  S.mask = applyStrokes(S.mask, S.cut.w, S.cut.h, discs)
  S.maskDirty = true
  S.strokes = [...S.strokes, ...discs]
  S.discs = [...(S.discs ?? []), ...discs]
  scheduleSegment()
}
let tolTimer = null
$('tolerance').oninput = e => {
  if (!S.cut) return
  begin()
  S.tolerance = Number(e.target.value)
  $('tolerance-val').value = S.tolerance
  clearTimeout(tolTimer); tolTimer = setTimeout(rebuildMask, 120)
}
$('tolerance').onchange = () => { if (S.cut) { clearTimeout(tolTimer); rebuildMask(); end() } }
$('invert').onclick = () => { if (S.cut) { begin(); S.invert = !S.invert; rebuildMask(); end() } }
$('show-removed').onchange = e => { S.showRemoved = e.target.checked; recompute() }
$('tint').onchange = e => { S.showTint = e.target.checked; recompute() }

// ---- pieces and points ----
function withAutoPieces(cut) {
  const { w, h } = cut
  const pieces = findPieces(S.mask, w, h)
  let out = M.replacePieces(cut, pieces)
  const { owner } = segment(S.mask, w, h, pieces)
  for (const [name, pt] of Object.entries(M.guessPoints(S.mask, w, h, pieces, owner))) out = M.setPoint(out, name, pt.piece, [pt.x, pt.y])
  return out
}
$('auto').onclick = async () => {
  if (!S.cut) return
  if (!(await ask('Replace every piece with a fresh automatic guess? Your cut lines, labels and claims go (Undo brings them back), and head and chest are re-placed.', 'Replace pieces'))) return
  syncMask()
  commit(withAutoPieces(S.cut))
  select(null)
  hint(`Auto found ${S.cut.pieces.length} pieces.`)
}
function select(id) {
  S.selected = id
  refreshPanels()
  if (S.tool === 'claim') setTool('claim')
  redraw()
}
function merge(id) {
  const p = S.cut.pieces.find(q => q.id === id)
  if (p && act(c => M.mergePiece(c, id))) select(p.parent)
}
const pieceActs = {
  select,
  merge,
  role: (id, role, side) => act(c => M.setRole(c, id, role, side)),
  z: (id, z) => act(c => M.setZ(c, id, z)),
  clearClaims: id => act(c => M.clearClaims(c, id)),
}
const pointActs = {
  place: name => { S.pointName = name; setTool('point') },
  remove: name => act(c => M.removePoint(c, name)),
}
$('add-point').onclick = () => {
  const name = $('point-name').value.trim()
  if (!NAME_RE.test(name)) return toast('point names use lowercase letters, digits and _', 'error')
  $('point-name').value = ''
  pointActs.place(name)
}
$('point-name').onkeydown = e => { if (e.key === 'Enter') $('add-point').click() }
function placePoint(xy) {
  const o = ownerAt(xy)
  if (o < 0) return hint(`Click on the monster: "${S.pointName}" has to sit on a piece.`, 'warn')
  const id = S.cut.pieces[o].id
  if (act(c => M.setPoint(c, S.pointName, id, xy))) hint(`Placed "${S.pointName}" on ${id}; it moves with that piece.`)
}
function finishSplit(seed) {
  const b = baseAt(seed)
  if (b < 0) return hint('Click on the monster, on the side of the line that becomes the new piece.', 'warn')
  const parentId = S.cut.pieces[b].id
  const { cut, id } = M.splitPiece(S.cut, parentId, [S.split.a, S.split.b], seed)
  S.split = null
  commit(cut)
  setTool('edit')
  select(id)
  if (S.leaks.has(id)) hint(`${id}'s line doesn't cut all the way across ${parentId}: drag its round ends past the outline.`, 'warn')
  else hint(`Cut ${id} off ${parentId}. Give it a role in the list, and drag its ring to the joint.`)
}
function refreshPanels() {
  if (!S.cut) return
  renderWarnings($('warnings'), { leaks: S.leaks, behind: S.behind })
  renderPieces($('pieces'), { cut: S.cut, leaks: S.leaks, selected: S.selected, colourOf }, pieceActs)
  renderPoints($('points'), { cut: S.cut, active: S.tool === 'point' ? S.pointName : null }, pointActs)
}

// ---- tools, status bar, controls ----
const TOOL_HINTS = {
  edit: () => 'Drag the round cut ends, the rings (joints) and the square seeds. Click a piece to select it. Wheel zooms, right-drag pans.',
  keep: () => 'Paint over parts of the monster the background guess removed. [ ] change the brush.',
  erase: () => 'Paint away background the guess kept. [ ] change the brush.',
  split: () => 'Drag a line across the part you want to cut off.',
  claim: () => S.selected ? `Paint pixels over to ${S.selected}, for bits a straight cut can't reach.` : 'Select the piece that should take the pixels first (click it in the list).',
  point: () => `Click on the monster to place "${S.pointName}". It moves with the piece under it.`,
}
function hint(msg, kind = '') { $('hint').textContent = msg; $('hint').className = kind }
function setTool(t) {
  S.tool = t
  if (t !== 'split') S.split = null
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t)
  $('point-tool').firstChild.textContent = `Point: ${S.pointName} `
  canvas.style.cursor = t === 'edit' ? 'default' : 'crosshair'
  hint(TOOL_HINTS[t](), t === 'claim' && !S.selected ? 'warn' : '')
  refreshPanels()
  redraw()
}
for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool)
function setBrush(r) {
  S.brush = Math.max(1, Math.min(256, Math.round(r)))
  $('brush').value = S.brush; $('brush-val').value = S.brush
  redraw()
}
$('brush').oninput = e => setBrush(Number(e.target.value))
$('undo').onclick = undo
$('redo').onclick = redo
$('fit').onclick = fit
$('view').onchange = e => act(c => M.setView(c, e.target.value))
$('faces').onchange = e => act(c => M.setFaces(c, e.target.value))
$('out-height').onchange = e => act(c => M.setOutHeight(c, Number(e.target.value)))
$('outline').onchange = e => act(c => M.setOutline(c, e.target.value))
$('outline-auto').onchange = e => act(c => M.setOutline(c, e.target.checked ? null : $('outline').value))

function syncControls() {
  if (!S.cut) return
  $('tolerance').value = S.tolerance; $('tolerance-val').value = S.tolerance
  $('invert').classList.toggle('active', S.invert)
  $('view').value = S.cut.view; $('faces').value = S.cut.faces
  $('out-height').value = S.cut.outHeight
  $('outline-auto').checked = S.cut.outline === null
  if (S.cut.outline) $('outline').value = S.cut.outline.length === 4 ? '#' + [...S.cut.outline.slice(1)].map(c => c + c).join('') : S.cut.outline
  $('undo').disabled = !S.undo.length; $('redo').disabled = !S.redo.length
  $('save').textContent = dirty() ? 'Save cut •' : 'Save cut'
}

// ---- opening an image or a saved cut ----
function loadSource(img, w, h) {
  srcCanvas.width = w; srcCanvas.height = h
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  S.src = { w, h, rgba: ctx.getImageData(0, 0, w, h).data }
}
function startSession(cut, { saved }) {
  colours.clear()
  Object.assign(S, { cut, savedCut: saved ? cut : null, maskRuns: null, maskDirty: false, undo: [], redo: [],
    selected: null, split: null, discs: null })
  pending = null
  $('layout').classList.add('has-image')
  setBrush(Math.max(2, Math.round(Math.max(cut.w, cut.h) * 0.02)))
  fit()
  changed()
  previewNow()
  setTool('edit')
}
const discardOk = async () => !dirty() || ask('Discard the unsaved changes to this cut?', 'Discard')
const suggestName = file => file.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'monster'

async function openFile(file) {
  if (!file) return
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast(`${file.name} is not a PNG, JPEG or WebP`, 'error')
  if (!(await discardOk())) return
  let bmp
  try { bmp = await createImageBitmap(file) } catch { return toast(`could not decode ${file.name}`, 'error') }
  const fitted = M.fitSize(bmp.width, bmp.height)
  loadSource(bmp, fitted.w, fitted.h)
  const name = suggestName(file.name)
  $('name').value = name
  $('image-info').textContent = `${file.name} · ${fitted.w}×${fitted.h}${fitted.scale < 1 ? ` (shrunk from ${bmp.width}×${bmp.height})` : ''}`
  Object.assign(S, { strokes: [], invert: false })
  S.mask = guessMask(S.src, S.tolerance, false)
  S.maskRuns = null
  const blank = [{ id: 'torso', role: 'torso', side: null, parent: null, seed: [0, 0], cut: null, pivot: [0, 0], z: 0, claims: [] }]
  startSession(withAutoPieces(M.newCut({ name, w: fitted.w, h: fitted.h, mask: S.mask, pieces: blank })), { saved: false })
  hint(`Found ${S.cut.pieces.length} pieces. Check the background, then fix any cut that looks wrong; the preview on the right walks.`)
}
for (const id of ['file', 'file2']) $(id).onchange = e => { openFile(e.target.files[0]); e.target.value = '' }
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => e.preventDefault())
wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop') })
wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'))
wrap.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('drop'); openFile(e.dataTransfer.files[0]) })

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error(`could not load ${url}`))
  img.src = url
})
async function reopen(name) {
  $('reopen').value = ''
  if (!name || !(await discardOk())) return
  try {
    const res = await fetch(`/assets/cuts/${encodeURIComponent(name)}.json?t=${Date.now()}`)
    if (!res.ok) throw new Error(`assets/cuts/${name}.json: ${res.status}`)
    const cut = await res.json()
    const errs = validateCut(cut)
    if (errs.length) throw new Error(errs.join('; '))
    const img = await loadImage(`/${cut.source}?t=${Date.now()}`)
    if (img.naturalWidth !== cut.w || img.naturalHeight !== cut.h) throw new Error(`its source is ${img.naturalWidth}×${img.naturalHeight}, the cut ${cut.w}×${cut.h}`)
    loadSource(img, cut.w, cut.h)
    $('name').value = name
    $('image-info').textContent = `${cut.source} · ${cut.w}×${cut.h}`
    Object.assign(S, { strokes: [], invert: false })
    startSession(cut, { saved: true })
    hint(`Reopened ${name}. Moving the tolerance re-guesses the background from the image.`)
  } catch (err) { toast(`could not reopen ${name}: ${err.message}`, 'error') }
}
$('reopen').onchange = e => reopen(e.target.value)
async function refreshCutList() {
  try {
    const names = await (await fetch('/api/cuts')).json()
    $('reopen').replaceChildren(new Option('Reopen a saved cut…', ''), ...names.map(n => new Option(n, n)))
  } catch { /* the list just stays as it was */ }
}
let listTimer = null
new EventSource('/api/events').onmessage = ev => {
  if (JSON.parse(ev.data).dir === 'cuts') { clearTimeout(listTimer); listTimer = setTimeout(refreshCutList, 200) }
}
// a browser asks before losing unsaved work (Electron would block the close silently)
if (!navigator.userAgent.includes('Electron')) window.addEventListener('beforeunload', e => { if (dirty()) e.preventDefault() })

// ---- preview ----
const pane = makePreviewPane()
const previewArgs = () => S.cut && S.src ? [S.src, S.cut, [...S.leaks]] : null
const schedulePreview = () => pane.schedule(previewArgs)
const previewNow = () => { const a = previewArgs(); if (a) pane.rebuild(...a) }

// ---- save ----
async function put(name, body) {
  const res = await fetch(`/api/cuts/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) })
  return { res, data: await res.json().catch(() => ({})) }
}
function saveStatus(msg, kind = '') { $('save-status').textContent = msg; $('save-status').className = `status ${kind}` }
$('save').onclick = async () => {
  if (!S.cut) return
  const name = $('name').value.trim()
  if (!NAME_RE.test(name)) return saveStatus('The name may use lowercase letters, digits and _ only.', 'error')
  if (S.leaks.size) return saveStatus(`Not saved: the cut line of ${[...S.leaks].join(', ')} doesn't close.`, 'error')
  const errs = validateCut(S.cut)
  if (errs.length) return saveStatus(`Not saved:\n- ${errs.join('\n- ')}`, 'error')
  $('save').disabled = true
  saveStatus('Saving…')
  try {
    const cut = S.cut
    const body = { cut: { ...cut, name }, sourcePng: srcCanvas.toDataURL('image/png') }
    let { res, data } = await put(name, body)
    if (res.status === 409 && data.needsSwitch) {
      const st = await (await fetch(`/api/cuts/${encodeURIComponent(name)}/status`)).json()
      if (!(await ask(`Switch ${name} from rig ${st.def?.rig} to its cut? Stats, behaviour and tuning stay.`, 'Switch'))) return saveStatus('Not saved.', 'warn')
      ;({ res, data } = await put(name, { ...body, switchRig: true }))
    }
    if (!res.ok) return saveStatus(`Not saved: ${data.error ?? `HTTP ${res.status}`}`, 'error')
    S.savedCut = cut
    const bench = `Tune its motion in the bench: npm run bench -- ${name}`
    saveStatus(data.switched ? `Saved ${name}: its def now uses the cut (params reset to the cut's defaults; stats, behaviour and tuning kept). ${bench}`
      : data.createdDef ? `Saved ${name}: new rig and monster def written. ${bench}`
        : `Saved ${name}: the game picks up the new pieces.`, 'ok')
    toast(`saved ${name}`)
    refreshCutList()
  } catch (err) {
    saveStatus(`Save failed: ${err.message}`, 'error')
  } finally {
    $('save').disabled = false
    syncControls()
  }
}

attachEditor(canvas, {
  S, view, redraw, begin, preview, end, select, hint, paintMask, ownerAt, finishSplit, placePoint, setTool, setBrush, fit, undo, redo, merge,
  coords: xy => { $('coords').textContent = xy ? `${xy[0]}, ${xy[1]}${ownerAt(xy) >= 0 ? ` · ${S.cut.pieces[ownerAt(xy)].id}` : ''}` : '' },
})
refreshCutList()
setTool('edit')
hint('Open a drawing to start.')
window.cutter = { S, view, stage: pane.stage, previewNow, recompute, get rig() { return pane.rig } }
