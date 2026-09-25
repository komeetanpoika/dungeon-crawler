// Shared fixtures for the PvP unit tests (not itself a test file).
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { refreshTargets } from '../renderer/pvp/combat.js'

export const openMap = (w = 20, h = 20) => Array.from({ length: h }, (_, y) =>
  Array.from({ length: w }, (_, x) => ({ tile: x === 0 || y === 0 || x === w - 1 || y === h - 1 ? TILE.WALL : TILE.FLOOR })))

export function testMatch(heroes, map = openMap()) {
  const match = { map, heroes, entities: [], projectiles: [], lightning: [], strikes: [], arcs: [],
    shockwaves: [], zones: [], fireZones: [], feedback: makeFeedback(), sfx: null, pickups: [],
    clock: 0, acc: 0, ended: false, events: [], inputs: {} }
  refreshTargets(match)
  return match
}
