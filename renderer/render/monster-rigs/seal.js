// The seal folk (Norppaväki), drawn upright the way a sheet creature is: a
// ringed seal sitting up on its hind flippers, seen from the front, mirrored
// left or right by its facing and never turned. Rect-only art on the art-px
// grid (TILE_ART_PX per tile), straight onto the canvas. The origin is the
// middle of its tile; it sits on the tile's lower edge.
//
// One body at any `scale`, dressed by `role`:
//   0  the trader    a pack and a bedroll on its back, a strap, a necklace
//                    of shells
//   1  the singer    a wreath of kelp and flowers
//   2  the guard     a harpoon held upright, a limpet-shell cap, a strap
//   3  the walrus    (at scale 2) tusks, a great moustache, rolls of
//                    blubber, a champion's belt
// It does not walk: it gallumphs, gathering itself and throwing itself
// forward, four frames a hump.
//
// Channels its hooks write (systems/monsters/norppa*.js, mursu.js):
//   pose.eyeGlow  a wind-up. The guard: the harpoon goes back over the
//                 shoulder; at 1 the arm is flung forward and the hand is
//                 empty. The walrus: he rears up, flippers wide
//   pose.charge   the walrus's head goes down, tusks forward (the tusk
//                 charge, wind-up and rush)
//   pose.air      0..1, how far off the ground he is in the belly flop
//   pose.winded   he sits slumped, eyes crossed, tongue out, stars round his head
//   pose.bellow   his mouth wide open
//   pose.laugh    sat down laughing (he has yielded)
//   pose.sing     the singer: eyes shut, mouth open, swaying, flippers waving
//   pose.doze     curled up asleep
//   pose.side     1 it faces right, -1 left (the hooks keep it steady while
//                 it goes straight up or down the screen); without it (the
//                 bench's stage, a preview) the side its heading leans to
import { TILE_ART_PX, frameOf } from './pixel.js'

export const RIG_ID = 'seal'

export const PARAM_SCHEMA = [
  { key: 'scale',       label: 'Size',          group: 'body', type: 'range', min: 0.8, max: 2.4, step: 0.05, default: 1 },
  { key: 'role',        label: 'Role (0 trader, 1 singer, 2 guard, 3 walrus)', group: 'body', type: 'range', min: 0, max: 3, step: 1, default: 0 },
  { key: 'bodyColor',   label: 'Hide',          group: 'skin', type: 'color', default: '#75828f' },
  { key: 'bellyColor',  label: 'Belly',         group: 'skin', type: 'color', default: '#cfd6d2' },
  { key: 'ringColor',   label: 'Rings',         group: 'skin', type: 'color', default: '#c6d2da' },
  { key: 'gearColor',   label: 'Gear',          group: 'gear', type: 'color', default: '#8a5a2c' },
  { key: 'accentColor', label: 'Shells and flowers', group: 'gear', type: 'color', default: '#f08fa6' },
  { key: 'humpFreq',    label: 'Humps a second', group: 'motion', type: 'range', min: 1, max: 6, step: 0.1, default: 3 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const EYE = '#16181d', SHINE = '#ffffff', GLINT = '#a9b7c9', PINK = '#e8788c', MOUTH = '#3a1620'
const IVORY = '#f6eed8', IVORY_SHADE = '#cdbf9c', BONE = '#efe6cf', WOOD = '#7a5230', WOOD_DARK = '#4a3020'
const KELP = '#3f7d4e', KELP_DARK = '#28563a', GOLD = '#f2c94c', STAR = '#ffe14a', SLEEP = '#46536b', SHADOW = '#2a2418'
const BELT = '#2d5f66', BELT_DARK = '#1b3d44', BLANKET = '#d8c49a', STRIPE = '#b5523b', FLINT = '#39424f', FLINT_LIGHT = '#8b97ad'
const clamp01 = v => Math.max(0, Math.min(1, v ?? 0))

// a colour pulled towards black (f < 0) or white (f > 0), as #rrggbb
function tone(hex, f) {
  const n = parseInt(hex.slice(1), 16)
  const ch = sh => { const c = (n >> sh) & 255; return Math.max(0, Math.min(255, R(f < 0 ? c * (1 + f) : c + (255 - c) * f))) }
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

// The body's half-width (art px at scale 1) down its height, top to foot: a
// seal is a round head on a pear, a walrus a mound.
const SEAL = [[0, 1.5], [0.06, 3.5], [0.12, 4.6], [0.18, 5], [0.42, 5], [0.47, 4.6], [0.55, 5.3], [0.68, 6.1], [0.88, 6.2], [1, 4.4]]
const WALRUS = [[0, 2.6], [0.06, 3.5], [0.14, 4], [0.28, 4.3], [0.38, 5], [0.52, 6], [0.7, 6.7], [0.9, 7], [1, 6.3]]
const LIFT = 8               // art px a whole leap lifts it, at scale 1
function isWalrus(p) { return p.role >= 3 }
// art px tall, sitting: a seal is a tile, the walrus (at scale 2) nearly two
const heightOf = p => (isWalrus(p) ? 15 : 16) * p.scale
const footOf = sc => 7 + R((sc - 1) * 2)
function halfAt(profile, t) {
  for (let i = 1; i < profile.length; i++) if (t <= profile[i][0]) {
    const [t0, a] = profile[i - 1], [t1, b] = profile[i]
    return a + (b - a) * (t - t0) / (t1 - t0)
  }
  return profile[profile.length - 1][1]
}

// Hit extent (systems/hitbox.js): a disc on the body, in screen px at 32-px tiles.
export function hitShape(p) {
  const k = 32 / TILE_ART_PX
  return { r: R(5.5 * p.scale * k), oy: -R((heightOf(p) / 2 - footOf(p.scale)) * k), front: 0, back: 0 }
}
// (the walrus at scale 2 is 13: under a tile, so the mouth of his ring lets him through)
export function hitHalf(p) { return Math.max(8, Math.min(28, R(6.5 * p.scale))) }
// px from the centre to just over its head (or its harpoon's point), sitting: the health bar goes above
export function drawnTop(p, S) {
  const over = p.role === 2 ? 8 : p.role === 1 ? 3 : 2
  return -R((R(heightOf(p)) - footOf(p.scale) + over * Math.max(1, p.scale * 0.8)) * S / TILE_ART_PX)
}

// Everything the pose decides about the body before a rect is drawn.
function figure(p, pose) {
  const sc = p.scale, walrus = isWalrus(p)
  const glow = clamp01(pose.eyeGlow), charge = walrus ? clamp01(pose.charge) : 0
  const air = clamp01(pose.air), winded = clamp01(pose.winded), bellow = clamp01(pose.bellow), laugh = clamp01(pose.laugh)
  const sing = clamp01(pose.sing)
  const t = pose.t ?? 0
  const walking = pose.state === 'walk' || (pose.speed01 ?? 0) > 0.05
  const flip = (pose.side ? pose.side : Math.cos(pose.facing ?? 0)) < 0 ? -1 : 1
  let stretch = 1, wide = 1, lift = 0, lean = 0, tail = 0
  if (air > 0) { stretch = 0.84; wide = 1.14; lift = air * LIFT * sc }
  else if (walking && !winded && !laugh) {
    // gathered, pushing off, thrown forward, landing
    const fr = frameOf(t, p.humpFreq * (walrus ? 0.7 : 1) * 4, 4)
    ;[stretch, wide, lean, lift, tail] = [[0.88, 1.08, 0, 0, 0], [1, 1, 1, 0, 0], [1.1, 0.94, 2, 1.5, 2], [0.95, 1.04, 1, 0, 1]][fr]
    lean *= sc; lift *= sc; tail *= sc
  } else if (frameOf(t + (pose.seed ?? 0) * 0.37, 0.8, 2)) wide = 1.03   // a breath
  if (walrus) {
    const rear = glow * (1 - charge)
    stretch += 0.2 * rear - 0.3 * charge - 0.2 * winded + 0.05 * bellow - 0.08 * laugh
    wide += -0.05 * rear + 0.1 * charge + 0.08 * winded + 0.07 * bellow + 0.04 * laugh
    lift += rear * 1.2 * sc + (laugh && frameOf(t, 9, 2) ? 0.6 * sc : 0)
    lean += (3.5 * charge + 1.2 * bellow) * sc
  } else {
    if (sing) { stretch += 0.06; lean += (frameOf(t, 2.5, 2) ? 1 : -1) * sc }
    if (p.role === 2 && glow > 0) lean += (glow >= 1 ? 1.6 : -1.4 * glow) * sc
  }
  const H = Math.max(4, R(heightOf(p) * stretch))
  const foot = footOf(sc)
  const top = foot - R(lift) - H
  const profile = walrus ? WALRUS : SEAL
  const rows = []
  for (let i = 0; i < H; i++) {
    const f = (i + 0.5) / H, half = halfAt(profile, f) * sc * wide
    const cx = lean * (1 - f) ** 1.4
    rows.push({ y: top + i, x0: R(cx - half), x1: R(cx + half) })
  }
  const rowAt = f => rows[Math.max(0, Math.min(H - 1, Math.floor(f * H)))]
  const face = rowAt(walrus ? 0.14 : 0.15)
  return { sc, walrus, flip, glow, charge, air, winded, bellow, laugh, sing, t, walking, H, foot, top, lift, lean, tail, rows, rowAt,
    fx: (face.x0 + face.x1) / 2, fy: face.y }
}

// Where its head's top and its mouth are, px from the centre at tile size S
// (a hook's notes and rings start there).
export function anchor(p, pose, S, name) {
  const f = figure(p, pose), k = S / TILE_ART_PX
  const y = name === 'mouth' ? f.fy + (f.walrus ? 5 : 3) * f.sc * (f.walrus ? 0.5 : 1) : f.top
  return { x: f.flip * R(f.fx * k), y: R(y * k) }
}

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX
  const hit = pose.state === 'hit', dead = pose.state === 'death'
  const rect = (x, y, w, h, col) => {
    ctx.fillStyle = hit ? WHITE : col
    ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h)))
  }
  const body = { out: tone(p.bodyColor, -0.6), edge: tone(p.bodyColor, -0.42), shade: tone(p.bodyColor, -0.2), base: p.bodyColor, light: tone(p.bodyColor, 0.25) }
  const belly = { base: p.bellyColor, shade: tone(p.bellyColor, -0.14), light: tone(p.bellyColor, 0.45) }
  const f = figure(p, pose)
  ctx.save()
  ctx.scale(k * f.flip, k)
  if (dead || clamp01(pose.doze) > 0) lying(rect, p, pose, f, body, belly, dead)
  else if (f.walrus) walrus(ctx, rect, p, pose, f, body)
  else seal(ctx, rect, p, pose, f, body, belly)
  ctx.restore()
}

// ---- shared pieces --------------------------------------------------------------

function shadow(ctx, rect, f, halfW) {
  const w = Math.max(3, R(halfW * (1 - 0.35 * f.air)))
  ctx.save()
  ctx.globalAlpha *= 0.28
  rect(-w, f.foot - 2, 2 * w, 3, SHADOW)
  rect(-w + 2, f.foot - 3, 2 * w - 4, 5, SHADOW)
  ctx.restore()
}

// The body: its outline, its hide lit from behind it, and its pale front as a
// bib that starts narrow at `bellyFrom` and rounds out below.
function blob(rect, f, body, belly, bellyHalf, bellyFrom) {
  for (const r of f.rows) rect(r.x0 - 1, r.y - 1, r.x1 - r.x0 + 2, 3, body.out)
  for (const [i, r] of f.rows.entries()) {
    const w = r.x1 - r.x0, t = (i + 0.5) / f.H
    rect(r.x0, r.y, w, 1, body.base)
    rect(r.x0, r.y, Math.max(1, R(w * 0.12)), 1, body.light)
    rect(r.x1 - Math.max(1, R(w * 0.12)), r.y, Math.max(1, R(w * 0.12)), 1, body.shade)
    if (t >= bellyFrom && t < 0.96) {
      const bh = Math.max(1, R(w * bellyHalf * Math.min(1, (t - bellyFrom) * 7 + 0.45) * (t > 0.88 ? 0.8 : 1)))
      const cx = R((r.x0 + r.x1) / 2)
      rect(cx - bh, r.y, 2 * bh, 1, belly.base)
      rect(cx + bh - 1, r.y, 1, 1, belly.shade)
    }
  }
  rect(f.rows[0].x0 + 1, f.rows[0].y, Math.max(1, f.rows[0].x1 - f.rows[0].x0 - 2), 1, body.light)
}

// The hind flippers it sits on, splayed at its foot; `tail` trails them behind a hump.
function hindFlippers(rect, f, body) {
  const base = f.rows[f.H - 1], u = f.sc, y = f.foot - R(f.lift)
  const w = Math.max(3, R((f.walrus ? 3 : 3.4) * u)), h = Math.max(2, R(1.6 * u))
  for (const [x, dir] of [[base.x0 + 2 - R(f.tail), -1], [base.x1 - 2 - R(f.tail), 1]]) {
    const x0 = dir < 0 ? x - w : x
    rect(x0 - 1, y - h, w + 2, h + 1, body.out)
    rect(x0, y - h + 1, w, h - 1, body.shade)
    rect(dir < 0 ? x0 : x0 + w - 1, y - h + 1, 1, h - 1, body.base)
    rect(dir < 0 ? x0 + 1 : x0 + w - 2, y - 1, 1, 1, body.edge)   // the web between its toes
  }
}

// A front flipper: `how` 'down' along the side, 'out' level, 'up' raised, 'fore' forward and low.
function flipper(rect, f, body, side, how, len, thick) {
  const sh = f.rowAt(f.walrus ? 0.46 : 0.56)
  const x = side < 0 ? sh.x0 : sh.x1, y = sh.y
  const edge = f.walrus ? body.out : body.edge
  const box = (x0, y0, w, h) => { rect(x0 - 1, y0 - 1, w + 2, h + 2, edge); rect(x0, y0, w, h, body.shade); rect(x0, y0, w, 1, body.base) }
  if (how === 'down' && !f.walrus) {
    // a seal's hangs at its side like a fin, its tip turned out
    const x0 = side < 0 ? x - thick : x
    rect(x0 - 1, y - 1, thick + 2, len + 1, body.out)
    rect(side < 0 ? x0 - 2 : x0 + 1, y + len - 2, thick + 1, 3, body.out)
    rect(x0, y, thick, len - 1, body.shade)
    rect(side < 0 ? x0 - 1 : x0 + 1, y + len - 1, thick, 1, body.shade)
    rect(side < 0 ? x0 + thick - 1 : x0, y, 1, len - 1, body.base)
  } else if (how === 'down') box(side < 0 ? x - thick + 1 : x - 1, y, thick, len)
  else if (how === 'out') box(side < 0 ? x - len : x, y - 1, len, thick)
  else if (how === 'fore') box(side < 0 ? x - len : x, y + thick, len, thick)
  else {
    // raised: up from the shoulder and out at the tip
    box(side < 0 ? x - thick : x, y - len + 1, thick, len)
    box(side < 0 ? x - thick - R(thick * 0.8) : x + R(thick * 0.8), y - len, thick, Math.max(2, R(len * 0.45)))
  }
}

// A scallop shell, hinge down: a fan `w` wide and `h` tall with its ribs.
function scallop(rect, cx, y, w, h, col, edge) {
  const x = R(cx - w / 2)
  rect(x, y - 1, w, h + 1, edge); rect(x - 1, y, w + 2, h - 2, edge); rect(x + 1, y + h - 1, w - 2, 2, edge)
  rect(x + 1, y, w - 2, 1, tone(col, 0.5))
  rect(x, y + 1, w, Math.max(1, h - 3), col)
  rect(x + 1, y + h - 2, w - 2, 1, col)
  rect(x + R(w * 0.3), y + h - 1, Math.max(1, w - 2 * R(w * 0.3)), 1, tone(col, -0.25))
  for (let i = 1; i < w - 1; i += 2) rect(x + i, y + 1, 1, Math.max(1, h - 3), tone(col, -0.25))
}

// ---- the seal ----------------------------------------------------------------------

function seal(ctx, rect, p, pose, f, body, belly) {
  const u = f.sc, role = p.role
  const neck = f.rowAt(0.47), chest = f.rowAt(0.62)
  shadow(ctx, rect, f, 6.5 * u)

  // the trader's pack on its back, a striped blanket rolled across the top
  if (role === 0) {
    const gear = { base: p.gearColor, dark: tone(p.gearColor, -0.45), light: tone(p.gearColor, 0.22) }
    const w = R(7 * u), h = R(7 * u), x = neck.x0 - R(4 * u), y = neck.y - R(2 * u)
    rect(x - 1, y - 1, w + 2, h + 2, gear.dark)
    rect(x, y, w, h, gear.base)
    rect(x, y, R(2 * u), h, gear.light)
    rect(x, y + R(3 * u), w, 1, gear.dark); rect(x + R(1 * u), y + R(3 * u) + 1, R(2 * u), R(2 * u), gear.dark)
    const ry = y - R(3 * u), rw = w + R(1 * u)
    rect(x - R(1 * u) - 1, ry - 1, rw + 2, R(3 * u) + 1, tone(BLANKET, -0.5))
    rect(x - R(1 * u), ry, rw, R(3 * u) - 1, BLANKET)
    rect(x - R(1 * u), ry, rw, 1, tone(BLANKET, 0.4))
    for (let i = 1; i < rw; i += 3) rect(x - R(1 * u) + i, ry, 1, R(3 * u) - 1, STRIPE)
  }

  // the guard's arm back: the harpoon level behind his head, point to the fore, drawn further back as he winds up
  if (role === 2 && f.glow > 0 && f.glow < 1) harpoon(rect, f, R(f.lean - 9 * u - 4 * f.glow * u), f.top + R(2 * u), R(24 * u), true)

  hindFlippers(rect, f, body)
  blob(rect, f, body, belly, 0.27, 0.5)

  // the rings of a ringed seal: pale hoops down its sides, flecks on its crown
  const d = Math.max(1, R(1 * u))
  const ring = (x, y) => { rect(x + d, y, d, d, p.ringColor); rect(x, y + d, d, d, p.ringColor); rect(x + 2 * d, y + d, d, d, p.ringColor); rect(x + d, y + 2 * d, d, d, p.ringColor) }
  for (const [t, side] of [[0.64, -1], [0.8, 1]]) { const r = f.rowAt(t); ring(side < 0 ? r.x0 : r.x1 - 3 * d, r.y - d) }
  const crown = f.rowAt(0.05)
  rect(crown.x0 + R(2 * u), crown.y, R(2 * u), d, p.ringColor); rect(crown.x1 - R(3 * u), crown.y + d, d, d, p.ringColor)

  // ---- what it wears across the chest ---------------------------------------------
  if (role === 0 || role === 2) {
    // a strap from the far shoulder to the near hip
    const dark = tone(p.gearColor, -0.4)
    const from = f.rowAt(0.5), to = f.rowAt(0.88), n = to.y - from.y
    for (let i = 0; i <= n; i++) rect(from.x0 + 1 + (to.x1 - 3 - from.x0) * i / n, from.y + i, Math.max(2, R(2 * u)), 1, i % 3 === 2 ? p.gearColor : dark)
  }
  if (role === 0) {
    // a necklace of shells, a scallop hanging from it
    for (let x = neck.x0 + 1, i = 0; x < neck.x1 - 1; x += 2, i++) rect(x, neck.y + (x < neck.x0 + 3 || x > neck.x1 - 4 ? 0 : 1), 1, 1, i % 2 ? p.accentColor : SHINE)
    const cx = R((neck.x0 + neck.x1) / 2), pw = Math.max(3, R(3 * u))
    rect(cx - 2, neck.y + 2, pw + 2, R(2 * u) + 1, tone(p.accentColor, -0.5)); rect(cx - 1, neck.y + 2, pw, R(2 * u), p.accentColor)
    rect(cx - 1, neck.y + 2, pw, 1, SHINE); rect(cx, neck.y + 2 + R(2 * u), pw - 2, 1, tone(p.accentColor, -0.5))
  }
  if (role === 2) rect(R((chest.x0 + chest.x1) / 2), chest.y - 1, R(2 * u), R(2 * u), BONE)   // a badge of bone on the strap

  sealFace(rect, f, body, belly, f.sing > 0 ? 'sing' : 'calm')

  // ---- flippers, and what they hold -------------------------------------------------
  const len = R(4 * u), thick = Math.max(2, R(2 * u))
  if (role === 2) {
    const g = f.glow
    if (g >= 1) { flipper(rect, f, body, -1, 'down', len, thick); flipper(rect, f, body, 1, 'out', len + R(u), thick) }
    else if (g > 0) {
      // arm back (the harpoon is behind him, drawn above): one flipper up to it, the other out for balance
      flipper(rect, f, body, 1, 'fore', len - 1, thick)
      flipper(rect, f, body, -1, 'up', len, thick)
    } else {
      flipper(rect, f, body, -1, 'down', len, thick)
      const hand = f.rowAt(0.56)
      harpoon(rect, f, hand.x1 + R(2 * u), f.top - R(6 * u), f.foot - (f.top - R(6 * u)), false)
      flipper(rect, f, body, 1, 'fore', R(3 * u), thick)
    }
  } else if (f.sing > 0) {
    const wave = frameOf(f.t, 2.5, 2)
    flipper(rect, f, body, -1, wave ? 'out' : 'up', len, thick); flipper(rect, f, body, 1, wave ? 'up' : 'out', len, thick)
  } else if (f.walking && f.lift > 0) { flipper(rect, f, body, -1, 'out', len, thick); flipper(rect, f, body, 1, 'out', len, thick) }
  else { flipper(rect, f, body, -1, 'down', len, thick); flipper(rect, f, body, 1, 'down', len, thick) }

  // ---- what it wears on its head ------------------------------------------------------
  const brow = f.rowAt(0.07)
  if (role === 1) wreath(rect, p, brow.x0, brow.x1, brow.y - 1, u)
  if (role === 2) {
    // a limpet shell for a cap: a brim, a cone, its ribs
    const w = brow.x1 - brow.x0, dark = tone(BONE, -0.5), cx = (brow.x0 + brow.x1) / 2
    const tiers = [w + 2, w - 2, w - 5, w - 8].map(v => Math.max(2, v)), th = Math.max(1, R(1 * u))
    tiers.forEach((tw, i) => rect(cx - tw / 2 - 1, brow.y - (i + 1) * th - 1, tw + 2, th + 2, dark))
    tiers.forEach((tw, i) => {
      rect(cx - tw / 2, brow.y - (i + 1) * th, tw, th, i ? BONE : tone(BONE, -0.12))
      for (let x = R(cx - tw / 2) + 1; x < cx + tw / 2 - 1; x += 3) rect(x, brow.y - (i + 1) * th, 1, th, tone(BONE, -0.25))
    })
    rect(cx - tiers[3] / 2, brow.y - 4 * th, 1, th, SHINE)
  }
}

function wreath(rect, p, x0, x1, y, u) {
  rect(x0 - 1, y, x1 - x0 + 2, R(2 * u), KELP_DARK)
  rect(x0, y, x1 - x0, R(1.2 * u), KELP)
  const flower = (x, yy, col) => { rect(x - 1, yy, 3, 1, col); rect(x, yy - 1, 1, 3, col); rect(x, yy, 1, 1, GOLD) }
  flower(x0 + R(1 * u), y, p.accentColor)
  flower(R((x0 + x1) / 2), y - 1, SHINE)
  flower(x1 - R(2 * u), y, p.accentColor)
}

// Big dark eyes level with the nose, a pale muzzle, whiskers out past the cheeks.
function sealFace(rect, f, body, belly, mood) {
  const u = f.sc, fx = f.fx, fy = f.fy
  const es = Math.max(2, R(2 * u)), eh = Math.max(2, R(3 * u))
  const blink = mood === 'calm' && frameOf(f.t + 1.3, 10, 34) === 0
  for (const [x, side] of [[R(fx - 2 * u) - es, -1], [R(fx + 2 * u), 1]]) {
    if (mood === 'sing') { rect(x, fy + 1, es, 1, EYE); rect(side < 0 ? x - 1 : x + es, fy + 2, 1, 1, EYE) }
    else if (blink) rect(x, fy + eh - 1, es, 1, EYE)
    else { rect(x, fy, es, eh, EYE); rect(x, fy, Math.max(1, R(0.8 * u)), Math.max(1, R(0.8 * u)), SHINE); rect(x + es - 1, fy + eh - 1, 1, 1, GLINT) }
  }
  const mw = R(4 * u), mh = Math.max(2, R(3 * u)), mx = R(fx - mw / 2), my = fy + R(2 * u)
  rect(mx, my, mw, mh, belly.light)
  rect(mx - 1, my + 1, mw + 2, mh - 2, belly.light)
  rect(mx + R(1 * u), my, mw - R(2 * u), Math.max(1, R(1 * u)), EYE)                  // the nose
  if (mood === 'sing') {
    rect(mx + R(1 * u), my + R(1 * u) + 1, mw - R(2 * u), R(2 * u), MOUTH)
    rect(mx + R(1 * u), my + R(2 * u) + 1, mw - R(2 * u), Math.max(1, R(1 * u)), PINK)
  } else {
    rect(R(fx) - 1, my + R(1 * u), 1, mh - R(1 * u) - 1, belly.shade)
    rect(mx, my + mh - 1, mw, 1, belly.shade)
  }
  // whiskers
  const row = f.rows[Math.max(0, Math.min(f.H - 1, my + 1 - f.top))]
  rect(row.x0 - 1 - R(2 * u), my + 1, R(2 * u), 1, body.out); rect(row.x1 + 1, my + 1, R(2 * u), 1, body.out)
  rect(row.x0 - R(2 * u), my + 1 + R(2 * u), R(1 * u) + 1, 1, body.out); rect(row.x1, my + 1 + R(2 * u), R(1 * u) + 1, 1, body.out)
}

// A harpoon from (x, y): upright, running down `len`, or level, running to
// the fore. A wooden shaft, a rope binding, a barbed point of dark flint
// (dark, so it shows on pale sand).
function harpoon(rect, f, x, y, len, level) {
  const u = f.sc, w = Math.max(1, R(1 * u)), tip = R(4 * u), barb = Math.max(1, R(1 * u))
  if (level) {
    rect(x, y, len - tip, w, WOOD); rect(x, y + w, len - tip, 1, WOOD_DARK)
    rect(x + len - tip - barb, y - 1, barb, w + 2, BONE)                              // the binding
    rect(x + len - tip, y, tip, w, FLINT)
    rect(x + len - tip, y - barb, barb + 1, w + 2 * barb, FLINT); rect(x + len - tip + barb + 1, y - barb + 1, barb, w + 2 * barb - 2, FLINT)
    rect(x + len - barb, y, barb, w, FLINT_LIGHT)
  } else {
    rect(x, y + tip, w, len - tip, WOOD); rect(x + w, y + tip, 1, len - tip, WOOD_DARK)
    rect(x - 1, y + tip, w + 2, barb, BONE)                                           // the binding
    rect(x, y, w, tip, FLINT)
    rect(x - barb, y + tip - barb - 1, w + 2 * barb, barb + 1, FLINT); rect(x - barb + 1, y + tip - 2 * barb - 1, w + 2 * barb - 2, barb, FLINT)
    rect(x, y, w, barb, FLINT_LIGHT)
  }
}

// ---- the walrus -----------------------------------------------------------------------

function walrus(ctx, rect, p, pose, f, body) {
  const u = f.sc / 2                      // his features are drawn for scale 2
  const fx = f.fx, fy = f.fy
  const down = f.charge > 0.5, slumped = f.winded > 0, laughing = f.laugh > 0, roaring = f.bellow > 0.3
  const rear = f.glow * (1 - f.charge)
  shadow(ctx, rect, f, 14 * u)
  hindFlippers(rect, f, body)
  blob(rect, f, body, { base: tone(p.bodyColor, 0.2), shade: tone(p.bodyColor, 0.1) }, 0.26, 0.5)

  // rolls of blubber: creases that sag at their ends
  for (const t of [0.58, 0.76, 0.89]) {
    const r = f.rowAt(t), w = r.x1 - r.x0, sag = Math.max(1, R(3 * u))
    rect(r.x0 + sag, r.y, w - 2 * sag, 1, body.shade)
    rect(r.x0 + 1, r.y + 1, sag, 1, body.shade); rect(r.x1 - sag - 1, r.y + 1, sag, 1, body.shade)
    rect(r.x0 + sag, r.y + 1, R(w * 0.3), 1, body.light)
  }

  // the champion's belt: kelp, studs, and a great scallop for a buckle
  const waist = f.rowAt(0.69), wh = Math.max(2, R(3 * u))
  rect(waist.x0, waist.y, waist.x1 - waist.x0, wh, BELT)
  rect(waist.x0, waist.y + wh - 1, waist.x1 - waist.x0, 1, BELT_DARK)
  for (let x = waist.x0 + 2; x < waist.x1 - 1; x += 4) rect(x, waist.y + 1, 1, 1, GOLD)
  scallop(rect, (waist.x0 + waist.x1) / 2, waist.y - R(1 * u), Math.max(3, R(7 * u)), Math.max(3, R(5 * u)), p.accentColor, BELT_DARK)

  // ---- the face ---------------------------------------------------------------------
  const es = Math.max(2, R(2 * u)), eyeY = fy
  const angry = down || rear > 0.3
  for (const [x, side] of [[R(fx - 4 * u) - es, -1], [R(fx + 4 * u), 1]]) {
    if (slumped) for (let i = 0; i <= es; i++) { rect(x - 1 + i, eyeY - 1 + i, 1, 1, EYE); rect(x + es - 1 - i, eyeY - 1 + i, 1, 1, EYE) }   // crossed
    else if (laughing || roaring) { rect(x - 1, eyeY + 1, 1, 1, EYE); rect(x, eyeY, es, 1, EYE); rect(x + es, eyeY + 1, 1, 1, EYE) }
    else {
      rect(x, eyeY, es, es, EYE); rect(x, eyeY, 1, 1, SHINE)
      // a heavy brow, drawn down when he means it
      if (angry) { rect(x - 1, eyeY - 1, es + 2, 1, body.out); rect(side < 0 ? x - 1 : x + es, eyeY - 2, R(2 * u), 1, body.out) }
      else rect(x - (side < 0 ? 1 : 0), eyeY - 2, es + 1, 1, body.shade)
    }
  }
  const padY = fy + R(3 * u), padW = Math.max(3, R(6.5 * u)), padH = Math.max(3, R(5 * u))
  const open = roaring ? R(6 * u * f.bellow) : laughing ? R(3 * u) + (frameOf(f.t, 9, 2) ? 1 : 0) : rear > 0.4 ? R(2 * u) : slumped ? R(2 * u) : 0
  if (open > 0) {
    rect(fx - padW + R(2 * u) - 1, padY + padH - 1, 2 * padW - R(4 * u) + 2, open + 2, body.out)
    rect(fx - padW + R(2 * u), padY + padH - 1, 2 * padW - R(4 * u), open + 1, MOUTH)
    rect(fx - R(2 * u), padY + padH + open - Math.max(1, R(open * 0.45)), R(4 * u), Math.max(1, R(open * 0.45)), PINK)
  }
  // tusks: hanging, or level and to the fore when his head is down
  const tw = Math.max(2, R(2 * u)), tl = Math.max(4, R(9 * u))
  if (down) {
    for (const [dx, dy] of [[0, 0], [-R(3 * u), R(3 * u)]]) {
      const x = fx + padW - R(2 * u) + dx, y = padY + R(3 * u) + dy
      rect(x - 1, y - 1, tl + 2, tw + 2, body.out)
      rect(x, y, tl, tw, IVORY); rect(x, y + tw - 1, tl - 2, 1, IVORY_SHADE)
      rect(x + tl - 1, y, 1, tw - 1, SHINE)
    }
  } else {
    // (the one behind is chipped short: he has fought before)
    for (const [x, len] of [[R(fx - 3.5 * u) - tw + 1, tl - R(3 * u)], [R(fx + 3.5 * u) - 1, tl]]) {
      const y = padY + padH - 2
      rect(x - 1, y, tw + 2, len, body.out); rect(x, y + len - 1, tw, 2, body.out)
      rect(x, y, tw, len - 1, IVORY); rect(x + tw - 1, y, 1, len - 1, IVORY_SHADE)
      rect(x, y + len - 1, tw - 1, 1, IVORY)
    }
  }
  // the moustache: two bristling pads under a broad nose
  const pad = tone(p.bodyColor, 0.42), padShade = tone(p.bodyColor, 0.18)
  for (const side of [-1, 1]) {
    const x = side < 0 ? fx - padW : fx
    rect(x - (side < 0 ? 1 : 0), padY - 1, padW + 1, padH + 2, body.out)
    rect(x, padY, padW, padH, pad)
    rect(x, padY + padH - 1, padW, 1, padShade)
    for (let i = 1; i < padW - 1; i += 2) for (let j = 1; j < padH - 1; j += 2) rect(x + i + (j % 4 === 1 ? 0 : 1) * (i + 2 < padW ? 1 : 0), padY + j, 1, 1, body.out)
    // bristles past the pad's edge
    for (let j = 0; j < padH; j += 2) rect(side < 0 ? x - 2 : x + padW, padY + j + 1, 2, 1, pad)
  }
  rect(fx - R(2 * u), padY - R(2 * u), R(4 * u), R(2 * u) + 1, EYE)
  rect(fx - R(2 * u), padY - R(2 * u), R(2 * u), 1, body.shade)
  if (slumped) rect(fx + R(1 * u), padY + padH, R(3 * u), R(4 * u) + (frameOf(f.t, 6, 2) ? 1 : 0), PINK)   // his tongue hangs out

  // ---- flippers ------------------------------------------------------------------------
  const len = Math.max(4, R(9 * u)), thick = Math.max(2, R(4 * u))
  const how = f.air > 0 ? 'out' : rear > 0.3 || laughing ? 'up' : roaring ? 'out' : down ? 'fore' : 'down'
  flipper(rect, f, body, -1, how === 'fore' ? 'down' : how, len, thick); flipper(rect, f, body, 1, how, len, thick)

  // stars round a winded head
  if (slumped) for (let i = 0; i < 3; i++) {
    const a = f.t * 5 + i * 2.094
    const x = fx + Math.cos(a) * 9 * u, y = f.top - R(3 * u) + Math.sin(a) * 2 * u
    rect(x - 1, y, 3, 1, STAR); rect(x, y - 1, 1, 3, STAR)
  }
}

// ---- lying down: asleep, or dead ---------------------------------------------------------
// A low loaf, its head at the fore end; asleep its sleep rises off it.
function lying(rect, p, pose, f, body, belly, dead) {
  const u = f.sc, walrus = f.walrus
  const W = R((walrus ? 15 : 15) * u), Hh = Math.max(3, R((walrus ? 7.5 : 7) * u))
  const foot = f.foot, top = foot - Hh, x0 = -R(W / 2)
  const rows = []
  for (let i = 0; i < Hh; i++) {
    const t = (i + 0.5) / Hh
    const half = W / 2 * Math.sqrt(Math.max(0.05, 1 - (1 - t) ** 2.4))
    rows.push({ y: top + i, x0: R(-half * 0.92), x1: R(half) })
  }
  // tail flippers out behind
  rect(x0 - R(3 * u) - 1, foot - R(3 * u) - 1, R(4 * u) + 2, R(3 * u) + 1, body.out)
  rect(x0 - R(3 * u), foot - R(3 * u), R(4 * u), R(3 * u) - 1, body.shade)
  for (const r of rows) rect(r.x0 - 1, r.y - 1, r.x1 - r.x0 + 2, 3, body.out)
  for (const [i, r] of rows.entries()) {
    rect(r.x0, r.y, r.x1 - r.x0, 1, i >= Hh - Math.max(1, R(1.5 * u)) ? (walrus ? tone(p.bodyColor, 0.2) : belly.base) : body.base)
    if (i < 2) rect(r.x0 + 1, r.y, Math.max(1, R((r.x1 - r.x0) * 0.4)), 1, body.light)
  }
  if (!walrus) for (const [dx, dy] of [[2, 2], [6, 1]]) { rect(x0 + R(dx * u), top + R(dy * u), R(3 * u), R(3 * u), p.ringColor); rect(x0 + R((dx + 1) * u), top + R((dy + 1) * u), Math.max(1, R(u)), Math.max(1, R(u)), body.base) }
  // a front flipper folded over its side
  rect(R(-1 * u) - 1, foot - R(3 * u) - 1, R(4 * u) + 2, R(2 * u) + 2, body.edge)
  rect(R(-1 * u), foot - R(3 * u), R(4 * u), R(2 * u), body.shade)
  // the head, at the fore end
  const hx = R(W / 2) - R((walrus ? 5 : 4.5) * u), hy = top + R((walrus ? 2.5 : 2) * u)
  const es = Math.max(2, R((walrus ? 1 : 2) * u))
  for (const x of [hx - es - R(0.5 * u), hx + R(2 * u)]) {
    if (dead) { rect(x, hy, 1, 1, EYE); rect(x + es - 1, hy + es - 1, 1, 1, EYE); rect(x + es - 1, hy, 1, 1, EYE); rect(x, hy + es - 1, 1, 1, EYE) }
    else { rect(x, hy + es - 1, es, 1, EYE); rect(x - 1, hy + es - 2, 1, 1, EYE) }
  }
  if (walrus) {
    const pad = tone(p.bodyColor, 0.42)
    rect(hx - R(2.5 * u), hy + es + 1, R(5 * u), R(2.5 * u), pad)
    rect(hx - R(0.5 * u), hy + es, R(1.5 * u), R(1 * u), EYE)
    for (const x of [hx - R(2 * u), hx + R(1.5 * u)]) { rect(x - 1, hy + es + R(2 * u), R(1 * u) + 2, R(3 * u) + 1, body.out); rect(x, hy + es + R(2 * u), R(1 * u), R(3 * u), IVORY) }
  } else {
    rect(hx - R(1 * u), hy + es - 1, R(3 * u), R(3 * u), belly.light)
    rect(hx, hy + es - 1, R(1.5 * u), Math.max(1, R(1 * u)), EYE)
    rect(R(W / 2) + 1, hy + es, R(2 * u), 1, body.out); rect(R(W / 2), hy + es + R(2 * u), R(2 * u), 1, body.out)
  }
  if (dead) rect(hx, hy + es + R(2 * u), R(1.5 * u), R(1.5 * u), PINK)
  if (p.role === 1) wreath(rect, p, hx - R(3 * u), hx + R(3.5 * u), top - 1 + R(0.5 * u), u)
  if (p.role === 2) {
    // the cap slipped over one eye, the harpoon laid by
    rect(hx - R(2 * u), top - R(1 * u), R(5 * u), R(2 * u), BONE); rect(hx - R(2 * u), top + R(1 * u) - 1, R(5 * u), 1, tone(BONE, -0.4))
    rect(x0, foot + 1, W, 1, WOOD); rect(x0 + W - R(3 * u), foot + 1, R(3 * u), 1, FLINT)
  }
  if (p.role === 0) { rect(x0 - R(1 * u), top - R(2 * u), R(6 * u), R(4 * u), tone(p.gearColor, -0.4)); rect(x0, top - R(2 * u) + 1, R(6 * u) - 2, R(4 * u) - 2, p.gearColor) }
  if (dead) return
  // z, z, z
  const t = pose.t ?? 0
  for (let i = 0; i < 3; i++) {
    const a = ((t * 0.45 + i / 3) % 1), s = 2 + i
    const x = hx + R(2 * u) + R(a * 7 * u) + i, y = top - R(3 * u) - R(a * 9 * u)
    if (a > 0.9) continue
    rect(x, y, s + 1, 1, SLEEP); rect(x, y + s, s + 1, 1, SLEEP)
    for (let j = 1; j < s; j++) rect(x + s - j, y + j, 1, 1, SLEEP)
  }
}
