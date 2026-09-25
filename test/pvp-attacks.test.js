import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { swing } from '../renderer/pvp/attacks.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { weaponContents, makeWandContents } from '../renderer/systems/entities.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const dt = PVP.tick

describe('melee', () => {
  it('a sword tap hits the foe in front for 2, knocks it back and credits the swinger', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 6, y: 5 })
    w.facing = 'east'
    const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, 8)
    assert.equal(a.lastHitBy.id, 'w')
    assert.ok(a.knockback)
    assert.ok(w.meleeCooldown > 0)
  })
  it('misses a foe behind the swinger', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }), a = hero('a', 'archer', { x: 4, y: 5 })
    const m = testMatch([w, a])
    tickHero(m, w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(a.hp, 10)
  })
  it('attacking ends spawn protection', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.spawnProtect = 1
    tickHero(testMatch([w]), w, input({ attack: true, facing: 'east' }), dt)
    assert.equal(w.spawnProtect, 0)
  })
  it('an overcharged hammer chains 4/3 over two foes and never zaps its wielder', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const a = hero('a', 'archer', { x: 6, y: 5 }), b = hero('b', 'archer', { x: 8, y: 5 })
    const m = testMatch([w, a, b])
    swing(m, w, resolveCharge('ukonvasara', 5))
    assert.equal(a.hp, 6)
    assert.equal(b.hp, 7)
    assert.equal(w.hp, 10)
    assert.equal(m.arcs.length, 2)
  })
  it('an overcharged whiff rains on the wielder and hurts nobody', () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const m = testMatch([w])
    swing(m, w, resolveCharge('ukonvasara', 5))
    assert.ok(w.rain)
    assert.equal(w.hp, 10)
  })
  it("a full hammer blow shocks the foe with the wielder's name on it", () => {
    const w = hero('w', 'warrior', { x: 5, y: 5 }); w.facing = 'east'
    w.weapon = weaponContents('ukonvasara')
    const a = hero('a', 'archer', { x: 6, y: 5 })
    swing(testMatch([w, a]), w, resolveCharge('ukonvasara', 0.6))
    assert.equal(a.shock.owner, 'w')
  })
})

describe('magic', () => {
  it('holding then releasing attack casts a spark bolt owned by the mage', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(mg.charging?.kind, 'spell')
    tickHero(m, mg, input({ attack: false }), dt)
    assert.equal(m.projectiles.length, 1)
    assert.equal(m.projectiles[0].owner, 'm')
    assert.equal(mg.charging, null)
  })
  it('a held attack auto-releases once and waits for a let-go before charging again', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    for (let i = 0; i < 90; i++) tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 1)
    assert.equal(mg.charging, null)
  })
  it('an alt press blinks the mage four tiles along its facing, once per press', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 })
    const m = testMatch([mg])
    tickHero(m, mg, input({ alt: true, facing: 'east' }), dt)
    assert.equal(mg.x, 9)
    assert.ok(mg.blinkTrail)
    tickHero(m, mg, input({ alt: true, facing: 'east' }), dt)
    assert.equal(mg.x, 9)
  })
  it('a storm wand marks lightning owned by the mage', () => {
    const mg = hero('m', 'mage', { x: 5, y: 5 }); mg.wand = makeWandContents('stormwand')
    const m = testMatch([mg])
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)
    tickHero(m, mg, input({ attack: false }), dt)
    assert.equal(m.lightning[0].owner, 'm')
  })
})

describe('ranged', () => {
  it('holding attack streams arrows on the bow cooldown, each owned by the archer', () => {
    const ar = hero('a', 'archer', { x: 5, y: 5 })
    const m = testMatch([ar])
    for (let i = 0; i < 30; i++) tickHero(m, ar, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 2)   // shortbow cooldown 0.6 s over 1 s
    assert.ok(m.projectiles.every(p => p.owner === 'a' && p.dx > 0))
    assert.equal(ar.ammo.arrow, 22)
  })
  it('no arrows, no shot', () => {
    const ar = hero('a', 'archer', { x: 5, y: 5 }); ar.ammo.arrow = 0
    const m = testMatch([ar])
    tickHero(m, ar, input({ attack: true, facing: 'east' }), dt)
    assert.equal(m.projectiles.length, 0)
  })
})
