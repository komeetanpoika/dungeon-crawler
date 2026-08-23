// Static open maps: hand-authored worlds exported from tools/static-overworld
// (renderer/data/open-maps.js), converted here into the live map format.
//
// The data carries its own ground art, props and walkability, so unlike the
// generated levels nothing here rolls dice: the only entities are chests at
// the map's cache POIs — village, shrine and cave POIs are already baked into
// the tile art and stay scenery.
import { TILE } from './entities.js'
import { createMap } from './map.js'
import { MAP_RITES } from '../data/rites.js'
import { signsForMap } from './signs.js'

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
  // Every entrance is stamped as a sealed gate over whatever the bake put
  // there: vined arch art on the two trigger cells, blocking gargoyle
  // fountains on the flanks, walkable basins in front of them. Setting all
  // of a gate's gargoyles flowing (F on a basin) opens it — systems/gates.js
  // holds that logic and the open-arch art recorded on gate.cells.
  const gates = {}
  for (const p of data.pois.filter(p => p.kind === 'dungeon_entrance')) {
    map[p.y][p.x].overlay = 'ow_cave_gate_l'
    map[p.y][p.x + 1].overlay = 'ow_cave_gate_r'
    map[p.y][p.x].tile = TILE.FLOOR
    map[p.y][p.x + 1].tile = TILE.FLOOR
    for (const fx of [p.x - 1, p.x + 2]) {
      if (fx < 1 || fx > data.w - 2 || p.y + 1 > data.h - 2) continue
      map[p.y][fx].tile = TILE.WALL
      delete map[p.y][fx].overlay
      map[p.y + 1][fx].tile = TILE.FLOOR
      delete map[p.y + 1][fx].overlay
      entitySpawns.push({ kind: 'fountain_wall', propType: 'prop_gargoyle_dry',
        x: fx, y: p.y, pairX: fx, pairY: p.y + 1, gateId: p.label })
      entitySpawns.push({ kind: 'fountain_basin', propType: 'prop_fountain_empty',
        x: fx, y: p.y + 1, pairX: fx, pairY: p.y, gateId: p.label })
    }
    gates[p.label] = {
      open: false, trigger: 'fountains',
      cells: [
        { x: p.x, y: p.y, overlay: 'ow_cave_arch_0' },
        { x: p.x + 1, y: p.y, overlay: 'ow_cave_arch_1' },
      ],
    }
  }
  // The waystone onward: a visible stone arch on a walkable cell. Progression
  // (game.js) decides whether stepping onto it travels or stays sealed.
  if (data.exit) map[data.exit.y][data.exit.x].overlay = 'ow_house_arch_stone'
  // Rite triggers: invisible walk-onto spawns anchored to named landmark POIs.
  for (const rite of MAP_RITES[data.name] ?? []) {
    const poi = data.pois.find(p => p.kind === 'landmark' && p.label === rite.fromPoi)
    if (poi) entitySpawns.push({ kind: 'talent_trigger', x: poi.x, y: poi.y, talent: rite.talent, rite: rite.rite })
    else console.warn(`rites: poi "${rite.fromPoi}" not found on ${data.name}`)
  }
  // Wild mushrooms: pickable, colour-shifting. Deterministic — every third
  // walkable cell adjacent to a mushroom prop, row-major, capped at 8.
  if (MAP_RITES[data.name]) {
    const spots = []
    const mushroomProp = i => i >= 0 && data.palette[i] === 'ow_mushroom'
    for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
      if (!mushroomProp(data.prop[y][x])) continue
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (map[ny][nx].tile === TILE.FLOOR && data.prop[ny][nx] < 0) { spots.push({ x: nx, y: ny }); break }
      }
    }
    spots.filter((_, i) => i % 3 === 0).slice(0, 8)
      .forEach(s => entitySpawns.push({ kind: 'wild_mushroom', x: s.x, y: s.y }))
  }
  return {
    map, entitySpawns, playerSpawn: { ...data.playerSpawn }, rooms: [],
    caveEntrances, gates, mapExit: data.exit ? { ...data.exit } : null,
    signs: signsForMap(data.name),
  }
}
