import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { updateBrain, HUNT_PAUSE } from '../renderer/systems/brain.js'

const S = 32
// 14x9: floor interior with a wall spur at x=7, y=1..5 (LOS blocker to hide behind)
function spurMap() {
  const map = createMap(14, 9)
  for (let y = 1; y < 8; y++) for (let x = 1; x < 13; x++) map[y][x].tile = TILE.FLOOR
  for (let y = 1; y <= 5; y++) map[y][7].tile = TILE.WALL
  return map
}
function makeState(map, playerTile, enemies = []) {
  const player = { type: 'player', x: playerTile.x, y: playerTile.y,
    px: playerTile.x * S + S / 2, py: playerTile.y * S + S / 2, maxHp: 10, hp: 10 }
  return { map, player, entities: enemies }
}
function guardAt(x, y, hp = 4) {
  return { type: 'guard', maxHp: 4, hp, x, y, px: x * S + S / 2, py: y * S + S / 2 }
}

describe('updateBrain perception', () => {
  it('visible player within sight -> chase (approach intent)', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'approach')
    assert.equal(e.ai.mode, 'chase')
    assert.deepEqual(e.ai.lastSeen, { x: 5, y: 3 })
  })

  it('losing LOS -> hunt toward the last seen tile', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)                    // sees the player at (5,3)
    state.player.x = 10; state.player.y = 3          // teleport behind the wall spur
    state.player.px = 10 * S + S / 2; state.player.py = 3 * S + S / 2
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'hunt')
    assert.equal(intent.mode, 'approach')
    assert.deepEqual(intent.target, { x: 5, y: 3 })  // heads to where it last saw them
  })

  it('arriving at the last-seen tile with nothing there -> pause, then patrol', () => {
    const map = spurMap()
    const e = guardAt(3, 3)
    const state = makeState(map, { x: 5, y: 3 }, [e])
    updateBrain(e, state, 1 / 60)
    state.player.x = 10; state.player.px = 10 * S + S / 2   // beyond sight range AND behind the spur
    updateBrain(e, state, 1 / 60)                            // now hunting
    e.x = 5; e.y = 3; e.px = 5 * S + S / 2; e.py = 3 * S + S / 2  // teleport to last-seen
    const holding = updateBrain(e, state, 1 / 60)
    assert.equal(holding.mode, 'hold')                       // looking around
    for (let t = 0; t < HUNT_PAUSE + 0.1; t += 1 / 60) updateBrain(e, state, 1 / 60)
    assert.equal(e.ai.mode, 'patrol')
  })

  it('a badly hurt guard flees while the player is near', () => {
    const map = spurMap()
    const e = guardAt(3, 3, 1)   // 1/4 HP, guard fleeHp default 0.3
    const state = makeState(map, { x: 5, y: 3 }, [e])
    const intent = updateBrain(e, state, 1 / 60)
    assert.equal(intent.mode, 'flee')
  })

  it('kiting and strafing types get their configured combat intents', () => {
    const map = spurMap()
    const spider = { type: 'monster', variant: 'medium', maxHp: 2, hp: 2, x: 3, y: 3, px: 3 * S + S / 2, py: 3 * S + S / 2 }
    const crab = { type: 'crab', maxHp: 6, hp: 6, x: 3, y: 5, px: 3 * S + S / 2, py: 5 * S + S / 2 }
    const state = makeState(map, { x: 5, y: 3 }, [spider, crab])
    assert.equal(updateBrain(spider, state, 1 / 60).mode, 'kite')
    const crabIntent = updateBrain(crab, state, 1 / 60)
    assert.equal(crabIntent.mode, 'strafe')
    assert.equal(crabIntent.inward, 0.3)
  })
})
