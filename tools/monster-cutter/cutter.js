// The monster cutter, mounted by the Monster Studio as its Drawing and Cuts
// tabs. State and undo history live here; pure edits come from cut-model.js,
// drawing from overlay.js, the editor's pointer tools from interact.js, the
// side-panel lists from panels.js and the live preview from preview-pane.js.
// The studio owns the files: it opens images and cuts through the returned
// CutterTab, and every change to the cut reaches it through onCutChanged (it
// autosaves the draft). Element ids come from tools/monster-studio/index.html.
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

const NAME_RE = /^[a-z0-9_]+$/
const HISTORY = 100
const stemName = file => file.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'monster'
const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error(`could not load ${url}`))
  img.src = url
})

// onCutChanged(cut): called once per change to the cut (a drag is one change),
// never for the cut a session starts with. isActive(): false while the
// cutter's tabs are hidden, so its keys stay off.
export function mountCutter({ onCutChanged = () => {}, isActive = () => true } = {}) {
  const $ = id => document.getElementById(id)
  const S = {
    src: null, cut: null,
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
  let cssW = 0, cssH = 0, needsFit = false

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
  // A hidden tab measures 0×0: a fit asked for then waits until the editor shows.
  function measure() {
    const r = wrap.getBoundingClientRect(), dpr = devicePixelRatio || 1
    cssW = r.width; cssH = r.height
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr)
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (needsFit) fit()
    redraw()
  }
  function fit() {
    if (!S.cut) return
    if (!cssW || !cssH) { needsFit = true; return }
    needsFit = false
    fitView(view, S.cut.w, S.cut.h, cssW, cssH)
    redraw()
  }
  new ResizeObserver(measure).observe(wrap)

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
  let pending = null, notified = null
  function pushUndo(entry) { S.undo.push(entry); if (S.undo.length > HISTORY) S.undo.shift(); S.redo = [] }
  function changed() {
    recompute(); schedulePreview(); syncControls()
    if (S.cut !== notified) { notified = S.cut; onCutChanged(S.cut) }
  }
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
  function startSession(cut) {
    colours.clear()
    Object.assign(S, { cut, maskRuns: null, maskDirty: false, undo: [], redo: [], selected: null, split: null, discs: null })
    pending = null
    notified = cut // the opening cut is no change
    $('layout').classList.add('has-image')
    setBrush(Math.max(2, Math.round(Math.max(cut.w, cut.h) * 0.02)))
    measure()
    fit()
    changed()
    previewNow()
    setTool('edit')
  }

  // Decode a dropped or chosen drawing, guess its background and pieces, and
  // start editing it. Resolves to the first cut and the source as a PNG data
  // URL, or null (with a toast) when the file can't be used.
  async function openImage(file) {
    if (!file) return null
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast(`${file.name} is not a PNG, JPEG or WebP`, 'error'); return null }
    let bmp
    try { bmp = await createImageBitmap(file) } catch { toast(`could not decode ${file.name}`, 'error'); return null }
    const fitted = M.fitSize(bmp.width, bmp.height)
    loadSource(bmp, fitted.w, fitted.h)
    $('image-info').textContent = `${file.name} · ${fitted.w}×${fitted.h}${fitted.scale < 1 ? ` (shrunk from ${bmp.width}×${bmp.height})` : ''}`
    Object.assign(S, { strokes: [], invert: false })
    S.mask = guessMask(S.src, S.tolerance, false)
    S.maskRuns = null
    const blank = [{ id: 'torso', role: 'torso', side: null, parent: null, seed: [0, 0], cut: null, pivot: [0, 0], z: 0, claims: [] }]
    startSession(withAutoPieces(M.newCut({ name: stemName(file.name), w: fitted.w, h: fitted.h, mask: S.mask, pieces: blank })))
    hint(`Found ${S.cut.pieces.length} pieces. Check the background, then fix any cut that looks wrong; the preview on the right walks.`)
    return { cut: S.cut, sourcePng: srcCanvas.toDataURL('image/png') }
  }

  // Open a saved cut over its source image (a URL the page can load). Throws
  // when the cut is invalid or the image doesn't match it.
  async function loadCut(cut, imageUrl) {
    const errs = validateCut(cut)
    if (errs.length) throw new Error(errs.join('; '))
    const img = await loadImage(imageUrl)
    if (img.naturalWidth !== cut.w || img.naturalHeight !== cut.h) throw new Error(`its source is ${img.naturalWidth}×${img.naturalHeight}, the cut ${cut.w}×${cut.h}`)
    loadSource(img, cut.w, cut.h)
    $('image-info').textContent = `${cut.source} · ${cut.w}×${cut.h}`
    Object.assign(S, { strokes: [], invert: false })
    startSession(cut)
    hint(`Opened ${cut.name}. Moving the tolerance re-guesses the background from the image.`)
  }

  // ---- preview ----
  const pane = makePreviewPane()
  const previewArgs = () => S.cut && S.src ? [S.src, S.cut, [...S.leaks]] : null
  const schedulePreview = () => pane.schedule(previewArgs)
  const previewNow = () => { const a = previewArgs(); if (a) pane.rebuild(...a) }

  attachEditor(canvas, {
    S, view, redraw, begin, preview, end, select, hint, paintMask, ownerAt, finishSplit, placePoint, setTool, setBrush, fit, undo, redo, merge,
    isActive,
    coords: xy => { $('coords').textContent = xy ? `${xy[0]}, ${xy[1]}${ownerAt(xy) >= 0 ? ` · ${S.cut.pieces[ownerAt(xy)].id}` : ''}` : '' },
  })
  setTool('edit')
  hint('')
  window.cutter = { S, view, stage: pane.stage, previewNow, recompute, get rig() { return pane.rig } }

  return {
    openImage,
    loadCut,
    get cut() { return S.cut },
    get leaks() { return [...S.leaks] },
    setPreviewParams: params => pane.setParams(params),
  }
}
