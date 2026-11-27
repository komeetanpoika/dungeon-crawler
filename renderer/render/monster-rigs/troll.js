// The mountain trolls (Vuorenpeikot), drawn upright and from the front the
// way a sheet creature is: a troll does not turn with its heading, it faces
// left or right (the nose, the tail and what it carries swap sides). Rect-only
// art on the shared pixel stage at angle 0, in art px (TILE_ART_PX a tile).
// One body plan at any `scale`: squat and wide, about 1.3 tiles tall at
// scale 1, a heavy brow over two small eyes, a big nose, two tusks, moss on
// stone-grey skin, long arms, a tufted tail. Its feet stand FOOT art px below
// the entity's centre at every scale, so a big one grows upward.
//
// `role` is what he holds and wears:
//   0  the fighter (Möhkäle): a great stone slab on his leading arm, a club
//      (in a swing: down in front as the blow lands, then up and back)
//   1  the mage (Louhija): a staff topped by a rock, a necklace of stones
//   2  the drummer (Rumpali): a war drum slung in front, two sticks
//   3  the King (Vuorenkuningas, at scale 2.2): a crown of rock, a beard,
//      bigger fists
//
// Channels the hooks write (systems/monsters/mohkale.js, louhija.js,
// rumpali.js, vuorenkuningas.js; all but eyeGlow through `e.channels`):
//   pose.eyeGlow  0..1, a wind-up: the eyes light; the mage's staff goes up
//                 with it and the rock on it glows
//   pose.slab     0..1, the fighter's slab: 1 = up, held broad before him,
//                 his eyes over its rim; 0 = down, edge-on at his side
//   pose.drum     the drummer's beat: 0 = sticks at rest; above 0 he drums,
//                 the whole part's parity says which stick, the fraction how
//                 far into the beat (down on the hide early, then up again)
//   pose.stirred  above 0 the drum has him: red eyes, steam off his head
//   pose.side     1 he faces right, -1 left; without it (the bench's stage,
//                 a preview) the side his heading leans to
//   pose.lift     0..1, the King's boulder: from the ground up over his head
//   pose.rear     0..1, the King reared for a stomp: a foot and both fists up
//   pose.bellow   0..1, the King calling his hall: head back, mouth wide
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'troll'

export const PARAM_SCHEMA = [
  { key: 'scale',      label: 'Size',   group: 'body', type: 'range', min: 0.7, max: 2.6, step: 0.05, default: 1 },
  { key: 'role',       label: 'Role (0 fighter, 1 mage, 2 drummer, 3 king)', group: 'body', type: 'range', min: 0, max: 3, step: 1, default: 0 },
  { key: 'skinColor',  label: 'Skin',   group: 'skin', type: 'color', default: '#6e766e' },
  { key: 'mossColor',  label: 'Moss',   group: 'skin', type: 'color', default: '#5c9a3c' },
  { key: 'stoneColor', label: 'Stone',  group: 'skin', type: 'color', default: '#a3a6b0' },
  { key: 'woodColor',  label: 'Wood and hide', group: 'skin', type: 'color', default: '#8a5a30' },
  { key: 'eyeColor',   label: 'Eyes',   group: 'skin', type: 'color', default: '#ffd23a' },
  { key: 'gaitFreq',   label: 'Gait frequency', group: 'motion', type: 'range', min: 3, max: 12, step: 0.5, default: 6 },
]

const R = Math.round
const WHITE = '#f8f8f8'
export const SHADOW = '#14171a'
const TUSK = '#f0ead8'
const HIDE = '#e6d6ac'        // the drum's skin
const BEARD = '#d6dacc'
const HOT = '#ff3a2a'         // a stirred troll's eyes
const STEAM = '#e4eaea'
const MAW = '#3a1016'
const clamp01 = v => Math.max(0, Math.min(1, v ?? 0))
const lerp = (a, b, f) => a + (b - a) * f
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)
const mix = (a, b, f) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ch = sh => R(((pa >> sh) & 255) * (1 - f) + ((pb >> sh) & 255) * f)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

// Art px at scale 1, y up from the feet (negative).
export const FOOT = 6           // the feet stand this far below the entity's centre, at any scale
const H = 21                    // crown of the head above the feet
const REACH_UP = 39             // the tallest thing drawn: the King's boulder over his head
const REACH_OUT = 17            // the widest: a club swung out in front
const roleOf = p => Math.max(0, Math.min(3, R(p.role ?? 0)))
const facesLeft = pose => pose?.side ? pose.side < 0 : Math.cos(pose?.facing ?? 0) < -0.01

function dims(p) {
  const sc = p.scale
  return { sc, artW: ceilTile(2 * REACH_OUT * sc), artH: ceilTile(2 * REACH_UP * sc) }
}

// How tall he stands, in art px at the params' scale.
export function height(p) { return R(H * p.scale) }

// Where blades and shots land (systems/hitbox.js): a circle on his trunk that
// reaches down to his feet, in screen px at 32-px tiles.
export function hitShape(p) {
  const r = Math.max(8, Math.min(28, R(6.5 * 2 * p.scale)))
  return { r, oy: -(r - FOOT * 2) }
}
// Collision and nav: never wider than one tile's clearance, so the King
// walks his hall as his band does.
export function hitHalf(p) { return Math.max(8, Math.min(16, R(4 * 2 * p.scale))) }
// Where the drawing tops out, in px from the centre (up is negative): the
// health bar goes above it.
export function drawnTop(p, S) {
  return -R(((roleOf(p) === 3 ? H + 5 : H + 1) * p.scale - FOOT) * S / TILE_ART_PX)
}
// A point of the drawing, in px from the centre at tile size S: 'head',
// 'chest', 'drum' (the hide), 'hand' (what the leading hand holds up: the
// staff's rock, a boulder over the head).
export function anchor(p, pose, S, which) {
  const k = S / TILE_ART_PX, sc = p.scale, side = facesLeft(pose) ? -1 : 1
  const at = (x, y) => ({ x: R(x * sc * side * k), y: R((FOOT + y * sc) * k) })
  if (which === 'head') return at(0, -16)
  if (which === 'drum') return at(0, -12)
  if (which === 'hand') return roleOf(p) === 3 ? at(0, -28) : at(9, -25 - 7 * clamp01(pose?.eyeGlow))
  return at(0, -9)
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  withPixelStage(ctx, d.artW, d.artH, 0, S, c => draw(c, p, pose, d.sc))
}

function draw(c, p, pose, sc) {
  const { state } = pose
  const t = pose.t ?? 0, stateT = pose.stateT ?? 0
  const hit = state === 'hit', dead = state === 'death', walking = state === 'walk', swinging = state === 'attack'
  const flat = col => hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(col)
  const one = col => hit ? WHITE : col
  const skin = flat(p.skinColor), moss = flat(p.mossColor), stone = flat(p.stoneColor), wood = flat(p.woodColor)
  const nose = flat(mix(p.skinColor, '#d08a78', 0.5))
  const shade = one(mix(skin.base, skin.outline, 0.45))
  const role = roleOf(p)
  const king = role === 3

  const glow = clamp01(pose.eyeGlow)
  const slab = role === 0 ? clamp01(pose.slab) : 0
  const drum = role === 2 ? Math.max(0, pose.drum ?? 0) : 0
  const lift = king ? clamp01(pose.lift) : 0
  const rear = king ? clamp01(pose.rear) : 0
  const bellow = king ? clamp01(pose.bellow) : 0
  const stirred = (pose.stirred ?? 0) > 0
  const fall = dead ? Math.min(1, stateT / 0.3) : 0

  const u = v => R(v * sc)
  // a rect given in scale-1 art px: edges are rounded, never the size, so
  // neighbouring rects still meet at any scale
  // (a fallen one is cut off at the ground it lies on)
  const rect = (x, y, w, h) => {
    if (dead) { h = Math.min(y + h, 1) - y; if (h <= 0) return }
    c.fillRect(u(x), u(y), Math.max(1, u(x + w) - u(x)), Math.max(1, u(y + h) - u(y)))
  }
  const fill = col => { c.fillStyle = col }
  // rects of one material as one silhouette: every outline, then every fill
  const shape = (pal, rects, tone = 'base') => {
    fill(pal.outline); for (const [x, y, w, h] of rects) rect(x - 1, y - 1, w + 2, h + 2)
    fill(pal[tone]); for (const [x, y, w, h] of rects) rect(x, y, w, h)
  }

  c.save()
  c.translate(0, FOOT)
  if (facesLeft(pose)) c.scale(-1, 1)

  // ---- his shadow ----------------------------------------------------------------
  c.save()
  c.globalAlpha *= 0.28
  fill(SHADOW)
  rect(-9, -2, 18, 4); rect(-7, -3, 14, 6)
  c.restore()

  // ---- the gait --------------------------------------------------------------------
  const F = walking ? frameOf(t, p.gaitFreq, 4) : 0
  const stepL = walking && F === 0 ? 1 : 0, stepR = walking && F === 2 ? 1 : 0
  const breath = !walking && !dead && frameOf(t, 1.3, 2) ? 1 : 0
  // the trunk: a lumbering dip on each planted foot, up when he rears, down as he falls
  const by = (walking && F % 2 ? 1 : 0) - R(rear * 3) + R(fall * 7)
  const lean = walking ? [-1, 0, 1, 0][F] : 0                      // he rolls from foot to foot
  const hy = by + breath - (bellow > 0 ? 1 : 0) + R(fall * 2)     // the head
  const bx = lean

  // ---- tail: out behind, a tuft at its end ----------------------------------------
  if (!dead) {
    const wag = frameOf(t, 2, 2) ? 0 : 1
    shape(skin, [[-9 + bx, -6 + by, 3, 1], [-11 + bx, -8 + by - wag, 2, 3]])
    shape(wood, [[-13 + bx, -12 + by - wag, 3, 4]], 'outline')
    fill(wood.base); rect(-12 + bx, -12 + by - wag, 1, 2)
  }

  // ---- what the trailing hand holds, behind him -------------------------------------
  // (hands as [x, y] of the fist's middle)
  const swing = walking ? [-1, 0, 1, 0][F] : 0
  let back = [-8 + bx, -5 + by + swing], front = [7 + bx, -5 + by - swing]
  const fist = king ? 6 : 4
  // a swing lands as it starts (the weapon has no wind-up): the blow first, then the arm coming back
  const early = swinging && stateT < 0.16

  if (role === 0) {
    // the club: on his shoulder, up over his head as the swing starts, then down in front
    if (dead) shape(wood, [[-14, -2, 8, 2], [-17, -3, 4, 4]])
    else if (swinging && !early) { back = [-8 + bx, -19 + by]; shape(wood, [[-9 + bx, -28 + by, 2, 9], [-11 + bx, -33 + by, 5, 6]]); fill(stone.light); rect(-8 + bx, -31 + by, 2, 2) }
    else if (swinging) back = [3 + bx, -9 + by]
    else { back = [-8 + bx, -8 + by + swing]; shape(wood, [[-9 + bx, -17 + by + swing, 2, 8], [-11 + bx, -22 + by + swing, 5, 6]]); fill(wood.light); rect(-11 + bx, -22 + by + swing, 2, 2); fill(stone.light); rect(-8 + bx, -20 + by + swing, 2, 2) }
    front = slab > 0.5 ? [6 + bx, -9 + by] : [8 + bx, -6 + by]
  } else if (role === 1) {
    back = [-8 + bx, -5 + by + swing - R(glow * 13)]
    front = [8 + bx, -10 + by - R(glow * 7)]
  } else if (role === 2) {
    back = [-8 + bx, -11 + by]; front = [7 + bx, -11 + by]
    if (drum > 0) {
      const which = Math.floor(drum) % 2, down = drum % 1 < 0.45
      const struck = [5, -14 + by], up = [8, -18 + by]
      const b = which === 0 ? (down ? struck : up) : up, f = which === 1 ? (down ? struck : up) : up
      back = [-b[0] + bx, b[1]]; front = [f[0] - 1 + bx, f[1]]
    }
  } else {
    if (lift > 0) {
      // his hands at the boulder's sides while it is before him, under it once it is over his head
      const cy = lerp(-5, -31, lift) + by, over = cy < -24 + by
      back = over ? [-6 + bx, cy + 6] : [-7 + bx, cy + 2]; front = over ? [5 + bx, cy + 6] : [6 + bx, cy + 2]
    } else if (rear > 0) { back = [-10 + bx, lerp(-5, -23, rear) + by]; front = [9 + bx, lerp(-5, -24, rear) + by] }
    else if (bellow > 0) { back = [-11 + bx, -8 + by]; front = [10 + bx, -8 + by] }
    else if (swinging) front = early ? [13 + bx, -11 + by] : [9 + bx, -9 + by]
  }
  if (dead) { back = [-10, -2]; front = [9, -2] }

  // an arm: down (or up) from the shoulder, across to the hand, a fist
  const arm = (side, [hx, hy0], size = fist) => {
    const sx = side > 0 ? 6 + bx : -9 + bx, sy = -13 + by
    const hyy = R(hy0)
    const y0 = Math.min(sy, hyy - 1), y1 = Math.max(sy + 3, hyy + 1)
    const x0 = Math.min(sx, hx - 1), x1 = Math.max(sx + 3, hx + 1)
    shape(skin, [[sx, y0, 3, y1 - y0], [x0, hyy - 1, x1 - x0, 3], [hx - size / 2, hyy - size / 2, size, size]])
    fill(skin.light); rect(hx - size / 2 + 1, hyy - size / 2, size - 2, 1)
    fill(shade); rect(hx - size / 2, hyy + size / 2 - 1, size, 1)
  }
  arm(-1, back)

  // ---- legs, trunk, head: one silhouette --------------------------------------------
  const legs = dead ? [] : [
    [-5 + stepL, -5 - stepL, 4, 5 + stepL - (stepL ? 1 : 0)], [-5 + stepL, -2 - stepL, 5, 2],
    [1 + stepR + R(rear * 2), -5 - stepR - R(rear * 4), 4, 5 + stepR - (stepR ? 1 : 0)], [1 + stepR + R(rear * 2), -2 - stepR - R(rear * 4), 5, 2],
  ]
  shape(skin, [
    ...legs,
    [-6 + bx, -12 + by, 12, 8], [-5 + bx, -13 + by, 10, 10],                                     // the trunk
    [-5 + bx, -20 + hy, 11, 9], [-4 + bx, -21 + hy, 9, 1],                                       // the head
    [-7 + bx, -18 + hy, 2, 3], [6 + bx, -18 + hy, 2, 3], [-8 + bx, -19 + hy, 1, 2], [8 + bx, -19 + hy, 1, 2],   // ears
  ])
  // toes, the belly, the shade under the chin and down his back
  if (!dead) { fill(skin.light); rect(-1 + stepL, -2 - stepL, 1, 1); rect(5 + stepR + R(rear * 2), -2 - stepR - R(rear * 4), 1, 1) }
  fill(skin.light); rect(-2 + bx, -10 + by, 6, 5); rect(-1 + bx, -11 + by, 4, 1)
  fill(shade); rect(-6 + bx, -11 + by, 2, 7); rect(-5 + bx, -4 + by, 10, 1); rect(-4 + bx, -11 + hy, 9, 1)
  // a hide round his hips
  fill(wood.outline); rect(-6 + bx, -6 + by, 12, 2); rect(-5 + bx, -4 + by, 2, 1); rect(-1 + bx, -4 + by, 3, 1); rect(4 + bx, -4 + by, 1, 1)
  // moss: on his crown, an ear, a shoulder
  fill(moss.base); rect(-5 + bx, -21 + hy, 6, 1); rect(-5 + bx, -20 + hy, 3, 1); rect(-6 + bx, -13 + by, 3, 2); rect(3 + bx, -13 + by, 2, 1)
  fill(moss.light); rect(-4 + bx, -21 + hy, 2, 1); rect(-6 + bx, -13 + by, 1, 1)

  if (role === 1) {
    // the mage's mantle of fur, over his shoulders and across his chest
    fill(wood.outline); rect(-9 + bx, -14 + by, 4, 4); rect(5 + bx, -14 + by, 4, 4); rect(-7 + bx, -10 + by, 14, 3); rect(-5 + bx, -7 + by, 10, 1)
    fill(wood.base); rect(-9 + bx, -14 + by, 3, 1); rect(6 + bx, -14 + by, 3, 1); rect(-6 + bx, -8 + by, 1, 1); rect(5 + bx, -8 + by, 1, 1)
  }

  // ---- the face ----------------------------------------------------------------------
  // the brow, heavy, out past the head on the side he faces
  fill(skin.outline); rect(-4 + bx, -18 + hy, 11, 2)
  fill(shade); rect(-4 + bx, -19 + hy, 10, 1)
  // eyes, deep under it
  const eyeCol = dead ? skin.outline : stirred ? one(HOT) : glow > 0 ? flat(p.eyeColor).light : one(p.eyeColor)
  const eyeH = !dead && (stirred || glow >= 0.5) ? 2 : 1
  fill(eyeCol); rect(-3 + bx, -16 + hy, 2, eyeH); rect(4 + bx, -16 + hy, 2, eyeH)
  // the nose: a bridge and a bulb, hanging over the mouth
  fill(nose.outline); rect(-1 + bx, -16 + hy, 5, 5); rect(-2 + bx, -14 + hy, 7, 4)
  fill(nose.base); rect(0 + bx, -16 + hy, 3, 3); rect(-1 + bx, -14 + hy, 5, 3)
  fill(nose.light); rect(2 + bx, -14 + hy, 2, 1); rect(1 + bx, -16 + hy, 1, 2)
  // the mouth, two tusks up from the lower jaw
  if (bellow > 0) { fill(one(MAW)); rect(-3 + bx, -11 + hy, 9, 4); fill(one('#b0303a')); rect(-1 + bx, -9 + hy, 5, 2) }
  else { fill(skin.outline); rect(-3 + bx, -10 + hy, 9, 1) }
  fill(one(TUSK)); rect(-4 + bx, -12 + hy, 1, 3); rect(6 + bx, -12 + hy, 1, 3)

  // ---- what each one wears -------------------------------------------------------------
  if (role === 1) {
    // a necklace of stones on his mantle
    for (let i = 0; i < 6; i++) {
      fill(i % 2 ? stone.light : stone.base)
      rect(-6 + i * 2 + bx + (i > 2 ? 1 : 0), -9 + by + (i === 0 || i === 5 ? -1 : i === 2 || i === 3 ? 1 : 0), 2, 2)
    }
  }
  if (king) {
    // the beard, down over his belly
    shape({ outline: one(mix(BEARD, '#40443c', 0.6)), base: one(BEARD) }, [[-4 + bx, -8 + hy, 10, 2], [-3 + bx, -6 + hy, 8, 3], [-2 + bx, -3 + hy, 6, 2], [-1 + bx, -1 + hy, 3, 1]])
    fill(one(mix(BEARD, '#40443c', 0.35))); rect(-2 + bx, -7 + hy, 1, 4); rect(1 + bx, -6 + hy, 1, 5); rect(4 + bx, -7 + hy, 1, 3)
    if (bellow > 0) { fill(one(MAW)); rect(-3 + bx, -11 + hy, 9, 4); fill(one(TUSK)); rect(-4 + bx, -12 + hy, 1, 3); rect(6 + bx, -12 + hy, 1, 3) }
    // the crown: three teeth of rock on a band
    shape(stone, [[-5 + bx, -22 + hy, 11, 2], [-5 + bx, -24 + hy, 2, 2], [-1 + bx, -26 + hy, 3, 4], [4 + bx, -24 + hy, 2, 2]])
    fill(stone.light); rect(-5 + bx, -24 + hy, 1, 1); rect(-1 + bx, -26 + hy, 1, 2); rect(4 + bx, -24 + hy, 1, 1); rect(-4 + bx, -22 + hy, 8, 1)
    fill(one(p.eyeColor)); rect(0 + bx, -22 + hy, 1, 1)
  }
  if (role === 2) {
    // the war drum: a tub of staves laced with hide, its skin up
    const dy = dead ? 4 : by
    shape(wood, [[-6 + bx, -10 + dy, 13, 7], [-5 + bx, -3 + dy, 11, 1]])
    fill(wood.light); rect(-5 + bx, -10 + dy, 2, 7)
    fill(wood.outline); for (const x of [-3, 0, 3]) rect(x + bx, -9 + dy, 1, 6)
    fill(one('#b0303a')); rect(-6 + bx, -7 + dy, 13, 1)
    shape({ outline: wood.outline, base: one(HIDE) }, [[-6 + bx, -12 + dy, 13, 2]])
    fill(one(WHITE)); rect(-4 + bx, -12 + dy, 5, 1)
  }

  // ---- what the leading hand holds, before him ---------------------------------------------
  if (role === 0) {
    arm(1, front)
    if (swinging && early) {
      // the club brought down in front
      shape(wood, [[4 + bx, -10 + by, 8, 2], [11 + bx, -12 + by, 5, 5]])
      fill(wood.light); rect(11 + bx, -12 + by, 2, 1)
      arm(-1, back)
    }
    // the slab: broad before him when it is up, edge-on at his side when down
    const x0 = dead ? 6 : lerp(9, 0, slab) + bx, w = dead ? 10 : lerp(3, 11, slab)
    const y0 = dead ? -3 : lerp(-13, -15, slab) + by, h = dead ? 3 : lerp(12, 14, slab)
    shape(stone, [[x0, y0, w, h], [x0 + 1, y0 - 1, Math.max(1, w - 3), 1]])
    fill(stone.light); rect(x0, y0, Math.max(1, w - 1), 1); rect(x0, y0, 1, h - 2)
    if (w > 6) {
      fill(stone.outline); rect(x0 + 3, y0 + 3, 1, 4); rect(x0 + 4, y0 + 6, 3, 1); rect(x0 + w - 3, y0 + 9, 1, 3); rect(x0 + 6, y0 + 2, 2, 1)
      fill(moss.base); rect(x0 + 1, y0 + h - 3, 3, 2); rect(x0 + w - 3, y0 + 1, 2, 1)
      // his fingers over its rim
      fill(skin.base); rect(x0 + 2, y0 - 1, 3, 2)
      fill(skin.outline); rect(x0 + 2, y0 + 1, 3, 1)
    }
  } else if (role === 1) {
    // the staff, a rock lashed to its top
    const up = R(glow * 7)
    if (dead) { shape(wood, [[2, -2, 14, 2]]); shape(stone, [[14, -4, 4, 4]]) }
    else {
      shape(wood, [[8 + bx, -24 + by - up, 2, 24 - R(glow * 2)]])
      shape(stone, [[6 + bx, -28 + by - up, 6, 5], [7 + bx, -29 + by - up, 4, 1]])
      fill(stone.light); rect(6 + bx, -28 + by - up, 3, 2)
      fill(wood.outline); rect(7 + bx, -23 + by - up, 4, 1)
      if (glow > 0) {
        // it lights from inside, and grit lifts off the ground round it
        fill(flat(p.eyeColor).light); rect(8 + bx, -27 + by - up, 2, 2)
        if (glow > 0.4) { fill(one(p.eyeColor)); rect(7 + bx, -26 + by - up, 4, 1); rect(9 + bx, -28 + by - up, 1, 4) }
        const f = frameOf(t, 10, 4)
        fill(stone.base)
        for (let i = 0; i < 4; i++) rect([3, 13, 5, 12][i] + bx, -30 + by - up - ((i + f) % 4) - R(glow * 2), 1, 1)
      }
      arm(1, front)
    }
  } else if (role === 2) {
    arm(1, front)
    if (!dead) {
      // the sticks: from each fist to the hide, or up in the air
      const stick = ([hx, hy0], side) => {
        const high = hy0 < -15 + by
        const tip = high ? [hx + side * 1, hy0 - 6] : [hx - side * 3, hy0 + 1]
        fill(one('#3c2a1a'))
        for (let i = 0; i <= 3; i++) rect(lerp(hx, tip[0], i / 3) - 1, lerp(hy0, tip[1], i / 3) - 1, 3, 3)
        fill(one(TUSK))
        for (let i = 0; i <= 3; i++) rect(lerp(hx, tip[0], i / 3), lerp(hy0, tip[1], i / 3), 1, 1)
        rect(tip[0] - 1 + (side > 0 ? 0 : 1), tip[1], 2, 2)
        if (!high && drum > 0) { fill(one(WHITE)); rect(tip[0] - 2, tip[1] + 1, 5, 1) }
      }
      stick(back, -1); stick(front, 1)
    }
  } else {
    arm(1, front)
    if (lift > 0) {
      // the boulder: off the ground, up his chest, over his head
      const cy = lerp(-5, -31, lift) + by, over = cy < -24 + by
      arm(-1, back)
      boulder(rect, fill, stone, moss, bx, cy, 6)
      // his hands on it: under it once it is up, at its sides before
      const hy1 = over ? cy + 4 : cy
      shape(skin, [[-8 + bx, hy1, 3, 3], [5 + bx, hy1, 3, 3]])
      fill(skin.light); rect(-8 + bx, hy1, 3, 1); rect(5 + bx, hy1, 3, 1)
    }
  }

  // ---- stirred: steam off his head ---------------------------------------------------------
  if (stirred && !dead) {
    const f = frameOf(t, 7, 4), top = king ? -28 : -23
    fill(one(STEAM))
    rect(-4 + bx, top + hy - f, 2, 2); rect(4 + bx, top + hy - ((f + 2) % 4), 2, 2); rect(0 + bx, top - 2 + hy - ((f + 1) % 4), 1, 1)
  }
  // ---- the bellow: it shakes the air ---------------------------------------------------------
  if (bellow > 0 && !dead) {
    const f = frameOf(t, 9, 3)
    fill(one(WHITE))
    for (const side of [-1, 1]) { rect(side * (12 + f * 2) + bx, -14 + hy, 1, 5); rect(side * (15 + f * 2) + bx, -16 + hy, 1, 9) }
  }
  c.restore()
}

// A round rock, r art px in radius at scale 1, about (x, y): the King's
// boulder in his hands (the one that rolls is the hook's own drawing).
function boulder(rect, fill, stone, moss, x, y, r) {
  fill(stone.outline)
  rect(x - r - 1, y - r + 2, 2 * r + 2, 2 * r - 4); rect(x - r + 1, y - r, 2 * r - 2, 2 * r); rect(x - r + 3, y - r - 1, 2 * r - 6, 2 * r + 2)
  fill(stone.base)
  rect(x - r, y - r + 2, 2 * r, 2 * r - 4); rect(x - r + 1, y - r + 1, 2 * r - 2, 2 * r - 2); rect(x - r + 3, y - r, 2 * r - 6, 2 * r)
  fill(stone.light)
  rect(x - r + 2, y - r + 1, r, 2); rect(x - r + 1, y - r + 3, 2, 3)
  fill(stone.outline)
  rect(x + 1, y - 1, 1, 4); rect(x + 2, y + 2, 3, 1); rect(x - 3, y + 2, 1, 2)
  fill(moss.base)
  rect(x + 2, y - r + 1, 3, 1); rect(x - r + 1, y + 1, 2, 2)
}
