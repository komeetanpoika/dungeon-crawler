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
// Posed sequences (params.anims, see anims.js) replace that built-in motion
// for the animations the user posed: idle and walk loop on pose.animT, the
// attack follows the game's attack clock (pose.attack, windup then swing) so
// the hit card lands with the strike, and the lunge and swell build through
// the windup and ease off in the follow-through. A posed piece turns and
// stretches: the stretch runs along the line from its joint to its far end
// (pieceEnd), and the pieces hung on it ride that end, turned with it but
// never distorted (pieceFrames' carry). On a switch of animation a monster
// with any sequence blends from the pose it left over BLEND_TIME, built-in
// motion included. pose.still draws exactly the given pose with no motion
// (the studio's posing view; stillMatrix places it). A monster with no
// sequence draws exactly as before, number for number.
// Without an image (Node tests, the cutter preview, before the atlas loads)
// each piece is a plain role-coloured rectangle. Everything here is shipped
// to the game: nothing may import from tools/.
import { drawSheetCell } from './pixel.js'
import { isActive, hasSequences, loopLength, samplePose, attackTiming, attackTime, animOf, ease, BLEND_TIME } from './anims.js'

export const CUTOUT_SCHEMA = [
  { key: 'size',        label: 'Height (tiles)',       group: 'body',   type: 'range', min: 1.5, max: 6, step: 0.25, default: 3 },
  { key: 'body',        label: 'Body radius (tiles)',  group: 'body',   type: 'range', min: 0.25, max: 0.85, step: 0.05, default: 0.5 },
  { key: 'lift',        label: 'Body height (tiles)',  group: 'body',   type: 'range', min: 0, max: 3, step: 0.05, default: 1.1 },
  { key: 'bob',         label: 'Bob',                  group: 'motion', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
  { key: 'wobble',      label: 'Walk lean (deg)',      group: 'motion', type: 'range', min: 0, max: 15, step: 1, default: 3 },
  { key: 'gaitFreq',    label: 'Gait speed',           group: 'motion', type: 'range', min: 1, max: 12, step: 0.5, default: 6 },
  { key: 'lunge',       label: 'Attack lunge (tiles)', group: 'motion', type: 'range', min: 0, max: 0.6, step: 0.05, default: 0.2 },
  { key: 'armSwing',    label: 'Arm swing (deg)',      group: 'limbs',  type: 'range', min: 0, max: 60, step: 1, default: 20 },
  { key: 'stepHeight',  label: 'Foot lift (tiles)',    group: 'limbs',  type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.2 },
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
      // front: a sideways pendulum, both arms turning the same way (one swings
      // out as the other comes in); side: forward and back in opposite phase
      else if (walking) deg = p.armSwing * SWING[i] * (front || left ? 1 : -1)
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

// The point of a piece's drawn rect (its four corners, then its four edge
// midpoints) farthest from its joint, in figure px: where the studio's handle
// sits, and the direction a stretch lengthens the piece.
export function pieceEnd(piece) {
  const [x, y] = piece.at, w = piece.rect?.[2] ?? 0, h = piece.rect?.[3] ?? 0, [px, py] = piece.pivot
  let best = [x, y], bd = -1
  for (const q of [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) {
    const d = Math.hypot(q[0] - px, q[1] - py)
    if (d > bd) { bd = d; best = q }
  }
  return best
}

const REST = { deg: 0, lift: 0, stretch: 1 }

// One animation's per-piece values at its clock `at` (a number for idle and
// walk, the attack clock for attack): its sequence, sampled once here, or the
// built-in motion of `builtIn` (a pose in that state).
function animMotion(parts, params, name, at, builtIn) {
  const seq = params.anims?.[name]
  if (!isActive(seq)) return piece => ({ ...limbMotion(piece, parts, params, builtIn), stretch: 1 })
  const t = name === 'attack' ? (at && typeof at === 'object' ? attackTime(seq, at) : 0) : (at ?? 0) % loopLength(seq)
  const sampled = samplePose(seq, t)
  return piece => {
    if (!Object.hasOwn(sampled, piece.id)) return REST
    const v = sampled[piece.id]
    return { deg: v.turn, lift: 0, stretch: v.stretch }
  }
}

// Each piece's turn (degrees, clockwise), lift (figure px up) and stretch for
// a pose: a still pose as given; otherwise the playing animation (sequence or
// built-in), blended from the animation just left while a monster with any
// sequence is inside BLEND_TIME of the switch.
function motionOf(parts, params, pose) {
  const still = pose.still
  if (still) return piece => ({ deg: still[piece.id]?.turn ?? 0, lift: 0, stretch: still[piece.id]?.stretch ?? 1 })
  const name = animOf(pose)
  const current = animMotion(parts, params, name, name === 'attack' ? pose.attack : pose.animT ?? pose.t, pose)
  const b = pose.blend
  if (!b || !hasSequences(params.anims) || !(b.t < BLEND_TIME)) return current
  const from = b.from === 'attack' || b.from === 'walk' ? b.from : 'idle'
  const builtIn = { ...pose, state: from, speed01: from === 'walk' ? 1 : 0, t: pose.t }
  const left = animMotion(parts, params, from, b.at, builtIn)
  const u = Math.max(0, b.t / BLEND_TIME)
  return piece => {
    const x = left(piece), y = current(piece)
    return { deg: x.deg + (y.deg - x.deg) * u, lift: x.lift + (y.lift - x.lift) * u, stretch: x.stretch + (y.stretch - x.stretch) * u }
  }
}

// Canvas-style affine [a b c d e f] pairs per piece id, in figure px. `world`
// draws the piece: its own turn and stretch about its pivot, lifted, composed
// on `carry`, its placement on its parent (world = carry · local). A piece on
// a stretched parent rides the parent's stretched drawing at its own joint
// but takes only the parent's rigid turn, so it is never distorted; on an
// unstretched parent carry is simply the parent's world. No whole-figure
// effects.
export function pieceFrames(parts, params, pose) {
  const byId = new Map(parts.pieces.map(p => [p.id, p]))
  const motion = motionOf(parts, params, pose)
  const out = new Map()
  const rigidWorld = new Map()                        // stretched pieces only: their world without the stretch
  const build = piece => {
    if (out.has(piece.id)) return out.get(piece.id)
    const frame = { world: IDENTITY, carry: IDENTITY }
    out.set(piece.id, frame)                          // guards a parent cycle
    const { deg, lift, stretch } = motion(piece)
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD), [px, py] = piece.pivot
    const rigid = deg === 0 && lift === 0 ? IDENTITY : [c, s, -s, c, px - c * px + s * py, py - s * px - c * py - lift]
    let local = rigid, stretched = false
    if (stretch !== 1) {
      const [ex, ey] = pieceEnd(piece), len = Math.hypot(ex - px, ey - py)
      if (len > 1e-9) {
        const ux = (ex - px) / len, uy = (ey - py) / len, g = stretch - 1
        const a = 1 + g * ux * ux, b = g * ux * uy, d = 1 + g * uy * uy
        local = mul(rigid, [a, b, b, d, px - a * px - b * py, py - b * px - d * py])
        stretched = true
      }
    }
    const parent = piece.parent && byId.get(piece.parent)
    if (parent) {
      const pf = build(parent), pr = rigidWorld.get(parent.id)
      if (!pr) frame.carry = pf.world
      else {
        const on = apply(pf.world, px, py), off = apply(pr, px, py)
        frame.carry = [pr[0], pr[1], pr[2], pr[3], pr[4] + on.x - off.x, pr[5] + on.y - off.y]
      }
      frame.world = mul(frame.carry, local)
    } else frame.world = local
    if (stretched) rigidWorld.set(piece.id, parent ? mul(frame.carry, rigid) : rigid)
    return frame
  }
  for (const piece of parts.pieces) build(piece)
  return out
}

// The `world` of each piece (see pieceFrames).
export function pieceTransforms(parts, params, pose) {
  const out = new Map()
  for (const [id, f] of pieceFrames(parts, params, pose)) out.set(id, f.world)
  return out
}

// Figure px → px from the entity centre for a still pose at tile size S:
// unflipped, no lean, bob, lunge or breath, feet where drawMonster puts them.
export function stillMatrix(parts, params, S) {
  const { figure } = parts, k = params.size * S / figure.h
  return [k, 0, 0, k, -figure.w / 2 * k, R(FOOT * S) - figure.h * k]
}

// How far a playing attack sequence has built (0..1): up through the windup,
// back down through the follow-through. null without one.
function attackCurve(p, pose) {
  if (animOf(pose) !== 'attack') return null
  const tm = attackTiming(p.anims?.attack)
  if (!tm) return null
  const part = (t, d) => d > 0 ? ease(t / d) : 1
  const t = pose.attack.t ?? 0
  return pose.attack.phase === 'swing' ? 1 - part(t, tm.followThrough) : part(t, tm.windup)
}

// The whole-figure state of a pose at tile size S: scale from art px to
// screen px, lean, bob, lunge, flip. A playing attack sequence drives the
// lunge and swell by its curve, whatever the pose state (a hit flash too).
function frameOf(parts, p, pose, S) {
  const t = pose.t ?? 0, state = pose.state
  const i = Math.floor(t * p.gaitFreq) % 4
  const walking = isWalking(pose)
  const dying = state === 'death' ? Math.min(1, (pose.stateT ?? 0) / DEATH) : 0
  const breath = !walking && Math.floor(t * 2) % 4 >= 2 ? BREATH : 1
  const curve = attackCurve(p, pose)
  const swell = curve === null ? (state === 'attack' ? SWELL : 1) : 1 + (SWELL - 1) * curve
  const grow = swell * (1 - 0.4 * dying)
  return {
    k: p.size * S * grow * breath / parts.figure.h,
    flip: mirrored(parts, pose.facing),
    lean: walking ? LEAN[i] * p.wobble * RAD : 0,
    bob: walking ? R(BOB[i] * p.bob * S * 0.1) : 0,
    lunge: curve !== null ? R(Math.cos(pose.facing ?? 0) * p.lunge * S * curve)
      : state === 'attack' ? R(Math.cos(pose.facing ?? 0) * p.lunge * S) : 0,
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
  // centre, so the health bar clears it: the built-in poses of every
  // animation left unposed, and every phase of every posed one held still in
  // its animation's frame (the attack's at full swell). Memoised: the bar
  // asks every frame.
  let topKey = null, topAnims = null, topVal = 0
  function drawnTop(p, S) {
    const key = S + '|' + CUTOUT_SCHEMA.map(d => p[d.key]).join(',')
    if (key === topKey && p.anims === topAnims) return topVal
    const posed = name => isActive(p.anims?.[name])
    const CLOCK = { phase: 'windup', t: 0 }, FULL = { phase: 'windup', t: Infinity }
    const idle = [0.25, 0.75, 1.25, 1.75].map(t => ({ t, state: 'idle' }))
    const walk = [0, 1, 2, 3].map(i => ({ t: (i + 0.5) / p.gaitFreq, state: 'walk', speed01: 1 }))
    const attack = [...idle, ...walk].map(f => ({ ...f, state: 'attack', attack: CLOCK }))
    const frames = { idle, walk, attack: attack.map(f => ({ ...f, attack: FULL })) }
    const poses = []
    for (const [name, list] of [['idle', idle], ['walk', walk], ['attack', attack]]) {
      if (!posed(name)) { poses.push(...list); continue }
      for (const phase of p.anims[name].phases) for (const f of frames[name]) poses.push({ ...f, still: phase.pose })
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
    topKey = key; topAnims = p.anims
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
