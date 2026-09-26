// The Warrior's hold and release (spec 2a §2): renderer/pvp/hero.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune, endRune } from '../renderer/pvp/pickups.js'
import { getAttack } from '../renderer/systems/melee.js'
import { PLAYER_SPEED, PLAYER_HALF, canMoveTo } from '../renderer/systems/movement.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { TILE } from '../renderer/systems/entities.js'
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
    tickHero(m, w, input({ attack: true }), dt)      // the key is still down from the charge: needs a release first (fix round 1)
    assert.equal(w.combo, null, 'no hold on the key still held from before the swap')
    tickHero(m, w, input({ attack: false }), dt)     // let go
    tickHero(m, w, input({ attack: true }), dt)      // a fresh press
    assert.ok(w.combo, 'the sword holds again')
  })
  it('the rune picked up with the key still held needs a release: the hammer does not wind up on its own (fix round 1)', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)   // press: the sword holds
    grantRune(m, w)
    assert.equal(w.combo, null)
    tickHero(m, w, input({ attack: true }), dt)     // the key never came up across the swap
    assert.equal(w.charging, null, 'no wind-up while the key is still down from before the swap')
    tickHero(m, w, input({ attack: false }), dt)    // finally let go
    tickHero(m, w, input({ attack: true }), dt)     // a fresh press
    assert.deepEqual(w.charging, { t: 0 }, 'charges cleanly after the release')
  })
  it('the rune ending with the key still held needs a release: the sword does not hold on its own (fix round 1)', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    grantRune(m, w)
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)   // wind-up begins
    assert.deepEqual(w.charging, { t: 0 })
    endRune(m, w)
    assert.equal(w.charging, null)
    tickHero(m, w, input({ attack: true }), dt)    // the key never came up across the swap
    assert.equal(w.combo, null, 'no hold begins while the key is still down from before the swap')
    tickHero(m, w, input({ attack: false }), dt)   // finally let go
    assert.equal(a.hp, PVP.hp, 'no stray swing landed')
    tickHero(m, w, input({ attack: true }), dt)    // a fresh press
    assert.ok(w.combo, 'the sword holds again after the release')
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

// Press standing still, enter `moves`, let go, then `after` neutral ticks.
const combo = (m, h, moves, after = 12) => {
  tickHero(m, h, input({ attack: true }), dt)
  gesture(m, h, moves)
  for (let i = 0; i < after; i++) tickHero(m, h, input({}), dt)
}
const LUNGE = [E, O, E], FENCE = [E, O, W], WHIRL = [N, E, S, W]
const hits = m => m.events.filter(e => e.type === 'hit')
// A 12×12 room with a wall column at x = 5.
const walledAt5 = () => Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
  ({ tile: x === 0 || y === 0 || x === 11 || y === 11 || x === 5 ? TILE.WALL : TILE.FLOOR })))

describe('the lunge', () => {
  it('dashes 2.5 tiles toward its direction with nobody in the way, and walks no step of its own', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }); const m = testMatch([w])
    const x0 = w.px, y0 = w.py
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, LUNGE)
    for (let i = 0; i < 12; i++) tickHero(m, w, input({ move: N }), dt)   // pushing north during the dash
    assert.ok(Math.abs(w.px - x0 - 2.5 * 32) < 1e-9, `moved ${w.px - x0}`)
    assert.ok(w.py < y0, 'walks again once the dash is over')
    assert.equal(w.x, Math.floor(w.px / 32))
  })
  it('the first foe within reach ahead takes 3, and the dash ends there', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }), b = hero('b', 'archer', { x: 7, y: 5 })
    const m = testMatch([w, a, b])
    combo(m, w, LUNGE)
    assert.equal(a.hp, PVP.hp - 3)
    assert.equal(b.hp, PVP.hp)
    assert.ok(a.px - w.px <= 12 + 20 + 1e-9, 'stopped at the foe')
    assert.ok(w.px < 3 * 32 + 16 + 80, 'short of the full dash')
    assert.equal(a.lastHitBy.id, 'w')
  })
  it('stops flush against a wall', () => {
    const map = walledAt5()
    const w = hero('w', 'warrior', { x: 3, y: 5 }); const m = testMatch([w], map)
    combo(m, w, LUNGE)
    assert.equal(w.x, 4)
    assert.ok(canMoveTo(map, w.px, w.py, PLAYER_HALF))
    assert.ok(5 * 32 - (w.px + PLAYER_HALF) < 1, `gap ${5 * 32 - (w.px + PLAYER_HALF)}`)
  })
  it('flush against a wall the lunge goes nowhere, ends, and does not hang', () => {
    const map = walledAt5()
    const w = hero('w', 'warrior', { x: 4, y: 5 }); const m = testMatch([w], map)
    w.px = 5 * 32 - PLAYER_HALF                          // touching the wall
    combo(m, w, LUNGE)
    assert.equal(w.px, 5 * 32 - PLAYER_HALF)
    assert.equal(w.move, null)
  })
  it('a buckler raised toward the lunge blocks it and still ends the dash', () => {
    const w = hero('w', 'warrior', { x: 3, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    v.facing = 'west'; v.blocking = true
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, LUNGE)
    for (let i = 0; i < 12; i++) tickHero(m, w, input({}), dt)
    assert.equal(v.hp, PVP.hp)
    assert.ok(v.px - w.px < 64)
    assert.ok(w.knockback && w.knockback.vx < 0, 'the lunger is shoved back')
  })
})

describe('the fence', () => {
  it('three thrusts toward d, 1 each: all three land on one hero', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    combo(m, w, FENCE)
    assert.equal(a.hp, PVP.hp - 3)
    assert.deepEqual(hits(m).map(e => e.amount), [1, 1, 1])
    assert.equal(w.facing, 'east')
  })
  it('the thrusts come at 0, 0.12 and 0.24 s after the release', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, FENCE)                                   // the release tick: the first thrust
    const at = [hits(m).length]
    for (let i = 1; i <= 8; i++) { tickHero(m, w, input({}), dt); at.push(hits(m).length) }
    // ticks after the release: 0.12 s falls on tick 4 (0.133 s), 0.24 s on tick 8 (0.267 s)
    assert.deepEqual(at, [1, 1, 1, 1, 2, 2, 2, 2, 3])
  })
  it('reaches 40 px: a foe two tiles off is untouched', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 7, y: 5 }); const m = testMatch([w, a])
    combo(m, w, FENCE)
    assert.equal(a.hp, PVP.hp)
  })
})

describe('the whirlwind', () => {
  it('needs the full tank, hits every foe all round within 44 px for 2 and throws them 40 px away', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 })
    const e = hero('e', 'archer', { x: 6, y: 5 }), wv = hero('wv', 'archer', { x: 4, y: 5 }), n = hero('n', 'mage', { x: 5, y: 4 })
    const far = hero('far', 'archer', { x: 5, y: 7 })
    const m = testMatch([w, e, wv, n, far]); m.sfx = makeSfx()
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, WHIRL)
    for (const h of [e, wv, n]) assert.equal(h.hp, PVP.hp - 2, h.id)
    assert.equal(far.hp, PVP.hp)
    assert.ok(e.knockback.vx > 0 && wv.knockback.vx < 0 && n.knockback.vy < 0)
    assert.equal(w.stamina, 0)
    assert.ok(m.sfx.cues.some(c => c.name === 'whirl'))
  })
  it('a buckler facing the spinner blocks it, and the spinner is shoved', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of WHIRL) tickHero(m, w, input({ attack: true, move }), dt)
    v.facing = 'west'; v.blocking = true
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(v.hp, PVP.hp)
    assert.ok(w.knockback && w.knockback.vx < 0)
  })
  it('a buckler facing away does not', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), v = hero('v', 'warrior', { x: 6, y: 5 }); const m = testMatch([w, v])
    tickHero(m, w, input({ attack: true }), dt)
    for (const move of WHIRL) tickHero(m, w, input({ attack: true, move }), dt)
    v.facing = 'east'; v.blocking = true
    tickHero(m, w, input({ attack: false }), dt)
    assert.equal(v.hp, PVP.hp - 2)
  })
})

describe('combo bookkeeping', () => {
  it("a combo's hero.move names its kind and direction, and a stun ends it", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, FENCE)
    assert.equal(w.move.kind, 'fence')
    assert.equal(w.move.dir, 'e')
    w.stunTimer = 0.2
    tickHero(m, w, input({}), dt)
    assert.equal(w.move, null)
  })
  it('death clears a hold and a running combo', () => {
    const m = makeMatch({ roster: [{ id: 'w', name: 'w', cls: 'warrior' }, { id: 'a', name: 'a', cls: 'archer' }] })
    const w = m.heroes[0]
    w.combo = { moves: ['e'], last: 'e', lockDir: { x: 0, y: 0 } }
    w.move = { kind: 'fence', dir: 'e', t: 0, from: { px: w.px, py: w.py }, done: false, dist: 0, fired: 3, group: 'x' }
    w.hp = 0
    stepMatch(m, {}, PVP.tick)
    assert.equal(w.combo, null); assert.equal(w.move, null)
  })
  it('the rune picked up mid-fence stops the remaining thrusts (fix round 1)', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 }); const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true }), dt)
    gesture(m, w, FENCE)                       // release: the first thrust lands
    assert.equal(a.hp, PVP.hp - 1)
    grantRune(m, w)
    assert.equal(w.move, null)
    for (let i = 0; i < 10; i++) tickHero(m, w, input({}), dt)
    assert.equal(a.hp, PVP.hp - 1, 'no further thrusts after the rune swap')
  })
  it('the rune ending also stops a running combo (fix round 1)', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); const m = testMatch([w])
    grantRune(m, w)
    w.move = { kind: 'fence', dir: 'e', t: 0.05, from: { px: w.px, py: w.py }, done: false, dist: 0, fired: 1, group: 'x' }
    endRune(m, w)
    assert.equal(w.move, null)
  })
})
