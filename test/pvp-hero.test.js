import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, tickHeroStatus, NEUTRAL_INPUT, applyKit } from '../renderer/pvp/hero.js'
import { hurtHero, foesOf, isTargetable } from '../renderer/pvp/combat.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const hero = (id, cls, cell = { x: 5, y: 5 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const dt = PVP.tick

describe('makeHero / applyKit', () => {
  it('a warrior wears plate at protect 1, holds a sword and a buckler, fights as melee', () => {
    const h = makeHero({ id: 'w', name: 'W', cls: 'warrior' })
    assert.equal(h.type, 'hero')
    assert.equal(h.attackMode, 'melee')
    assert.equal(h.weapon.weaponType, 'sword')
    assert.equal(h.gear.melee.outfit.protect, 1)
    assert.equal(h.gear.melee.off.kind, 'shield')
    assert.equal(h.hp, 10)
  })
  it('an archer has a shortbow and 24 arrows; a mage a spark wand and a blink offhand', () => {
    const a = makeHero({ id: 'a', name: 'A', cls: 'archer' })
    assert.equal(a.ranged.weaponType, 'shortbow')
    assert.equal(a.ammo.arrow, 24)
    const m = makeHero({ id: 'm', name: 'M', cls: 'mage' })
    assert.equal(m.wand.weaponType, 'sparkwand')
    assert.equal(m.gear.magic.off.weaponType, 'blinkwand')
  })
  it('applyKit fully resets a hero to a new class', () => {
    const h = makeHero({ id: 'x', name: 'X', cls: 'warrior' })
    h.hp = 1; h.stunTimer = 2
    h.attackTimer = 5; h.attackDuration = 9; h.attackStyle = 'spin'; h.attackFacing = 'west'; h.prevAlt = true
    applyKit(h, 'archer')
    assert.equal(h.cls, 'archer')
    assert.equal(h.weapon, null)
    assert.equal(h.gear.melee.outfit, null)
    assert.equal(h.hp, 10)
    assert.equal(h.stunTimer, 0)
    assert.equal(h.attackTimer, 0)
    assert.equal(h.attackDuration, 0.2)
    assert.equal(h.attackStyle, 'arc')
    assert.equal(h.attackFacing, 'south')
    assert.equal(h.prevAlt, false)
  })
  it('rejects an unknown class', () => {
    assert.throws(() => makeHero({ id: 'x', name: 'X', cls: 'bard' }), /unknown class/)
  })
})

describe('tickHero movement', () => {
  it('walks at PLAYER_SPEED and faces the input facing', () => {
    const h = hero('a', 'archer'); const m = testMatch([h])
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, facing: 'east' }), dt)
    assert.ok(Math.abs(h.px - x0 - 120 * dt) < 1e-6)
    assert.equal(h.facing, 'east')
  })
  it('a stunned hero neither moves nor turns', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.stunTimer = 1
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, facing: 'north' }), dt)
    assert.equal(h.px, x0); assert.equal(h.facing, 'south')
  })
  it('a rooted hero does not move; a slowed one moves at slowMul', () => {
    const r = hero('r', 'archer'); const m = testMatch([r]); r.rootTimer = 1
    const x0 = r.px
    tickHero(m, r, input({ move: { x: 1, y: 0 } }), dt)
    assert.equal(r.px, x0)
    const s = hero('s', 'archer'); s.slowTimer = 1; s.slowMul = 0.5
    const x1 = s.px
    tickHero(testMatch([s]), s, input({ move: { x: 1, y: 0 } }), dt)
    assert.ok(Math.abs(s.px - x1 - 60 * dt) < 1e-6)
  })
  it('holding alt raises the warrior shield and halves speed', () => {
    const h = hero('w', 'warrior'); const m = testMatch([h])
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 }, alt: true }), dt)
    assert.equal(h.blocking, true)
    assert.ok(Math.abs(h.px - x0 - 60 * dt) < 1e-6)
  })
  it('a dead hero is not ticked', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.dead = true
    const x0 = h.px
    tickHero(m, h, input({ move: { x: 1, y: 0 } }), dt)
    assert.equal(h.px, x0)
  })
  it('spawn protection counts down', () => {
    const h = hero('a', 'archer'); const m = testMatch([h]); h.spawnProtect = 1
    tickHero(m, h, NEUTRAL_INPUT, 0.5)
    assert.equal(h.spawnProtect, 0.5)
  })
})

describe('tickHeroStatus', () => {
  it('counts stun, slow and root down and thaws a freeze', () => {
    const h = hero('a', 'archer'); h.stunTimer = 1; h.slowTimer = 1; h.rootTimer = 1; h.frozen = true
    tickHeroStatus(h, 1)
    assert.equal(h.stunTimer, 0); assert.ok(h.slowTimer <= 0); assert.ok(h.rootTimer <= 0); assert.equal(h.frozen, false)
  })
})

describe('combat helpers', () => {
  it('hurtHero damages, records the attacker and emits a hit event', () => {
    const a = hero('a', 'archer', { x: 4, y: 5 }), b = hero('b', 'archer'); const m = testMatch([a, b]); m.clock = 7
    assert.equal(hurtHero(m, b, 2, { by: a }), true)
    assert.equal(b.hp, 8)
    assert.deepEqual(b.lastHitBy, { id: 'a', t: 7 })
    assert.deepEqual(m.events[0], { type: 'hit', target: 'b', by: 'a', amount: 2 })
  })
  it('a hit event reports the damage that actually landed, after outfit protect', () => {
    const a = hero('a', 'archer', { x: 4, y: 5 }), w = hero('w', 'warrior'); const m = testMatch([a, w])
    assert.equal(hurtHero(m, w, 2, { by: a }), true)
    assert.equal(w.hp, 9)   // plate's protect 1 reduces the raw 2 to 1
    assert.deepEqual(m.events[0], { type: 'hit', target: 'w', by: 'a', amount: 1 })
  })
  it('never hurts the attacker itself, a dead hero or a spawn-protected one', () => {
    const a = hero('a', 'archer'); const m = testMatch([a])
    assert.equal(hurtHero(m, a, 2, { by: a }), false)
    a.spawnProtect = 1
    assert.equal(hurtHero(m, a, 2, {}), false)
    a.spawnProtect = 0; a.dead = true
    assert.equal(hurtHero(m, a, 2, {}), false)
    assert.equal(a.hp, 10)
  })
  it('a blocked melee hit shoves the attacker back', () => {
    const a = hero('a', 'archer', { x: 6, y: 5 }), w = hero('w', 'warrior'); const m = testMatch([a, w])
    w.facing = 'east'; w.blocking = true
    assert.equal(hurtHero(m, w, 2, { by: a, melee: true }), false)
    assert.ok(a.knockback && a.knockback.vx > 0)
  })
  it('foesOf skips the hero itself and untargetable heroes', () => {
    const a = hero('a', 'archer'), b = hero('b', 'archer'), c = hero('c', 'archer'); c.spawnProtect = 1
    const m = testMatch([a, b, c])
    assert.deepEqual(foesOf(m, a).map(h => h.id), ['b'])
    assert.equal(isTargetable(c), false)
  })
})
