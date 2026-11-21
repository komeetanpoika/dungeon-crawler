// Who the city's ward keeps out: enemies that do not belong to the city.
// City people carry `cityKey` (a hostile watchman is an enemy but not warded).
import { isEnemy } from './factions.js'

export function isWarded(e) {
  return isEnemy(e) && e.cityKey === undefined
}
