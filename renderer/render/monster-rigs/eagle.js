// The great eagle (Louhi of Pohjola with the Sampo in her claws, the end of
// the Sampo's story: systems/monsters/louhi.js). A sheet of five frames,
// renderer/assets/monsters/eagle.png, painted by tools/make-sampo-creatures.mjs:
// wings up, level, down (the beat), the stoop, and on the ground. The hook's
// channels choose: `pose.sink` is her height (0 on the ground, 1 aloft; the
// shadow stays on the ground under her) and `pose.flicker` is set while she
// stoops. Without a DOM Image (Node tests) or before the sheet has loaded a
// plain dark shape stands in so she never vanishes.
import { drawSheetCell } from './pixel.js'

export const RIG_ID = 'eagle'

export const PARAM_SCHEMA = [
  { key: 'span', label: 'Wingspan (tiles)', group: 'body',   type: 'range', min: 2.0, max: 7.0, step: 0.25, default: 5 },
  { key: 'flap', label: 'Wingbeats a second', group: 'motion', type: 'range', min: 0.5, max: 6.0, step: 0.5, default: 2.5 },
  { key: 'lift', label: 'Height aloft (tiles)', group: 'motion', type: 'range', min: 0.0, max: 2.0, step: 0.1, default: 1.2 },
]

export const CELL = { w: 96, h: 64, spanPx: 88, feetY: 58, bodyY: 33 }
export const FRAMES = { beat: [0, 1, 2, 1], stoop: 3, ground: 4 }
const R = Math.round
const WHITE = '#f8f8f8'
const SHEET_URL = new URL('../../assets/monsters/eagle.png', import.meta.url).href

let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export const hitHalf = () => 14
export const hitShape = () => ({ r: 14 })
// the bar goes over her head at her highest
export const drawnTop = (p, S) => R(S * (1.3 + p.lift))

// Which frame a pose shows. Exported for tests.
export function frameFor(p, pose) {
  const h = Math.max(0, Math.min(1, pose.sink ?? 0))
  if (h < 0.12) return FRAMES.ground
  if ((pose.flicker ?? 0) > 0.5) return FRAMES.stoop
  return FRAMES.beat[Math.floor((pose.t ?? 0) * p.flap * FRAMES.beat.length) % FRAMES.beat.length]
}

export function drawMonster(ctx, p, pose, S) {
  const h = Math.max(0, Math.min(1, pose.sink ?? 0))
  const k = p.span * S / CELL.spanPx
  const w = R(CELL.w * k), hh = R(CELL.h * k)
  const ground = R(S * 0.3)                      // where her feet stand, below the entity's centre
  const lift = R(h * p.lift * S)
  const hit = pose.state === 'hit'
  // her shadow, smaller the higher she is
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  const sw = R((22 - 8 * h) * k)
  for (let y = -2; y <= 2; y++) { const half = R(sw * Math.sqrt(1 - (y * y) / 6.5) / 2); ctx.fillRect(-half, ground + y * Math.max(1, R(k)), 2 * half, Math.max(1, R(k))) }
  const dx = -R(w / 2), dy = ground - R(CELL.feetY * k) - lift
  const img = sheetImage()
  ctx.save()
  ctx.imageSmoothingEnabled = false
  if (!img) {
    ctx.fillStyle = hit ? WHITE : '#3d4252'
    ctx.fillRect(-R(7 * k), dy + R(20 * k), R(14 * k), R(30 * k))
    if (h >= 0.12) ctx.fillRect(-R(40 * k), dy + R(26 * k), R(80 * k), R(8 * k))
  } else drawSheetCell(ctx, img, frameFor(p, pose) * CELL.w, 0, CELL.w, CELL.h, dx, dy, w, hh, hit ? { color: WHITE, alpha: 1 } : null)
  ctx.restore()
}
