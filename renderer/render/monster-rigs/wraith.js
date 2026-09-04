// Sprite-sheet wraith: blits hand-drawn frames from
// renderer/assets/monsters/wraith.png (built by tools/extract-wraith-sheet.mjs
// from assets/wraith.png; grid in the generated wraith-sheet.js). Upright,
// flips with facing. Two rows: `float` — the five-frame drifting loop — and
// `dissolve`, the body unravelling to a wisp and a pair of eyes. Channels:
// `flicker` (the Sammunut moving while faded, 0..1) picks dissolve frames so
// it materialises eyes-first out of the dark and unravels as it leaves the
// light; `burn` (0..1) tints it ember; death plays the dissolve row through.
// Without a DOM Image (Node tests) or before the sheet has loaded it draws a
// plain hooded silhouette so nothing ever vanishes.
import { SHEET } from '../../assets/monsters/wraith-sheet.js'
import { frameOf, drawSheetCell } from './pixel.js'

export const RIG_ID = 'wraith'

export const PARAM_SCHEMA = [
  { key: 'height',     label: 'Height (tiles)', group: 'body',   type: 'range', min: 1.5, max: 4.5, step: 0.05, default: 2.85 },
  { key: 'lift',       label: 'Lift (tiles)',   group: 'body',   type: 'range', min: -0.5, max: 1.0, step: 0.05, default: 0.25 },
  { key: 'floatFps',   label: 'Float speed',    group: 'motion', type: 'range', min: 1, max: 12, step: 1, default: 6 },
  { key: 'bob',        label: 'Hover bob',      group: 'motion', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.5 },
  { key: 'emberColor', label: 'Ember',          group: 'skin',   type: 'color', default: '#ff7a2a' },
]

const R = Math.round
const WHITE = '#f8f8f8'
const DEATH_TIME = 0.7
const SHEET_URL = new URL('../../assets/monsters/wraith.png', import.meta.url).href
const clamp01 = v => Math.max(0, Math.min(1, v ?? 0))

let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export function hitHalf(p) {
  return Math.max(8, Math.min(28, R(p.height * 16 * 0.35)))
}

// Which sheet cell a pose shows. Death and a strong flicker both walk the
// dissolve row (flicker reversed on the way in: a rising fade means a falling
// flicker, so the eyes appear first and the body gathers under them);
// otherwise the float loop. Exported for tests.
export function frameFor(p, pose) {
  const dis = SHEET.rows.dissolve, fl = SHEET.rows.float
  if (pose.state === 'death') {
    const k = clamp01((pose.stateT ?? 0) / DEATH_TIME)
    return { row: dis.row, frame: Math.min(dis.frames - 1, Math.floor(k * dis.frames)) }
  }
  const flick = clamp01(pose.flicker)
  if (flick > 0.35) {
    const k = (flick - 0.35) / 0.65
    return { row: dis.row, frame: Math.min(dis.frames - 1, Math.floor(k * dis.frames)) }
  }
  return { row: fl.row, frame: frameOf(pose.t ?? 0, p.floatFps, fl.frames) }
}

export function drawMonster(ctx, p, pose, S) {
  const { row, frame } = frameFor(p, pose)
  const flip = Math.cos(pose.facing ?? 0) < 0
  const k = p.height * S / SHEET.cellH                  // scale: a cell spans `height` tiles
  const w = R(SHEET.cellW * k), h = R(SHEET.cellH * k)
  const bob = R(Math.sin((pose.t ?? 0) * 2.4 + (pose.seed ?? 0)) * p.bob * S * 0.1)
  const dx = -R(w / 2), dy = -R(h / 2) - R(p.lift * S) + bob
  const sx = frame * SHEET.cellW, sy = row * SHEET.cellH
  const burn = clamp01(pose.burn)
  const hit = pose.state === 'hit'
  const tint = hit ? { color: WHITE, alpha: 1 } : burn > 0 ? { color: p.emberColor, alpha: burn * 0.7 } : null

  ctx.save()
  if (flip) ctx.scale(-1, 1)
  ctx.imageSmoothingEnabled = false
  if (pose.state === 'death') {
    const kd = clamp01((pose.stateT ?? 0) / DEATH_TIME)
    ctx.globalAlpha *= 1 - kd
  }
  const img = sheetImage()
  if (!img) drawSilhouette(ctx, w, h, dx, dy, row === SHEET.rows.dissolve.row, hit, burn, p.emberColor)
  else drawSheetCell(ctx, img, sx, sy, SHEET.cellW, SHEET.cellH, dx, dy, w, h, tint)
  ctx.restore()
}

// Fallback when no sheet can be drawn: a hooded block with two bright eyes
// and a tapering skirt (just the eyes and a wisp while dissolving).
function drawSilhouette(ctx, w, h, dx, dy, dissolving, hit, burn, ember) {
  const cloak = hit ? WHITE : burn > 0.5 ? ember : '#3a3550'
  const eye = hit ? WHITE : '#ffb040'
  const cx = dx + R(w / 2)
  if (!dissolving) {
    ctx.fillStyle = cloak
    ctx.fillRect(dx + R(w * 0.2), dy + R(h * 0.05), R(w * 0.6), R(h * 0.35))    // hood
    ctx.fillRect(dx + R(w * 0.25), dy + R(h * 0.4), R(w * 0.5), R(h * 0.45))    // skirt
  } else {
    ctx.fillStyle = cloak
    ctx.fillRect(cx - 1, dy + R(h * 0.3), 3, R(h * 0.5))                         // wisp
  }
  ctx.fillStyle = eye
  ctx.fillRect(cx - R(w * 0.14), dy + R(h * 0.18), Math.max(1, R(w * 0.08)), Math.max(1, R(w * 0.08)))
  ctx.fillRect(cx + R(w * 0.06), dy + R(h * 0.18), Math.max(1, R(w * 0.08)), Math.max(1, R(w * 0.08)))
}
