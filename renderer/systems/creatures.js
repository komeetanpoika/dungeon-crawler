// Creature registry: the leap-episode critters (nakki, maahinen, sammunut)
// each plug in a hit hook, an update hook, a maker, and an alpha function
// without game.js knowing their type-specific behaviour. Tasks 9–11 populate
// the registries below by importing this module and assigning into them;
// this module owns only the dispatch, plus a sane default for each hook.
// Pure — no browser/Electron imports.

export const CREATURE_TYPES = ['nakki', 'maahinen', 'sammunut']

export function isCreature(e) { return CREATURE_TYPES.includes(e.type) }

// Keyed by creature type. Plain mutable objects so per-type modules can
// assign `CREATURE_HIT.maahinen = fn` etc. on import, side-effect style.
export const CREATURE_HIT = {}
export const CREATURE_UPDATE = {}
export const CREATURE_MAKE = {}
export const CREATURE_ALPHA = {}

// The one place player damage to a creature is decided. Registered types
// resolve their own hook; everything else takes plain damage.
export function strikeCreature(e, state, dmg) {
  const hook = CREATURE_HIT[e.type]
  if (hook) return hook(e, state, dmg)
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}

// Per-frame creature update, dispatched from the enemy loop instead of the
// enemy brain (creatures — including the nakki, which is not isEnemy — still
// need to tick every frame). No-op for a type with nothing registered.
export function updateCreature(e, state, delta) {
  const hook = CREATURE_UPDATE[e.type]
  if (hook) hook(e, state, delta)
}

// buildEntities 'creature' case dispatches here; null for an unregistered type.
export function makeCreature(type, x, y) {
  const hook = CREATURE_MAKE[type]
  return hook ? hook(x, y) : null
}

// Render alpha (e.g. the nakki fading in/out of visibility). Defaults to
// fully opaque for a type with nothing registered.
export function creatureAlpha(e, state) {
  const hook = CREATURE_ALPHA[e.type]
  return hook ? hook(e, state) : 1
}
