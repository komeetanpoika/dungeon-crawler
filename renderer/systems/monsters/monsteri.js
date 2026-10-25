// Monsteri, from the user's crayon drawing (monsteri.jpg): a red, upright
// creature with two pairs of clawed arms, a sweeping tail and three yellow
// orbs on stalks above its head. It fights in one combination:
//
//   stalk    the brain walks it after the hero until the hero is in reach
//   windup   it stands, turns to the hero and its orbs light up
//   breath   a cone of frost from its head, aimed where the hero stood when
//            the windup ended; a hero caught in it is frozen solid
//            (systems/player-bind.js) unless a raised shield faces it
//   rush     it runs at the frozen hero; reaching them before the ice thaws
//            is the grab, a thaw first is a miss (retreat: it backs off)
//   hold     the hero is pinned against it and squeezed for unblockable
//            damage until enough key presses (game.js counts them) break
//            the grip: the hero is thrown clear and it reels (a stun)
//
// Runs as a CREATURE_UPDATE supplement after the brain and act have moved
// it this frame (see systems/monsters.js). Everything but the stalk tops up
// rootTimer, so act() leaves the moving to this hook. Every number worth
// tweaking lives in TUNING_SCHEMA; the values come from the monster's JSON
// `tuning` and are read through tuningOf every frame, so a monster-bench
// edit lands on the next frame. drawFx draws the breath and the arms over
// the hero (canvas.js, through drawMonsterFx).
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf, getMonsterDef, entityPose } from '../monsters.js'
import { hasLineOfSight } from '../entities.js'
import { moveEntity } from '../movement.js'
import { inSwing } from '../melee.js'
import { nearestPoint, PLAYER_SHAPE } from '../hitbox.js'
import { tryBlock } from '../shield.js'
import { damagePlayer } from '../player-damage.js'
import { startKnockback } from '../knockback.js'
import { freezePlayer, grabPlayer, releasePlayer, playerBound } from '../player-bind.js'
import { sfx } from '../sfx.js'

const S = 32
const DEG = Math.PI / 180
const ROOT = 0.1   // s of root topped up each frame it moves itself; lapses right after

export const TUNING_SCHEMA = [
  { key: 'reach', label: 'Breath reach (tiles)', group: 'breath', type: 'range', min: 1, max: 6, step: 0.25, default: 3,
    hint: 'how far the frost carries; it starts the windup once the hero is this close' },
  { key: 'width', label: 'Breath half-width (deg)', group: 'breath', type: 'range', min: 10, max: 90, step: 5, default: 55,
    hint: 'degrees either side of its aim (Rime is 55)' },
  { key: 'windup', label: 'Windup (s)', group: 'breath', type: 'range', min: 0.2, max: 3, step: 0.1, default: 0.8,
    hint: 'seconds the orbs glow before the breath; the aim locks at the end' },
  { key: 'breathTime', label: 'Breath (s)', group: 'breath', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.5,
    hint: 'seconds the frost blows; walking into it freezes too' },
  { key: 'freeze', label: 'Freeze (s)', group: 'breath', type: 'range', min: 0.3, max: 5, step: 0.1, default: 1.5,
    hint: 'seconds a caught hero stays frozen solid' },
  { key: 'cooldown', label: 'Cooldown (s)', group: 'breath', type: 'range', min: 0.5, max: 12, step: 0.5, default: 4,
    hint: 'seconds after a miss or a broken grip before the next windup' },
  { key: 'rushSpeed', label: 'Rush speed (tiles/s)', group: 'grab', type: 'range', min: 1, max: 10, step: 0.5, default: 4,
    hint: 'how fast it runs at a frozen hero' },
  { key: 'grabReach', label: 'Grab reach (tiles)', group: 'grab', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1,
    hint: 'centre to centre: this close to a frozen hero is a grab' },
  { key: 'holdDist', label: 'Hold distance (tiles)', group: 'grab', type: 'range', min: 0.3, max: 1.5, step: 0.05, default: 0.7,
    hint: 'how close it pulls the hero in' },
  { key: 'squeezeDmg', label: 'Squeeze damage', group: 'grab', type: 'range', min: 0, max: 5, step: 1, default: 1,
    hint: 'per squeeze; no shield, outfit or i-frames stop it' },
  { key: 'squeezeEvery', label: 'Squeeze every (s)', group: 'grab', type: 'range', min: 0.1, max: 3, step: 0.05, default: 0.5 },
  { key: 'mashNeed', label: 'Presses to break free', group: 'grab', type: 'range', min: 1, max: 30, step: 1, default: 8 },
  { key: 'mashDecay', label: 'Press fade (per s)', group: 'grab', type: 'range', min: 0, max: 5, step: 0.25, default: 1,
    hint: 'presses lost each second, so only mashing breaks free' },
  { key: 'shove', label: 'Throw clear (tiles)', group: 'grab', type: 'range', min: 0, max: 4, step: 0.25, default: 1.5,
    hint: 'how far a hero who breaks free is pushed away' },
  { key: 'reel', label: 'Reel (s)', group: 'grab', type: 'range', min: 0, max: 4, step: 0.1, default: 1.2,
    hint: 'seconds it stands stunned after the hero breaks free' },
  { key: 'retreat', label: 'Back off (s)', group: 'grab', type: 'range', min: 0, max: 3, step: 0.1, default: 0.8,
    hint: 'seconds it backs away after missing a grab' },
]

const to = (m, state) => { m.state = state; m.t = 0 }
const root = e => { e.rootTimer = Math.max(e.rootTimer ?? 0, ROOT) }
const half = e => getMonsterDef(e.type)?.stats.half ?? 8
const glow = (e, v) => { if (e.pose) e.pose.eyeGlow = v }
const face = (e, ang) => { if (e.pose) e.pose.facing = ang }
const toward = (e, p) => Math.atan2(p.py - e.py, p.px - e.px)

function rest(e, m, T) {
  glow(e, 0)
  m.grip = null
  to(m, 'stalk')
  m.cd = T.cooldown
}

function inCone(e, player, T, aim) {
  const n = nearestPoint(player, e.px, e.py, PLAYER_SHAPE)
  return inSwing(T.reach * S, T.width * DEG, aim, n.x - e.px, n.y - e.py)
}

function stalk(e, m, state, T) {
  const { player, map } = state
  m.cd = Math.max(0, m.cd - m.dt)
  if (m.cd > 0 || !(player.hp > 0) || playerBound(player)) return
  if (Math.hypot(player.px - e.px, player.py - e.py) > T.reach * S) return
  if (map && !hasLineOfSight(map, e.y, e.x, player.y, player.x)) return
  to(m, 'windup')
  root(e)
  sfx(state, 'magic-cast', { px: e.px, py: e.py })
}

function windup(e, m, state, T) {
  root(e)
  m.aim = toward(e, state.player)
  face(e, m.aim)
  glow(e, Math.min(1, m.t / T.windup))
  if (m.t < T.windup) return
  to(m, 'breath')
  m.done = false; m.caught = false
  sfx(state, 'sizzle', { px: e.px, py: e.py })
}

function breath(e, m, state, T) {
  const { player } = state
  root(e)
  glow(e, 1)
  if (!m.done && !playerBound(player) && player.hp > 0 && inCone(e, player, T, m.aim)) {
    m.done = true
    if (!tryBlock(state, { px: e.px, py: e.py })) {
      freezePlayer(player, T.freeze)
      m.caught = true
      sfx(state, 'crackle', { px: player.px, py: player.py })
    }
  }
  if (m.t < T.breathTime) return
  glow(e, 0)
  if (m.caught && player.ice) to(m, 'rush')
  else rest(e, m, T)
}

function rush(e, m, state, T) {
  const { player } = state
  root(e)
  if (!player.ice || player.held) { to(m, 'retreat'); return }
  const dx = player.px - e.px, dy = player.py - e.py, d = Math.hypot(dx, dy)
  if (d <= T.grabReach * S) { grab(e, m, state, T); return }
  const step = Math.min(d, T.rushSpeed * S * m.dt)
  moveEntity(e, dx / d * step, dy / d * step, state.map, half(e))
}

// The hero is pulled in to the hold distance (walls permitting) and pinned
// there until they break free.
function grab(e, m, state, T) {
  const { player } = state
  const dx = player.px - e.px, dy = player.py - e.py, d = Math.hypot(dx, dy) || 1
  const pull = d - T.holdDist * S
  if (pull > 0) moveEntity(player, -dx / d * pull, -dy / d * pull, state.map)
  grabPlayer(player, e)
  m.grip = player.held                                         // the drawing reads the struggle off it
  m.holdPx = player.px; m.holdPy = player.py; m.sq = 0
  face(e, toward(e, player))
  to(m, 'hold')
  sfx(state, 'drag', { px: player.px, py: player.py })
}

function hold(e, m, state, T) {
  const { player } = state
  root(e)
  const h = player.held
  if (h?.by !== e) { rest(e, m, T); return }
  if (!(player.hp > 0)) { releasePlayer(player); rest(e, m, T); return }
  player.px = m.holdPx; player.py = m.holdPy
  player.x = Math.floor(player.px / S); player.y = Math.floor(player.py / S)
  if (h.presses >= T.mashNeed) { breakFree(e, m, state, T); return }
  h.presses = Math.max(0, h.presses - T.mashDecay * m.dt)
  m.sq += m.dt
  while (m.sq >= T.squeezeEvery) {
    m.sq -= T.squeezeEvery
    if (T.squeezeDmg > 0) damagePlayer(state, T.squeezeDmg, 'dot')
  }
}

function breakFree(e, m, state, T) {
  const { player } = state
  releasePlayer(player)
  const dx = player.px - e.px, dy = player.py - e.py
  if (T.shove > 0) startKnockback(player, dx || 1, dy, T.shove * S)
  e.stunTimer = Math.max(e.stunTimer ?? 0, T.reel)
  rest(e, m, T)
  sfx(state, 'wall-slam', { px: e.px, py: e.py })
}

function retreat(e, m, state, T) {
  const { player } = state
  root(e)
  if (m.t >= T.retreat) { rest(e, m, T); return }
  const dx = e.px - player.px, dy = e.py - player.py, d = Math.hypot(dx, dy) || 1
  const speed = getMonsterDef(e.type)?.stats.speed ?? 60
  moveEntity(e, dx / d * speed * m.dt, dy / d * speed * m.dt, state.map, half(e))
}

const STATES = { stalk, windup, breath, rush, hold, retreat }

export function update(e, state, delta) {
  if (!state.player) return
  const T = tuningOf(e.type)
  const m = e.mech ?? (e.mech = { state: 'stalk', t: 0, cd: 0, aim: 0 })
  m.t += delta
  m.dt = delta
  STATES[m.state](e, m, state, T)
}

// Monster-bench readout: one short line on where the state machine is.
export function debugState(e) {
  const m = e.mech
  if (!m) return '-'
  const grip = m.state === 'hold' && m.grip ? ` grip ${m.grip.presses.toFixed(1)}/${tuningOf(e.type).mashNeed}` : ''
  return `${m.state} cd ${m.cd.toFixed(1)}${grip}`
}

// Monster-bench overlay (Hitboxes on): the breath's cone along its aim (or
// facing) and the grab reach. ctx sits at the monster's screen centre.
export function debugDraw(ctx, e, S) {
  const T = tuningOf(e.type), m = e.mech
  const aim = m && m.state !== 'stalk' ? m.aim : (e.pose?.facing ?? 0)
  const k = S / 32
  ctx.save()
  ctx.strokeStyle = '#7dd3fc'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, T.reach * S, aim - T.width * DEG, aim + T.width * DEG)
  ctx.closePath()
  ctx.stroke()
  ctx.strokeStyle = '#fca5a5'
  ctx.beginPath()
  ctx.arc(0, 0, T.grabReach * 32 * k, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// --- drawing over the hero -------------------------------------------------
// ctx sits at the monster's screen centre, S px per tile (canvas.js calls
// this after the hero, through systems/monsters.js drawMonsterFx).

const FROST = ['#ffffff', '#e0f2fe', '#7dd3fc', '#bae6fd']
const HIDE = '#cd8476', HIDE_DARK = '#a85a50', OUTLINE = '#3a1416'
const R = Math.round

export function drawFx(ctx, e, S) {
  const m = e.mech
  if (!m || e.hp <= 0) return
  const def = getMonsterDef(e.type)
  if (!def) return
  const T = tuningOf(e.type)
  const pose = entityPose(e)
  if (m.state === 'windup') drawGather(ctx, def, pose, S, Math.min(1, m.t / T.windup))
  else if (m.state === 'breath') drawBreath(ctx, def, pose, S, m, T)
  else if (m.state === 'hold' && m.grip) drawArms(ctx, e, def, pose, S, m, T)
}

// Frost specks circling in to the head as the orbs charge.
function drawGather(ctx, def, pose, S, charge) {
  const k = S / 32
  const head = def.rig.anchor(def.params, pose, S, 'head')
  const n = Math.round(6 * charge)
  ctx.save()
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + pose.t * 5
    const r = (1 - ((pose.t * 2 + i * 0.37) % 1)) * 14 * k
    ctx.fillStyle = FROST[i % FROST.length]
    ctx.fillRect(R(head.x + Math.cos(a) * r - k), R(head.y + Math.sin(a) * r - k), Math.max(1, R(2 * k)), Math.max(1, R(2 * k)))
  }
  ctx.restore()
}

// The breath: a pale wedge on the ground where it lands, and a spray of
// chunky frost flakes streaming from the head down and out across it,
// thinning out over the last fifth of the breath.
const FLAKES = 48
function drawBreath(ctx, def, pose, S, m, T) {
  const k = S / 32
  const head = def.rig.anchor(def.params, pose, S, 'head')
  const reach = T.reach * S, w = T.width * DEG
  const fade = Math.min(1, (T.breathTime - m.t) / (T.breathTime * 0.2))
  ctx.save()
  ctx.globalAlpha = 0.18 * fade
  ctx.fillStyle = FROST[3]
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, reach, m.aim - w, m.aim + w)
  ctx.closePath()
  ctx.fill()
  for (let i = 0; i < FLAKES; i++) {
    const off = ((i * 0.6180339) % 1) * 2 - 1                // spread across the wedge
    const f = (i / FLAKES + pose.t * 2.2) % 1               // how far along this flake is
    const ang = m.aim + off * w
    const gx = Math.cos(ang) * reach, gy = Math.sin(ang) * reach
    const x = head.x + (gx - head.x) * f, y = head.y + (gy - head.y) * f
    const size = Math.max(1, R((1.5 + 3 * f) * k))
    ctx.globalAlpha = fade * (0.95 - 0.5 * f)
    ctx.fillStyle = FROST[i % FROST.length]
    ctx.fillRect(R(x - size / 2), R(y - size / 2), size, size)
  }
  ctx.restore()
}

// Two pairs of arms from the chest round the held hero, a hug in screen
// space: each arm bows out past the hero's side and curls a claw in on it,
// one pair high on the hero and one low. The arms spread wider and the
// claws let go of the hero's sides as the presses mount; each press shakes
// them with the hero. Every arm is solid: its outline squares first, then
// its fill, a few px apart, thinning toward the claw.
function drawArms(ctx, e, def, pose, S, m, T) {
  const k = S / 32
  const g = m.grip
  const chest = def.rig.anchor(def.params, pose, S, 'chest')
  const hx = (m.holdPx - e.px) * k + R(g.jolt * 3 * k) * g.side, hy = (m.holdPy - e.py) * k
  const loose = Math.min(1, g.presses / T.mashNeed)
  const pairs = [{ root: 0, at: -7 * k }, { root: 8 * k, at: 5 * k }]
  ctx.save()
  for (const { root, at } of pairs) {
    for (const side of [-1, 1]) {
      const x0 = chest.x + side * 5 * k, y0 = chest.y + root
      const tx = hx + side * (9 + 7 * loose) * k, ty = hy + at        // the claw, at the hero's side
      const cx = hx + side * (17 + 8 * loose) * k, cy = (y0 + ty) / 2  // bowed out round the hero
      const len = Math.hypot(tx - x0, ty - y0) + Math.abs(cx - tx)
      const n = Math.max(4, Math.ceil(len / (2.5 * k)))
      const pts = []
      for (let i = 0; i <= n; i++) {
        const f = i / n, u = 1 - f
        pts.push([u * u * x0 + 2 * u * f * cx + f * f * tx, u * u * y0 + 2 * u * f * cy + f * f * ty, R((5 - 2 * f) * k)])
      }
      ctx.fillStyle = OUTLINE
      for (const [x, y, w] of pts) ctx.fillRect(R(x - w / 2 - k), R(y - w / 2 - k), w + R(2 * k), w + R(2 * k))
      pts.forEach(([x, y, w], i) => {
        ctx.fillStyle = i < n / 2 ? HIDE_DARK : HIDE
        ctx.fillRect(R(x - w / 2), R(y - w / 2), w, w)
      })
      ctx.fillStyle = OUTLINE                                          // the claw curls in on the hero
      const cw = Math.max(2, R(2 * k))
      for (let i = 1; i <= 2; i++) ctx.fillRect(R(tx - side * i * 2 * k - cw / 2), R(ty + (i - 1) * k - cw / 2), cw, cw)
    }
  }
  ctx.restore()
}

CREATURE_UPDATE.monsteri = update
