import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePickups, tickPickups, grantRune, endRune, tickRunes } from '../renderer/pvp/pickups.js'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { PICKUPS } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const hero = (id, cls, cell = { x: 3, y: 3 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const withPickups = (heroes, list) => { const m = testMatch(heroes); m.pickups = makePickups({ pickups: list }); return m }

describe('makePickups', () => {
  it('flasks and quivers start up; the rune waits for its first spawn', () => {
    const [f, r] = makePickups({ pickups: [{ kind: 'flask', x: 1, y: 1 }, { kind: 'rune', x: 2, y: 2 }] })
    assert.equal(f.up, true)
    assert.equal(r.up, false)
    assert.equal(r.t, PICKUPS.rune.firstSpawn)
  })
})

describe('flask', () => {
  it('heals 4 (capped) and goes down for its respawn time', () => {
    const h = hero('a', 'archer'); h.hp = 8
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(h.hp, 10)
    assert.equal(m.pickups[0].up, false)
    assert.equal(m.pickups[0].t, PICKUPS.flask.respawn)
    assert.deepEqual(m.events[0], { type: 'pickup', kind: 'flask', hero: 'a' })
  })
  it('is left alone at full hp', () => {
    const h = hero('a', 'archer')
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
  })
  it('comes back after its timer and is taken by a hero standing on it', () => {
    const h = hero('a', 'archer'); h.hp = 2
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)                       // taken: 6 hp
    tickPickups(m, PICKUPS.flask.respawn)     // back up this tick
    tickPickups(m, 0.1)                       // taken again by the hero still on it
    assert.equal(h.hp, 10)
  })
})

describe('quiver', () => {
  it('only an archer takes it', () => {
    const w = hero('w', 'warrior'), a = hero('a', 'archer', { x: 4, y: 3 })
    const m = withPickups([w, a], [{ kind: 'quiver', x: 3, y: 3 }, { kind: 'quiver', x: 4, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
    assert.equal(m.pickups[1].up, false)
    assert.equal(a.ammo.arrow, 24 + PICKUPS.quiver.arrows)
  })
})

describe('rune', () => {
  it('turns each class main hand into its power weapon and back', () => {
    const w = hero('w', 'warrior'), a = hero('a', 'archer'), mg = hero('m', 'mage')
    const m = testMatch([w, a, mg])
    for (const h of [w, a, mg]) assert.equal(grantRune(m, h), true)
    assert.equal(w.weapon.weaponType, 'ukonvasara')
    assert.equal(a.ranged.weaponType, 'crossbow')
    assert.equal(a.ammo.bolt, 10)
    assert.equal(mg.wand.weaponType, 'stormwand')
    for (const h of [w, a, mg]) endRune(m, h)
    assert.equal(w.weapon.weaponType, 'sword')
    assert.equal(a.ranged.weaponType, 'shortbow')
    assert.equal(a.ammo.bolt, 0)
    assert.equal(mg.wand.weaponType, 'sparkwand')
    assert.equal(m.events.filter(e => e.type === 'runeEnd').length, 3)
  })
  it('a hero already holding the rune does not take a second', () => {
    const w = hero('w', 'warrior'); const m = testMatch([w])
    grantRune(m, w)
    assert.equal(grantRune(m, w), false)
  })
  it('ends after its duration', () => {
    const w = hero('w', 'warrior'); const m = testMatch([w])
    grantRune(m, w)
    tickRunes(m, PICKUPS.rune.duration)
    assert.equal(w.rune, null)
    assert.equal(w.weapon.weaponType, 'sword')
  })
  it('is picked up after first spawn and respawns 60 s after pickup', () => {
    const w = hero('w', 'warrior')
    const m = withPickups([w], [{ kind: 'rune', x: 3, y: 3 }])
    tickPickups(m, PICKUPS.rune.firstSpawn)   // appears
    tickPickups(m, 0.1)                       // taken
    assert.ok(w.rune)
    assert.equal(m.pickups[0].t, PICKUPS.rune.respawn)
  })
})
