// House doors on the open maps: which prop art is a door, which houses are
// story houses, how dangerous the inside is. Pure — openmap.js stamps the
// triggers, game.js walks through them (systems/cave.js does the transition).
export const HOUSE_DOOR_PREFIXES = ['ow_house_door', 'ow_house_arch_']
export const HOUSE_WALL_PREFIX = 'ow_house_wall'
export const SAFE_RADIUS = 10          // Chebyshev tiles from the village/camp POI
export const STORY_RADIUS = 4          // door ↔ story POI distance

// The door a walked-onto cell opens: a door record stands on its west cell and
// covers `span` cells eastward (Kalevanlinna's keep and church draw double
// doors, two cells, one record each); any other door is one cell.
export const doorAt = (doors, x, y) => doors?.find(d => d.y === y && x >= d.x && x < d.x + (d.span ?? 1)) ?? null

export const isHouseDoorArt = name => typeof name === 'string' && HOUSE_DOOR_PREFIXES.some(p => name.startsWith(p))
export const isHouseWallArt = name => typeof name === 'string' && name.startsWith(HOUSE_WALL_PREFIX)
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))
const propArt = (data, x, y) => {
  const pi = data.prop[y]?.[x]
  return pi >= 0 ? data.palette[pi] : null
}

// Door art alone is not a door: the leap maps' arrival runestone and their
// exit waystones are stamped with `ow_house_arch_stone` too, and one of them
// sits a tile from the player spawn. A real door is a house FRONT — stampHouse3
// always lays walls[0]/walls[1] immediately left and right of it — so require a
// house wall beside the cell.
export const hasHouseContext = (data, x, y) =>
  isHouseWallArt(propArt(data, x - 1, y)) || isHouseWallArt(propArt(data, x + 1, y))

export function tierForDoor(data, x, y, art) {
  // Nearest village/camp POI, not the first listed: a map may anchor more than
  // one settlement, and a door belongs to the one it actually stands in.
  let anchor = null, bestD = Infinity
  for (const p of data.pois ?? []) {
    if (p.kind !== 'village' && p.kind !== 'camp') continue
    const d = cheb(x, y, p.x, p.y)
    if (d < bestD) { bestD = d; anchor = p }
  }
  if (!anchor || art === 'ow_house_arch_stone') return 'ruin'
  return bestD <= SAFE_RADIUS ? 'safe' : 'hut'
}

export function storyForDoor(data, episode, x, y) {
  let best = null, bestD = Infinity
  for (const label of Object.keys(episode?.houses ?? {})) {
    const poi = data.pois.find(p => p.label === label)
    if (!poi) continue
    const d = cheb(x, y, poi.x, poi.y)
    if (d <= STORY_RADIUS && d < bestD) { best = label; bestD = d }
  }
  return best
}

export function houseDoorsForMap(data, episode) {
  const doors = []
  for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
    const pi = data.prop[y][x]
    const art = pi >= 0 ? data.palette[pi] : null
    if (!isHouseDoorArt(art) || !hasHouseContext(data, x, y)) continue
    const story = storyForDoor(data, episode, x, y)
    doors.push({ x, y, label: `house:${data.name}:${x},${y}`, tier: story ? 'hut' : tierForDoor(data, x, y, art), story })
  }
  return doors
}

// What is behind a door is built by renderer/interior/ (systems/interior.js
// re-exports it) from the door record above, at this fixed depth, which never
// needs a LEVEL_CONFIG entry of its own.
export const INTERIOR_DEPTH = 19
