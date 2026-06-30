import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildBossTestArena, generateLevel } from '../renderer/systems/map.js'
import { TILE, WEAPON_TYPES } from '../renderer/systems/entities.js'

const W = 26, H = 18

describe('buildBossTestArena', () => {
  it('builds a walled room of the requested size', () => {
    const { map } = buildBossTestArena(W, H)
    assert.equal(map.length, H)
    assert.equal(map[0].length, W)
    assert.equal(map[0][0].tile, TILE.WALL)
    assert.equal(map[H - 1][W - 1].tile, TILE.WALL)
    assert.equal(map[1][1].tile, TILE.FLOOR)
    assert.equal(map[H - 2][W - 2].tile, TILE.FLOOR)
  })

  it('spawns exactly one dragon_boss at the center, flagged isBoss', () => {
    const { entitySpawns } = buildBossTestArena(W, H)
    const bosses = entitySpawns.filter(s => s.kind === 'dragon_boss')
    assert.equal(bosses.length, 1)
    assert.equal(bosses[0].x, Math.floor(W / 2))
    assert.equal(bosses[0].y, Math.floor(H / 2))
    assert.equal(bosses[0].isBoss, true)
  })

  it('spawns exactly 20 chests, mixing weapon and potion', () => {
    const { entitySpawns } = buildBossTestArena(W, H)
    const chests = entitySpawns.filter(s => s.kind === 'weapon' || s.kind === 'potion')
    assert.equal(chests.length, 20)
    assert.ok(chests.some(s => s.kind === 'weapon'), 'has weapon chests')
    assert.ok(chests.some(s => s.kind === 'potion'), 'has potion chests')
    for (const w of chests.filter(s => s.kind === 'weapon'))
      assert.ok(WEAPON_TYPES[w.weaponType], `valid weapon type: ${w.weaponType}`)
  })

  it('places every spawn on an in-bounds floor tile', () => {
    const { map, entitySpawns } = buildBossTestArena(W, H)
    for (const s of entitySpawns) {
      assert.ok(s.x >= 0 && s.x < W && s.y >= 0 && s.y < H, `in bounds: ${s.x},${s.y}`)
      assert.equal(map[s.y][s.x].tile, TILE.FLOOR, `floor under spawn ${s.x},${s.y}`)
    }
  })

  it('player spawns on floor, clear of the boss and all chests', () => {
    const { map, entitySpawns, playerSpawn } = buildBossTestArena(W, H)
    assert.equal(map[playerSpawn.y][playerSpawn.x].tile, TILE.FLOOR)
    const onSpawn = entitySpawns.some(s => s.x === playerSpawn.x && s.y === playerSpawn.y)
    assert.equal(onSpawn, false, 'no entity on the player spawn')
  })
})

describe('generateLevel routes depth 0 to the boss arena', () => {
  it('returns the arena (1 boss + 20 chests, no exit door)', () => {
    const { entitySpawns } = generateLevel(0, W, H)
    assert.equal(entitySpawns.filter(s => s.kind === 'dragon_boss').length, 1)
    assert.equal(entitySpawns.filter(s => s.kind === 'weapon' || s.kind === 'potion').length, 20)
    assert.equal(entitySpawns.some(s => s.kind === 'exit_door'), false)
  })
})
