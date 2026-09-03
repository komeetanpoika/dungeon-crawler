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
// everything else takes plain damage. The default path returns a fresh
// entity and never mutates `e` — but a registered hook is free to touch the
// live entity itself (the nakki's ensureNakki does), so this is not a
// guarantee across all types.
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

// Render alpha (e.g. the nakki fading in/out of visibility). Defaults to
// fully opaque for a type with nothing registered.
export function creatureAlpha(e, state) {
  const hook = CREATURE_ALPHA[e.type]
  return hook ? hook(e, state) : 1
}
