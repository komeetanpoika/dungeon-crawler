// Sprite-sheet sea serpent: the one rig that blits hand-drawn frames instead
// of drawing shapes. Frames come from renderer/assets/monsters/serpent.png
// (built by tools/extract-serpent-sheet.mjs from assets/serpent.png); the
// grid is described by the generated serpent-sheet.js. Upright art facing
// west — it never rotates with facing, only flips. Three rows: idle while
// surfaced and still, swim while moving, and dive indexed straight off
// `pose.sink` (0..1) so the Näkki's sinking plays the row forward and its
// rising plays it backward. Without a DOM Image (Node tests) or before the
// sheet has loaded it draws a plain silhouette so nothing ever vanishes.
import { SHEET } from '../../assets/monsters/serpent-sheet.js'
import { frameOf, drawSheetCell } from './pixel.js'

export const RIG_ID = 'serpent'

export const PARAM_SCHEMA = [
  { key: 'width',     label: 'Width (tiles)', group: 'body',   type: 'range', min: 1.5, max: 7.0, step: 0.25, default: 4.5 },
  { key: 'shift',     label: 'Shift (tiles)', group: 'body',   type: 'range', min: -1.0, max: 2.0, step: 0.05, default: 1.4 },
  { key: 'waterline', label: 'Waterline',     group: 'body',   type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.45 },
  { key: 'idleFps',   label: 'Idle speed',    group: 'motion', type: 'range', min: 1, max: 12, step: 1, default: 5 },
  { key: 'swimFps',   label: 'Swim speed',    group: 'motion', type: 'range', min: 1, max: 16, step: 1, default: 8 },
  { key: 'bob',       label: 'Bob',           group: 'motion', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.4 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const SHEET_URL = new URL('../../assets/monsters/serpent.png', import.meta.url).href

// The sheet image is created on first draw (not at import) so a headless
// import stays side-effect free. null until an Image exists; a failed load
// leaves it in the not-ready state and the silhouette keeps drawing.
let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export function hitHalf(p) {
  return Math.max(8, Math.min(28, R(p.width * 16 * 0.5)))
}

// Which sheet cell a pose shows: dive row while sinking/rising, swim row
// while moving, idle row otherwise. Exported for tests.
export function frameFor(p, pose) {
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  if (sink > 0) {
    const r = SHEET.rows.dive
    return { row: r.row, frame: Math.min(r.frames - 1, Math.floor(sink * r.frames)) }
  }
  const moving = pose.state === 'walk' || (pose.speed01 ?? 0) > 0.05
  const r = moving ? SHEET.rows.swim : SHEET.rows.idle
  return { row: r.row, frame: frameOf(pose.t ?? 0, moving ? p.swimFps : p.idleFps, r.frames) }
}

export function drawMonster(ctx, p, pose, S) {
  const { row, frame } = frameFor(p, pose)
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const flip = Math.cos(pose.facing ?? 0) > 0          // art faces west
  const k = p.width * S / SHEET.cellW                   // scale: a cell spans `width` tiles
  const w = R(SHEET.cellW * k), h = R(SHEET.cellH * k)
  const bob = sink > 0 ? 0 : R(Math.sin((pose.t ?? 0) * 2.2 + (pose.seed ?? 0)) * p.bob * S * 0.06)
  // shift slides the art toward its tail (the frame's head sits well left of
  // centre) so the jaws hang beside the entity's own cell, not over it
  const dx = -R(w / 2) + R(p.shift * S), dy = R(p.waterline * S) - h + bob
  const sx = frame * SHEET.cellW, sy = row * SHEET.cellH

  ctx.save()
  if (flip) ctx.scale(-1, 1)
  ctx.imageSmoothingEnabled = false
  const img = sheetImage()
  if (!img) drawSilhouette(ctx, w, h, dx, dy, sink, pose.state === 'hit')
  else drawSheetCell(ctx, img, sx, sy, SHEET.cellW, SHEET.cellH, dx, dy, w, h,
                     pose.state === 'hit' ? { color: WHITE, alpha: 1 } : null)
  ctx.restore()
}

// Fallback when no sheet can be drawn: a rounded neck-and-head block on a
// water band, sliding under with sink, so the creature is still readable.
function drawSilhouette(ctx, w, h, dx, dy, sink, hit) {
  const skin = hit ? WHITE : '#2f5a50', dark = hit ? WHITE : '#1d3a33', foam = hit ? WHITE : '#dfe9f2'
  const water = dy + h - R(h * 0.2)
  ctx.save()
  ctx.beginPath(); ctx.rect(dx, dy, w, water - dy + 2); ctx.clip()
  ctx.translate(0, R(sink * h * 0.8))
  ctx.fillStyle = dark
  ctx.fillRect(dx + R(w * 0.3), dy + R(h * 0.15), R(w * 0.22), water - dy)     // neck
  ctx.fillStyle = skin
  ctx.fillRect(dx + R(w * 0.12), dy + R(h * 0.1), R(w * 0.42), R(h * 0.26))    // head
  ctx.fillStyle = hit ? WHITE : '#f0c030'
  ctx.fillRect(dx + R(w * 0.2), dy + R(h * 0.16), R(w * 0.05), R(h * 0.05))   // eye
  ctx.restore()
  ctx.fillStyle = foam
  ctx.fillRect(dx, water, w, 2)
}
