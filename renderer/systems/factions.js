// Faction predicates: who the game treats as an enemy, and what the player's
// weapons are allowed to hurt. Lifted out of game.js so systems and tests can
// ask the question without importing the browser-only renderer. Pure logic.

// Hostile NPCs count as enemies for as long as they stay hostile; every other
// entity type is decided by its kind alone.
export function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss' || (e.type === 'npc' && e.hostile)
}

// Things the player's weapons can hurt: every enemy plus peaceful NPCs.
export function isHittable(e) { return isEnemy(e) || e.type === 'npc' }
