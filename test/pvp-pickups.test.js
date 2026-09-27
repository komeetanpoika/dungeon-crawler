import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makePickups, tickPickups, grantRune, endRune, tickRunes } from '../renderer/pvp/pickups.js'
import { makeHero, placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { gearOf } from '../renderer/systems/inventory.js'
import { PICKUPS, PVP, BUFF_SPOTS, BUFF_KINDS } from '../renderer/data/pvp.js'
import { mulberry32 } from '../renderer/pvp/rng.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { testMatch } from './pvp-helpers.js'

const hero = (id, cls, cell = { x: 3, y: 3 }) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
const withPickups = (heroes, list) => { const m = testMatch(heroes); m.pickups = makePickups({ pickups: list }); return m }
const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })

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
    const h = hero('a', 'archer'); h.hp = 6
    const m = withPickups([h], [{ kind: 'flask', x: 3, y: 3 }])
    tickPickups(m, 0.1)
    assert.equal(h.hp, 8)
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
    assert.equal(h.hp, 8)
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
    assert.equal(mg.wand.weaponType, 'firewand')
    for (const h of [w, a, mg]) endRune(m, h)
    assert.equal(w.weapon.weaponType, 'sword')
    assert.equal(a.ranged.weaponType, 'shortbow')
    assert.equal(a.ammo.bolt, 0)
    assert.equal(mg.wand.weaponType, 'stormwand')
    assert.equal(m.events.filter(e => e.type === 'runeEnd').length, 3)
  })
  it('parks the warrior melee offhand for the rune and restores it after', () => {
    const w = hero('w', 'warrior'); const m = testMatch([w])
    const buckler = gearOf(w, 'melee').off
    assert.ok(buckler)
    grantRune(m, w)
    assert.equal(gearOf(w, 'melee').off, null)
    endRune(m, w)
    assert.equal(gearOf(w, 'melee').off, buckler)
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
  it("the archer's double-shot draw is alt-driven (attack never held): the rune drops it without demanding a release before the crossbow fires (fix round 1)", () => {
    const a = hero('a', 'archer'); const m = testMatch([a])
    for (let i = 0; i < 20; i++) tickHero(m, a, input({ alt: true, facing: 'east' }), PVP.tick)
    assert.equal(a.charging.kind, 'double')
    grantRune(m, a)
    assert.equal(a.charging, null)
    assert.equal(a.needRelease, false, 'attack was never held for this draw — no release should be demanded')
    tickHero(m, a, input({ attack: true, facing: 'east' }), PVP.tick)   // a fresh press: fires at once
    assert.equal(m.projectiles.length, 1)
    assert.equal(a.ammo.bolt, 9)
  })
  it("endRune's same guard: a double-shot charging state (unit case — the crossbow itself can never start one) does not demand a release either (fix round 1)", () => {
    const a = hero('a', 'archer'); const m = testMatch([a])
    grantRune(m, a)
    a.charging = { t: 0, kind: 'double' }
    endRune(m, a)
    assert.equal(a.charging, null)
    assert.equal(a.needRelease, false)
  })
})

describe('buff spots (2b)', () => {
  const spots = [{ kind: 'buff', tier: 'minor', x: 3, y: 3 }, { kind: 'buff', tier: 'major', x: 8, y: 8 }]
  const spotMatch = (heroes, rngSeed = 5) => { const m = testMatch(heroes); m.rng = mulberry32(rngSeed); m.pickups = makePickups({ pickups: spots }, m.rng); return m }
  it('a minor spot starts up with a rolled buff; a major waits majorFirstSpawn with its roll as the ghost', () => {
    const [b, B] = makePickups({ pickups: spots }, mulberry32(5))
    assert.equal(b.kind, 'buff'); assert.equal(b.tier, 'minor')
    assert.equal(b.up, true); assert.equal(b.t, 0); assert.equal(b.next, null)
    assert.ok(BUFF_KINDS.includes(b.buff))
    assert.equal(B.up, false); assert.equal(B.t, BUFF_SPOTS.majorFirstSpawn); assert.equal(B.buff, null)
    assert.ok(BUFF_KINDS.includes(B.next))
    assert.deepEqual(makePickups({ pickups: spots }, mulberry32(5)), [b, B], 'the same seed rolls the same')
  })
  it('walking onto an up spot takes it: the buff, the event, the cue and a float of its colour', () => {
    const h = hero('a', 'warrior')
    const m = spotMatch([h])
    m.sfx = makeSfx(false)
    const kind = m.pickups[0].buff
    tickPickups(m, 0.1)
    assert.equal(h.buffs[kind === 'ember' || kind === 'venom' ? 'edge' : kind].tier, 'minor')
    assert.deepEqual(m.events, [{ type: 'pickup', kind: 'buff', hero: 'a', buff: kind, tier: 'minor' }])
    assert.deepEqual(m.sfx.cues.map(c => c.name), ['pickup'])
    assert.deepEqual(m.feedback.floats.map(f => [f.text, f.kind]), [['+', kind]])
  })
  it('a taken spot goes down for its respawn with the next roll showing, then comes back with that buff', () => {
    const h = hero('a', 'mage')
    const m = spotMatch([h])
    tickPickups(m, 0.1)
    const b = m.pickups[0]
    assert.equal(b.up, false); assert.equal(b.t, BUFF_SPOTS.minorRespawn); assert.equal(b.buff, null)
    const ghost = b.next
    assert.ok(BUFF_KINDS.includes(ghost))
    placeHero(h, { x: 12, y: 12 })
    tickPickups(m, BUFF_SPOTS.minorRespawn - 0.5)
    assert.equal(b.up, false)
    tickPickups(m, 0.5)
    assert.equal(b.up, true); assert.equal(b.buff, ghost); assert.equal(b.next, null)
  })
  it('the major spot comes up at majorFirstSpawn and, taken, stays down majorRespawn', () => {
    const h = hero('a', 'archer', { x: 8, y: 8 })
    const m = spotMatch([h])
    tickPickups(m, BUFF_SPOTS.majorFirstSpawn - 0.1)
    assert.equal(m.pickups[1].up, false)
    assert.equal(h.buffs.haste ?? h.buffs.might ?? h.buffs.ward ?? h.buffs.edge, null)
    tickPickups(m, 0.2)                        // up this tick
    tickPickups(m, PVP.tick)                   // taken by the hero standing on it
    assert.equal(m.pickups[1].up, false)
    assert.equal(m.pickups[1].t, BUFF_SPOTS.majorRespawn)
    assert.equal(m.events.at(-1).tier, 'major')
  })
  it('two heroes on one spot in one tick: only the first takes it, and there is one event', () => {
    const a = hero('a', 'warrior'), b = hero('b', 'mage')
    const m = spotMatch([a, b])
    const kind = m.pickups[0].buff
    tickPickups(m, 0.1)
    const holds = h => Object.values(h.buffs).some(Boolean)
    assert.equal(holds(a), true); assert.equal(holds(b), false)
    assert.deepEqual(m.events.map(e => e.hero), ['a'])
    assert.equal(m.events[0].buff, kind)
  })
  it('any class takes any buff; a dead hero takes nothing', () => {
    for (const cls of ['warrior', 'archer', 'mage']) {
      const m = spotMatch([hero('a', cls)])
      tickPickups(m, 0.1)
      assert.equal(m.pickups[0].up, false, cls)
    }
    const d = hero('d', 'warrior'); d.dead = true
    const m = spotMatch([d])
    tickPickups(m, 0.1)
    assert.equal(m.pickups[0].up, true)
  })
  it("every roll comes from match.rng: one seed replays one sequence, and all five kinds come up", () => {
    const run = seed => {
      const h = hero('a', 'warrior')
      const m = spotMatch([h], seed)
      const got = []
      for (let i = 0; i < 60; i++) { got.push(m.pickups[0].buff); tickPickups(m, 0.1); tickPickups(m, BUFF_SPOTS.minorRespawn) }
      return got
    }
    assert.deepEqual(run(11), run(11))
    assert.notDeepEqual(run(11), run(12))
    assert.deepEqual(new Set(run(11)).size, 5)
  })
})
