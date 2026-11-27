// 16-bit pixel scorpion, seen from above (the desert's skorpioni and
// keisariskorpioni). Rect-only art on the shared pixel stage, like the
// quadruped: facing snaps to 8 directions, -y is forward. One body plan at
// any `scale`: a head plate with two eyes, a ringed abdomen, eight legs
// that step in two alternating sets, two pincers that open and shut, and the
// tail curled forward over the back with its sting above the abdomen.
//
// Channels a hook writes (systems/monsters/skorpioni.js):
//   pose.sink     1 = buried: a low mound of sand with the sting's tip and
//                 the two eyes showing; between 1 and 0 it shakes the sand off
//   pose.eyeGlow  the sting: rising to just under 1 the tail rears back and
//                 swells; at 1 it is struck out forward past the pincers
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'scorpion'

export const PARAM_SCHEMA = [
  { key: 'scale',      label: 'Size',        group: 'body', type: 'range', min: 0.6, max: 2.2, step: 0.05, default: 1 },
  { key: 'shellColor', label: 'Shell',       group: 'skin', type: 'color', default: '#5a3a22' },
  { key: 'clawColor',  label: 'Pincers',     group: 'skin', type: 'color', default: '#8a5a2c' },
  { key: 'stingColor', label: 'Sting',       group: 'skin', type: 'color', default: '#d8902a' },
  { key: 'eyeColor',   label: 'Eyes',        group: 'skin', type: 'color', default: '#ffe14a' },
  { key: 'gaitFreq',   label: 'Gait frequency', group: 'motion', type: 'range', min: 4, max: 18, step: 0.5, default: 11 },
]

const R = Math.round
const WHITE = '#f8f8f8'
// the desert's sand (tools/make-wilds-desert-tiles.mjs): the mound a buried one lies under
const SAND = { light: '#e6dabf', base: '#d9caa9', shade: '#bda983' }
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)

// Lengths in art px at scale 1, forward of the centre negative.
const BODY = { halfW: 4, headW: 3, head: -6, waist: -2, rear: 4 }
const CLAW_TIP = -12          // the pincers' tips
const STRIKE_TIP = -16        // the sting's point at full strike
const LEG_OUT = 3             // how far a leg reaches from the body's side
const TAIL_BACK = 8           // how far the curled tail lies behind the rear

// The tail's four links, root to bulb, as [x, y, width], and where the
// sting's point lies, in three attitudes: at rest it runs out behind and
// curls round to one side, the sting pointing forward beside the rear;
// reared it stands over the back, the bulb swollen; struck it is one line
// over the head and out past the pincers.
const r = BODY.rear
const TAIL = {
  rest:   { links: [[0, r + 1.5, 3], [0.5, r + 4.5, 3], [3, r + 6, 3], [5.5, r + 4, 4]], tip: [5.5, r + 0.5] },
  reared: { links: [[0, r + 1, 3], [0, r - 1.5, 3], [0, r - 4, 3], [0, r - 6.5, 5]], tip: [0, r - 10] },
  struck: { links: [[0, r, 3], [0, r - 5, 3], [0, r - 10, 3], [0, STRIKE_TIP + 3.5, 4]], tip: [0, STRIKE_TIP] },
}
const lerp = (a, b, f) => a + (b - a) * f
function tailAt(glow) {
  if (glow >= 1) return TAIL.struck
  if (glow <= 0) return TAIL.rest
  // most of the way up early, so the rear is seen in time
  const f = Math.min(1, glow * 1.6)
  return { links: TAIL.rest.links.map((l, i) => l.map((v, k) => lerp(v, TAIL.reared.links[i][k], f))),
           tip: TAIL.rest.tip.map((v, k) => lerp(v, TAIL.reared.tip[k], f)) }
}

// How far forward of the centre the sting's point lies, in art px at the
// params' scale, by the hook's channel (behind the centre is negative).
export function stingReach(p, glow = 0) { return -tailAt(glow).tip[1] * p.scale }

function dims(p) {
  const sc = p.scale
  return { sc, artW: ceilTile(2 * (BODY.halfW + LEG_OUT + 3) * sc + 2), artH: ceilTile(2 * -STRIKE_TIP * sc + 2) }
}

// Hit extent (systems/hitbox.js): a capsule from the pincers to the tail's
// root, in screen px at 32-px tiles.
export function hitShape(p) {
  const k = 32 / TILE_ART_PX * p.scale
  const r = R((BODY.halfW + 1.5) * k)
  return { r, front: Math.max(0, R(-CLAW_TIP * k * 0.8) - r), back: Math.max(0, R((BODY.rear + TAIL_BACK * 0.5) * k) - r) }
}
export function hitHalf(p) {
  return Math.max(8, Math.min(28, R((BODY.halfW + 2) * 2 * p.scale * 0.9)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state, stateT } = pose
  withPixelStage(ctx, d.artW, d.artH, pose.facing + Math.PI / 2, S, c => {
    const hit = state === 'hit'
    const flat = col => hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(col)
    const shell = flat(p.shellColor), claw = flat(p.clawColor), sting = flat(p.stingColor)
    const eye = hit ? WHITE : p.eyeColor
    const u = v => R(v * d.sc)
    // a rect given in scale-1 art px: edges are rounded, never the size, so
    // neighbouring rects still meet at any scale
    const rect = (x, y, w, h) => c.fillRect(u(x), u(y), Math.max(1, u(x + w) - u(x)), Math.max(1, u(y + h) - u(y)))
    const mirror = fn => { fn(1); fn(-1) }
    // (x from the centre line outward on side sx)
    const side = (sx, x, y, w, h) => sx > 0 ? rect(x, y, w, h) : rect(-x - w, y, w, h)

    const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
    const glow = Math.max(0, Math.min(1, pose.eyeGlow ?? 0))
    const walking = state === 'walk'
    const F = walking ? frameOf(pose.t, p.gaitFreq, 4) : 0
    const snap = state === 'attack' ? frameOf(stateT, 8, 2) : 0
    const dead = state === 'death'
    const deathF = dead ? Math.min(1, Math.floor(stateT / 0.25)) : 0

    c.save()
    // ---- buried: the mound, and what pokes out of it -------------------------
    if (sink > 0) {
      c.save()
      c.globalAlpha *= sink
      // shaking the sand off as it bursts out
      const shake = sink < 1 ? (frameOf(pose.t, 20, 2) ? 1 : -1) : 0
      c.translate(shake, 0)
      c.fillStyle = SAND.shade
      rect(-6, -3, 12, 8); rect(-5, -4, 10, 10); rect(-3, -5, 6, 12)
      c.fillStyle = SAND.base
      rect(-5, -3, 10, 6); rect(-4, -4, 8, 8); rect(-2, -5, 4, 9)
      c.fillStyle = SAND.light
      rect(-3, -4, 5, 2); rect(-4, -3, 2, 3)
      // the sting's tip, and the two eyes at the mound's front
      c.fillStyle = sting.outline
      rect(-1, 0, 3, 3)
      c.fillStyle = sting.base
      rect(-1, 0, 2, 2)
      c.fillStyle = shell.outline
      rect(-3, -6, 2, 2); rect(1, -6, 2, 2)
      c.fillStyle = eye
      rect(-3, -6, 1, 1); rect(2, -6, 1, 1)
      c.restore()
    }
    if (sink >= 1) { c.restore(); return }
    c.globalAlpha *= 1 - sink
    if (dead) { c.globalAlpha *= deathF ? 0.5 : 1; c.scale(1, deathF ? 0.6 : 0.85) }

    // ---- legs: four a side, two sets stepping in turn --------------------------
    c.fillStyle = shell.outline
    const LEGS = [-4, -2, 0, 2]
    mirror(sx => LEGS.forEach((y, i) => {
      const set = (i + (sx > 0 ? 0 : 1)) % 2
      const step = walking ? [[1, -1], [0, 0], [-1, 1], [0, 0]][F][set] : 0
      const splay = dead ? 1 : 0
      const lean = i < 2 ? -1 : 1                    // front legs reach forward, hind legs back
      side(sx, BODY.halfW, y + step, LEG_OUT - 1 + splay, 1)
      side(sx, BODY.halfW + LEG_OUT - 2 + splay, y + step + (lean < 0 ? -1 : 0), 1, 2)
      side(sx, BODY.halfW + LEG_OUT - 1 + splay, y + step + lean, 1, 1)
    }))

    // ---- pincers: an arm out and forward, a claw of two fingers -----------------
    const reach = snap ? -2 : state === 'attack' ? -1 : 0
    const open = state === 'attack' ? (snap ? 0 : 2) : walking ? 1 : (frameOf(pose.t, 2, 2) ? 1 : 0)
    mirror(sx => {
      // (open 0: the fingers shut; 1: a little apart; 2: wide)
      const inner = open ? 3 : 4, outer = 6 + (open > 1 ? 1 : 0)
      c.fillStyle = claw.outline
      side(sx, 2, -8 + reach, 4, 3)                   // the arm, out from the head's corner
      side(sx, 4, -10 + reach, 4, 3)                  // the elbow
      side(sx, 3, -12 + reach, 6, 4)                  // the palm
      side(sx, inner, -14 + reach, 2, 3)              // the inner finger
      side(sx, outer, -15 + reach, 2, 4)              // the outer finger, the longer
      c.fillStyle = claw.base
      side(sx, 3, -7 + reach, 2, 1)
      side(sx, 5, -9 + reach, 2, 1)
      side(sx, 4, -11 + reach, 4, 2)
      side(sx, outer, -14 + reach, 1, 3)
      c.fillStyle = claw.light
      side(sx, 6, -11 + reach, 2, 1)
      side(sx, inner + 1, -13 + reach, 1, 2)
    })

    // ---- body: head plate and ringed abdomen ------------------------------------
    const hw = BODY.halfW, kw = BODY.headW
    c.fillStyle = shell.outline
    rect(-hw - 1, BODY.waist, 2 * hw + 2, BODY.rear - BODY.waist)
    rect(-hw, BODY.waist - 1, 2 * hw, BODY.rear - BODY.waist + 2)
    rect(-hw + 1, BODY.rear, 2 * hw - 2, 2)
    rect(-kw - 1, BODY.head + 1, 2 * kw + 2, BODY.waist - BODY.head)
    rect(-kw, BODY.head, 2 * kw, 2)
    c.fillStyle = shell.base
    rect(-hw, BODY.waist, 2 * hw, BODY.rear - BODY.waist)
    rect(-hw + 1, BODY.rear, 2 * hw - 2, 1)
    rect(-kw, BODY.head + 1, 2 * kw, BODY.waist - BODY.head - 1)
    c.fillStyle = shell.light
    rect(-hw + 1, BODY.waist, 2, BODY.rear - BODY.waist)
    rect(-kw + 1, BODY.head + 1, 2, 2)
    c.fillStyle = shell.outline
    for (let y = BODY.waist + 1; y < BODY.rear; y += 2) rect(-hw, y, 2 * hw, 1)
    rect(-hw, BODY.waist - 1, 2 * hw, 1)
    c.fillStyle = eye
    rect(-2, BODY.head + 1, 1, 1); rect(1, BODY.head + 1, 1, 1)

    // ---- tail ------------------------------------------------------------------
    const tail = tailAt(glow)
    const up = glow > 0
    tail.links.forEach(([x, y, w], i) => {
      const bulb = i === tail.links.length - 1
      const pal = bulb ? sting : shell
      c.fillStyle = pal.outline
      rect(x - w / 2 - 1, y - 2.5, w + 2, 5)
      // a link held up over the back is nearer the eye: lighter
      c.fillStyle = bulb || (up && i > 0) ? pal.light : pal.base
      rect(x - w / 2, y - 1.5, w, 3)
      c.fillStyle = pal.base
      rect(x - w / 2, y + 0.5, w, 1)
    })
    // the sting itself: a dark hook off the bulb, pointing forward
    const [tx, ty] = tail.tip
    c.fillStyle = sting.outline
    rect(tx - 1, ty, 2, 3)
    c.fillStyle = hit ? WHITE : '#2a1408'
    rect(tx - 0.5, ty, 1, 2)
    c.restore()
  })
}
