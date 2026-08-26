import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildArena, buildBossTestArena, generateLevel } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

describe('buildArena — default content', () => {
  it('reproduces the original boss arena when no enemies/chests are configured', () => {
    const a = buildArena({ size: { w: 26, h: 18 } })
    const b = buildBossTestArena(26, 18)
    assert.deepEqual(a.entitySpawns, b.entitySpawns)
    assert.deepEqual(a.playerSpawn, { x: 13, y: 16 })
    assert.equal(a.entitySpawns.filter(s => s.kind === 'dragon_boss_pixel').length, 1)
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

  it('places a configured ranged chest with its weaponType intact', () => {
    const { entitySpawns } = buildArena({ enemies: [], chests: [
      { kind: 'ranged', weaponType: 'stormwand', x: 3, y: 3 },
    ] })
    const r = entitySpawns.find(s => s.kind === 'ranged')
    assert.ok(r, 'ranged chest was not skipped')
    assert.deepEqual([r.x, r.y, r.weaponType], [3, 3, 'stormwand'])
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

  it('skips explicit spawns that overlap the player or another spawn', () => {
    const warnings = []
    const { entitySpawns, playerSpawn } = buildArena({ enemies: [
      { kind: 'guard', x: 13, y: 16 },            // on the default player spawn
      { kind: 'guard', x: 5, y: 5 },
      { kind: 'crab', x: 5, y: 5 },               // on the first guard
    ] }, msg => warnings.push(msg))
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['guard', 5, 5]])
    assert.equal(warnings.length, 2)
    assert.deepEqual(playerSpawn, { x: 13, y: 16 })
  })

  it('auto chests avoid occupied ring cells and never stack', () => {
    const warnings = []
    const { entitySpawns } = buildArena({
      enemies: [{ kind: 'guard', x: 1, y: 1 }],   // occupies the ring's first cell
      chests: Array.from({ length: 5 }, () => ({ kind: 'potion' })),
    }, msg => warnings.push(msg))
    const cells = entitySpawns.filter(s => s.kind === 'potion').map(s => `${s.x},${s.y}`)
    assert.equal(new Set(cells).size, 5, 'all five chests on distinct cells')
    assert.ok(!cells.includes('1,1'), 'none on the guard')
    assert.equal(warnings.length, 0)
  })
})

describe('buildArena — columns', () => {
  it('places COLUMN tiles, keeps spawns off them, and warn-skips bad entries', () => {
    const warns = []
    const { map, entitySpawns } = buildArena({
      size: { w: 12, h: 10 },
      columns: [{ x: 5, y: 4 }, { x: 0, y: 4 }, { x: 6, y: 8 }, null],
      enemies: [{ kind: 'monster', variant: 'weak', x: 5, y: 4 }], // on the column -> skipped
      player: { x: 6, y: 8 },                                     // column there -> that column skipped
    }, w => warns.push(w))
    assert.equal(map[4][5].tile, TILE.COLUMN)
    assert.notEqual(map[8][6].tile, TILE.COLUMN, 'player spawn cell protected')
    assert.equal(entitySpawns.length, 0, 'enemy overlapping a column is skipped')
    assert.equal(warns.length, 4) // out-of-bounds column, player-spawn column, null entry, enemy overlap
  })

  it('keeps auto-placed ring chests off column cells', () => {
    const { map, entitySpawns } = buildArena({
      size: { w: 10, h: 8 },
      columns: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      chests: [{ kind: 'potion' }, { kind: 'potion' }, { kind: 'potion' }],
    }, () => {})
    for (const s of entitySpawns) {
      assert.notEqual(map[s.y][s.x].tile, TILE.COLUMN, `spawn ${s.kind} at (${s.x},${s.y}) not on a column`)
    }
  })

  it('default-content arena (no enemies/chests) clears a column at the boss centre and warns', () => {
    const warns = []
    const { w: width, h: height } = { w: 26, h: 18 }
    const cx = Math.floor(width / 2), cy = Math.floor(height / 2)
    const { map, entitySpawns } = buildArena({
      size: { w: width, h: height },
      columns: [{ x: cx, y: cy }],
    }, w => warns.push(w))
    assert.equal(map[cy][cx].tile, TILE.FLOOR, 'column at the boss centre replaced with floor')
    assert.ok(warns.some(w => w.includes('default boss spawn takes precedence')), 'warned about the removal')
    const boss = entitySpawns.find(s => s.kind === 'dragon_boss_pixel')
    assert.deepEqual([boss.x, boss.y], [cx, cy], 'boss spawn present at the centre')
  })
})

describe('buildArena — enemy hp override', () => {
  it('passes an enemy hp override through to the spawn', () => {
    const { entitySpawns } = buildArena({ enemies: [{ kind: 'guard', x: 5, y: 5, hp: 1 }] }, () => {})
    assert.equal(entitySpawns[0].hp, 1)
  })
})

describe('generateLevel — arena option', () => {
  it('routes a depth-0 arena config through buildArena', () => {
    const { entitySpawns } = generateLevel(0, 26, 18, { arena: { enemies: [{ kind: 'cyclops', x: 10, y: 9 }] } })
    assert.deepEqual(entitySpawns.map(s => [s.kind, s.x, s.y]), [['cyclops', 10, 9]])
  })

  it('defaults to the boss arena without a config', () => {
    const { entitySpawns } = generateLevel(0, 26, 18)
    assert.equal(entitySpawns.filter(s => s.kind === 'dragon_boss_pixel').length, 1)
    assert.equal(entitySpawns.length, 21)
  })
})
