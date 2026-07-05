import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { act, getPlayerField } from '../renderer/systems/act.js'

const S = 32
function columnMap() {
  const map = createMap(12, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) map[y][x].tile = TILE.FLOOR
  map[4][6].tile = TILE.COLUMN
  return map
}
function makeState(map, playerTile, enemies = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities: enemies }
}
function enemyAt(x, y) {
  return { type: 'monster', variant: 'weak', maxHp: 2, hp: 2, x, y,
    px: x * S + S / 2, py: y * S + S / 2, ai: {}, aiHalf: 4 }
}

describe('act approach (flow field)', () => {
  it('walks an enemy around the column to the player', () => {
    const map = columnMap()
    const e = enemyAt(4, 4)
    const state = makeState(map, { x: 8, y: 4 }, [e])
    for (let i = 0; i < 600; i++) {
      act(e, state, 1 / 60, { mode: 'approach', speed: 80, stopRange: 20 })
      if (Math.hypot(e.px - state.player.px, e.py - state.player.py) <= 24) break
    }
    assert.ok(Math.hypot(e.px - state.player.px, e.py - state.player.py) <= 24,
      `enemy should reach the player, ended at (${e.px},${e.py})`)
  })

  it('stops inside stopRange', () => {
    const map = columnMap()
    const e = enemyAt(7, 2)
    const state = makeState(map, { x: 8, y: 2 }, [e])
    const moved = act(e, state, 1 / 60, { mode: 'approach', speed: 80, stopRange: 40 })
    assert.equal(moved, false)
  })
})

describe('act approach (A* target)', () => {
  it('follows a path to a fixed tile and flags unreachable targets', () => {
    const map = columnMap()
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    act(e, state, 1 / 60, { mode: 'approach', speed: 80, target: { x: 9, y: 2 } })
    assert.ok(Array.isArray(e.ai.path), 'path cached on e.ai')
  })

  it('sets e.ai.path = null when the target is sealed off (brain reads this to give up)', () => {
    const map = columnMap()
    // seal a 1-tile pocket at (9,6): wall off ALL 8 neighbours (before nav caches)
    for (const [x, y] of [[8, 5], [9, 5], [10, 5], [8, 6], [10, 6], [8, 7], [9, 7], [10, 7]]) {
      map[y][x].tile = TILE.WALL
    }
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    act(e, state, 1 / 60, { mode: 'approach', speed: 80, target: { x: 9, y: 6 } })
    assert.equal(e.ai.path, null)
  })
})

describe('act separation', () => {
  it('two stacked enemies drift apart while approaching', () => {
    const map = columnMap()
    const a = enemyAt(3, 4), b = enemyAt(3, 4)
    b.px += 1 // tiny offset so the push direction is defined
    const state = makeState(map, { x: 9, y: 4 }, [a, b])
    for (let i = 0; i < 120; i++) {
      act(a, state, 1 / 60, { mode: 'approach', speed: 60 })
      act(b, state, 1 / 60, { mode: 'approach', speed: 60 })
    }
    assert.ok(Math.hypot(a.px - b.px, a.py - b.py) > 8, 'separation pushes them apart')
  })
})

describe('act escape', () => {
  it('an enemy wedged in a wall walks back out', () => {
    const map = columnMap()
    const e = enemyAt(6, 4) // on the column tile
    const state = makeState(map, { x: 9, y: 4 }, [e])
    for (let i = 0; i < 120; i++) act(e, state, 1 / 60, { mode: 'approach', speed: 60 })
    const tile = map[e.y][e.x].tile
    assert.notEqual(tile, TILE.COLUMN, 'escaped the column tile')
  })
})

describe('getPlayerField cache', () => {
  it('reuses the field until the player changes tile', () => {
    const map = columnMap()
    const state = makeState(map, { x: 8, y: 4 })
    const f1 = getPlayerField(state, 1)
    assert.equal(getPlayerField(state, 1), f1)
    state.player.x = 7
    assert.notEqual(getPlayerField(state, 1), f1)
  })
})
