// Creature registry: the leap-episode critters (nakki, maahinen, sammunut)
// are registry monsters whose hook modules (systems/monsters/*.js) register
// into these tables, so game.js never learns their type-specific behaviour.
// Podeboo-style supplements for ordinary generated monsters register here
// too. This module owns only the dispatch, plus a sane default for each
// hook. Pure — no browser/Electron imports.

// Keyed by creature type. Plain mutable objects so per-type modules can
// assign `CREATURE_HIT.maahinen = fn` etc. on import, side-effect style.
export const CREATURE_HIT = {}
export const CREATURE_UPDATE = {}
export const CREATURE_ALPHA = {}

// The one place player/wolf/fire damage to a creature is decided. Registered
// types resolve their own hook (which also sees `opts`, e.g. { source });
// everything else takes plain damage. Returns a fresh entity, never mutates.
export function strikeCreature(e, state, dmg, opts = {}) {
  const hook = CREATURE_HIT[e.type]
  if (hook) return hook(e, state, dmg, opts)
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}

// Strike and apply: mutates the live entity with the hook's result and
// records the kill on state.creatureKills the first time hp reaches 0. The
// episodes read that record — never a creature's absence — as the death.
export function hurtCreature(state, e, dmg, opts = {}) {
  const r = strikeCreature(e, state, dmg, opts)
  if (r.entity !== e) Object.assign(e, r.entity)
  const dead = !r.absorbed && Number.isFinite(e.hp) && e.hp <= 0
  const killed = dead && !state.creatureKills?.[e.type]
  if (killed) state.creatureKills = { ...(state.creatureKills ?? {}), [e.type]: true }
  return { absorbed: r.absorbed, cue: killed ? 'enemy-death' : r.cue, think: r.think, killed }
}

// Per-frame creature update, dispatched from the enemy loop instead of the
// enemy brain (creatures — including the nakki, which is not isEnemy — still
// need to tick every frame). No-op for a type with nothing registered.
export function updateCreature(e, state, delta) {
  const hook = CREATURE_UPDATE[e.type]
  if (hook) hook(e, state, delta)
}

// Render alpha (e.g. the nakki fading in/out of visibility). Defaults to
// fully opaque for a type with nothing registered.
export function creatureAlpha(e, state) {
  const hook = CREATURE_ALPHA[e.type]
  return hook ? hook(e, state) : 1
}
