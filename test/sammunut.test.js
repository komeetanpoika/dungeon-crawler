import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeSammunut, updateSammunut, nearestFire, inFirelight, sammunutVisible,
  FIRELIGHT, DRIFT, TOUCH, TOUCH_TIME, DRAIN_PER_S, WANDER_REPICK, BURN_DPS,
} from '../renderer/systems/monsters/sammunut.js'
import { makeCampfire } from '../renderer/systems/campfire.js'
import { strikeCreature, creatureAlpha, CREATURE_HIT, CREATURE_ALPHA, hurtCreature } from '../renderer/systems/creatures.js'
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

// Two call shapes: makePlayer(x, y, overrides) and makePlayer({ x, y, ...overrides }).
function makePlayer(x = 0, y = 0, overrides = {}) {
  if (x !== null && typeof x === 'object') ({ x = 0, y = 0, ...overrides } = x)
  return { x, y, px: x * S + 16, py: y * S + 16, stamina: 100, staminaRegenT: 0, trance: 0, ...overrides }
}

// entities defaults to [sammunut, ...extra] so callers can pass just the
// extra entities (e.g. fires) without re-listing the sammunut itself.
function makeState(sammunut, player, extraEntities, map = openMap()) {
  const entities = extraEntities ?? [sammunut]
  return { player, map, entities, projectiles: [], log: [], sfx: makeSfx() }
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

  it('absorbs damage at an ordinary fire too — visible there, but vulnerable only in deadwood light', () => {
    const fire = makeCampfire(5, 5)
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e, fire] }
    const r = strikeCreature(e, state, 6)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'chop')
    assert.equal(r.entity.hp, 18)
  })

  it('damages inside deadwood firelight — a flat 1 regardless of the swing, and starts a flee', () => {
    const fire = makeCampfire(5, 5, { fuel: 'deadwood' })
    const e = makeSammunut(5, 5)
    const state = { player: makePlayer(0, 0), entities: [e, fire] }
    const r = strikeCreature(e, state, 6)
    assert.equal(r.absorbed, false)
    assert.equal(r.cue, 'melee-hit')
    assert.equal(r.entity.hp, 17)
    assert.equal(r.entity.inCombat, true)
    assert.equal(r.entity.state, 'fleeing')
  })
})

describe('CREATURE_ALPHA.sammunut', () => {
  // fadeA ramps rather than snapping now (see 'sammunut visibility fade'
  // below), so a single long update settles it fully toward its target
  // instead of asserting an instant 0.85/0. The fire is eternal so it can't
  // be snuffed mid-update, keeping "visible" stable across the long step.
  it('settles to 0.85 when visible, to 0 when not, after a long update', () => {
    const fire = makeCampfire(5, 5, { eternal: true })
    const e = makeSammunut(5, 5)
    const state = makeState(e, makePlayer(0, 0), [e, fire])
    updateSammunut(e, state, 2)
    assert.ok(Math.abs(creatureAlpha(e, state) - 0.85) < 1e-6)

    const hidden = makeSammunut(20, 20)
    const state2 = makeState(hidden, makePlayer(0, 0), [hidden])
    updateSammunut(hidden, state2, 2)
    assert.equal(creatureAlpha(hidden, state2), 0)
  })
})

const fireAt = (x, y, fuel) => makeCampfire(x, y, { fuel })

describe('sammunut and deadwood fire', () => {
  it('drifts to an ordinary fire and snuffs it, clearing shun', () => {
    const w = { ...makeSammunut(10, 10), shun: true }
    const fire = fireAt(10, 11)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    for (let i = 0; i < 60; i++) updateSammunut(w, state, 0.05)
    assert.equal(state.entities.includes(fire), false)
    assert.equal(w.shun, false)
  })
  it('cannot snuff a deadwood fire; hovers at it and burns, driving the burn channel', () => {
    const w = makeSammunut(10, 10)
    const fire = fireAt(10, 11, 'deadwood')
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.5)
    assert.equal(state.entities.includes(fire), true)
    assert.ok(w.hp < 18)
    assert.ok(Math.abs(w.hp - (18 - BURN_DPS * 0.5)) < 1e-6)
    assert.ok(Math.abs(w.burn - (1 - w.hp / 18)) < 1e-6)
  })
  it('crossing a third makes it flee and shun deadwood fires', () => {
    const w = { ...makeSammunut(10, 10), hp: 12.1 }
    const fire = fireAt(10, 11, 'deadwood')
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.1)
    assert.equal(w.state, 'fleeing')
    assert.equal(w.shun, true)
    assert.equal(w.burnStage, 1)
    const before = Math.hypot(w.px - fire.px, w.py - fire.py)
    updateSammunut(w, state, 0.5)
    assert.ok(Math.hypot(w.px - fire.px, w.py - fire.py) > before)
    // Pin the wander rng so the wraith drifts to the far map corner instead
    // of wandering back into the fire's light during the drift below.
    w.rng = () => 0.99
    for (let i = 0; i < 80; i++) updateSammunut(w, state, 0.05)
    assert.equal(w.state, 'drift')
    assert.equal(w.shun, true)          // still shunning: no ordinary fire snuffed yet
  })
  it('a shunning wraith ignores deadwood fires but not ordinary ones', () => {
    const w = { ...makeSammunut(10, 10), shun: true }
    const grey = fireAt(10, 11, 'deadwood'), plain = fireAt(20, 10)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [grey, plain])
    updateSammunut(w, state, 0.1)
    assert.equal(w.target, plain)
  })
  it('burning to 0 records the kill through hurtCreature', () => {
    const w = { ...makeSammunut(10, 10), hp: 0.1, burnStage: 2 }
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fireAt(10, 11, 'deadwood')])
    updateSammunut(w, state, 0.1)
    assert.equal(state.creatureKills.sammunut, true)
  })
})

describe('sammunut player hits', () => {
  it('outside deadwood light hits are absorbed with a dull cue and a thought', () => {
    const w = makeSammunut(10, 10)
    const state = makeState(w, makePlayer(), [fireAt(10, 11)])   // ordinary fire: visible, not vulnerable
    const r = CREATURE_HIT.sammunut(w, state, 5)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'chop')
    assert.equal(r.think, 'Your blade passes through it.')
  })
  it('inside deadwood light a hit is a flat 1 and makes it flee and shun', () => {
    const w = makeSammunut(10, 10)
    const state = makeState(w, makePlayer(), [fireAt(10, 11, 'deadwood')])
    const r = CREATURE_HIT.sammunut(w, state, 5, { source: 'player' })
    assert.equal(r.absorbed, false)
    assert.equal(r.entity.hp, 17)
    assert.equal(r.entity.state, 'fleeing')
    assert.equal(r.entity.shun, true)
  })
  it('fire damage is plain damage', () => {
    const r = CREATURE_HIT.sammunut(makeSammunut(1, 1), { entities: [] }, 0.4, { source: 'fire' })
    assert.ok(Math.abs(r.entity.hp - 17.6) < 1e-9)
    assert.equal(r.absorbed, false)
  })
})

describe('sammunut visibility fade', () => {
  it('fades in inside firelight and out beyond it instead of snapping', () => {
    const w = makeSammunut(10, 10)
    const fire = fireAt(10, 11)
    const state = makeState(w, makePlayer({ x: 1, y: 1, px: 48, py: 48 }), [fire])
    updateSammunut(w, state, 0.1)
    const a1 = CREATURE_ALPHA.sammunut(w, state)
    assert.ok(a1 > 0 && a1 < 0.85, String(a1))
    state.entities = state.entities.filter(e => e !== fire)
    w.fadeA = 1
    updateSammunut(w, state, 0.1)
    const a2 = CREATURE_ALPHA.sammunut(w, state)
    assert.ok(a2 > 0 && a2 < 0.85, String(a2))
    assert.ok(w.flicker > 0)
  })
})
