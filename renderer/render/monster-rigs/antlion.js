// The antlion (kuoppaleuka): a funnel of sliding sand with jaws at the
// bottom. Seen from above, never turned: rect-only art on the art-px grid
// (TILE_ART_PX per tile), straight onto the canvas. The funnel is part of
// the creature, not of the map: it is drawn here and goes when it dies.
//
// Channels its hook writes (systems/monsters/kuoppaleuka.js):
//   pose.sink     1 = buried: only the jaws' tips show in the hole;
//                 0 = the flat head and both sickle jaws are out
//   pose.eyeGlow  0..1, winding up a throw: a heap of sand grows on the head
//   pose.flicker  0..1, the snap: the jaws shut
//   pose.burn     0..1, the pit filling in (and in its death pose, by itself)
import { TILE_ART_PX, palette, frameOf } from './pixel.js'

export const RIG_ID = 'antlion'

export const PARAM_SCHEMA = [
  { key: 'funnel',     label: 'Funnel radius', group: 'pit', type: 'range', min: 1.2, max: 4, step: 0.1, default: 2.6 },
  { key: 'flow',       label: 'Sand flow',     group: 'pit', type: 'range', min: 0, max: 2, step: 0.05, default: 0.45 },
  { key: 'headColor',  label: 'Head',          group: 'skin', type: 'color', default: '#6b4a2a' },
  { key: 'jawColor',   label: 'Jaws',          group: 'skin', type: 'color', default: '#2e2018' },
  { key: 'eyeColor',   label: 'Eyes',          group: 'skin', type: 'color', default: '#ffcf3a' },
]

const R = Math.round
const WHITE = '#f8f8f8'
// the desert's sand, light to dark down the slope (tools/make-wilds-desert-tiles.mjs)
const SAND = { lip: '#ece2c9', base: '#d9caa9', slope: '#cbb98f', deep: '#b29b70', hole: '#8a7450', pit: '#5e4c32' }

export function hitShape() { return { r: 10, front: 0, back: 0 } }
export function hitHalf() { return 10 }

// a filled disc of radius r (art px) as rows two px tall
function disc(ctx, r, colour) {
  ctx.fillStyle = colour
  for (let y = -r; y < r; y += 2) {
    const half = Math.sqrt(Math.max(0, r * r - (y + 1) * (y + 1)))
    if (half >= 1) ctx.fillRect(R(-half), y, R(half) * 2, 2)
  }
}

// The bowl never changes for a given size, so it is drawn once and kept
// (a canvas per radius); only the sliding specks are drawn each frame.
// Without OffscreenCanvas (Node) it is drawn straight every time.
const bowls = new Map()
function drawBowl(ctx, rad) {
  disc(ctx, rad, SAND.lip)
  disc(ctx, rad - 2, SAND.base)
  disc(ctx, R(rad * 0.78), SAND.slope)
  disc(ctx, R(rad * 0.5), SAND.deep)
  disc(ctx, R(rad * 0.24), SAND.hole)
  disc(ctx, 4, SAND.pit)
}
function bowl(ctx, rad) {
  if (typeof OffscreenCanvas === 'undefined') { drawBowl(ctx, rad); return }
  let buf = bowls.get(rad)
  if (!buf) {
    buf = new OffscreenCanvas(rad * 2 + 2, rad * 2 + 2)
    const b = buf.getContext('2d')
    b.translate(rad + 1, rad + 1)
    drawBowl(b, rad)
    bowls.set(rad, buf)
  }
  ctx.drawImage(buf, -rad - 1, -rad - 1)
}

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX
  const { state, stateT } = pose
  const hit = state === 'hit'
  const dead = state === 'death'
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const wind = Math.max(0, Math.min(1, pose.eyeGlow ?? 0))
  const snap = Math.max(0, Math.min(1, pose.flicker ?? 0))
  // (dying, it fills in by its death's own clock)
  const fill = Math.max(0, Math.min(1, dead ? stateT / 0.6 : pose.burn ?? 0))
  const head = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.headColor)
  const jaw = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.jawColor)
  const rect = (x, y, w, h) => ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h)))
  const full = R(p.funnel * TILE_ART_PX)

  ctx.save()
  ctx.scale(k, k)
  ctx.imageSmoothingEnabled = false

  // ---- the funnel ---------------------------------------------------------------
  // (filling in, it closes from the rim inward)
  const rad = R(full * (1 - fill))
  if (rad > 5) {
    ctx.save()
    if (fill > 0) drawBowl(ctx, rad); else bowl(ctx, rad)
    // rings of specks sliding down to the hole
    const rings = 4, n = 14
    const phase = (pose.t * p.flow) % 1
    for (let i = 0; i < rings; i++) {
      const f = 1 - ((i + phase) / rings)              // 1 at the rim, 0 at the hole
      const rr = 5 + (rad - 7) * f
      ctx.fillStyle = f > 0.5 ? SAND.lip : SAND.base
      for (let j = 0; j < n; j++) {
        const a = (j + (i % 2) * 0.5) / n * Math.PI * 2 + i * 0.7
        rect(Math.cos(a) * rr, Math.sin(a) * rr, f > 0.4 ? 2 : 1, 1)
      }
    }
    ctx.restore()
  }
  if (dead && fill >= 1) { ctx.restore(); return }

  // ---- the jaws and the head ------------------------------------------------------
  if (dead) ctx.globalAlpha *= Math.max(0, 1 - stateT / 0.5)
  const out = 1 - sink                                   // how far the head is out
  const shut = Math.max(snap, 0)
  // two sickles, one each side: a root by the head, curving in to a point
  // ahead (south, towards the viewer); shut, the points cross
  // each a string of blocks along an arc from the head's corner round to a
  // point in front; shut, the two arcs close on each other
  const rr = 3 + 5 * out, cy = 1 + 2 * out, steps = 5 + R(4 * out)
  for (const pass of [0, 1]) for (const sx of [-1, 1]) for (let i = 0; i <= steps; i++) {
    const f = i / steps, a = (-70 + 150 * f) * Math.PI / 180
    const x = sx * rr * Math.cos(a) * (1 - 0.75 * shut), y = cy + rr * Math.sin(a)
    const w = f > 0.8 ? 1 : 2
    if (pass === 0) { ctx.fillStyle = jaw.outline; rect(x - w / 2 - 0.5, y - w / 2 - 0.5, w + 1, w + 1) }
    else if (f < 0.75 && i % 2 === 0) { ctx.fillStyle = jaw.light; rect(x - 0.5, y - 0.5, 1, 1) }
  }
  if (out > 0.15) {
    // the head: a flat plate with two eyes, rising out of the hole
    const hw = 5 + 3 * out, hy = -2 - 5 * out
    ctx.fillStyle = head.outline
    rect(-hw - 1, hy - 1, 2 * hw + 2, 6 + 2 * out); rect(-hw + 1, hy - 2, 2 * hw - 2, 8 + 2 * out)
    ctx.fillStyle = head.base
    rect(-hw, hy, 2 * hw, 4 + 2 * out); rect(-hw + 2, hy - 1, 2 * hw - 4, 6 + 2 * out)
    ctx.fillStyle = head.light
    rect(-hw + 1, hy, 3, 1); rect(-1, hy - 1, 2, 2)
    ctx.fillStyle = hit ? WHITE : p.eyeColor
    rect(-hw + 2, hy + 1, 2, 2); rect(hw - 4, hy + 1, 2, 2)
    ctx.fillStyle = head.outline
    rect(-hw + 3, hy + 2, 1, 1); rect(hw - 3, hy + 2, 1, 1)
    // the heap of sand it is about to throw
    if (wind > 0) {
      const w = 2 + 5 * wind
      ctx.fillStyle = SAND.deep
      rect(-w / 2 - 1, hy - 3 - w * 0.6, w + 2, w * 0.6 + 2)
      ctx.fillStyle = frameOf(pose.t, 14, 2) ? SAND.lip : SAND.base
      rect(-w / 2, hy - 3 - w * 0.6, w, w * 0.6)
    }
  }
  ctx.restore()
}
