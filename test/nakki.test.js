import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ensureNakki, makeNakki, updateNakki, sinkNakki, feedNakki, SINK_TIME, SUBMERGE_TIME, DRAG_INTERVAL } from '../renderer/systems/monsters/nakki.js'
import { strikeCreature, CREATURE_ALPHA } from '../renderer/systems/creatures.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeItem } from '../renderer/systems/inventory.js'

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

// makeMonsterFromDef stamps hp/maxHp on every registry monster; the Näkki
// must carry neither, so the first ensure strips them.
describe('ensureNakki', () => {
  it('strips the registry hp/maxHp, stamps the surfaced state, and is idempotent', () => {
    const e = ensureNakki({ type: 'nakki', x: 1, y: 1, px: 48, py: 48, hp: 1, maxHp: 1 })
    assert.equal('hp' in e, false)
    assert.equal('maxHp' in e, false)
    assert.equal(e.state, 'surfaced')
    assert.equal(e.lurk, true)

    e.state = 'submerged'
    ensureNakki(e)
    assert.equal(e.lurk, true)
    assert.equal(e.state, 'submerged', 'a second ensure must not reset live state')
    assert.equal('hp' in e, false)
  })
})

describe('sinkNakki', () => {
  it('starts sinking and resets the timer to SINK_TIME', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    assert.equal(n.state, 'sinking')
    assert.equal(n.timer, SINK_TIME)
    assert.equal(SINK_TIME, 0.6)
  })

  it('is a no-op while already sinking or submerged', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    n.timer = 0.2
    sinkNakki(n)
    assert.equal(n.timer, 0.2, 'already sinking: timer left alone')
    n.state = 'submerged'; n.timer = SUBMERGE_TIME - 1
    sinkNakki(n)
    assert.equal(n.state, 'submerged')
    assert.equal(n.timer, SUBMERGE_TIME - 1, 'already submerged: timer left alone')
  })
})

describe('updateNakki — full submerge/surface cycle', () => {
  it('resurfaces once sinking, submerged and rising have all elapsed', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer()
    const state = makeState(n, player)
    updateNakki(n, state, SINK_TIME + 0.1)
    assert.equal(n.state, 'submerged')
    updateNakki(n, state, SUBMERGE_TIME + 0.1)
    assert.equal(n.state, 'rising')
    updateNakki(n, state, SINK_TIME + 0.1)
    assert.equal(n.state, 'surfaced')
  })

  it('stays submerged before SUBMERGE_TIME has elapsed', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer()
    const state = makeState(n, player)
    updateNakki(n, state, SINK_TIME + 0.1)
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
    const player = makePlayer({ x: 6, y: 5, px: 6 * S + 16, py: 5 * S + 16 })
    const state = makeState(n, player)
    sinkNakki(n)
    updateNakki(n, state, SINK_TIME + 0.1) // now submerged
    n.dragCooldown = 1
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

  it('cooked meat feeds and starts sinking the nakki, removing one', () => {
    const n = makeNakki(0, 0)
    const player = makePlayer({ inventory: [{ kind: 'cooked_meat', count: 1 }] })
    const result = feedNakki(n, player)
    assert.equal(result, true)
    assert.equal(player.inventory.length, 0)
    assert.equal(n.state, 'sinking')
  })

  it('does nothing while sinking or submerged', () => {
    const n = makeNakki(0, 0)
    sinkNakki(n)
    const player = makePlayer({ inventory: [{ kind: 'cooked_meat', count: 1 }] })
    assert.equal(feedNakki(n, player), false)
    assert.equal(player.inventory.length, 1)

    n.state = 'submerged'
    assert.equal(feedNakki(n, player), false)
    assert.equal(player.inventory.length, 1)
  })
})

describe('nakki sink cycle', () => {
  it('a hit starts sinking with the sink channel rising, then submerges, rises and surfaces', () => {
    const n = makeNakki(3, 4)
    const state = makeState(n, makePlayer())
    const r = strikeCreature(n, state, 5)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'sink')
    assert.equal(r.entity.state, 'sinking')
    Object.assign(n, r.entity)
    updateNakki(n, state, SINK_TIME / 2)
    assert.ok(Math.abs(n.sink - 0.5) < 1e-6)
    updateNakki(n, state, SINK_TIME / 2 + 0.001)
    assert.equal(n.state, 'submerged')
    assert.equal(CREATURE_ALPHA.nakki(n, state), 0)
    updateNakki(n, state, SUBMERGE_TIME + 0.001)
    assert.equal(n.state, 'rising')
    updateNakki(n, state, SINK_TIME / 2)
    assert.ok(n.sink > 0 && n.sink < 1)
    updateNakki(n, state, SINK_TIME / 2 + 0.001)
    assert.equal(n.state, 'surfaced')
    assert.equal(n.sink, 0)
  })
  it('a leaving nakki removes itself from state.entities when the sink completes', () => {
    const n = makeNakki(3, 4)
    const state = makeState(n, makePlayer())
    sinkNakki(n); n.leaving = true
    updateNakki(n, state, SINK_TIME + 0.001)
    assert.equal(state.entities.includes(n), false)
  })
  it('feeding only works surfaced and starts a sink', () => {
    const n = makeNakki(3, 4)
    const p = makePlayer({ inventory: [makeItem('cooked_meat', 1)] })
    assert.equal(feedNakki(n, p), true)
    assert.equal(n.state, 'sinking')
    assert.equal(feedNakki(n, p), false)
  })
})
