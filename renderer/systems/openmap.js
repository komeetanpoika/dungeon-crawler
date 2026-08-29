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
import { NPC_SPECIES } from '../data/npcs.js'

// Vision classes for blocking cells, keyed off the art that blocks: open
// water never impedes sight (losClear); foliage is shallow cover — a ray
// crosses up to LOS_TREE_BUDGET such cells (losSoft). Rocks, buildings and
// ruins stay fully opaque. See hasLineOfSight in entities.js.
const LOS_CLEAR_PREFIXES = ['ow_water_', 'ow_pond_']
const LOS_SOFT_PREFIXES = ['ow_tree_', 'ow_deadtree_', 'ow_bush_', 'ow_shrub_', 'ow_mushroom', 'ow_cactus']
const startsWithAny = (s, prefixes) => prefixes.some(p => s?.startsWith(p))

export const WILD_MIN_FROM_VILLAGE = 12
export const WILD_MIN_FROM_CAVE = 4
const SAMPLE_TRIES = 200
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// Homes for the map's declared NPC population. Village NPCs cluster on the
// village/camp POI within their species' roam; wild ones keep clear of the
// village and every cave mouth. Ids index the concatenated village+wild list,
// so they are stable while the homes reroll on every spawn.
export function npcSpawnsForMap(data, { record = null, rng = Math.random } = {}) {
  if (!data.npcs) return []
  const walkable = (x, y) => x >= 1 && y >= 1 && x < data.w - 1 && y < data.h - 1 && data.walk[y][x] === '1'
  const taken = new Set([`${data.playerSpawn.x},${data.playerSpawn.y}`])
  const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp') ?? null
  const caves = data.pois.filter(p => p.kind === 'dungeon_entrance')
  const dead = new Set(record?.dead ?? [])
  const spawns = []
  const place = (species, i, pick) => {
    const id = `npc:${data.name}:${i}`
    if (dead.has(id)) return
    const def = NPC_SPECIES[species]
    if (!def) { console.warn(`npc: unknown species "${species}" on ${data.name}`); return }
    const t = pick(def)
    if (!t) { console.warn(`npc: no home found for ${id}`); return }
    taken.add(`${t.x},${t.y}`)
    // a reloaded wrath only re-arms the villagers who can actually fight —
    // onNpcHit never turns a flee species hostile, so nor may a saved record
    spawns.push({ kind: 'npc', species, x: t.x, y: t.y, id,
      hostile: !!(def.hostile || (record?.hostile && def.faction === 'village' && def.onHit === 'fight')) })
  }
  const free = (x, y) => walkable(x, y) && !taken.has(`${x},${y}`)
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  // village: uniform in the roam box around the anchor, expanding if crowded
  const pickVillage = def => {
    if (!anchor) return null
    for (let r = def.roam, tries = 0; tries < SAMPLE_TRIES; tries++, r += tries % 20 === 0 ? 1 : 0) {
      const x = anchor.x + ri(-r, r), y = anchor.y + ri(-r, r)
      if (free(x, y)) return { x, y }
    }
    return null
  }
  // wild: anywhere, then relax the village distance, then anywhere free
  const pickWild = () => {
    for (const minV of [WILD_MIN_FROM_VILLAGE, 6, 0]) {
      for (let tries = 0; tries < SAMPLE_TRIES; tries++) {
        const x = ri(1, data.w - 2), y = ri(1, data.h - 2)
        if (!free(x, y)) continue
        if (anchor && cheb(x, y, anchor.x, anchor.y) < minV) continue
        if (caves.some(c => cheb(x, y, c.x, c.y) < WILD_MIN_FROM_CAVE)) continue
        return { x, y }
      }
    }
    return null
  }
  const declaredVillage = data.npcs.village ?? []
  if (declaredVillage.length && !anchor)
    console.warn(`npc: ${data.name} declares ${declaredVillage.length} village npcs but has no village/camp POI`)
  if (anchor) declaredVillage.forEach((sp, i) => place(sp, i, pickVillage))
  ;(data.npcs.wild ?? []).forEach((sp, i) => place(sp, declaredVillage.length + i, pickWild))
  return spawns
}

export function buildOpenMap(data, { npcs = null, rng = Math.random } = {}) {
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
    if (!border && c.tile === TILE.WALL) {
      // The blocker the player sees is the prop art if any, else the ground.
      const blocker = pi >= 0 ? data.palette[pi] : c.skin
      if (startsWithAny(blocker, LOS_CLEAR_PREFIXES)) c.losClear = true
      else if (startsWithAny(blocker, LOS_SOFT_PREFIXES)) c.losSoft = true
    }
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
  // Signposts: stamp the sign art onto each sign tile and make it solid.
  // A no-op where the bake already carries the ow_sign prop (Aspengrove).
  const signs = signsForMap(data.name)
  for (const s of signs) {
    const c = map[s.y]?.[s.x]
    if (!c) { console.warn(`signs: tile ${s.x},${s.y} outside ${data.name}`); continue }
    c.overlay = 'ow_sign'
    c.tile = TILE.WALL
  }
  entitySpawns.push(...npcSpawnsForMap(data, { record: npcs, rng }))
  // Starter weapon: a chest beside the spawn so a fresh adventurer is armed
  // before the first cave. Nearest free walkable tile 1–3 steps out, row-major
  // by ring so it lands on the same tile every visit.
  if (data.starter) {
    const taken = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    const { x: sx, y: sy } = data.playerSpawn
    let spot = null
    for (let r = 1; r <= 3 && !spot; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = sx + dx, y = sy + dy
        if (map[y]?.[x]?.tile === TILE.FLOOR && !taken.has(`${x},${y}`)) { spot = { x, y }; break }
      }
    }
    if (spot) entitySpawns.push({ kind: 'weapon', weaponType: data.starter, x: spot.x, y: spot.y })
    else console.warn(`starter: no free tile beside the spawn on ${data.name}`)
  }
  return {
    map, entitySpawns, playerSpawn: { ...data.playerSpawn }, rooms: [],
    caveEntrances, gates, mapExit: data.exit ? { ...data.exit } : null,
    signs,
  }
}
