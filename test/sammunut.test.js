import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeSammunut, updateSammunut, nearestFire, inFirelight, sammunutVisible,
  FIRELIGHT, DRIFT, TOUCH, TOUCH_TIME, DRAIN_PER_S, WANDER_REPICK,
} from '../renderer/systems/sammunut.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { strikeCreature, creatureAlpha } from '../renderer/systems/creatures.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32

function openMap(w = 30, h = 30) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makePlayer(x, y, overrides = {}) {
  return { x, y, px: x * S + 16, py: y * S + 16, stamina: 100, staminaRegenT: 0, trance: 0, ...overrides }
}

function makeState(sammunut, player, entities, map = openMap()) {
  return { player, map, entities: entities ?? [sammunut], projectiles: [], log: [], sfx: makeSfx() }
}

describe('makeSammunut', () => {
  it('has the correct initial shape', () => {
    const e = makeSammunut(5, 5)
    assert.equal(e.type, 'sammunut')
    assert.equal(e.hp, 18)
    assert.equal(e.maxHp, 18)
    assert.equal(e.x, 5)
    assert.equal(e.y, 5)
    assert.equal(e.px, 5 * S + S / 2)
    assert.equal(e.py, 5 * S + S / 2)
    assert.equal(e.target, null)
    assert.equal(e.wanderT, 0)
    assert.equal(e.touchT, 0)
    assert.equal(e.inCombat, false)
  })
})

describe('constants', () => {
  it('match the brief', () => {
    assert.equal(FIRELIGHT, 160)
    assert.equal(DRIFT, 80)
    assert.equal(TOUCH, 20)
    assert.equal(TOUCH_TIME, 0.5)
    assert.equal(DRAIN_PER_S, 12)
    assert.equal(WANDER_REPICK, 3)
  })
})

describe('fire-seeking', () => {
  it('drifts toward the only campfire at DRIFT px/s', () => {
    const e = makeSammunut(5, 5)
    const fire = makeCampfire(15, 5)
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e, fire])
    const before = Math.hypot(fire.px - e.px, fire.py - e.py)
    updateSammunut(e, state, 1)
    const after = Math.hypot(fire.px - e.px, fire.py - e.py)
    assert.ok(Math.abs((before - after) - DRIFT) < 1, `expected ~${DRIFT}px closed, got ${before - after}`)
  })

  it('removes the fire on arrival and records the campfire-out cue', () => {
    const fire = makeCampfire(5, 5)
    const e = makeSammunut(5, 5)
    e.px = fire.px + 10; e.py = fire.py   // within 16px after one drift step
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e, fire])
    updateSammunut(e, state, 1)
    assert.ok(!state.entities.some(x => x.type === 'campfire'), 'fire removed')
    assert.ok(state.sfx.cues.some(c => c.name === 'campfire-out'), 'campfire-out cue recorded')
  })

  it('an eternal fire survives arrival', () => {
    const fire = makeCampfire(5, 5, { eternal: true })
    const e = makeSammunut(5, 5)
    e.px = fire.px + 10; e.py = fire.py
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e, fire])
    updateSammunut(e, state, 1)
    assert.ok(state.entities.some(x => x.type === 'campfire'), 'eternal fire remains')
    assert.ok(!state.sfx.cues.some(c => c.name === 'campfire-out'), 'no campfire-out cue for eternal fire')
  })
})

describe('wandering with no fire', () => {
  it('moves over 1s and stays inside the map, using a fixed rng', () => {
    const e = makeSammunut(15, 15)
    e.rng = () => 0.9   // deterministic pick
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e], openMap())
    const startPx = e.px, startPy = e.py
    for (let i = 0; i < 10; i++) updateSammunut(e, state, 0.1)
    assert.ok(e.px !== startPx || e.py !== startPy, 'position changed')
    const w = state.map[0].length, h = state.map.length
    assert.ok(e.px > 0 && e.px < (w - 1) * S, `px ${e.px} inside map`)
    assert.ok(e.py > 0 && e.py < (h - 1) * S, `py ${e.py} inside map`)
  })

  it('re-picks the wander target every WANDER_REPICK seconds', () => {
    const e = makeSammunut(15, 15)
    let calls = 0
    e.rng = () => { calls++; return 0.5 }
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e], openMap())
    updateSammunut(e, state, 0.1)
    const callsAfterFirst = calls
    assert.ok(callsAfterFirst > 0, 'rng consulted for the first pick')
    updateSammunut(e, state, 0.1)   // well inside the WANDER_REPICK window
    assert.equal(calls, callsAfterFirst, 'no repick before WANDER_REPICK elapses')
    updateSammunut(e, state, WANDER_REPICK)
    assert.ok(calls > callsAfterFirst, 'rng consulted again once WANDER_REPICK seconds elapse')
  })
})

// Touch tests park the sammunut on the player's tile via a co-located eternal
// campfire, so fire-seeking pins it there deterministically instead of
// racing the wander RNG for position.
describe('touch', () => {
  it('drains stamina at 12/s and sets touchT while within TOUCH px of the player', () => {
    const player = makePlayer(5, 5)
    const fire = makeCampfire(5, 5, { eternal: true })
    const e = makeSammunut(5, 5)
    e.px = player.px + 5; e.py = player.py   // well within TOUCH=20
    const state = makeState(e, player, [e, fire])
    for (let i = 0; i < 10; i++) updateSammunut(e, state, 0.1)
    assert.ok(Math.abs(player.stamina - 88) < 0.5, `expected ~88 stamina, got ${player.stamina}`)
    assert.ok(e.touchT > 0, 'touchT set')
  })

  it('throttles the wraith-touch cue to at most a few per second', () => {
    const player = makePlayer(5, 5)
    const fire = makeCampfire(5, 5, { eternal: true })
    const e = makeSammunut(5, 5)
    e.px = player.px + 5; e.py = player.py
    const state = makeState(e, player, [e, fire])
    for (let i = 0; i < 10; i++) updateSammunut(e, state, 0.1)
    const touches = state.sfx.cues.filter(c => c.name === 'wraith-touch')
    assert.ok(touches.length <= 3, `expected <= 3 wraith-touch cues, got ${touches.length}`)
  })

  it('does not drain stamina when outside TOUCH range', () => {
    const e = makeSammunut(5, 5)
    const player = makePlayer(20, 20)
    const state = makeState(e, player, [e])
    updateSammunut(e, state, 0.1)
    assert.equal(player.stamina, 100)
    assert.equal(e.touchT, 0)
  })
})

describe('sammunutVisible', () => {
  it('is visible when within firelight', () => {
    const e = makeSammunut(5, 5)
    const fire = makeCampfire(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e, fire] }
    assert.equal(sammunutVisible(e, state), true)
  })

  it('is visible while the player is in a mushroom trance', () => {
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0, { trance: 3 }), entities: [e] }
    assert.equal(sammunutVisible(e, state), true)
  })

  it('is visible for a while after touching the player', () => {
    const e = makeSammunut(5, 5)
    e.touchT = 0.2
    const state = { player: makePlayer(0, 0), entities: [e] }
    assert.equal(sammunutVisible(e, state), true)
  })

  it('is invisible when none of the three conditions hold', () => {
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e] }
    assert.equal(sammunutVisible(e, state), false)
  })

  it('updateSammunut clears inCombat while invisible', () => {
    const e = makeSammunut(5, 5)
    e.inCombat = true
    const player = makePlayer(0, 0)
    const state = makeState(e, player, [e])
    updateSammunut(e, state, 0.1)
    assert.equal(e.inCombat, false)
  })
})

describe('nearestFire / inFirelight', () => {
  it('nearestFire returns the closest campfire, or null with none', () => {
    const e = makeSammunut(0, 0)
    const near = makeCampfire(1, 0)
    const far = makeCampfire(10, 0)
    assert.equal(nearestFire([e, far, near], e), near)
    assert.equal(nearestFire([e], e), null)
  })

  it('inFirelight is true within FIRELIGHT px of any campfire', () => {
    const fire = makeCampfire(5, 5)
    assert.equal(inFirelight([fire], fire.px + FIRELIGHT - 1, fire.py), true)
    assert.equal(inFirelight([fire], fire.px + FIRELIGHT + 20, fire.py), false)
  })
})

describe('strikeCreature — sammunut', () => {
  it('absorbs damage outside firelight (hp unchanged, cue chop)', () => {
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e] }
    const r = strikeCreature(e, state, 6)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'chop')
    assert.equal(r.entity.hp, 18)
  })

  it('damages inside firelight', () => {
    const fire = makeCampfire(5, 5)
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e, fire] }
    const r = strikeCreature(e, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.cue, 'melee-hit')
    assert.equal(r.entity.hp, 12)
    assert.equal(r.entity.inCombat, true)
  })
})

describe('CREATURE_ALPHA.sammunut', () => {
  it('is 0.85 when visible, 0 when not', () => {
    const fire = makeCampfire(5, 5)
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e, fire] }
    assert.equal(creatureAlpha(e, state), 0.85)
    const hidden = makeSammunut(20, 20)
    const state2 = { player: makePlayer(0, 0), entities: [hidden] }
    assert.equal(creatureAlpha(hidden, state2), 0)
  })
})
