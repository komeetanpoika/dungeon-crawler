import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeNakki, updateNakki, sinkNakki, feedNakki, SUBMERGE_TIME, DRAG_INTERVAL } from '../renderer/systems/nakki.js'
import { strikeCreature } from '../renderer/systems/creatures.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32

function makePlayer(overrides = {}) {
  return { x: 5, y: 5, px: 5 * S + 16, py: 5 * S + 16, hp: 10, invulnTimer: 0,
    inventory: [], maxInventory: 10, ...overrides }
}

function makeState(nakki, player) {
  return { player, map: [], entities: [nakki], log: [], sfx: makeSfx() }
}

describe('makeNakki', () => {
  it('has correct initial fields and no hp/maxHp', () => {
    const n = makeNakki(3, 4)
    assert.equal(n.type, 'nakki')
    assert.equal(n.x, 3)
    assert.equal(n.y, 4)
    assert.equal(n.state, 'surfaced')
    assert.equal(n.timer, 0)
    assert.equal(n.dragCooldown, 0)
    assert.equal(n.pierEnd, null)
    assert.equal('hp' in n, false)
    assert.equal('maxHp' in n, false)
  })
})

describe('sinkNakki', () => {
  it('submerges and resets the timer to SUBMERGE_TIME', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    assert.equal(n.state, 'submerged')
    assert.equal(n.timer, SUBMERGE_TIME)
    assert.equal(SUBMERGE_TIME, 4)
  })
})

describe('updateNakki — submerge/surface cycle', () => {
  it('resurfaces once SUBMERGE_TIME has elapsed', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer()
    const state = makeState(n, player)
    updateNakki(n, state, SUBMERGE_TIME + 0.1)
    assert.equal(n.state, 'surfaced')
  })

  it('stays submerged before SUBMERGE_TIME has elapsed', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer()
    const state = makeState(n, player)
    updateNakki(n, state, 1)
    assert.equal(n.state, 'submerged')
    assert.equal(n.timer, SUBMERGE_TIME - 1)
  })
})

describe('updateNakki — drag attack', () => {
  it('deals exactly 1 damage and resets dragCooldown to DRAG_INTERVAL when the player is on the pier end', () => {
    const n = makeNakki(5, 5)
    n.pierEnd = { x: 6, y: 5 }
    const player = makePlayer({ x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16 })
    const state = makeState(n, player)
    updateNakki(n, state, DRAG_INTERVAL)
    assert.equal(player.hp, 9)
    assert.equal(n.dragCooldown, DRAG_INTERVAL)
    assert.equal(DRAG_INTERVAL, 2)
  })

  it('records the drag sfx cue and knocks the player back away from the nakki', () => {
    const n = makeNakki(5, 5)
    n.px = 5 * S + 16; n.py = 5 * S + 16
    n.pierEnd = { x: 6, y: 5 }
    const player = makePlayer({ x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16 })
    const state = makeState(n, player)
    updateNakki(n, state, DRAG_INTERVAL)
    assert.ok(state.sfx.cues.some(c => c.name === 'drag'), 'drag cue recorded')
    assert.ok(player.knockback, 'player gets a knockback slide')
    assert.ok(player.knockback.vx > 0, 'pushed away from the nakki (eastward)')
  })

  it('does no damage when the player is off the pier end', () => {
    const n = makeNakki(5, 5)
    n.pierEnd = { x: 6, y: 5 }
    const player = makePlayer({ x: 8, y: 8, px: 8 * S + 16, py: 8 * S + 16 })
    const state = makeState(n, player)
    updateNakki(n, state, DRAG_INTERVAL)
    assert.equal(player.hp, 10)
  })

  it('does not tick dragCooldown while submerged', () => {
    const n = makeNakki(5, 5)
    n.pierEnd = { x: 6, y: 5 }
    sinkNakki(n)
    n.dragCooldown = 1
    const player = makePlayer({ x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16 })
    const state = makeState(n, player)
    updateNakki(n, state, 1)
    assert.equal(n.dragCooldown, 1)
  })
})

describe('feedNakki', () => {
  it('raw meat does not feed the nakki', () => {
    const n = makeNakki(0, 0)
    const player = makePlayer({ inventory: [{ kind: 'meat', count: 1 }] })
    const result = feedNakki(n, player)
    assert.equal(result, false)
    assert.equal(player.inventory.length, 1)
    assert.equal(n.state, 'surfaced')
  })

  it('cooked meat feeds and sinks the nakki, removing one', () => {
    const n = makeNakki(0, 0)
    const player = makePlayer({ inventory: [{ kind: 'cooked_meat', count: 1 }] })
    const result = feedNakki(n, player)
    assert.equal(result, true)
    assert.equal(player.inventory.length, 0)
    assert.equal(n.state, 'submerged')
  })

  it('does nothing while submerged', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer({ inventory: [{ kind: 'cooked_meat', count: 1 }] })
    const result = feedNakki(n, player)
    assert.equal(result, false)
    assert.equal(player.inventory.length, 1)
  })
})

describe('strikeCreature on nakki', () => {
  it('is absorbed, sinks the nakki, and never adds an hp key', () => {
    const n = makeNakki(5, 5)
    const player = makePlayer()
    const state = makeState(n, player)
    const result = strikeCreature(n, state, 5)
    assert.equal(result.absorbed, true)
    assert.equal(result.cue, 'drag')
    assert.equal(result.entity.state, 'submerged')
    assert.equal('hp' in result.entity, false)
    assert.equal('maxHp' in result.entity, false)
  })
})
