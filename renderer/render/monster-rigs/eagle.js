// The great eagle (Louhi of Pohjola with the Sampo in her claws, the end of
// the Sampo's story: systems/monsters/louhi.js). Drawn from shapes in art
// pixels, with fillRect alone so it draws on any context. `pose.sink` is her
// height (the hook's channel: 0 on the ground with wings half folded, 1
// aloft and beating); the shadow stays on the ground under her.
import { withPixelStage } from './pixel.js'

export const RIG_ID = 'eagle'

export const PARAM_SCHEMA = [
  { key: 'span', label: 'Wingspan (tiles)', group: 'body',   type: 'range', min: 2.0, max: 7.0, step: 0.25, default: 5 },
  { key: 'flap', label: 'Wingbeats a second', group: 'motion', type: 'range', min: 0.5, max: 6.0, step: 0.5, default: 3 },
  { key: 'lift', label: 'Height aloft (tiles)', group: 'motion', type: 'range', min: 0.0, max: 2.0, step: 0.1, default: 1.2 },
]

const R = Math.round
const WHITE = '#f8f8f8'
export const hitHalf = () => 14
export const hitShape = () => ({ r: 14 })
// the bar goes over her head wherever she is
export const drawnTop = (p, S) => R(S * 1.2)

// a convex polygon, a row of art pixels at a time
function poly(c, pts) {
  const ys = pts.map(p => p[1]), y0 = Math.ceil(Math.min(...ys)), y1 = Math.floor(Math.max(...ys))
  for (let y = y0; y <= y1; y++) {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]
      if ((ay <= y && by >= y) || (by <= y && ay >= y)) {
        const x = ay === by ? ax : ax + (bx - ax) * (y - ay) / (by - ay)
        lo = Math.min(lo, x, ay === by ? bx : x); hi = Math.max(hi, x, ay === by ? bx : x)
      }
    }
    if (hi >= lo) c.fillRect(R(lo), y, Math.max(1, R(hi) - R(lo)), 1)
  }
}
function oval(c, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y++) {
    const w = R(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))))
    if (w > 0) c.fillRect(cx - w, cy + y, 2 * w, 1)
  }
}

export function drawMonster(ctx, p, pose, S) {
  const half = R(p.span * 8)
  const artW = Math.ceil((2 * half + 8) / 16) * 16, artH = 80
  const h = Math.max(0, Math.min(1, pose.sink ?? 0))
  const hit = pose.state === 'hit'
  const beat = Math.sin((pose.t ?? 0) * p.flap * 2 * Math.PI)
  const reach = half * (0.4 + 0.6 * h)            // half folded on the ground
  const lift = R(h * p.lift * 16)
  const flip = Math.cos(pose.facing ?? 0) < 0
  const col = hit ? { wing: WHITE, dark: WHITE, body: WHITE, head: WHITE, gold: WHITE, eye: WHITE }
    : { wing: '#3a3f4d', dark: '#23262f', body: '#2c303a', head: '#c9ccd4', gold: '#e2b64a', eye: '#b3261e' }
  withPixelStage(ctx, artW, artH, 0, S, c => {
    // her shadow, smaller the higher she is
    c.fillStyle = 'rgba(0,0,0,0.28)'
    oval(c, 0, 12, R(9 - 3 * h), 3)
    c.save()
    c.translate(0, -lift)
    if (flip) c.scale(-1, 1)
    const tipY = -3 - R(beat * 9 * h)
    for (const side of [-1, 1]) {
      c.fillStyle = col.dark
      poly(c, [[side * 3, -4], [side * reach, tipY], [side * reach * 0.82, tipY + 7], [side * reach * 0.45, 7], [side * 3, 5]])
      c.fillStyle = col.wing
      poly(c, [[side * 3, -4], [side * reach * 0.9, tipY + 1], [side * reach * 0.5, 3], [side * 3, 2]])
    }
    c.fillStyle = col.dark
    poly(c, [[-4, 7], [4, 7], [6, 15], [0, 13], [-6, 15]])      // tail
    c.fillStyle = col.body
    oval(c, 0, 2, 5, 8)
    c.fillStyle = col.head
    oval(c, 2, -8, 4, 4)
    c.fillStyle = col.gold
    poly(c, [[5, -9], [10, -7], [5, -5]])                        // beak
    if (h < 0.5) { c.fillRect(-4, 10, 3, 2); c.fillRect(2, 10, 3, 2) }   // talons, on the ground
    c.fillStyle = col.eye
    c.fillRect(3, -9, 1, 1)
    c.restore()
  })
}
