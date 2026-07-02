import { ITEMS } from '../data/items.js'
import { FINAL_DEPTH } from '../data/levels.js'

export const MILESTONES = [
  { depth: 3, bonus: 'quiet_step',      label: 'Quieter footsteps' },
  { depth: 6, bonus: 'extra_slot',      label: 'Extra inventory slot' },
  { depth: 9, bonus: 'starting_potion', label: 'Start each run with a potion' },
]

export function getInitialMeta() {
  return { deepestReached: 0, unlockedBonuses: [], runsCompleted: 0, treasureStolen: false }
}

export function applyRunResult(meta, { deepestLevel, won }) {
  // Depths beyond FINAL_DEPTH only exist as cheat-only sandbox levels (see the
  // level<N> dev cheat code) — they sit outside normal progression, so a run
  // started there must never touch persistent meta (no deepest/milestone/
  // runsCompleted/treasureStolen updates), otherwise cheating could
  // permanently unlock progression bonuses legitimate play can't reach.
  if (deepestLevel > FINAL_DEPTH) return meta
  const newBonuses = [...meta.unlockedBonuses]
  for (const m of MILESTONES) {
    if (deepestLevel >= m.depth && !newBonuses.includes(m.bonus)) newBonuses.push(m.bonus)
  }
  return {
    deepestReached: Math.max(meta.deepestReached, deepestLevel),
    unlockedBonuses: newBonuses,
    runsCompleted: meta.runsCompleted + 1,
    treasureStolen: meta.treasureStolen || !!won,
  }
}

export function getStartingItems(meta) {
  return meta.unlockedBonuses.includes('starting_potion') ? [{ ...ITEMS.POTION }] : []
}

export function validateMeta(data) {
  return (
    data !== null &&
    data !== undefined &&
    typeof data.deepestReached === 'number' &&
    Array.isArray(data.unlockedBonuses) &&
    typeof data.runsCompleted === 'number' &&
    typeof data.treasureStolen === 'boolean'
  )
}
