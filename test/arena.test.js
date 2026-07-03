import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildArena, buildBossTestArena, generateLevel } from '../renderer/systems/map.js'

describe('buildArena — default content', () => {
  it('reproduces the original boss arena when no enemies/chests are configured', () => {
    const a = buildArena({ size: { w: 26, h: 18 } })
    const b = buildBossTestArena(26, 18)
    assert.deepEqual(a.entitySpawns, b.entitySpawns)
    assert.deepEqual(a.playerSpawn, { x: 13, y: 16 })
    assert.equal(a.entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(a.entitySpawns.length, 21)
  })
})

describe('buildArena — configured content', () => {
  it('spawns enemies at explicit positions', () => {
    const { entitySpawns } = buildArena({ enemies: [{ kind: 'cyclops', x: 5, y: 5 }, { kind: 'crab', x: 7, y: 7 }] })
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['cyclops', 5, 5], ['crab', 7, 7]])
  })

  it('auto-places enemies without positions inside the walls, no overlaps', () => {
    const { entitySpawns, playerSpawn } = buildArena({ enemies: [{ kind: 'guard' }, { kind: 'guard' }, { kind: 'guard' }] })
    assert.equal(entitySpawns.length, 3)
    const seen = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    assert.equal(seen.size, 3, 'no two enemies share a cell')
    assert.ok(!seen.has(`${playerSpawn.x},${playerSpawn.y}`), 'none on the player')
    for (const s of entitySpawns) assert.ok(s.x >= 1 && s.x <= 24 && s.y >= 1 && s.y <= 16, 'inside the walls')
  })

  it('passes variant and isBoss through', () => {
    const { entitySpawns } = buildArena({ enemies: [
      { kind: 'monster', variant: 'medium', x: 4, y: 4 },
      { kind: 'wizard', x: 6, y: 6, isBoss: true },
    ] })
    assert.equal(entitySpawns[0].variant, 'medium')
    assert.equal(entitySpawns[1].isBoss, true)
  })

  it('skips unknown kinds and out-of-bounds positions with warnings, keeps the rest', () => {
    const warnings = []
    const { entitySpawns } = buildArena({ enemies: [
      { kind: 'balrog', x: 5, y: 5 },
      { kind: 'guard', x: 0, y: 5 },
      { kind: 'guard', x: 99, y: 5 },
      { kind: 'crab', x: 5, y: 6 },
    ] }, msg => warnings.push(msg))
    assert.deepEqual(entitySpawns.map(s => s.kind), ['crab'])
    assert.equal(warnings.length, 3)
  })

  it('empty enemies array yields a valid empty arena', () => {
    const { entitySpawns, map } = buildArena({ enemies: [] })
    assert.equal(entitySpawns.length, 0)
    assert.equal(map.length, 18)
    assert.equal(map[0].length, 26)
  })

  it('places configured chests (explicit position + auto on the perimeter ring)', () => {
    const { entitySpawns } = buildArena({ enemies: [], chests: [
      { kind: 'weapon', weaponType: 'axe', x: 3, y: 3 },
      { kind: 'potion' },
    ] })
    const w = entitySpawns.find(s => s.kind === 'weapon')
    const p = entitySpawns.find(s => s.kind === 'potion')
    assert.deepEqual([w.x, w.y, w.weaponType], [3, 3, 'axe'])
    assert.ok(p.x === 1 || p.x === 24 || p.y === 1 || p.y === 16, 'auto chest lands on the ring')
  })

  it('honors and clamps the player spawn', () => {
    assert.deepEqual(buildArena({ player: { x: 5, y: 5 } }).playerSpawn, { x: 5, y: 5 })
    assert.deepEqual(buildArena({ player: { x: -3, y: 99 } }).playerSpawn, { x: 1, y: 16 })
  })

  it('clamps size to 8×8 … 40×30', () => {
    assert.equal(buildArena({ size: { w: 4, h: 4 }, enemies: [] }).map.length, 8)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map.length, 30)
    assert.equal(buildArena({ size: { w: 100, h: 100 }, enemies: [] }).map[0].length, 40)
  })
})

describe('generateLevel — arena option', () => {
  it('routes a depth-0 arena config through buildArena', () => {
    const { entitySpawns } = generateLevel(0, 26, 18, { arena: { enemies: [{ kind: 'cyclops', x: 10, y: 9 }] } })
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['cyclops', 10, 9]])
  })

  it('defaults to the boss arena without a config', () => {
    const { entitySpawns } = generateLevel(0, 26, 18)
    assert.equal(entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(entitySpawns.length, 21)
  })
})
