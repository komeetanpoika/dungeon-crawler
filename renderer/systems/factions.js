// Faction predicates: who the game treats as an enemy, and what the player's
// weapons are allowed to hurt. Lifted out of game.js so systems and tests can
// ask the question without importing the browser-only renderer. Pure logic.
import { getMonsterDef } from './monsters.js'

// Hostile NPCs count as enemies for as long as they stay hostile; every other
// entity type is decided by its kind alone.
// Leap-episode creatures: maahinen and sammunut are combatants (chased,
// brain-targeted); nakki is never an enemy — it must not be chased or
// brain-targeted, it is only isHittable so the player's weapons can reach it.
// Generated monsters (registered in systems/monsters.js) join as enemies too,
// so they run the brain and the standard hit/death pipeline like any built-in
// type — registry membership decides it, never a literal type-string list.
export function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss' || e.type === 'maahinen' || e.type === 'sammunut'
      || (e.type === 'npc' && e.hostile)
      || !!getMonsterDef(e.type)
}

// Things the player's weapons can hurt: every enemy plus peaceful NPCs plus nakki.
export function isHittable(e) { return isEnemy(e) || e.type === 'npc' || e.type === 'nakki' }

// The frame's death cull predicate. hp is `undefined` for creatures like the
// nakki that carry no hp field — Number.isFinite keeps those alive here so a
// plain `e.hp > 0` check (which would evaluate `undefined > 0` to false and
// wrongly cull them) never appears at a cull site.
export function isDead(e) { return isHittable(e) && Number.isFinite(e.hp) && e.hp <= 0 }
