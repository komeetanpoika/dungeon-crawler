// Card operations for the Movement tab. Pure: every op returns new objects
// and leaves its input alone.
import { LIMITS, isActive, attackTiming, loopLength } from '../../renderer/render/monster-rigs/anims.js'

const NAME_MAX = 24
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const copy = v => JSON.parse(JSON.stringify(v))
const round = (v, step) => Math.round(v / step) * step
const fix = (v, d) => Number(v.toFixed(d))

export const startAnim = () => ({ phases: [{ time: 0.3, pose: {} }] })

function editAnim(anims, name, fn) {
  const next = copy(anims ?? {})
  if (!next[name]) next[name] = startAnim()
  fn(next[name].phases, next[name])
  return next
}

export function addPhase(anims, name, after) {
  let index = 0
  const out = editAnim(anims, name, phases => {
    const at = Math.min(Math.max(after, 0), phases.length - 1)
    const ph = { time: 0.2, pose: copy(phases[at].pose ?? {}) }
    if (name === 'attack' && !phases.some(p => p.hit)) ph.hit = true
    index = at + 1
    phases.splice(index, 0, ph)
  })
  return { anims: out, index }
}

export function deletePhase(anims, name, i) {
  if (i < 1 || !anims?.[name] || i >= anims[name].phases.length) return anims
  return editAnim(anims, name, phases => {
    const [gone] = phases.splice(i, 1)
    if (gone.hit && name === 'attack' && phases.length >= 2) phases[phases.length - 1].hit = true
  })
}

export function setTime(anims, name, i, time) {
  return editAnim(anims, name, phases => { if (phases[i]) phases[i].time = clamp(time, LIMITS.time) })
}

export function setHit(anims, i) {
  if (i < 1 || !anims?.attack || i >= anims.attack.phases.length) return anims
  return editAnim(anims, 'attack', phases => {
    phases.forEach((p, k) => { if (k === i) p.hit = true; else delete p.hit })
  })
}

export function setName(anims, name, i, text) {
  const t = String(text ?? '').trim().slice(0, NAME_MAX).trim()
  return editAnim(anims, name, phases => {
    if (!phases[i]) return
    if (t) phases[i].name = t; else delete phases[i].name
  })
}

export function setPieces(anims, name, i, ids, { turn, stretch }) {
  return editAnim(anims, name, phases => {
    if (!phases[i]) return
    for (const id of ids) phases[i].pose[id] = { turn, stretch }
  })
}

export function resetPieces(anims, name, i, ids) {
  return editAnim(anims, name, phases => {
    if (phases[i]) for (const id of ids) delete phases[i].pose[id]
  })
}

export function resetCard(anims, name, i) {
  return editAnim(anims, name, phases => { if (phases[i]) phases[i].pose = {} })
}

// An animation that is still exactly the start card a new one begins with
// (one card, rest pose, the start time, no name or hit), as a reset on an
// animation never posed leaves it: it plays nothing, so it is not saved.
const START = startAnim().phases[0]
const untouched = phases => phases.length === 1 && phases[0].time === START.time && !phases[0].name && !phases[0].hit
  && !Object.keys(phases[0].pose).length

// The animations as the def stores them: sparse (rest values left out) and
// rounded. Piece ids the current cut lacks are kept (Ruling 9): the engine
// ignores them, and a re-cut, even one undone later, must not wipe poses.
export function toSaved(anims) {
  const out = {}
  for (const [name, anim] of Object.entries(anims ?? {})) {
    if (!anim?.phases?.length) continue
    const phases = anim.phases.map(ph => {
      const pose = {}
      for (const [id, ch] of Object.entries(ph.pose ?? {})) {
        const c = {}
        if (typeof ch?.turn === 'number') { const t = fix(round(ch.turn, 0.1), 1); if (t !== 0) c.turn = t }
        if (typeof ch?.stretch === 'number') { const s = fix(round(ch.stretch, 0.01), 2); if (s !== 1) c.stretch = s }
        if (Object.keys(c).length) pose[id] = c
      }
      const p = { time: fix(round(ph.time, 0.01), 2) }
      if (ph.name) p.name = ph.name
      if (ph.hit) p.hit = true
      p.pose = pose
      return p
    })
    if (!untouched(phases)) out[name] = { phases }
  }
  return out
}

export function timingSummary(anim, name) {
  const phases = anim?.phases ?? []
  const order = [...phases.keys()].slice(1).concat(phases.length ? [0] : [])
  const out = {
    moves: order.map(index => ({ index, time: phases[index].time, hit: !!phases[index].hit })),
    total: phases.length ? loopLength(anim) : 0,
  }
  if (name === 'attack' && isActive(anim)) {
    const tm = attackTiming(anim)
    if (tm) { out.windup = tm.windup; out.followThrough = tm.followThrough } else out.missingHit = true
  }
  return out
}
