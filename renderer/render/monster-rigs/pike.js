// The great pike of the marsh (the Sampo's story: systems/monsters/lurker.js).
// A sheet of two frames, renderer/assets/monsters/pike.png, painted by
// tools/make-sampo-creatures.mjs: the head and shoulders of it up out of the
// water at a slant, jaws shut and jaws wide, facing west. The art is cut at
// its waterline and slid under by `pose.sink` (the hook's channel: 1 under,
// 0 up), so its rising and going down need no frames of their own; foam
// marks where it breaks the water. Without a DOM Image (Node tests) or
// before the sheet has loaded a plain green shape stands in.
import { drawSheetCell } from './pixel.js'

export const RIG_ID = 'pike'

export const PARAM_SCHEMA = [
  { key: 'width',     label: 'Width (tiles)', group: 'body',   type: 'range', min: 1.5, max: 6.0, step: 0.25, default: 3.5 },
  { key: 'shift',     label: 'Shift (tiles)', group: 'body',   type: 'range', min: -1.0, max: 2.0, step: 0.05, default: 0.7 },
  { key: 'waterline', label: 'Waterline',     group: 'body',   type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.45 },
  { key: 'snap',      label: 'Snaps a second', group: 'motion', type: 'range', min: 0.5, max: 6.0, step: 0.5, default: 2 },
]

export const CELL = { w: 64, h: 40, water: 31 }   // the art row its waterline is on
const R = Math.round
const WHITE = '#f8f8f8'
const SHEET_URL = new URL('../../assets/monsters/pike.png', import.meta.url).href

let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export function hitHalf(p) { return Math.max(8, Math.min(28, R(p.width * 16 * 0.4))) }
export const hitShape = p => ({ r: hitHalf(p) })

// Jaws wide every other beat while it is right up. Exported for tests.
export function frameFor(p, pose) {
  if ((pose.sink ?? 0) > 0.05) return 0
  return Math.floor((pose.t ?? 0) * p.snap * 2) % 2
}

export function drawMonster(ctx, p, pose, S) {
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const flip = Math.cos(pose.facing ?? 0) > 0          // the art faces west
  const k = p.width * S / CELL.w
  const w = R(CELL.w * k), h = R(CELL.h * k), above = R(CELL.water * k)
  const dx = -R(w / 2) + R(p.shift * S), water = R(p.waterline * S), dy = water - above
  const hit = pose.state === 'hit'
  ctx.save()
  if (flip) ctx.scale(-1, 1)
  ctx.imageSmoothingEnabled = false
  // only what is above the water shows
  ctx.save()
  ctx.beginPath(); ctx.rect(dx - 2, dy - 2, w + 4, above + 2); ctx.clip()
  const down = R(sink * above)
  const img = sheetImage()
  if (!img) {
    ctx.fillStyle = hit ? WHITE : '#62803a'
    ctx.fillRect(dx + R(w * 0.05), dy + down + R(above * 0.3), R(w * 0.5), R(above * 0.28))
    ctx.fillRect(dx + R(w * 0.45), dy + down + R(above * 0.4), R(w * 0.45), R(above * 0.6))
  } else drawSheetCell(ctx, img, frameFor(p, pose) * CELL.w, 0, CELL.w, CELL.h, dx, dy + down, w, h, hit ? { color: WHITE, alpha: 1 } : null)
  ctx.restore()
  // foam where the body breaks the water, thinning as it goes under
  if (sink < 1) {
    const u = Math.max(1, R(k)), x0 = dx + R(w * (0.62 + 0.2 * sink)), x1 = dx + w
    const beat = Math.floor((pose.t ?? 0) * 6) % 2
    for (let x = x0, i = 0; x < x1; x += 2 * u, i++) {
      ctx.fillStyle = hit ? WHITE : (i + beat) % 3 === 0 ? '#9ec4dd' : '#e8f1f8'
      ctx.fillRect(x, water - ((i + beat) % 2) * u, 2 * u, u)
    }
    ctx.fillStyle = hit ? WHITE : '#9ec4dd'
    ctx.fillRect(x0 - 3 * u, water + u, x1 - x0 + 5 * u, u)
  }
  ctx.restore()
}
