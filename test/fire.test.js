import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TILE } from '../renderer/systems/entities.js'
import { registerMonsters, clearMonsters } from '../renderer/systems/monsters.js'
import { computeBlastTiles, BLAST_TILES, applyBurst, makeFireZone, updateFireZones,
         BURST_DAMAGE, FIRE_DURATION, FIRE_TICK_INTERVAL } from '../renderer/systems/fire.js'

// Build a map from ASCII rows: '#' wall, '.' floor, 'v' floor with a void zone.
function grid(rows) {
  return rows.map(r => [...r].map(ch => ({
    tile: ch === '#' ? TILE.WALL : TILE.FLOOR,
    ...(ch === 'v' ? { voidZone: true } : {}),
  })))
}
const key = t => `${t.x},${t.y}`

describe('computeBlastTiles', () => {
  it('fills a BFS diamond in the open — 16 tiles, all of manhattan radius 2 included', () => {
    const map = grid(['.........', '.........', '.........', '.........',
                      '.........', '.........', '.........', '.........', '.........'])
    const tiles = computeBlastTiles(map, 4, 4)
    assert.equal(tiles.length, BLAST_TILES)
    assert.deepEqual(tiles[0], { x: 4, y: 4 }, 'origin first in BFS order')
    const keys = new Set(tiles.map(key))
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= 2)
          assert.ok(keys.has(`${4 + dx},${4 + dy}`), `manhattan-2 tile ${dx},${dy} burns`)
    for (const t of tiles)
      assert.ok(Math.abs(t.x - 4) + Math.abs(t.y - 4) <= 3, 'never farther than ring 3')
  })

  it('spills around walls like a gas and truncates when the space runs out', () => {
    // Two chambers joined only by the gap at row 3. Straight-line distance to
    // the right chamber is short, but fire must walk around through the gap.
    const map = grid([
      '#######',
      '#..#..#',
      '#..#..#',
      '#.....#',
      '#######',
    ])
    const tiles = computeBlastTiles(map, 1, 1)
    const keys = new Set(tiles.map(key))
    assert.equal(tiles.length, 13, 'all 13 reachable tiles burn — closet truncation under 16')
    assert.ok(keys.has('4,1'), 'spilled through the gap into the right chamber')
    assert.ok(!keys.has('3,1'), 'wall tile never burns')
  })

  it('respects void zones and refuses an unwalkable origin', () => {
    const map = grid(['....', '.v..', '....'])
    const keys = new Set(computeBlastTiles(map, 0, 0).map(key))
    assert.ok(!keys.has('1,1'), 'void-zone tile excluded')
    assert.deepEqual(computeBlastTiles(grid(['#..']), 0, 0), [], 'wall origin → no blast')
  })

  it('honors a custom count', () => {
    const map = grid(['.....', '.....', '.....'])
    assert.equal(computeBlastTiles(map, 2, 1, 4).length, 4)
  })
})

// Entities/player on a 32px grid: tile (tx, ty) → pixel center.
const at = (tx, ty, extra = {}) => ({ type: 'monster', px: tx * 32 + 16, py: ty * 32 + 16, hp: 10, ...extra })
const TILES = [{ x: 1, y: 1 }, { x: 2, y: 1 }]

describe('applyBurst', () => {
  it('deals 4 to everyone on a blast tile, spares everyone off it, removes kills', () => {
    const inside = at(1, 1)
    const outside = at(5, 5)
    const weakling = at(2, 1, { hp: 3 })
    const { entities, playerBurned, hitCount } =
      applyBurst([inside, outside, weakling], at(1, 1), TILES)
    assert.equal(hitCount, 2)
    assert.equal(entities.find(e => e.px === inside.px).hp, 10 - BURST_DAMAGE)
    assert.equal(entities.find(e => e.px === outside.px).hp, 10, 'outside untouched')
    assert.ok(!entities.some(e => e.hp <= 0), 'burst kill removed')
    assert.equal(playerBurned, true)
  })

  it('spares the dragon boss and non-enemies, burns shielded wizards, misses a distant player', () => {
    const boss = at(1, 1, { type: 'dragon_boss', hp: 18 })
    const chest = at(2, 1, { type: 'chest', hp: undefined })
    const shielded = at(2, 1, { type: 'wizard', hp: 6, shieldTimer: 2 })
    const { entities, playerBurned, hitCount } =
      applyBurst([boss, chest, shielded], at(9, 9), TILES)
    assert.equal(hitCount, 1, 'only the wizard counts')
    assert.equal(entities.find(e => e.type === 'dragon_boss').hp, 18)
    assert.equal(entities.find(e => e.type === 'chest').hp, undefined)
    assert.equal(entities.find(e => e.type === 'wizard').hp, 6 - BURST_DAMAGE, 'shield is no fire protection')
    assert.equal(playerBurned, false)
  })
})

describe('fire zones', () => {
  it('makeFireZone starts fresh with a full tick timer', () => {
    assert.deepEqual(makeFireZone(TILES), { tiles: TILES, age: 0, tickTimer: FIRE_TICK_INTERVAL })
  })

  it('ticks 1 damage per second — 3 ticks over a full 3 s lifetime, then expires', () => {
    let zones = [makeFireZone(TILES)]
    let entities = [at(1, 1), at(5, 5)]
    const player = at(2, 1)
    let playerTotal = 0
    for (let i = 0; i < 6; i++) {           // 6 × 0.5 s = 3.0 s
      const r = updateFireZones(zones, entities, player, 0.5)
      zones = r.zones; entities = r.entities; playerTotal += r.playerDamage
    }
    assert.equal(entities.find(e => e.px === 48).hp, 10 - 3, 'standing enemy took 3 ticks')
    assert.equal(entities.find(e => e.px === 176).hp, 10, 'distant enemy untouched')
    assert.equal(playerTotal, 3, 'player standing in fire took 3 ticks')
    assert.equal(zones.length, 0, 'zone burned out at 3.0 s')
  })

  it('does not tick before the first full second', () => {
    const r = updateFireZones([makeFireZone(TILES)], [at(1, 1)], at(9, 9), 0.9)
    assert.equal(r.entities[0].hp, 10)
    assert.equal(r.playerDamage, 0)
    assert.equal(r.zones.length, 1)
  })

  it('skips the dragon boss and removes tick kills', () => {
    const boss = at(1, 1, { type: 'dragon_boss', hp: 18 })
    const dying = at(2, 1, { hp: 1 })
    const r = updateFireZones([makeFireZone(TILES)], [boss, dying], at(9, 9), 1.0)
    assert.equal(r.entities.find(e => e.type === 'dragon_boss').hp, 18)
    assert.ok(!r.entities.some(e => e.type === 'monster'), 'tick kill removed')
  })

  it('applies 2 ticks in a single update when delta spans multiple tick intervals', () => {
    const r = updateFireZones([makeFireZone(TILES)], [at(1, 1)], at(2, 1), 2.5)
    assert.equal(r.entities.find(e => e.px === 48).hp, 10 - 2, 'entity took 2 ticks in one call')
    assert.equal(r.playerDamage, 2, 'player accrued 2 ticks in one call')
    assert.equal(r.zones.length, 1, 'zone still alive at age 2.5')
    assert.equal(r.zones[0].age, 2.5)
  })

  it('ticks overlapping zones independently on the shared tile', () => {
    const zones = [makeFireZone(TILES), makeFireZone(TILES)]
    const r = updateFireZones(zones, [at(1, 1)], at(2, 1), 1.0)
    assert.equal(r.entities.find(e => e.px === 48).hp, 10 - 2, 'both zones ticked the shared tile')
    assert.equal(r.playerDamage, 2, 'both zones ticked the player')
    assert.equal(r.zones.length, 2, 'both zones still alive')
  })
})

describe('npc burnability', () => {
  it('a fireball burst hurts an npc standing on a blast tile', () => {
    const hp = BURST_DAMAGE + 3   // tougher than any real species, so it survives to be checked
    const npc = { type: 'npc', id: 'n', hp, maxHp: hp, px: 48, py: 48 }
    const r = applyBurst([npc], { px: 400, py: 400 }, [{ x: 1, y: 1 }])
    assert.equal(r.hitCount, 1)
    assert.equal(r.entities[0].hp, hp - BURST_DAMAGE)
  })

  it('culls an npc the burst kills outright', () => {
    const npc = { type: 'npc', id: 'n', hp: 3, maxHp: 3, px: 48, py: 48 }
    const r = applyBurst([npc], { px: 400, py: 400 }, [{ x: 1, y: 1 }])
    assert.equal(r.entities.length, 0)
  })
})

describe('hit extents (systems/hitbox.js)', () => {
  it('a burst burns a big body spilling onto a blast tile from the next tile over', () => {
    const cyclops = at(3, 1, { type: 'cyclops' })   // centre 16 px past tile (2,1)'s east edge
    const guard = at(3, 1, { type: 'guard' })        // 32 px sprite: 16 px is past its rim
    const { entities, hitCount } = applyBurst([cyclops, guard], at(9, 9), TILES)
    assert.equal(hitCount, 1)
    assert.equal(entities.find(e => e.type === 'cyclops').hp, 10 - BURST_DAMAGE)
    assert.equal(entities.find(e => e.type === 'guard').hp, 10)
  })

  it('a fire zone ticks a big body spilling onto it the same way', () => {
    const cyclops = at(3, 1, { type: 'cyclops' })
    const guard = at(3, 1, { type: 'guard' })
    const { entities } = updateFireZones([makeFireZone(TILES)], [cyclops, guard], at(9, 9), FIRE_TICK_INTERVAL)
    assert.equal(entities.find(e => e.type === 'cyclops').hp, 9)
    assert.equal(entities.find(e => e.type === 'guard').hp, 10)
  })
})

describe('registry monsters', () => {
  const FAKE_RIG = {
    PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
    drawMonster: () => {},
  }
  const register = (name, behavior = {}) => registerMonsters(
    [{ name, rig: 'fakerig', stats: { hp: 24, dmg: 2, speed: 70, half: 12 }, behavior }],
    { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })
  const recorder = () => { const hurt = []; return { hurt, hooks: { hurt: (e, d, meta) => hurt.push([e, d, meta]) } } }

  it('a burst hurts a registry monster on a blast tile through the hurt hook, in place', async () => {
    await register('firebeast')
    try {
      const beast = at(1, 1, { type: 'firebeast', hp: 24 })
      const { hurt, hooks } = recorder()
      const r = applyBurst([beast], at(9, 9), TILES, hooks)
      assert.deepEqual(hurt, [[beast, BURST_DAMAGE, { source: 'fire' }]], 'the hook is told it is fire, so a creature can answer fire differently from a blade')
      assert.equal(r.hitCount, 1)
      assert.equal(r.entities[0], beast, 'the live entity is kept, never copied or culled here')
      assert.equal(beast.hp, 24, 'the hook owns the damage (hurtCreature decides absorbs and death)')
    } finally { clearMonsters() }
  })

  it('a fire zone ticks a registry monster through the hurt hook', async () => {
    await register('firebeast')
    try {
      const beast = at(1, 1, { type: 'firebeast', hp: 24 })
      const { hurt, hooks } = recorder()
      updateFireZones([makeFireZone(TILES)], [beast], at(9, 9), FIRE_TICK_INTERVAL, hooks)
      assert.deepEqual(hurt, [[beast, 1, { source: 'fire' }]])
    } finally { clearMonsters() }
  })

  it('a passive story creature burns too, like the bramble lets it through', async () => {
    await register('firenakki', { driver: 'hook', passive: true })
    try {
      const beast = at(1, 1, { type: 'firenakki', hp: undefined })
      const { hurt, hooks } = recorder()
      applyBurst([beast], at(9, 9), TILES, hooks)
      assert.equal(hurt.length, 1)
    } finally { clearMonsters() }
  })

  it('leaves registry monsters alone when no hook is given', async () => {
    await register('firebeast')
    try {
      const beast = at(1, 1, { type: 'firebeast', hp: 24 })
      const r = applyBurst([beast], at(9, 9), TILES)
      assert.equal(r.hitCount, 0)
      assert.equal(beast.hp, 24)
    } finally { clearMonsters() }
  })
})
