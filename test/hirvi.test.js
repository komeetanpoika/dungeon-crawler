import { describe, it, beforeEach } from 'node:test'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {
  makeHirvi, ensureHirvi, startBolt, makeStand, updateHirvi,
  BOLT_TIME, BOLT_SPEED, FLUSH_TILES,
} from '../renderer/systems/monsters/hirvi.js'
import { CREATURE_HIT, CREATURE_UPDATE, hurtCreature } from '../renderer/systems/creatures.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { tryStartEnemyAttack } from '../renderer/systems/enemy-attack.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef, isStoryCreature } from '../renderer/systems/monsters.js'

const S = 32
const N = 20

// `feedback` and `sfx` must be the real shapes: sfx() pushes into
// state.sfx.cues and queueToast into state.feedback.toasts, so a bare array
// would throw rather than record.
function makeState(elk, playerAt = { x: 4, y: 5 }) {
  const map = createMap(N, N)
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) map[y][x].tile = TILE.FLOOR
  return {
    map, entities: [elk], feedback: makeFeedback(), sfx: makeSfx(),
    player: { x: playerAt.x, y: playerAt.y, px: playerAt.x * S + 16, py: playerAt.y * S + 16, hp: 10 },
  }
}

describe('lazy init', () => {
  it('stamps the bedded mood once and never re-stamps', () => {
    const e = { type: 'hirvi', x: 5, y: 5, px: 176, py: 176 }
    ensureHirvi(e)
    assert.equal(e.mood, 'bedded')
    e.mood = 'bolting'
    ensureHirvi(e)
    assert.equal(e.mood, 'bolting')
  })
  it('registers itself in the creature tables', () => {
    assert.equal(typeof CREATURE_UPDATE.hirvi, 'function')
    assert.equal(typeof CREATURE_HIT.hirvi, 'function')
  })
})

describe('bolting', () => {
  it('starts only from bedded', () => {
    const e = makeHirvi(8, 5)
    assert.equal(startBolt(e), true)
    assert.equal(e.mood, 'bolting')
    assert.equal(startBolt(e), false)
  })
  it('runs away from the player and reports bolted when the run is over', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e, { x: 4, y: 5 })
    startBolt(e)
    const startPx = e.px
    updateHirvi(e, state, 0.1)
    assert.ok(e.px > startPx, 'moved away from the player')
    assert.equal(e.bolted, false)
    for (let t = 0; t < BOLT_TIME + 0.2; t += 0.1) updateHirvi(e, state, 0.1)
    assert.equal(e.bolted, true)
  })
  it('runs toward its bolt target when it has one, even with the player that way', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e, { x: 4, y: 5 })          // player is west
    startBolt(e, { px: 2 * S + 16, py: 5 * S + 16 })   // and so is the target
    const startPx = e.px
    updateHirvi(e, state, 0.1)
    assert.ok(e.px < startPx, 'moved toward the target, into the player, not away')
  })
  it('keeps its tile coordinates in step with its pixels', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e, { x: 4, y: 5 })
    startBolt(e)
    for (let i = 0; i < 5; i++) updateHirvi(e, state, 0.1)
    assert.equal(e.x, Math.floor(e.px / S))
    assert.equal(e.y, Math.floor(e.py / S))
  })
  it('never bolts through a wall', () => {
    const e = makeHirvi(N - 3, 5)
    const state = makeState(e, { x: N - 6, y: 5 })
    startBolt(e)
    for (let i = 0; i < 40; i++) updateHirvi(e, state, 0.1)
    assert.ok(state.map[e.y][e.x].tile === TILE.FLOOR, 'ended on a floor cell')
    assert.ok(e.x < N - 1 && e.x > 0)
  })
  it('a bolt speed fast enough to outrun a walking player', () => {
    assert.ok(BOLT_SPEED > 120)
    assert.ok(FLUSH_TILES >= 4)
  })
})

describe('damage', () => {
  it('shrugs off everything while the hunt is on', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e)
    const before = e.hp
    const r = hurtCreature(state, e, 99)
    assert.equal(r.absorbed, true)
    assert.equal(e.hp, before)
    assert.equal(state.creatureKills?.hirvi, undefined)
  })
  it('a hit on a bedded elk spooks it — absorbed, but no longer at rest', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e)
    const r = hurtCreature(state, e, 1)
    assert.equal(r.absorbed, true)
    assert.equal(e.hp, 30)
    assert.equal(e.spooked, true)
  })
  it('takes damage once it stands, and records the kill', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e)
    makeStand(e)
    const r1 = hurtCreature(state, e, 1)
    assert.equal(r1.absorbed, false)
    assert.equal(e.hp, 29)
    const r2 = hurtCreature(state, e, 99)
    assert.equal(r2.killed, true)
    assert.equal(state.creatureKills.hirvi, true)
  })
  it('goes quiet once it stands so the brain can drive it', () => {
    const e = makeHirvi(8, 5)
    const state = makeState(e, { x: 4, y: 5 })
    makeStand(e)
    assert.equal(e.brainDriven, true)
    const px = e.px
    updateHirvi(e, state, 0.5)
    assert.equal(e.px, px)
  })
})

// The elk's weapon is the def's (behavior.weapon → makeMonsterFromDef), not a
// hook's: a bedded elk is a story creature the enemy loop never swings for,
// and the stand hands it to the brain already armed. Registry-built, like
// the game does it; makeHirvi's hand-rolled shape carries no weapon.
describe('melee attack', () => {
  beforeEach(clearMonsters)
  async function registryElk() {
    const def = JSON.parse(fs.readFileSync('renderer/data/monsters/hirvi.json', 'utf8'))
    await registerMonsters([def], { warn: () => {} })
    const e = makeMonsterFromDef('hirvi', 8, 5)
    e.px = 8 * S + 16; e.py = 5 * S + 16
    return e
  }
  it('is armed from the def at spawn, and makeStand adds nothing', async () => {
    const e = await registryElk()
    assert.equal(e.weaponId, 'maul')
    makeStand(e)
    assert.equal(e.weaponId, 'maul')
  })
  it('a bedded elk is a story creature — the enemy loop never reaches its weapon', async () => {
    const e = await registryElk()
    ensureHirvi(e)
    assert.equal(isStoryCreature(e), true)
  })
  it('a standing elk lands a melee attack at contact range', async () => {
    const e = await registryElk()
    const state = makeState(e, { x: 8, y: 5 })
    makeStand(e)
    assert.equal(isStoryCreature(e), false)
    state.player.px = e.px + 10; state.player.py = e.py   // inside maul's 34px reach
    const hpBefore = state.player.hp
    assert.equal(tryStartEnemyAttack(e, state), true)
    assert.ok(e.attack, 'the attack lifecycle started')
    assert.ok(state.player.hp < hpBefore, 'the swing (windup 0) resolved immediately and hit')
  })
  it('a hand-rolled elk has no weapon of its own', () => {
    assert.equal('weaponId' in makeHirvi(8, 5), false)
  })
})
