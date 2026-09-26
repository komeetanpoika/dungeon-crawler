// The Archer's double shot (spec 2a §3).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { PLAYER_SPEED } from '../renderer/systems/movement.js'
import { PVP, DOUBLE_SHOT } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
// Hold Q for `ticks` ticks after the one that starts the draw, then let go.
const draw = (m, h, ticks, over = {}) => {
  for (let i = 0; i <= ticks; i++) tickHero(m, h, input({ alt: true, facing: 'east', ...over }), dt)
  tickHero(m, h, input({ facing: 'east' }), dt)
}
const archer = () => { const a = hero('a', 'archer', { x: 3, y: 5 }); return { a, m: testMatch([a]) } }

describe('the draw', () => {
  it('holding Q draws (kind double) with the ranged cooldown ready, at 0.6 speed, steering normally', () => {
    const { a, m } = archer()
    tickHero(m, a, input({ alt: true }), dt)
    assert.deepEqual(a.charging, { t: 0, kind: 'double' })
    const x0 = a.px, y0 = a.py
    tickHero(m, a, input({ alt: true, move: { x: 0, y: 1 }, facing: 'south' }), dt)
    assert.ok(Math.abs(a.py - y0 - PLAYER_SPEED * DOUBLE_SHOT.moveMul * dt) < 1e-9)
    assert.equal(a.px, x0)
    assert.equal(a.facing, 'south')
  })
  it('does not start inside the ranged cooldown or with no arrows', () => {
    const { a, m } = archer(); a.rangedCooldown = 0.3
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
    const b = hero('b', 'archer', { x: 3, y: 7 }); b.ammo.arrow = 0
    tickHero(testMatch([b]), b, input({ alt: true }), dt)
    assert.equal(b.charging, null)
  })
  it('the draw stops at 1.2 s: no auto-release', () => {
    const { a, m } = archer()
    for (let i = 0; i < 90; i++) tickHero(m, a, input({ alt: true }), dt)
    assert.deepEqual(a.charging, { t: DOUBLE_SHOT.full, kind: 'double' })
    assert.equal(m.projectiles.length, 0)
  })
  it('the attack does nothing during the draw', () => {
    const { a, m } = archer()
    tickHero(m, a, input({ alt: true }), dt)
    for (let i = 0; i < 20; i++) tickHero(m, a, input({ alt: true, attack: true }), dt)
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
  })
  it('a stun mid-draw drops the draw: nothing fires, nothing is spent', () => {
    const { a, m } = archer()
    for (let i = 0; i < 30; i++) tickHero(m, a, input({ alt: true }), dt)
    a.stunTimer = 0.2
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
    a.stunTimer = 0
    tickHero(m, a, input({}), dt)
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
  })
  it("Q does nothing while the rune's crossbow is held", () => {
    const { a, m } = archer()
    grantRune(m, a)
    tickHero(m, a, input({ alt: true }), dt)
    assert.equal(a.charging, null)
  })
})

describe('the release', () => {
  it('below 30 % nothing fires and nothing is spent', () => {
    const { a, m } = archer()
    draw(m, a, 10)                                         // 10 ticks: 0.33 s = 28 %
    assert.equal(m.projectiles.length, 0)
    assert.equal(a.ammo.arrow, 24)
    assert.equal(a.rangedCooldown, 0)
    assert.equal(a.charging, null)
  })
  it('each band: two parallel arrows 12 px apart, each dealing the band damage', () => {
    // ticks held → draw fraction: 11 → 0.31, 13 → 0.36 (1); 15 → 0.42 (2); 20 → 0.56 (3); 26 → 0.72 (4); 36 → 1 (5)
    for (const [ticks, damage] of [[11, 1], [13, 1], [15, 2], [20, 3], [26, 4], [36, 5], [60, 5]]) {
      const { a, m } = archer()
      draw(m, a, ticks)
      assert.equal(m.projectiles.length, 2, `${ticks}`)
      const [p, q] = m.projectiles
      assert.deepEqual([p.damage, q.damage], [damage, damage], `${ticks} ticks`)
      assert.ok(p.dx > 0 && q.dx > 0 && p.dy === 0 && q.dy === 0)
      assert.equal(Math.abs(p.py - q.py), DOUBLE_SHOT.gap)
      assert.equal((p.py + q.py) / 2, a.py)
      assert.equal(p.owner, 'a')
      assert.ok(p.trail && p.color === q.color)
      assert.equal(a.ammo.arrow, 22)
      assert.equal(a.rangedCooldown, DOUBLE_SHOT.cooldown)
    }
  })
  it('with one arrow left it fires one, from the centre', () => {
    const { a, m } = archer(); a.ammo.arrow = 1
    draw(m, a, 36)
    assert.equal(m.projectiles.length, 1)
    assert.equal(m.projectiles[0].py, a.py)
    assert.equal(a.ammo.arrow, 0)
  })
})

describe('in a match', () => {
  const duel = () => {
    const m = makeMatch({ roster: [{ id: 'a', name: 'a', cls: 'archer' }, { id: 'v', name: 'v', cls: 'warrior' }] })
    const [a, v] = m.heroes
    placeHero(a, { x: 3, y: 8 }); placeHero(v, { x: 9, y: 8 })
    a.spawnProtect = 0; v.spawnProtect = 0
    return { m, a, v }
  }
  const play = (m, inputs, ticks) => { for (let i = 0; i < ticks; i++) stepMatch(m, inputs(i), PVP.tick) }
  it('both arrows hit one hero: a full draw deals 10 and kills from full hp', () => {
    const { m, a, v } = duel()
    play(m, i => ({ a: input({ alt: i <= 36, facing: 'east' }) }), 80)
    assert.equal(v.deaths, 1)
    assert.equal(a.kills, 1)
  })
  it('a buckler raised toward the shot blocks both arrows', () => {
    const { m, v } = duel()
    play(m, i => ({ a: input({ alt: i <= 36, facing: 'east' }), v: input({ alt: true, facing: 'west' }) }), 80)
    assert.equal(v.hp, PVP.hp)
  })
})
