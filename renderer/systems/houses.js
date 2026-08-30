// House doors on the open maps: which prop art is a door, which houses are
// story houses, how dangerous the inside is. Pure — openmap.js stamps the
// triggers, game.js walks through them (systems/cave.js does the transition).
export const HOUSE_DOOR_PREFIXES = ['ow_house_door', 'ow_house_arch_']
export const HOUSE_WALL_PREFIX = 'ow_house_wall'
export const SAFE_RADIUS = 10          // Chebyshev tiles from the village/camp POI
export const STORY_RADIUS = 4          // door ↔ story POI distance

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

// Interior generation: house doors transition into a BSP level at this fixed
// depth (generateLevel's LEVEL_CONFIG lookup is bypassed via the `config`
// option, so this depth never needs its own LEVEL_CONFIG entry).
export const INTERIOR_DEPTH = 19
const base = { depth: INTERIOR_DEPTH, mapW: 44, mapH: 28, staircaseWidth: 1, guardCount: 0, trapDensity: 0, puzzleDensity: 0, landmark: null, weapons: ['dagger'] }
// `guaranteed`: variants generateLevel must place at least one of each,
// counted toward (not added on top of) the density roll — spec "a ruin has
// spiders + 1 strong" needs a deterministic strong (and, so the interior test
// can assert per-generation, a deterministic medium too) rather than leaving
// both to chance against a 3-monster sample. Empty/absent elsewhere.
// `weaponDensity` counts FLOOR weapons, not chests (generateLevel's `config`
// path lays floating pickups — a house has no chests to open). Only a ruin
// arms you, and only from `weaponPool`: the two humblest melee weapons, so a
// derelict cottage never out-gifts a dungeon.
export const INTERIOR_CONFIG = {
  safe: { ...base, monsterDensity: 0,     variantPool: [],                             weaponDensity: 0,     potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel'] },
  hut:  { ...base, monsterDensity: 0.006, variantPool: ['weak'],                       weaponDensity: 0,     potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel', 'prop_anvil'] },
  ruin: { ...base, monsterDensity: 0.010, variantPool: ['medium', 'medium', 'strong'], weaponDensity: 0.008, potionDensity: 0.008, weaponPool: ['dagger', 'sword'], props: ['prop_gravestone', 'prop_barrel'], guaranteed: ['strong', 'medium'] },
}

// Prefab pickup slots -> the story house's items, laid on the floor. A
// `{ kind: 'pickup', slot }` spawn (from placeStructure spreading a prefab
// cell's `interaction: { type: 'pickup', slot }`) becomes a walk-into
// floating pickup carrying `pickups[slot]`; a slot with no matching content
// (or no pickups passed at all) is dropped.
export function attachPickups(entitySpawns, pickups = []) {
  return entitySpawns.flatMap(s => {
    if (s.kind !== 'pickup') return [s]
    const contents = pickups[s.slot]
    return contents ? [{ kind: 'floating_pickup', x: s.x, y: s.y, contents }] : []
  })
}

// Resolves a story door's prefab into the `structures` shape generateLevel
// expects, so it lands as the interior's landmark room. `structures` is the
// runtime-loaded structures.json (renderer/systems must stay pure, so it is
// never imported here — game.js passes it in via saveAPI.loadStructures()).
// Returns {} when there is no story (a generic house) or when the episode's
// story house names a room that isn't in structures.json (warns once).
export function storyStructures(structures, episode, story) {
  if (!story) return {}
  const room = episode?.houses?.[story]?.room
  if (!room) return {}
  const prefab = structures?.[room]
  if (!prefab) {
    console.warn(`storyStructures: room "${room}" for story house "${story}" not found in structures.json`)
    return {}
  }
  return { [room]: { ...prefab, targetDepth: INTERIOR_DEPTH } }
}
