import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeBrambleZone, tickZones } from '../renderer/systems/zones.js'
import { TILE } from '../renderer/systems/entities.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'

const T = 32
const mkMap = (w = 20, h = 20) =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => ({ tile: TILE.FLOOR })))

// Entity centred on tile (x, y).
const at = (type, x, y, over = {}) => ({ type, hp: 5, maxHp: 5,
  px: x * T + 16, py: y * T + 16, x, y, ...over })

const mkState = (entities, zones = []) => ({
  player: at('player', 0, 0), entities, zones, map: mkMap(),
})
// Collects what the hooks were asked to do, the way game.js would apply it.
const mkHooks = () => {
  const hurt = []
  return { hooks: { hurt: (e, dmg) => { hurt.push([e, dmg]); e.hp -= dmg } }, hurt }
}

const FAKE_RIG = {
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
const registerStoryCreature = name => registerMonsters(
  [{ name, rig: 'fakerig', stats: { hp: 24, dmg: 2, speed: 70, half: 20 }, behavior: { driver: 'hook' } }],
  { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })

describe('makeBrambleZone', () => {
  it('covers the square around the centre and carries its timings', () => {
    const z = makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)
    assert.equal(z.kind, 'bramble')
    assert.equal(z.tiles.length, 9)
    assert.equal(z.age, 0)
    assert.equal(z.dur, 6)
    assert.equal(z.root, 2)
    assert.equal(z.dps, 1)
    assert.equal(z.tickT, 0)
    assert.ok(z.tiles.every(t => Math.abs(t.x - 8) <= 1 && Math.abs(t.y - 5) <= 1))
  })

  it('takes walkable cells only — walls, columns and the map edge are skipped', () => {
    const map = mkMap(20, 20)
    map[5][8] = { tile: TILE.WALL }
    map[4][7] = { tile: TILE.COLUMN }
    const z = makeBrambleZone(map, 8, 5, 1, 6, 2, 1)
    assert.equal(z.tiles.length, 7)
    assert.ok(!z.tiles.some(t => t.x === 8 && t.y === 5))
    assert.ok(!z.tiles.some(t => t.x === 7 && t.y === 4))

    const corner = makeBrambleZone(map, 0, 0, 1, 6, 2, 1)
    assert.equal(corner.tiles.length, 4)   // only the in-bounds quadrant
  })

  it('honours a void-zone cell the same way walking does', () => {
    const map = mkMap()
    map[5][8] = { tile: TILE.FLOOR, voidZone: true }
    const z = makeBrambleZone(map, 8, 5, 1, 6, 2, 1)
    assert.ok(!z.tiles.some(t => t.x === 8 && t.y === 5))
  })
})

describe('tickZones', () => {
  it('roots an enemy that stands in the thorns', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks } = mkHooks()
    tickZones(s, 0.1, hooks)
    assert.equal(g.rootTimer, 2)
  })

  it('never shortens a longer root already running', () => {
    const g = at('guard', 8, 5, { rootTimer: 5 })
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    tickZones(s, 0.1, mkHooks().hooks)
    assert.equal(g.rootTimer, 5)
  })

  it('roots on entry only, so a rooted enemy is not pinned forever', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks } = mkHooks()
    tickZones(s, 0.5, hooks)
    g.rootTimer = 0.5                     // the enemy update loop counted it down
    tickZones(s, 0.5, hooks)
    assert.equal(g.rootTimer, 0.5, 'still inside: no re-root')
  })

  it('re-roots an enemy that leaves and walks back in', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks } = mkHooks()
    tickZones(s, 0.1, hooks)
    g.rootTimer = 0
    g.px = 20 * T; g.py = 20 * T          // wandered off
    tickZones(s, 0.1, hooks)
    assert.equal(g.rootTimer, 0)
    g.px = 8 * T + 16; g.py = 5 * T + 16  // back in
    tickZones(s, 0.1, hooks)
    assert.equal(g.rootTimer, 2)
  })

  it('bleeds dps once per second while an enemy stands inside', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks, hurt } = mkHooks()
    for (let i = 0; i < 3; i++) tickZones(s, 0.25, hooks)   // 0.75s
    assert.equal(hurt.length, 0)
    tickZones(s, 0.25, hooks)                               // 1.0s
    assert.deepEqual(hurt.map(([e, d]) => [e.type, d]), [['guard', 1]])
    for (let i = 0; i < 4; i++) tickZones(s, 0.25, hooks)   // 2.0s
    assert.equal(hurt.length, 2)
  })

  it('leaves the player out of it', () => {
    const player = at('player', 8, 5)
    const s = { player, entities: [player], zones: [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)], map: mkMap() }
    const { hooks, hurt } = mkHooks()
    tickZones(s, 1.0, hooks)
    assert.equal(player.rootTimer, undefined)
    assert.equal(hurt.length, 0)
  })

  it('spares peaceful villagers — thorns must never start a village brawl', () => {
    const villager = at('npc', 8, 5, { species: 'villager', hostile: false })
    const s = mkState([villager], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks, hurt } = mkHooks()
    tickZones(s, 1.0, hooks)
    assert.equal(villager.rootTimer, undefined)
    assert.equal(hurt.length, 0)
  })

  it('catches a villager who has turned hostile, like any other enemy', () => {
    const thug = at('npc', 8, 5, { species: 'villager', hostile: true })
    const s = mkState([thug], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks, hurt } = mkHooks()
    tickZones(s, 1.0, hooks)
    assert.equal(thug.rootTimer, 2)
    assert.deepEqual(hurt.map(([e, d]) => [e.type, d]), [['npc', 1]])
  })

  it('follows isHittable for story creatures — game.js routes their damage', async () => {
    await registerStoryCreature('maahinen')
    const creature = at('maahinen', 8, 5, { hp: 24, maxHp: 24 })
    const s = mkState([creature], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks, hurt } = mkHooks()
    tickZones(s, 1.0, hooks)
    assert.equal(creature.rootTimer, 2)
    assert.equal(hurt.length, 1, 'the hurt hook (hurtCreature upstream) decides what a creature takes')
    clearMonsters()
  })

  it('ignores an entity already dying', () => {
    const g = at('guard', 8, 5, { dying: 0.2 })
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    const { hooks, hurt } = mkHooks()
    tickZones(s, 1.0, hooks)
    assert.equal(g.rootTimer, undefined)
    assert.equal(hurt.length, 0)
  })

  it('ages zones and drops them when their time is up', () => {
    const s = mkState([], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    tickZones(s, 5.9, mkHooks().hooks)
    assert.equal(s.zones.length, 1)
    assert.equal(s.zones[0].age, 5.9)
    tickZones(s, 0.2, mkHooks().hooks)
    assert.equal(s.zones.length, 0)
  })

  it('tracks entry per zone, so overlapping patches each root once', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1),
      makeBrambleZone(mkMap(), 8, 5, 1, 6, 3, 1)])
    tickZones(s, 0.1, mkHooks().hooks)
    assert.equal(g.rootTimer, 3, 'the stronger root wins')
    assert.equal(s.zones[0].inside.size, 1)
    assert.equal(s.zones[1].inside.size, 1)
  })

  it('gives an id to entities that lack one, so entry tracking works', () => {
    const g = at('guard', 8, 5)
    const s = mkState([g], [makeBrambleZone(mkMap(), 8, 5, 1, 6, 2, 1)])
    tickZones(s, 0.1, mkHooks().hooks)
    assert.ok(g.id != null)
    assert.ok(s.zones[0].inside.has(g.id))
  })

  it('is a no-op with no zones', () => {
    const s = mkState([at('guard', 8, 5)])
    tickZones(s, 0.1, mkHooks().hooks)
    assert.deepEqual(s.zones, [])
  })
})
