// Faction predicates: who the game treats as an enemy, and what the player's
// weapons are allowed to hurt. Lifted out of game.js so systems and tests can
// ask the question without importing the browser-only renderer. Pure logic.
import { getMonsterDef } from './monsters.js'

// Hostile NPCs count as enemies for as long as they stay hostile; every other
// entity type is decided by its kind alone.
// Leap-episode creatures are registry monsters like any other: maahinen and
// sammunut are combatants (chased, brain-targeted); the nakki's def is
// `passive`, so it is never an enemy — it must not be chased or
// brain-targeted, only isHittable so the player's weapons can reach it.
// Generated monsters (registered in systems/monsters.js) join as enemies too,
// so they run the brain and the standard hit/death pipeline like any built-in
// type — registry membership decides it, never a literal type-string list.
export function isEnemy(e) {
  if (e.dying > 0) return false
  const def = getMonsterDef(e.type)
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss'
      || (e.type === 'npc' && e.hostile)
      || (!!def && !def.behavior?.passive)
}

// Things the player's weapons can hurt: every enemy, peaceful NPCs, and
// every registry monster (passive ones like the nakki included).
export function isHittable(e) {
  if (e.dying > 0) return false
  return isEnemy(e) || e.type === 'npc' || !!getMonsterDef(e.type)
}

// Who a spell or an arcing shot is allowed to *seek out*: every hittable
// thing minus peaceful villagers. Spells never seek out peaceful villagers —
// an area effect or a chaining bolt must not turn a rescue into a massacre —
// but a villager who has turned on the player keeps type 'npc' with
// `hostile` set and is caught like any other enemy. Deliberately wider than
// isEnemy: passive story creatures (the Näkki) stay reachable, which is the
// whole point of Call Lightning's conduction clause. The player's own aimed
// weapons keep using isHittable — hitting the baker with a swing is the
// player's choice to make; a spell fanning out is not.
export function isSpellTarget(e) {
  return isHittable(e) && !(e.type === 'npc' && !e.hostile)
}

// The frame's death cull predicate. hp is `undefined` for creatures like the
// nakki that carry no hp field — Number.isFinite keeps those alive here so a
// plain `e.hp > 0` check (which would evaluate `undefined > 0` to false and
// wrongly cull them) never appears at a cull site.
export function isDead(e) {
  if (e.dying > 0) return false
  return isHittable(e) && Number.isFinite(e.hp) && e.hp <= 0
}
