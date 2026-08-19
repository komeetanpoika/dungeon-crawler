// Static open maps: hand-authored worlds exported from tools/static-overworld
// (renderer/data/open-maps.js), converted here into the live map format.
//
// The data carries its own ground art, props and walkability, so unlike the
// generated levels nothing here rolls dice: the only entities are chests at
// the map's cache POIs — village, shrine and cave POIs are already baked into
// the tile art and stay scenery.
import { TILE } from './entities.js'
import { createMap } from './map.js'

export function buildOpenMap(data) {
  const map = createMap(data.w, data.h)
  const chestAt = new Set(data.pois.filter(p => p.kind === 'chest').map(p => `${p.x},${p.y}`))
  for (let y = 0; y < data.h; y++) for (let x = 0; x < data.w; x++) {
    const c = map[y][x]
    // The border stays wall even where the data is open: the camera is
    // unbounded and a walkable edge cell would show the void beyond.
    const border = x === 0 || y === 0 || x === data.w - 1 || y === data.h - 1
    c.tile = !border && data.walk[y][x] === '1' ? TILE.FLOOR : TILE.WALL
    c.skin = data.palette[data.ground[y][x]]
    const pi = data.prop[y][x]
    // Cache cells get a real chest entity instead of the baked-in chest art —
    // same sprite, but lootable.
    if (pi >= 0 && !chestAt.has(`${x},${y}`)) c.overlay = data.palette[pi]
    c.locked = true
  }
  const entitySpawns = data.pois
    .filter(p => p.kind === 'chest')
    .map(p => ({ kind: 'chest', x: p.x, y: p.y }))
  // Walk-onto triggers for both cells of each 2-wide arch; caveDepths pairs
  // with the dungeon_entrance POIs in order.
  const caveEntrances = data.pois
    .filter(p => p.kind === 'dungeon_entrance')
    .flatMap((p, i) => [0, 1].map(dx => ({
      x: p.x + dx, y: p.y,
      caveDepth: data.caveDepths?.[i] ?? 1,
      label: p.label,
    })))
  return { map, entitySpawns, playerSpawn: { ...data.playerSpawn }, rooms: [], caveEntrances }
}
