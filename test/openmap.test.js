import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenMap, npcSpawnsForMap } from '../renderer/systems/openmap.js'
import { generateLevel } from '../renderer/systems/map.js'
import { OPEN_MAPS, OPEN_MAP_SPRITES } from '../renderer/data/open-maps.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { TREES, STUMP } from '../renderer/systems/lumber.js'

const DATA = OPEN_MAPS[7]

// Cells rewritten by the gate stamp at each dungeon entrance (see
// systems/gates.js): the 4-wide gate row plus the two basin cells below.
const gateCells = data => new Set(data.pois
  .filter(p => p.kind === 'dungeon_entrance')
  .flatMap(p => [
    `${p.x - 1},${p.y}`, `${p.x},${p.y}`, `${p.x + 1},${p.y}`, `${p.x + 2},${p.y}`,
    `${p.x - 1},${p.y + 1}`, `${p.x + 2},${p.y + 1}`,
  ]))

describe('buildOpenMap', () => {
  const { map, entitySpawns, playerSpawn } = buildOpenMap(DATA)
  const stamped = gateCells(DATA)

  it('produces a map with the data dimensions', () => {
    assert.equal(map.length, DATA.h)
    assert.equal(map[0].length, DATA.w)
  })

  it('mirrors the walk grid: open cells are FLOOR, blocked cells are WALL (interior)', () => {
    for (let y = 1; y < DATA.h - 1; y++) for (let x = 1; x < DATA.w - 1; x++) {
      if (stamped.has(`${x},${y}`)) continue // gate stamp overrides the bake
      const open = DATA.walk[y][x] === '1'
      assert.equal(isWalkable(map[y][x].tile), open, `walkability mismatch at ${x},${y}`)
      assert.equal(map[y][x].tile, open ? TILE.FLOOR : TILE.WALL)
    }
  })

  it('blocks every border cell so the camera never shows the void', () => {
    for (let x = 0; x < DATA.w; x++) {
      assert.equal(map[0][x].tile, TILE.WALL)
      assert.equal(map[DATA.h - 1][x].tile, TILE.WALL)
    }
    for (let y = 0; y < DATA.h; y++) {
      assert.equal(map[y][0].tile, TILE.WALL)
      assert.equal(map[y][DATA.w - 1].tile, TILE.WALL)
    }
  })

  it('skins every cell from the palette, with props as overlays', () => {
    let overlays = 0
    for (let y = 0; y < DATA.h; y++) for (let x = 0; x < DATA.w; x++) {
      const c = map[y][x]
      assert.equal(c.skin, DATA.palette[DATA.ground[y][x]], `ground skin at ${x},${y}`)
      const pi = DATA.prop[y][x]
      if (pi >= 0 && !stamped.has(`${x},${y}`) && !entitySpawns.some(s => s.x === x && s.y === y)) {
        assert.equal(c.overlay, DATA.palette[pi], `prop overlay at ${x},${y}`)
        overlays++
      }
    }
    assert.ok(overlays > 100, 'a forest should carry many prop overlays')
  })

  it('locks every cell so a decoration pass cannot repaint the art', () => {
    for (const row of map) for (const c of row) assert.equal(c.locked, true)
  })

  it('turns chest POIs into chest spawns and drops their baked-in overlay', () => {
    const chests = DATA.pois.filter(p => p.kind === 'chest')
    assert.ok(chests.length > 0, 'Clearings has caches')
    // entitySpawns.length now also includes rite spawns (Task 10); compare
    // against just the chest-kind spawns.
    assert.equal(entitySpawns.filter(s => s.kind === 'chest').length, chests.length)
    for (const p of chests) {
      assert.ok(entitySpawns.some(s => s.kind === 'chest' && s.x === p.x && s.y === p.y), `spawn for cache at ${p.x},${p.y}`)
      assert.equal(map[p.y][p.x].overlay, undefined, 'chest art comes from the entity, not the map')
    }
  })

  it('spawns no enemies and no markers for scenery POIs', () => {
    // Rite triggers, wild mushrooms and gate fountains are legitimate spawn
    // kinds — this guards against anything else (enemies, markers)
    // sneaking onto an open map's scenery.
    const ALLOWED_KINDS = ['chest', 'talent_trigger', 'wild_mushroom', 'fountain_wall', 'fountain_basin', 'npc', 'weapon']
    assert.ok(entitySpawns.every(s => ALLOWED_KINDS.includes(s.kind)))
  })

  it('places the player on a walkable cell', () => {
    assert.deepEqual(playerSpawn, DATA.playerSpawn)
    assert.ok(isWalkable(map[playerSpawn.y][playerSpawn.x].tile))
  })
})

describe('episode chest contents', () => {
  const LAKE = Object.values(OPEN_MAPS).find(m => m.name === 'lake-1-ferry')

  it("the islet cache chest spawn carries the episode's clapper; other caches carry none", () => {
    const { entitySpawns } = buildOpenMap(LAKE)
    const chests = entitySpawns.filter(s => s.kind === 'chest')
    const islet = LAKE.pois.find(p => p.kind === 'chest' && p.label === 'islet cache')
    const islands = chests.find(s => s.x === islet.x && s.y === islet.y)
    assert.deepEqual(islands.contents, { type: 'clapper' })
    for (const s of chests) if (s.x !== islet.x || s.y !== islet.y) assert.equal(s.contents, undefined)
  })
})

describe('waystone exit', () => {
  it('marks the exit cell with the arch overlay and keeps it walkable', () => {
    const { map, mapExit } = buildOpenMap(DATA)
    assert.deepEqual(mapExit, DATA.exit)
    const c = map[mapExit.y][mapExit.x]
    assert.equal(c.overlay, 'ow_house_arch_stone')
    assert.equal(c.tile, TILE.FLOOR)
  })

  it('the last map has no exit and no marker', () => {
    const { mapExit } = buildOpenMap(OPEN_MAPS[18])
    assert.equal(mapExit, null)
  })
})

describe('generateLevel depth 7', () => {
  it('dispatches to the static open map', () => {
    const { map } = generateLevel(7, DATA.w, DATA.h)
    assert.equal(map.length, DATA.h)
    assert.equal(map[0].length, DATA.w)
    assert.equal(map[DATA.playerSpawn.y][DATA.playerSpawn.x].tile, TILE.FLOOR)
  })
})

describe('OPEN_MAP_SPRITES', () => {
  it('collects every palette name exactly once', () => {
    assert.equal(new Set(OPEN_MAP_SPRITES).size, OPEN_MAP_SPRITES.length)
    for (const n of DATA.palette) assert.ok(OPEN_MAP_SPRITES.includes(n))
  })
})

// Synthetic 8x8 map: a mushroom-ring poi at (4,4) and two ow_mushroom props.
const mkData = () => ({
  name: 'forest-1-clearings', w: 8, h: 8,
  palette: ['ow_grass_0', 'ow_mushroom'],
  ground: Array.from({ length: 8 }, () => Array(8).fill(0)),
  prop:   Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) =>
    (y === 2 && (x === 2 || x === 5)) ? 1 : -1)),
  walk:   Array.from({ length: 8 }, () => '11111111'),
  pois: [{ kind: 'landmark', x: 4, y: 4, label: 'mushroom ring' }],
  playerSpawn: { x: 1, y: 1 },
})

describe('rite spawns on open maps', () => {
  it('emits a talent_trigger at the rite poi', () => {
    const { entitySpawns } = buildOpenMap(mkData())
    const trig = entitySpawns.find(s => s.kind === 'talent_trigger')
    assert.deepEqual(trig, { kind: 'talent_trigger', x: 4, y: 4, talent: 'magic_stance', rite: 'mushroom_circle' })
  })

  it('spawns wild mushrooms beside mushroom props, deterministically', () => {
    const a = buildOpenMap(mkData()).entitySpawns.filter(s => s.kind === 'wild_mushroom')
    const b = buildOpenMap(mkData()).entitySpawns.filter(s => s.kind === 'wild_mushroom')
    assert.ok(a.length >= 1)
    assert.deepEqual(a, b)
  })

  it('maps without rites emit neither', () => {
    const data = { ...mkData(), name: 'desert-1-dunes', pois: [] }
    const spawns = buildOpenMap(data).entitySpawns
    assert.equal(spawns.some(s => s.kind === 'talent_trigger'), false)
  })
})

// The marsh's mushroom ring anchors a talent-less rite: the trance and
// ceremony still play, but there is nothing to learn (see game.js).
describe('marsh-3-hermit talent-less rite', () => {
  it('emits one talent_trigger at the mushroom ring with talent: null', () => {
    const data = OPEN_MAPS[10]
    const { entitySpawns } = buildOpenMap(data)
    const triggers = entitySpawns.filter(s => s.kind === 'talent_trigger')
    assert.equal(triggers.length, 1)
    const ring = data.pois.find(p => p.label === 'mushroom ring')
    assert.deepEqual(triggers[0], { kind: 'talent_trigger', x: ring.x, y: ring.y, talent: null, rite: 'mushroom_circle' })
  })
})

describe('LOS terrain classification', () => {
  // The blocker a cell shows is its prop art if it has one, else its ground.
  const effectiveSkin = (data, x, y) => {
    const pi = data.prop[y][x]
    return pi >= 0 ? data.palette[pi] : data.palette[data.ground[y][x]]
  }
  const CLEAR = ['ow_water_', 'ow_pond_']
  const SOFT = ['ow_tree_', 'ow_deadtree_', 'ow_bush_', 'ow_shrub_', 'ow_mushroom', 'ow_cactus']
  const startsWithAny = (s, prefixes) => prefixes.some(p => s?.startsWith(p))

  it('flags water clear and foliage soft on every blocking interior cell, nothing else', () => {
    let clear = 0, soft = 0
    for (const data of Object.values(OPEN_MAPS)) {
      const { map } = buildOpenMap(data)
      const stamped = gateCells(data)
      for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
        if (stamped.has(`${x},${y}`) || map[y][x].tile !== TILE.WALL) continue
        const skin = effectiveSkin(data, x, y)
        const wantClear = startsWithAny(skin, CLEAR)
        const wantSoft = !wantClear && startsWithAny(skin, SOFT)
        assert.equal(!!map[y][x].losClear, wantClear, `losClear at ${x},${y} (${skin})`)
        assert.equal(!!map[y][x].losSoft, wantSoft, `losSoft at ${x},${y} (${skin})`)
        if (wantClear) clear++
        if (wantSoft) soft++
      }
    }
    assert.ok(clear > 1000, 'the nine maps hold plenty of water')
    assert.ok(soft > 5000, 'the nine maps hold plenty of foliage')
  })

  it('walkable cells and the border carry no LOS flags', () => {
    const data = OPEN_MAPS[7]
    const { map } = buildOpenMap(data)
    for (let x = 0; x < data.w; x++) {
      assert.equal(map[0][x].losClear ?? map[0][x].losSoft, undefined)
    }
    for (let y = 1; y < data.h - 1; y++) for (let x = 1; x < data.w - 1; x++) {
      if (map[y][x].tile === TILE.FLOOR)
        assert.equal(map[y][x].losClear ?? map[y][x].losSoft, undefined, `flag on floor at ${x},${y}`)
    }
  })
})

describe('dungeon entrance reachability', () => {
  // Flood-fill from playerSpawn over the post-stamp map (gate stamping can
  // itself sever a narrow approach, so this must run against buildOpenMap's
  // output, not the raw data.walk grid).
  const floodFill = (map, start) => {
    const h = map.length, w = map[0].length
    const seen = Array.from({ length: h }, () => Array(w).fill(false))
    const stack = [start]
    seen[start.y][start.x] = true
    while (stack.length) {
      const { x, y } = stack.pop()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || ny >= h || nx >= w) continue
        if (seen[ny][nx]) continue
        if (!isWalkable(map[ny][nx].tile)) continue
        seen[ny][nx] = true
        stack.push({ x: nx, y: ny })
      }
    }
    return seen
  }

  for (const [key, data] of Object.entries(OPEN_MAPS)) {
    const entrances = data.pois.filter(p => p.kind === 'dungeon_entrance')
    if (entrances.length === 0) continue
    it(`every dungeon-entrance trigger cell is reachable from spawn on ${data.name} (map ${key})`, () => {
      const { map, playerSpawn } = buildOpenMap(data)
      const seen = floodFill(map, playerSpawn)
      for (const p of entrances) {
        assert.ok(seen[p.y]?.[p.x], `${data.name}: "${p.label}" trigger cell (${p.x},${p.y}) is unreachable from spawn`)
        assert.ok(seen[p.y]?.[p.x + 1], `${data.name}: "${p.label}" trigger cell (${p.x + 1},${p.y}) is unreachable from spawn`)
      }
    })
  }
})

// Deterministic LCG so sampling tests are reproducible.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

describe('npcSpawnsForMap', () => {
  for (const depth of [7, 8, 11, 12]) {
    const data = OPEN_MAPS[depth]
    it(`${data.name}: spawns the declared population on walkable, distinct tiles`, () => {
      const spawns = npcSpawnsForMap(data, { rng: lcg(1) })
      assert.equal(spawns.length, data.npcs.village.length + data.npcs.wild.length)
      const seen = new Set()
      for (const s of spawns) {
        assert.equal(s.kind, 'npc')
        assert.equal(data.walk[s.y][s.x], '1', `${s.id} on a blocked tile`)
        assert.ok(!seen.has(`${s.x},${s.y}`), `${s.id} shares a tile`); seen.add(`${s.x},${s.y}`)
        assert.ok(!(s.x === data.playerSpawn.x && s.y === data.playerSpawn.y), 'on the player spawn')
        assert.equal(s.hostile, !!NPC_SPECIES[s.species].hostile, `${s.id} hostility`)
      }
    })
    it(`${data.name}: village homes sit within roam of the anchor, wild homes keep their distance`, () => {
      const anchor = data.pois.find(p => p.kind === 'village' || p.kind === 'camp')
      const caves = data.pois.filter(p => p.kind === 'dungeon_entrance')
      const spawns = npcSpawnsForMap(data, { rng: lcg(2) })
      const nVillage = data.npcs.village.length
      spawns.slice(0, nVillage).forEach(s => assert.ok(cheb(s, anchor) <= 8, `${s.id} far from village`))
      spawns.slice(nVillage).forEach(s => {
        assert.ok(cheb(s, anchor) >= 12, `${s.id} too close to the village`)
        for (const c of caves) assert.ok(cheb(s, c) >= 4, `${s.id} clogs ${c.label}`)
      })
    })
  }
  it('ids are stable across rngs; homes are not', () => {
    const a = npcSpawnsForMap(OPEN_MAPS[7], { rng: lcg(3) })
    const b = npcSpawnsForMap(OPEN_MAPS[7], { rng: lcg(4) })
    assert.deepEqual(a.map(s => s.id), b.map(s => s.id))
    assert.equal(a[0].id, 'npc:forest-1-clearings:0')
    assert.ok(a.some((s, i) => s.x !== b[i].x || s.y !== b[i].y))
  })
  it('honours a saved record: dead ids are skipped, only fight-capable villagers spawn hostile', () => {
    const record = { dead: ['npc:forest-1-clearings:0', 'npc:forest-1-clearings:7'], hostile: true }
    const spawns = npcSpawnsForMap(OPEN_MAPS[7], { record, rng: lcg(5) })
    assert.equal(spawns.length, 16 - 2)
    assert.ok(!spawns.some(s => record.dead.includes(s.id)))
    // elders flee when hit, so onNpcHit never turns them hostile: a reloaded
    // wrath must not hand them a fight they cannot have
    for (const s of spawns) assert.equal(s.hostile, s.species === 'villager' || !!NPC_SPECIES[s.species].hostile)
    assert.ok(spawns.some(s => s.species === 'villager' && s.hostile))
    assert.ok(spawns.some(s => s.species === 'elder' && !s.hostile))
  })
  it('hostile-on-sight species spawn hostile without any saved record', () => {
    const spawns = npcSpawnsForMap(OPEN_MAPS[7], { rng: lcg(8) })
    const wolves = spawns.filter(s => s.species === 'wolf')
    assert.ok(wolves.length >= 1)
    for (const w of wolves) assert.equal(w.hostile, true)
    for (const s of spawns.filter(s => s.species === 'boar' || s.species === 'sheep')) assert.equal(s.hostile, false)
  })
  it('a map without npcs yields nothing', () => {
    assert.deepEqual(npcSpawnsForMap(OPEN_MAPS[13], { rng: lcg(6) }), [])
  })
  it('a map with a declared village but no village/camp POI drops only the village group', () => {
    const data = { ...OPEN_MAPS[7], pois: OPEN_MAPS[7].pois.filter(p => p.kind !== 'village' && p.kind !== 'camp') }
    const spawns = npcSpawnsForMap(data, { rng: lcg(8) })
    assert.equal(spawns.length, data.npcs.wild.length)
    assert.ok(spawns.every(s => data.npcs.wild.includes(s.species)))
    assert.equal(spawns[0].id, 'npc:forest-1-clearings:9')
  })
  it('buildOpenMap emits the npc spawns and forwards the record', () => {
    const record = { dead: ['npc:forest-1-clearings:0'], hostile: false }
    const { entitySpawns } = buildOpenMap(OPEN_MAPS[7], { npcs: record, rng: lcg(7) })
    const npcs = entitySpawns.filter(s => s.kind === 'npc')
    assert.equal(npcs.length, 15)
  })
})

describe('npcSpawnsForMap — npcs.at', () => {
  it('marsh-3-hermit: homes the hermit beside the hermit hut POI, with an id after village+wild', () => {
    const data = OPEN_MAPS[10]
    const spawns = npcSpawnsForMap(data, { rng: lcg(1) })
    const hut = data.pois.find(p => p.label === 'hermit hut')
    const hermit = spawns.find(s => s.species === 'hermit')
    assert.ok(hermit, 'hermit spawned')
    assert.ok(cheb(hermit, hut) <= 3, `hermit at ${hermit.x},${hermit.y} too far from the hut`)
    assert.equal(data.walk[hermit.y][hermit.x], '1')
    const nVillage = data.npcs.village.length, nWild = data.npcs.wild.length
    assert.equal(hermit.id, `npc:marsh-3-hermit:${nVillage + nWild}`)
    assert.equal(spawns.length, nVillage + nWild + 1)
  })

  it('honours the dead record for an npcs.at spawn like any other', () => {
    const data = OPEN_MAPS[10]
    const nVillage = data.npcs.village.length, nWild = data.npcs.wild.length
    const record = { dead: [`npc:marsh-3-hermit:${nVillage + nWild}`] }
    const spawns = npcSpawnsForMap(data, { record, rng: lcg(1) })
    assert.equal(spawns.some(s => s.species === 'hermit'), false)
  })

  it('a species listed under an undeclared POI label is dropped, not crashed on', () => {
    const data = { ...mkData(), npcs: { at: { 'no such poi': ['villager'] } } }
    assert.deepEqual(npcSpawnsForMap(data, { rng: lcg(1) }), [])
  })
})

describe('starter weapon', () => {
  it('Clearings declares a hatchet; the chest lands beside the village spawn', () => {
    const data = OPEN_MAPS[7]
    assert.equal(data.starter, 'hatchet')
    const { entitySpawns } = buildOpenMap(data)
    const starters = entitySpawns.filter(s => s.kind === 'weapon')
    assert.equal(starters.length, 1)
    const c = starters[0]
    assert.equal(c.weaponType, 'hatchet')
    assert.ok(cheb(c, data.playerSpawn) >= 1 && cheb(c, data.playerSpawn) <= 3, `chest at ${c.x},${c.y}`)
    assert.equal(data.walk[c.y][c.x], '1')
    assert.ok(!entitySpawns.some(s => s !== c && s.x === c.x && s.y === c.y), 'tile shared')
  })
  it('other maps get no starter chest', () => {
    for (const d of [8, 11, 12]) assert.equal(buildOpenMap(OPEN_MAPS[d]).entitySpawns.filter(s => s.kind === 'weapon').length, 0)
  })
})

describe('felled trees', () => {
  const firstTrunk = () => {
    for (let y = 1; y < DATA.h - 1; y++) for (let x = 1; x < DATA.w - 1; x++) {
      const pi = DATA.prop[y][x]
      if (pi >= 0 && TREES[DATA.palette[pi]]) return { x, y }
    }
    throw new Error('no tree on the map')
  }
  it('a recorded trunk is rebuilt as a walkable stump', () => {
    const { x, y } = firstTrunk()
    const { map } = buildOpenMap(DATA, { felled: [`${x},${y}`] })
    assert.equal(map[y][x].tile, TILE.FLOOR)
    assert.equal(map[y][x].overlay, STUMP)
    assert.ok(isWalkable(map[y][x].tile, map[y][x]))
    assert.equal(map[y][x].losSoft, undefined)
  })
  it('without a record the tree stands', () => {
    const { x, y } = firstTrunk()
    const { map } = buildOpenMap(DATA)
    assert.equal(map[y][x].tile, TILE.WALL)
    assert.ok(TREES[map[y][x].overlay])
  })
  it('a border key never punches a hole in the map edge', () => {
    // The border is forced to WALL because the camera is unbounded; a felled
    // border tree would open the void.
    const { map } = buildOpenMap(DATA, { felled: ['0,5', '5,0', `${DATA.w - 1},5`] })
    assert.equal(map[5][0].tile, TILE.WALL)
    assert.equal(map[0][5].tile, TILE.WALL)
    assert.equal(map[5][DATA.w - 1].tile, TILE.WALL)
  })
  it('generateLevel threads the record through', () => {
    const { x, y } = firstTrunk()
    const { map } = generateLevel(7, DATA.w, DATA.h, { felled: [`${x},${y}`] })
    assert.equal(map[y][x].overlay, STUMP)
  })
})
