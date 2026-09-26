// The Warrior's hold and release (spec 2a §2): renderer/pvp/hero.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { getAttack } from '../renderer/systems/melee.js'
import { PLAYER_SPEED } from '../renderer/systems/movement.js'
import { PVP, WARRIOR_COMBOS } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const N = { x: 0, y: -1 }, E = { x: 1, y: 0 }, S = { x: 0, y: 1 }, W = { x: -1, y: 0 }, O = { x: 0, y: 0 }
// Hold the attack through `moves` (one stick position a tick), then let go.
const gesture = (m, h, moves, over = {}) => {
  for (const move of moves) tickHero(m, h, input({ attack: true, move, ...over }), dt)
  tickHero(m, h, input({ attack: false }), dt)
}
const SWORD_CD = getAttack('sword').cooldown

describe('the hold', () => {
  it('a press begins a hold that records the move held at that moment as lockDir', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true, move: E, facing: 'east' }), dt)
    assert.deepEqual(w.combo, { moves: [], last: 'e', lockDir: { x: 1, y: 0 } })
  })
  it('while held the hero slides along lockDir at half speed, the stick does not steer or turn, and there is no sprint', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true, move: E, facing: 'east' }), dt)
    const x0 = w.px, y0 = w.py
    tickHero(m, w, input({ attack: true, move: N, facing: 'north', sprint: true }), dt)
    assert.ok(Math.abs(w.px - x0 - PLAYER_SPEED * WARRIOR_COMBOS.holdMoveMul * dt) < 1e-9)
    assert.equal(w.py, y0)
    assert.equal(w.facing, 'east')
    assert.equal(w.stamina, 100 - WARRIOR_COMBOS.moveCost)   // the move to N paid 25, and no sprint drain
  })
  it('standing still at the press, the hold stands still', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    const x0 = w.px
    tickHero(m, w, input({ attack: true, move: E }), dt)
    assert.equal(w.px, x0)
  })
  it('each move costs 25 stamina; a move the tank cannot pay is not recorded', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of [E, O, E]) tickHero(m, w, input({ attack: true, move }), dt)
    assert.deepEqual(w.combo.moves, ['e', 'e'])
    assert.equal(w.stamina, 50)
    w.stamina = 20
    for (const move of [O, S]) tickHero(m, w, input({ attack: true, move }), dt)
    assert.deepEqual(w.combo.moves, ['e', 'e'])
    assert.equal(w.stamina, 20)
  })
  it('a hold does not begin inside the melee cooldown', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w]); w.meleeCooldown = 0.3
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
  })
  it('a stun cancels the hold: nothing fires, the stamina stays spent, and the attack must be let go', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    w.facing = 'east'
    tickHero(m, w, input({ attack: true }), dt)
    tickHero(m, w, input({ attack: true, move: E }), dt)
    w.stunTimer = 0.1
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
    assert.equal(w.stamina, 75)
    w.stunTimer = 0
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null, 'still held since the cancel: no new hold')
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp)
    assert.equal(w.attackTimer, 0)
  })
  it('raising the shield cancels the hold', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    w.facing = 'east'
    tickHero(m, w, input({ attack: true }), dt)
    tickHero(m, w, input({ attack: true, alt: true }), dt)
    assert.equal(w.combo, null)
    assert.equal(w.blocking, true)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp)
  })
  it("the rune's hammer keeps its charge tiers: no combo", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    grantRune(m, w)
    tickHero(m, w, input({ attack: true }), dt)
    assert.equal(w.combo, null)
    assert.deepEqual(w.charging, { t: 0 })
  })
})

describe('review focus: the hold meets the rune and the diagonal', () => {
  it('the rune picked up mid-hold drops the hold; when it ends mid-wind-up the sword is back, clean', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    grantRune(m, w)
    assert.equal(w.combo, null)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp, 'no swing from the dropped hold')
    tickHero(m, w, input({ attack: true }), dt)
    assert.deepEqual(w.charging, { t: 0 })
    endRune(m, w)
    assert.equal(w.charging, null)
    tickHero(m, w, input({ attack: true }), dt)
    assert.ok(w.combo, 'the sword holds again')
  })
  it('pressed while walking diagonally: the hold slides that diagonal, and the diagonal held on is not a move', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    const NE = { x: 1, y: -1 }
    tickHero(m, w, input({ attack: true, move: NE }), dt)
    const x0 = w.px, y0 = w.py
    for (let i = 0; i < 3; i++) tickHero(m, w, input({ attack: true, move: NE }), dt)
    const step = PLAYER_SPEED * WARRIOR_COMBOS.holdMoveMul * dt * 3 / Math.SQRT2
    assert.ok(Math.abs(w.px - x0 - step) < 1e-9 && Math.abs(y0 - w.py - step) < 1e-9)
    assert.deepEqual(w.combo.moves, [])
    assert.equal(w.stamina, 100)
  })
})

describe('the release', () => {
  it('a plain swing lands on the release, not on the press', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, PVP.hp)
    assert.equal(w.attackTimer, 0)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(a.hp, PVP.hp - 2)
    assert.ok(w.attackTimer > 0)
    assert.equal(w.combo, null)
    assert.ok(Math.abs(w.meleeCooldown - SWORD_CD) < 1e-9)
  })
  it('an unknown pattern is the plain swing in the facing held; the moves stay paid', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    gesture(m, w, [N, O, E])                     // n, e: a quarter turn, not a combo
    assert.equal(w.facing, 'east')
    assert.equal(a.hp, PVP.hp - 2)
    assert.equal(w.stamina, 100 - 50 - 12)     // two moves, then the swing's own 12
  })
  it('a combo turns the hero toward its direction and starts the sword cooldown; the whirlwind 1.5 times it', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, [S, O, S])
    assert.equal(w.facing, 'south')
    assert.ok(Math.abs(w.meleeCooldown - SWORD_CD) < 1e-9)
    const v = hero('v', 'warrior', { x: 10, y: 10 }); const m2 = testMatch([v])
    tickHero(m2, v, input({ attack: true }), dt)
    gesture(m2, v, [N, E, S, W])
    assert.equal(v.facing, 'west')
    assert.equal(v.stamina, 0)
    assert.ok(Math.abs(v.meleeCooldown - SWORD_CD * 1.5) < 1e-9)
  })
  it('the release ends spawn protection', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w]); w.spawnProtect = 1
    tickHero(m, w, input({ attack: true }), dt)
    assert.ok(w.spawnProtect > 0)
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(w.spawnProtect, 0)
  })
})
