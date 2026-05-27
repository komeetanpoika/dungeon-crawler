import { ITEMS } from '../data/items.js'

export const MILESTONES = [
  { depth: 3, bonus: 'quiet_step',      label: 'Quieter footsteps' },
  { depth: 6, bonus: 'extra_slot',      label: 'Extra inventory slot' },
  { depth: 9, bonus: 'starting_potion', label: 'Start each run with a potion' },
]

export function getInitialMeta() {
  return { deepestReached: 0, unlockedBonuses: [], runsCompleted: 0, treasureStolen: false }
}

export function applyRunResult(meta, { deepestLevel, won }) {
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
