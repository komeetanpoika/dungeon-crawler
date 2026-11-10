// Sequence rules for posed cut-out monsters: an animation is a list of phase
// cards, each a sparse pose ({ pieceId: { turn?, stretch? } }) reached over
// its time. Pure data rules, shared by the cut-out engine, the monster
// registry and the studio. This file ships to the game, so it imports
// nothing (and certainly nothing from tools/).
export const ANIM_NAMES = ['idle', 'walk', 'attack']
export const LIMITS = { turn: [-360, 360], stretch: [0.5, 2], time: [0.03, 2] }
export const BLEND_TIME = 0.1
const NAME_MAX = 24

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const num = v => typeof v === 'number' && Number.isFinite(v)

export function ease(u) {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}

function cleanPose(raw) {
  const out = {}
  for (const [id, ch] of Object.entries(raw)) {
    if (!isObj(ch)) continue
    const c = {}
    if (num(ch.turn)) c.turn = clamp(ch.turn, LIMITS.turn)
    if (num(ch.stretch)) c.stretch = clamp(ch.stretch, LIMITS.stretch)
    out[id] = c
  }
  return out
}

export function cleanAnims(raw, warn = () => {}) {
  const out = {}
  if (!isObj(raw)) return out
  for (const [name, anim] of Object.entries(raw)) {
    if (!ANIM_NAMES.includes(name)) { warn(`unknown animation "${name}" ignored`); continue }
    const list = isObj(anim) && Array.isArray(anim.phases) ? anim.phases : []
    const phases = []
    for (const ph of list) {
      if (!isObj(ph) || !isObj(ph.pose) || !num(ph.time)) { warn(`${name}: a broken phase was dropped`); continue }
      const p = { time: clamp(ph.time, LIMITS.time) }
      if (typeof ph.name === 'string' && ph.name.trim()) p.name = ph.name.trim().slice(0, NAME_MAX)
      if (ph.hit) p.hit = true
      p.pose = cleanPose(ph.pose)
      phases.push(p)
    }
    let hitAt = -1
    phases.forEach((p, i) => {
      if (!p.hit) return
      if (name !== 'attack' || i === 0) { delete p.hit; warn(`${name}: hit on phase ${i + 1} ignored`) }
      else if (hitAt >= 0) { delete p.hit; warn(`${name}: extra hit on phase ${i + 1} ignored`) }
      else hitAt = i
    })
    if (!phases.length) { if (list.length) warn(`${name}: no usable phases, animation dropped`); continue }
    if (name === 'attack' && phases.length >= 2 && hitAt < 0) {
      phases[phases.length - 1].hit = true
      warn('attack: no hit phase, set on the last phase')
    }
    out[name] = { phases }
  }
  return out
}

export const isActive = anim => !!anim && Array.isArray(anim.phases) && anim.phases.length >= 2
export const hasSequences = anims => !!anims && ANIM_NAMES.some(n => isActive(anims[n]))
export const loopLength = anim => anim.phases.reduce((s, p) => s + p.time, 0)

export function attackTiming(anim) {
  if (!isActive(anim)) return null
  const hit = anim.phases.findIndex(p => p.hit)
  if (hit < 1) return null
  let windup = 0, followThrough = anim.phases[0].time
  anim.phases.forEach((p, i) => {
    if (i >= 1 && i <= hit) windup += p.time
    else if (i > hit) followThrough += p.time
  })
  return { windup, followThrough }
}

const chan = (pose, id) => ({ turn: pose?.[id]?.turn ?? 0, stretch: pose?.[id]?.stretch ?? 1 })

export function lerpPose(a, b, u) {
  const out = {}
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const x = chan(a, id), y = chan(b, id)
    out[id] = { turn: x.turn + (y.turn - x.turn) * u, stretch: x.stretch + (y.stretch - x.stretch) * u }
  }
  return out
}

export function samplePose(anim, t) {
  const ph = anim.phases
  if (ph.length < 2) return lerpPose(ph[0]?.pose, ph[0]?.pose, 0)
  const time = Math.min(Math.max(t, 0), loopLength(anim))
  let start = 0
  for (let k = 1; k <= ph.length; k++) {
    const from = ph[k - 1], to = k < ph.length ? ph[k] : ph[0], dur = to.time
    if (time <= start + dur || k === ph.length) {
      return lerpPose(from.pose, to.pose, ease((time - start) / dur))
    }
    start += dur
  }
}

export function attackTime(anim, clock) {
  const tm = attackTiming(anim)
  if (!tm) return 0
  return clock.phase === 'swing'
    ? tm.windup + Math.min(clock.t, tm.followThrough)
    : Math.min(clock.t, tm.windup)
}

export function animOf(pose) {
  if (pose.attack && pose.state !== 'death') return 'attack'
  if (pose.state === 'walk' || (pose.speed01 ?? 0) > 0.05) return 'walk'
  return 'idle'
}
