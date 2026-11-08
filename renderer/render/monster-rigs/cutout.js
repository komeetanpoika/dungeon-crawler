// The cut-out rig engine: draws a monster from its PARTS (the pieces the
// monster cutter made from the user's drawing, packed into one atlas) and
// moves the pieces so it comes alive: arms swing, legs step or lift, the head
// nods, the tail sways, all from the usual rig params. Each piece turns about
// its own pivot, composed parent before child, and a piece's joint cap (drawn
// under its parent) keeps the joint closed while it turns. The whole-figure
// behaviour is monsteri's: a breath while idle, a stepping bob and lean
// while walking, a lunge and swell on attack, the white flash on a hit, a
// shrink while dying, and a mirror so the drawing faces where it walks. Feet
// stand just below the entity's centre; the hit circle sits on the torso.
// Without an image (Node tests, the cutter preview, before the atlas loads)
// each piece is a plain role-coloured rectangle. Everything here is shipped
// to the game: nothing may import from tools/.
import { drawSheetCell } from './pixel.js'

export const CUTOUT_SCHEMA = [
  { key: 'size',        label: 'Height (tiles)',       group: 'body',   type: 'range', min: 1.5, max: 6, step: 0.25, default: 3 },
  { key: 'body',        label: 'Body radius (tiles)',  group: 'body',   type: 'range', min: 0.25, max: 0.85, step: 0.05, default: 0.5 },
  { key: 'lift',        label: 'Body height (tiles)',  group: 'body',   type: 'range', min: 0, max: 3, step: 0.05, default: 1.1 },
  { key: 'bob',         label: 'Bob',                  group: 'motion', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
  { key: 'wobble',      label: 'Walk lean (deg)',      group: 'motion', type: 'range', min: 0, max: 15, step: 1, default: 3 },
  { key: 'gaitFreq',    label: 'Gait speed',           group: 'motion', type: 'range', min: 1, max: 12, step: 0.5, default: 6 },
  { key: 'lunge',       label: 'Attack lunge (tiles)', group: 'motion', type: 'range', min: 0, max: 0.6, step: 0.05, default: 0.2 },
  { key: 'armSwing',    label: 'Arm swing (deg)',      group: 'limbs',  type: 'range', min: 0, max: 60, step: 1, default: 20 },
  { key: 'stepHeight',  label: 'Foot lift (tiles)',    group: 'limbs',  type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.12 },
  { key: 'legSwing',    label: 'Leg swing (deg)',      group: 'limbs',  type: 'range', min: 0, max: 45, step: 1, default: 20 },
  { key: 'headNod',     label: 'Head nod (deg)',       group: 'limbs',  type: 'range', min: 0, max: 15, step: 1, default: 3 },
  { key: 'tailSway',    label: 'Tail sway (deg)',      group: 'limbs',  type: 'range', min: 0, max: 30, step: 1, default: 8 },
  { key: 'attackReach', label: 'Attack reach (deg)',   group: 'limbs',  type: 'range', min: 0, max: 120, step: 5, default: 35 },
]

const R = Math.round
const RAD = Math.PI / 180
const WHITE = '#f8f8f8'
const FOOT = 0.45            // tiles below the entity centre where the feet stand
const DEATH = 0.7            // s, systems/dying.js DEATH_TIME (not imported: dying → monsters is a cycle)
const SWELL = 1.08           // the attack's grow
const BREATH = 1.02          // the idle breath's grow
const SWING = [1, 0, -1, 0]  // one entry per gait step
const LIFT = [1, 0, 0, 0]
const BOB = [0, -1, 0, -1]
const LEAN = [-1, 0, 1, 0]
const ROLE_COLOUR = { torso: '#c0605a', head: '#d98a7a', arm: '#5a1c1c', leg: '#5a1c1c', tail: '#8a3a34', weapon: '#9aa0a6', extra: '#d9b25a' }
const IDENTITY = [1, 0, 0, 1, 0, 0]

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
const isWalking = pose => pose.state === 'walk' || (pose.speed01 ?? 0) > 0.05
const mirrored = (parts, facing) => parts.faces === 'right' ? Math.cos(facing ?? 0) < -0.01 : Math.cos(facing ?? 0) > 0.01

// A piece's own turn (degrees, clockwise) and lift (figure px up), by role
// and motion; the table in the spec.
function limbMotion(piece, parts, p, pose) {
  const t = pose.t ?? 0
  const i = Math.floor(t * p.gaitFreq) % 4, j = Math.floor(t * 2) % 4
  const front = parts.view === 'front', left = piece.side === 'left'
  const outward = left ? 1 : -1, forward = parts.faces === 'left' ? 1 : -1
  const attack = pose.state === 'attack', walking = isWalking(pose)
  let deg = 0, lift = 0
  switch (piece.role) {
    case 'arm':
      if (attack) deg = front ? p.attackReach * outward : p.attackReach * forward
      else if (walking) deg = p.armSwing * SWING[i] * (front ? outward : left ? 1 : -1)
      else deg = p.armSwing / 4 * SWING[j] * outward
      break
    case 'leg':
      if (attack || !walking) break
      if (front) {
        const up = (left ? LIFT[i] : LIFT[(i + 2) % 4]) > 0
        if (up) { lift = p.stepHeight * parts.figure.h / p.size; deg = 4 * outward }
      } else deg = p.legSwing * SWING[i] * (left ? 1 : -1)
      break
    case 'head':
      if (!attack && walking) deg = p.headNod * BOB[(i + 3) % 4] * forward
      break
    case 'tail':
      if (!attack) deg = walking ? p.tailSway * SWING[(i + 1) % 4] : p.tailSway / 2 * SWING[j]
      break
  }
  return { deg, lift }
}

// Canvas-style affine [a b c d e f] per piece id, in figure px: its own turn
// about its pivot, composed parent before child. No whole-figure effects.
export function pieceTransforms(parts, params, pose) {
  const byId = new Map(parts.pieces.map(p => [p.id, p]))
  const out = new Map()
  const build = piece => {
    if (out.has(piece.id)) return out.get(piece.id)
    out.set(piece.id, IDENTITY)                       // guards a parent cycle
    const { deg, lift } = limbMotion(piece, parts, params, pose)
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD), [px, py] = piece.pivot
    const local = deg === 0 && lift === 0 ? IDENTITY : [c, s, -s, c, px - c * px + s * py, py - s * px - c * py - lift]
    const parent = piece.parent && byId.get(piece.parent)
    const world = parent ? mul(build(parent), local) : local
    out.set(piece.id, world)
    return world
  }
  for (const piece of parts.pieces) build(piece)
  return out
}

// The whole-figure state of a pose at tile size S: scale from art px to
// screen px, lean, bob, lunge, flip.
function frameOf(parts, p, pose, S) {
  const t = pose.t ?? 0, state = pose.state
  const i = Math.floor(t * p.gaitFreq) % 4
  const walking = isWalking(pose)
  const dying = state === 'death' ? Math.min(1, (pose.stateT ?? 0) / DEATH) : 0
  const breath = !walking && Math.floor(t * 2) % 4 >= 2 ? BREATH : 1
  const grow = (state === 'attack' ? SWELL : 1) * (1 - 0.4 * dying)
  return {
    k: p.size * S * grow * breath / parts.figure.h,
    flip: mirrored(parts, pose.facing),
    lean: walking ? LEAN[i] * p.wobble * RAD : 0,
    bob: walking ? R(BOB[i] * p.bob * S * 0.1) : 0,
    lunge: state === 'attack' ? R(Math.cos(pose.facing ?? 0) * p.lunge * S) : 0,
  }
}

const valid = r => r && r[2] > 0 && r[3] > 0
const imageReady = img => !!img && img.complete !== false && (img.naturalWidth || img.width) > 0

export function makeCutoutRig({ id, parts, imageUrl, extend = null }) {
  const { figure } = parts
  const children = new Map(parts.pieces.map(p => [p.id, []]))
  for (const p of parts.pieces) if (p.parent && children.has(p.parent)) children.get(p.parent).push(p)

  let sheet = null
  const sheetImage = () => {
    if (sheet === null && imageUrl && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = imageUrl }
    return imageReady(sheet) ? sheet : null
  }

  const hitHalf = p => Math.max(8, Math.min(28, R(p.body * 32)))
  const hitShape = p => ({ r: hitHalf(p), oy: -R(p.lift * 32) })

  // a named point of the drawing, posed, in figure px; a missing head is the
  // figure's top-centre, a missing chest (or any other name) its centre
  const pointOf = (name, tr) => {
    const pt = parts.points?.[name]
    if (!pt) return { x: figure.w / 2, y: name === 'head' ? 0 : figure.h / 2 }
    return tr.has(pt.piece) ? apply(tr.get(pt.piece), pt.x, pt.y) : { x: pt.x, y: pt.y }
  }

  function anchor(p, pose, S, name) {
    const pt = pointOf(name, pieceTransforms(parts, p, pose))
    const k = p.size * S / figure.h
    const x = (pt.x - figure.w / 2) * k
    return { x: R(mirrored(parts, pose.facing) ? -x : x), y: R(R(FOOT * S) - figure.h * k + pt.y * k) }
  }

  // The top of the drawing at its tallest living pose, in px from the entity
  // centre, so the health bar clears it. Memoised: the bar asks every frame.
  let topKey = null, topVal = 0
  function drawnTop(p, S) {
    const key = S + '|' + CUTOUT_SCHEMA.map(d => p[d.key]).join(',')
    if (key === topKey) return topVal
    const poses = []
    for (const t of [0.25, 0.75, 1.25, 1.75]) poses.push({ t, state: 'idle' }, { t, state: 'attack' })
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / p.gaitFreq
      poses.push({ t, state: 'walk', speed01: 1 }, { t, state: 'attack', speed01: 1 })
    }
    let top = Infinity
    for (const pose of poses) {
      const tr = pieceTransforms(parts, p, pose), f = frameOf(parts, p, pose, S)
      const sin = Math.sin(f.lean), cos = Math.cos(f.lean)
      for (const piece of parts.pieces) {
        const m = tr.get(piece.id)
        const rects = [valid(piece.rect) && [piece.at[0], piece.at[1], piece.rect[2], piece.rect[3]],
          valid(piece.cap) && [piece.cap[4], piece.cap[5], piece.cap[2], piece.cap[3]]]
        for (const r of rects) if (r) for (const [cx, cy] of [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]]) {
          const q = apply(m, cx, cy)
          const x = (q.x - figure.w / 2) * f.k, y = (q.y - figure.h) * f.k
          top = Math.min(top, R(FOOT * S) + f.bob + sin * x + cos * y)
        }
      }
    }
    topKey = key
    return (topVal = Math.floor(top))
  }

  function drawMonster(ctx, p, pose, S) {
    const f = frameOf(parts, p, pose, S), hit = pose.state === 'hit'
    const tr = pieceTransforms(parts, p, pose)
    const img = sheetImage()
    const tint = hit ? { color: WHITE, alpha: 1 } : null

    const draw = (m, r, ax, ay, role) => {
      ctx.save()
      ctx.transform(...m)
      if (!img) { ctx.fillStyle = hit ? WHITE : ROLE_COLOUR[role] ?? ROLE_COLOUR.extra; ctx.fillRect(ax, ay, r[2], r[3]) }
      else drawSheetCell(ctx, img, r[0], r[1], r[2], r[3], ax, ay, r[2], r[3], tint)
      ctx.restore()
    }

    ctx.save()
    ctx.translate(f.lunge, R(FOOT * S) + f.bob)          // origin at the feet
    if (f.flip) ctx.scale(-1, 1)
    if (f.lean) ctx.rotate(f.lean)
    ctx.scale(f.k, f.k)
    ctx.translate(-figure.w / 2, -figure.h)              // figure space, top-left origin
    ctx.imageSmoothingEnabled = false
    for (const piece of parts.pieces) {
      if (img) for (const c of children.get(piece.id)) if (valid(c.cap)) draw(tr.get(c.id), c.cap, c.cap[4], c.cap[5], c.role)
      if (valid(piece.rect)) draw(tr.get(piece.id), piece.rect, piece.at[0], piece.at[1], piece.role)
    }
    if (extend) {
      ctx.save()
      extend(ctx, p, pose, S, { point: name => pointOf(name, tr) })
      ctx.restore()
    }
    ctx.restore()
  }

  return { RIG_ID: id, PARAM_SCHEMA: CUTOUT_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage: img => { sheet = img } }
}
