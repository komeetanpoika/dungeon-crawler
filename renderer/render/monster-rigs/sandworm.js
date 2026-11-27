// The sand worm (hiekkamato), drawn upright the way a sheet creature is:
// it does not turn with its facing, it rises out of the ground. Rect-only
// art on the art-px grid (TILE_ART_PX per tile), straight onto the canvas:
// with no rotation there is nothing for the pixel stage to keep coherent.
// The origin is where it breaks the sand.
//
// Channels its hook writes (systems/monsters/hiekkamato.js):
//   pose.sink     1 = under the sand: a travelling mound and its dust;
//                 0 = risen to its full height
//   pose.flicker  0..1, the tell: the ground round it shakes and cracks,
//                 more as the eruption nears
//   pose.eyeGlow  0..1, a bite: the head dips towards its facing
//   pose.trail    [{ x, y, a }] the furrow behind the mound: px offsets from
//                 the centre at 32-px tiles, a = how fresh (1 new, 0 gone)
import { TILE_ART_PX, palette, frameOf } from './pixel.js'

export const RIG_ID = 'sandworm'

export const PARAM_SCHEMA = [
  { key: 'height',     label: 'Height',  group: 'body', type: 'range', min: 1, max: 3.5, step: 0.05, default: 1.8 },
  { key: 'girth',      label: 'Girth',   group: 'body', type: 'range', min: 0.4, max: 1.6, step: 0.05, default: 0.7 },
  { key: 'bodyColor',  label: 'Hide',    group: 'skin', type: 'color', default: '#a8603a' },
  { key: 'bellyColor', label: 'Rings',   group: 'skin', type: 'color', default: '#d39a62' },
  { key: 'mouthColor', label: 'Mouth',   group: 'skin', type: 'color', default: '#4a1018' },
  { key: 'toothColor', label: 'Teeth',   group: 'skin', type: 'color', default: '#f4ead0' },
  { key: 'sway',       label: 'Sway',    group: 'motion', type: 'range', min: 0, max: 4, step: 0.1, default: 1.6 },
]

const R = Math.round
const WHITE = '#f8f8f8'
// the desert's sand (tools/make-wilds-desert-tiles.mjs)
const SAND = { light: '#f3ead4', base: '#d9caa9', shade: '#bda983', dark: '#9c8662', crack: '#6f5a3c' }
const SEG = 4                 // art px a body ring is tall
const TELL_R = 19             // art px: the shaking ground's radius at the end of the tell (1.2 tiles)

const girthPx = p => 2 * Math.max(3, R(p.girth * 8))
const heightPx = p => R(p.height * TILE_ART_PX)

export function hitShape(p) { return { r: R(girthPx(p) * 0.5 * (32 / TILE_ART_PX) * 1.1), front: 0, back: 0 } }
export function hitHalf(p) { return Math.max(8, Math.min(28, R(girthPx(p) * 0.5 * (32 / TILE_ART_PX)))) }
// px above the centre where the drawing tops out, risen (the health bar goes above it)
export function drawnTop(p, S) { return R((heightPx(p) + 6) * S / TILE_ART_PX) }

// a deterministic scatter: the nth speck of a ring
const speck = (n, salt) => { const v = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v) }

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX
  const { state, stateT } = pose
  const hit = state === 'hit'
  const flat = col => hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(col)
  const body = flat(p.bodyColor), ring = flat(p.bellyColor)
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const tell = Math.max(0, Math.min(1, pose.flicker ?? 0))
  const bite = Math.max(0, Math.min(1, pose.eyeGlow ?? 0))
  const dead = state === 'death'
  const g = girthPx(p), H = heightPx(p)
  const rect = (x, y, w, h) => ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h)))

  ctx.save()
  ctx.scale(k, k)

  // ---- the furrow behind a travelling mound -----------------------------------
  if (pose.trail) for (const t of pose.trail) {
    if (!(t.a > 0)) continue
    const x = t.x * TILE_ART_PX / 32, y = t.y * TILE_ART_PX / 32
    ctx.save()
    ctx.globalAlpha *= Math.min(1, t.a)
    ctx.fillStyle = SAND.shade
    rect(x - 4, y - 2, 8, 4); rect(x - 3, y - 3, 6, 6)
    ctx.fillStyle = SAND.light
    rect(x - 3, y - 3, 4, 1)
    ctx.restore()
  }

  // ---- the tell: the ground shakes and cracks ----------------------------------
  if (tell > 0) {
    const r = 6 + (TELL_R - 6) * tell
    const f = frameOf(pose.t, 16, 4)
    ctx.fillStyle = SAND.crack
    // cracks running out from the middle, longer as it nears
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      const len = r * (0.5 + 0.5 * speck(dx * 3 + dy * 7, 1)) * (0.6 + 0.4 * tell)
      for (let s = 4; s < len; s += 1) rect(dx * s + (speck(s >> 1, dx + dy) - 0.5) * 3, dy * s * 0.7 + (speck(s >> 1, dx - dy) - 0.5) * 2, 1, 1)
    }
    // a ring of hopping sand
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2, hop = ((i + f) % 4 === 0) ? -2 : 0
      const rr = r * (0.85 + 0.15 * speck(i, 5))
      ctx.fillStyle = i % 3 ? SAND.dark : SAND.light
      rect(Math.cos(a) * rr - 1, Math.sin(a) * rr * 0.7 - 1 + hop, 2, 2)
    }
  }

  // ---- the mound it travels under, and what it leaves when it rises ----------
  const shake = tell > 0 ? (frameOf(pose.t, 24, 2) ? 1 : -1) * (tell > 0.5 ? 1 : 0.5) : 0
  // a low dome of heaped sand, w wide: three rows narrowing upward
  const mound = w => {
    const x = -w / 2 + shake
    ctx.fillStyle = SAND.dark
    rect(x + 1, 1, w - 2, 1)
    ctx.fillStyle = SAND.shade
    rect(x, -2, w, 3); rect(x + 2, -4, w - 4, 2); rect(x + 5, -5, w - 10, 1)
    ctx.fillStyle = SAND.base
    rect(x + 1, -2, w - 3, 2); rect(x + 3, -4, w - 7, 2); rect(x + 5, -5, w - 11, 1)
    ctx.fillStyle = SAND.light
    rect(x + 4, -4, w / 3, 1); rect(x + 2, -2, 3, 1)
  }
  if (sink >= 1) {
    mound(g + 8)
    // dust kicked up at its edges as it goes
    const f = frameOf(pose.t, 8, 4)
    ctx.fillStyle = SAND.light
    for (let i = 0; i < 3; i++) { const x = (speck(i + f, 2) - 0.5) * (g + 10); rect(x, -6 - ((i + f) % 3), 1, 1) }
    ctx.restore()
    return
  }

  // ---- risen: ringed body, round toothed mouth ---------------------------------
  const up = (1 - sink) * H * (dead ? Math.max(0.2, 1 - stateT / 0.5) : 1)
  if (dead) ctx.globalAlpha *= Math.max(0.3, 1 - stateT / 0.7)
  const rings = Math.max(1, Math.ceil(up / SEG))
  const lean = (pose.facing != null ? Math.cos(pose.facing) : 0)
  const swayAt = i => Math.sin(pose.t * 2.6 + i * 0.7) * p.sway * (i / Math.max(1, rings)) + lean * bite * 4 * (i / Math.max(1, rings))
  // the hole it stands in
  ctx.fillStyle = SAND.dark
  rect(-g / 2 - 2, -2, g + 4, 4)
  for (let i = 0; i < rings; i++) {
    const y = -Math.min(up, (i + 1) * SEG), x = swayAt(i)
    const w = g - (i === rings - 1 ? 0 : (i % 2 ? 0 : 0))
    ctx.fillStyle = body.outline
    rect(x - w / 2 - 1, y - 1, w + 2, SEG + 2)
    ctx.fillStyle = i % 2 ? ring.base : body.base
    rect(x - w / 2, y, w, SEG)
    ctx.fillStyle = i % 2 ? ring.light : body.light
    rect(x - w / 2 + 1, y, 2, SEG)
    ctx.fillStyle = body.outline
    rect(x + w / 2 - 2, y, 1, SEG)
  }
  // the head: a ring of lip round a dark maw, teeth on the rim
  if (up > SEG * 2) {
    const hx = swayAt(rings), hy = -up - 3 + bite * 5
    const hw = g + 4
    ctx.fillStyle = body.outline
    rect(hx - hw / 2, hy - 3, hw, 7); rect(hx - hw / 2 + 1, hy - 5, hw - 2, 11); rect(hx - hw / 2 + 3, hy - 6, hw - 6, 13)
    ctx.fillStyle = body.base
    rect(hx - hw / 2 + 1, hy - 3, hw - 2, 7); rect(hx - hw / 2 + 2, hy - 4, hw - 4, 9); rect(hx - hw / 2 + 3, hy - 5, hw - 6, 11)
    ctx.fillStyle = body.light
    rect(hx - hw / 2 + 2, hy - 4, 3, 1); rect(hx - hw / 2 + 1, hy - 3, 2, 2)
    ctx.fillStyle = hit ? WHITE : p.mouthColor
    rect(hx - hw / 2 + 3, hy - 2, hw - 6, 5); rect(hx - hw / 2 + 4, hy - 3, hw - 8, 7)
    ctx.fillStyle = hit ? WHITE : p.toothColor
    const open = bite > 0.5 ? 0 : 1
    for (let x = hx - hw / 2 + 4; x < hx + hw / 2 - 4; x += 2) { rect(x, hy - 3, 1, 1 + open); rect(x + 1, hy + 3 - open, 1, 1 + open) }
    rect(hx - hw / 2 + 3, hy, 1, 1); rect(hx + hw / 2 - 4, hy, 1, 1)
  }
  // the collar of thrown sand at its foot, in front of the body
  mound(g + 10)
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? SAND.base : SAND.shade
    rect(-g / 2 - 6 + i * (g + 10) / 6 + speck(i, 9) * 2, -6 - speck(i, 3) * 3, 3, 3)
  }
  ctx.restore()
}
