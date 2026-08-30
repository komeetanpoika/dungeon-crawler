// House doors on the open maps: which prop art is a door, which houses are
// story houses, how dangerous the inside is. Pure — openmap.js stamps the
// triggers, game.js walks through them (systems/cave.js does the transition).
export const HOUSE_DOOR_PREFIXES = ['ow_house_door', 'ow_house_arch_']
export const SAFE_RADIUS = 10          // Chebyshev tiles from the village/camp POI
export const STORY_RADIUS = 4          // door ↔ story POI distance

export const isHouseDoorArt = name => typeof name === 'string' && HOUSE_DOOR_PREFIXES.some(p => name.startsWith(p))
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

export function tierForDoor(data, x, y, art) {
  const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp')
  if (!anchor || art === 'ow_house_arch_stone') return 'ruin'
  return cheb(x, y, anchor.x, anchor.y) <= SAFE_RADIUS ? 'safe' : 'hut'
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
    if (!isHouseDoorArt(art)) continue
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
export const INTERIOR_CONFIG = {
  safe: { ...base, monsterDensity: 0,     variantPool: [],                             weaponDensity: 0,     potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel'] },
  hut:  { ...base, monsterDensity: 0.006, variantPool: ['weak'],                       weaponDensity: 0.004, potionDensity: 0.006, props: ['prop_table', 'prop_chair', 'prop_barrel', 'prop_anvil'] },
  ruin: { ...base, monsterDensity: 0.010, variantPool: ['medium', 'medium', 'strong'], weaponDensity: 0.008, potionDensity: 0.008, props: ['prop_gravestone', 'prop_barrel'] },
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
