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

describe('act flee and kite', () => {
  it('flee moves away from the player; cornered flee returns false', () => {
    // dead-end corridor: floor at y=4, x=1..5
    const map = createMap(8, 8)
    for (let x = 1; x <= 5; x++) map[4][x].tile = TILE.FLOOR
    const e = enemyAt(3, 4)
    const state = makeState(map, { x: 5, y: 4 }, [e])
    const d0 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    for (let i = 0; i < 60; i++) act(e, state, 1 / 60, { mode: 'flee', speed: 80 })
    assert.ok(Math.hypot(e.px - state.player.px, e.py - state.player.py) > d0, 'moved away')
    // pin it at the closed end: no uphill neighbour left
    const cornered = enemyAt(1, 4)
    const state2 = makeState(map, { x: 5, y: 4 }, [cornered])
    assert.equal(act(cornered, state2, 1 / 60, { mode: 'flee', speed: 80 }), false)
  })

  it('kite backs off when too close and closes when too far', () => {
    const map = columnMap()
    const close = enemyAt(8, 2) // player right next door
    const state = makeState(map, { x: 9, y: 2 }, [close])
    for (let i = 0; i < 60; i++) act(close, state, 1 / 60, { mode: 'kite', band: [70, 120], speed: 80 })
    assert.ok(Math.hypot(close.px - state.player.px, close.py - state.player.py) > 40, 'backed away')

    const far = enemyAt(2, 6)
    const state2 = makeState(map, { x: 9, y: 2 }, [far])
    const d0 = Math.hypot(far.px - state2.player.px, far.py - state2.player.py)
    for (let i = 0; i < 60; i++) act(far, state2, 1 / 60, { mode: 'kite', band: [70, 120], speed: 80 })
    assert.ok(Math.hypot(far.px - state2.player.px, far.py - state2.player.py) < d0, 'closed in')
  })
})

describe('act strafe', () => {
  it('orbits without net approach when inward is 0, and flips when blocked', () => {
    const map = columnMap()
    const e = enemyAt(5, 2)
    e.ai.strafeDir = 1
    const state = makeState(map, { x: 5, y: 5 }, [e])
    const d0 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    for (let i = 0; i < 30; i++) act(e, state, 1 / 60, { mode: 'strafe', speed: 60, inward: 0 })
    const d1 = Math.hypot(e.px - state.player.px, e.py - state.player.py)
    assert.ok(Math.abs(d1 - d0) < 24, 'roughly constant orbit distance')
    // fully blocked strafe flips direction immediately: 1-wide corridor,
    // strafe dir 1 pushes due south into the corridor wall; x-component is ~0
    const corridor = createMap(8, 8)
    for (let x = 1; x <= 5; x++) corridor[4][x].tile = TILE.FLOOR
    const wallHugger = enemyAt(1, 4) // closed end: can't move west into wall
    wallHugger.ai.strafeDir = 1
    wallHugger.ai.strafeTimer = 999 // pin the periodic flip; only blocking may flip
    const s2 = makeState(corridor, { x: 5, y: 4 }, [wallHugger])
    // high speed hits the wall immediately: fully blocked, triggers flip
    act(wallHugger, s2, 1 / 60, { mode: 'strafe', speed: 960, inward: 0 })
    assert.equal(wallHugger.ai.strafeDir, -1, 'strafeDir flipped at the wall')
  })
})

describe('act approach with a wide body (clearance 2)', () => {
  it('a wide enemy closes on the player in open space but never enters a 1-tile door', () => {
    // two rooms joined by a 1-tile door at x=8 (as in the nav tests)
    const map = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) map[y][x].tile = TILE.FLOOR
    for (let y = 1; y < 10; y++) if (y !== 5) map[y][8].tile = TILE.WALL
    const wide = { type: 'cyclops', maxHp: 30, hp: 30, x: 3, y: 5, px: 3 * 32 + 16, py: 5 * 32 + 16, ai: {}, aiHalf: 28 }
    const state = makeState(map, { x: 12, y: 5 }, [wide])
    for (let i = 0; i < 300; i++) act(wide, state, 1 / 60, { mode: 'approach', speed: 40 })
    // it cannot fit through the door: it must still be in the left room
    assert.ok(wide.x < 8, `stayed in the left room (x=${wide.x})`)
    // in open space the same body closes distance
    const open = createMap(16, 11)
    for (let y = 1; y < 10; y++) for (let x = 1; x < 15; x++) open[y][x].tile = TILE.FLOOR
    const wide2 = { type: 'cyclops', maxHp: 30, hp: 30, x: 3, y: 5, px: 3 * 32 + 16, py: 5 * 32 + 16, ai: {}, aiHalf: 28 }
    const state2 = makeState(open, { x: 12, y: 5 }, [wide2])
    const e0 = Math.hypot(wide2.px - state2.player.px, wide2.py - state2.player.py)
    for (let i = 0; i < 120; i++) act(wide2, state2, 1 / 60, { mode: 'approach', speed: 40 })
    assert.ok(Math.hypot(wide2.px - state2.player.px, wide2.py - state2.player.py) < e0 - 30, 'closed distance in the open room')
  })
})

describe('act charge', () => {
  it('dashes in a straight line and reports a wall hit as false', () => {
    const map = columnMap()
    const e = enemyAt(2, 2)
    const state = makeState(map, { x: 9, y: 7 }, [e])
    assert.equal(act(e, state, 1 / 60, { mode: 'charge', angle: 0, speed: 300 }), true)
    assert.ok(e.px > 2 * 32 + 16)
    // charge due east until the wall stops it
    let blocked = false
    for (let i = 0; i < 240 && !blocked; i++) {
      blocked = !act(e, state, 1 / 60, { mode: 'charge', angle: 0, speed: 300 })
    }
    assert.ok(blocked, 'charge reported the wall')
  })
})
