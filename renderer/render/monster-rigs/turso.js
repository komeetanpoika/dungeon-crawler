// Iku-Turso, who holds the Sampo's wheel in the sea (the Sampo's story:
// systems/monsters/lurker.js). The sea serpent's sheet in his own colours,
// renderer/assets/monsters/ikuturso.png (tools/make-sampo-creatures.mjs
// repaints serpent.png frame for frame, so serpent-sheet.js describes it
// too): the rows, the dive off `pose.sink` and the placing are serpent.js's.
import { SHEET } from '../../assets/monsters/serpent-sheet.js'
import { drawSheetCell } from './pixel.js'
import { PARAM_SCHEMA, hitHalf, hitShape, frameFor } from './serpent.js'

export const RIG_ID = 'turso'
export { PARAM_SCHEMA, hitHalf, hitShape, frameFor }

const R = Math.round
const WHITE = '#f8f8f8'
const SHEET_URL = new URL('../../assets/monsters/ikuturso.png', import.meta.url).href

let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export function drawMonster(ctx, p, pose, S) {
  const { row, frame } = frameFor(p, pose)
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const flip = Math.cos(pose.facing ?? 0) > 0          // the art faces west
  const k = p.width * S / SHEET.cellW
  const w = R(SHEET.cellW * k), h = R(SHEET.cellH * k)
  const bob = sink > 0 ? 0 : R(Math.sin((pose.t ?? 0) * 2.2 + (pose.seed ?? 0)) * p.bob * S * 0.06)
  const dx = -R(w / 2) + R(p.shift * S), dy = R(p.waterline * S) - h + bob
  const hit = pose.state === 'hit'
  ctx.save()
  if (flip) ctx.scale(-1, 1)
  ctx.imageSmoothingEnabled = false
  const img = sheetImage()
  if (!img) {
    // no sheet to draw: a dark head and neck over a line of foam, going under with sink
    const water = dy + h - R(h * 0.2)
    ctx.save()
    ctx.beginPath(); ctx.rect(dx, dy, w, water - dy + 2); ctx.clip()
    ctx.translate(0, R(sink * h * 0.8))
    ctx.fillStyle = hit ? WHITE : '#3a1f45'
    ctx.fillRect(dx + R(w * 0.3), dy + R(h * 0.15), R(w * 0.22), water - dy)
    ctx.fillRect(dx + R(w * 0.12), dy + R(h * 0.1), R(w * 0.42), R(h * 0.26))
    ctx.restore()
    ctx.fillStyle = hit ? WHITE : '#dfe9f2'
    ctx.fillRect(dx, water, w, 2)
  } else drawSheetCell(ctx, img, frame * SHEET.cellW, row * SHEET.cellH, SHEET.cellW, SHEET.cellH, dx, dy, w, h, hit ? { color: WHITE, alpha: 1 } : null)
  ctx.restore()
}
