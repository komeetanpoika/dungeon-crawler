import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch, setClass, standings, farthestSpawn } from '../renderer/pvp/sim.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { PVP } from '../renderer/data/pvp.js'
import { makeWandContents } from '../renderer/systems/entities.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `h${i}`, name: `H${i}`, cls: c }))
const byId = (m, id) => m.heroes.find(h => h.id === id)
const run = (m, secs, inputs = {}) => { const ev = []; for (let t = 0; t < secs - 1e-9; t += PVP.tick) ev.push(...stepMatch(m, inputs, PVP.tick)); return ev }

describe('makeMatch', () => {
  it('places each hero on its own spawn with a full kit', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer', 'mage') })
    assert.equal(m.heroes.length, 3)
    const cells = new Set(m.heroes.map(h => `${h.x},${h.y}`))
    assert.equal(cells.size, 3)
    assert.equal(m.entities.length, 3)
  })
  it('rejects an empty roster, more than six heroes and duplicate ids', () => {
    assert.throws(() => makeMatch({ roster: [] }))
    assert.throws(() => makeMatch({ roster: roster(...Array(7).fill('mage')) }))
    assert.throws(() => makeMatch({ roster: [{ id: 'a', name: 'a', cls: 'mage' }, { id: 'a', name: 'b', cls: 'mage' }] }))
  })
})

describe('stepMatch timing', () => {
  it('dt 0.1 runs exactly three ticks', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    stepMatch(m, {}, 0.1)
    assert.ok(Math.abs(m.clock - 0.1) < 1e-9)
  })
  it('a 5 s hitch runs at most 8 ticks', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    stepMatch(m, {}, 5)
    assert.ok(m.clock <= 8 * PVP.tick + 1e-9)
  })
  it('ends at the match length with a matchEnd event, then stops', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    byId(m, 'h0').kills = 2
    const ev = run(m, PVP.matchLength + 1)
    const end = ev.find(e => e.type === 'matchEnd')
    assert.ok(end)
    assert.equal(end.standings[0].id, 'h0')
    assert.equal(m.ended, true)
    assert.deepEqual(stepMatch(m, {}, 1), [])
  })
})

describe('death, credit and respawn', () => {
  const duel = () => {
    const m = makeMatch({ roster: roster('archer', 'archer') })
    const a = byId(m, 'h0'), b = byId(m, 'h1')
    placeHero(a, { x: 2, y: 2 }); placeHero(b, { x: 5, y: 2 })
    return { m, a, b }
  }
  it("an arrow kill credits the archer and counts the victim's death", () => {
    const { m, a, b } = duel()
    b.hp = 2
    const ev = run(m, 1, { h0: { move: { x: 0, y: 0 }, facing: 'east', attack: true, alt: false, sprint: false } })
    const kill = ev.find(e => e.type === 'kill')
    assert.deepEqual(kill, { type: 'kill', victim: 'h1', killer: 'h0' })
    assert.equal(a.kills, 1); assert.equal(b.deaths, 1); assert.equal(b.dead, true)
  })
  it('a dead owner arrow still credits the owner', () => {
    const { m, a, b } = duel()
    b.hp = 2
    m.projectiles.push({ px: a.px + 20, py: a.py, dx: 280, dy: 0, damage: 2, friendly: true, owner: 'h0' })
    a.hp = 0                                   // the archer dies this tick (a -1 self-kill)
    const ev = run(m, 1)
    assert.ok(ev.some(e => e.type === 'kill' && e.victim === 'h1' && e.killer === 'h0'))
    assert.equal(a.kills, 0)                   // -1 for dying uncredited, +1 for the arrow
  })
  it('a death with no recent attacker costs the victim a kill', () => {
    const { m, b } = duel()
    b.hp = 0
    run(m, PVP.tick)
    assert.equal(b.kills, -1)
  })
  it('credit expires after the credit window', () => {
    const { m, a, b } = duel()
    b.lastHitBy = { id: 'h0', t: 0 }
    m.clock = PVP.creditWindow + 1
    b.hp = 0
    run(m, PVP.tick)
    assert.equal(a.kills, 0)
    assert.equal(b.kills, -1)
  })
  it('simultaneous kills both count', () => {
    const { m, a, b } = duel()
    a.hp = 0; a.lastHitBy = { id: 'h1', t: 0 }
    b.hp = 0; b.lastHitBy = { id: 'h0', t: 0 }
    run(m, PVP.tick)
    assert.equal(a.kills, 1); assert.equal(b.kills, 1)
    assert.equal(a.dead && b.dead, true)
  })
  it('respawns after the delay at the spawn farthest from the living, protected, with a fresh kit', () => {
    const { m, a, b } = duel()
    b.hp = 0; b.ammo.arrow = 0
    const ev = run(m, PVP.respawnDelay + 0.1)
    assert.ok(ev.some(e => e.type === 'respawn' && e.hero === 'h1'))
    assert.equal(b.dead, false)
    assert.equal(b.hp, 10)
    assert.equal(b.ammo.arrow, 24)
    assert.ok(b.spawnProtect > 0)
    assert.ok(Math.hypot(b.px - a.px, b.py - a.py) > 20 * 32)   // across the arena from h0 at (2,2)
  })
  it('a spawn-protected hero cannot be hit', () => {
    const { m, b } = duel()
    b.spawnProtect = 1
    run(m, 0.5, { h0: { move: { x: 0, y: 0 }, facing: 'east', attack: true, alt: false, sprint: false } })
    assert.equal(b.hp, 10)
  })
  it('death ends the rune and clears the charge', () => {
    const { m, a } = duel()
    a.cls = 'mage'
    a.rune = { t: 10, saved: { weapon: null, ranged: a.ranged, wand: makeWandContents('sparkwand') } }
    a.charging = { t: 0.5, kind: 'spell' }
    a.hp = 0
    const ev = run(m, PVP.tick)
    assert.equal(a.rune, null)
    assert.equal(a.charging, null)
    assert.ok(ev.some(e => e.type === 'runeEnd'))
  })
  it('a same-tick lightning hit on an already-lethally-hit hero does not steal kill credit', () => {
    const m = makeMatch({ roster: roster('archer', 'archer', 'mage') })
    const a = byId(m, 'h0'), b = byId(m, 'h1'), c = byId(m, 'h2')
    placeHero(b, { x: 5, y: 5 })
    // A's arrow lands on B and kills it outright this tick...
    m.projectiles.push({ px: b.px - 5, py: b.py, dx: 280, dy: 0, damage: 100, friendly: true, owner: 'h0' })
    // ...and C's lightning mark, primed to strike the same tick, also lands
    // on B's tile — B is still in the stale pre-tick entity list even
    // though it is already at (or below) 0 hp by the time the sky answers.
    m.lightning.push({ x: b.x, y: b.y, t: 0, delay: 0, struck: false, owner: 'h2' })
    const ev = run(m, PVP.tick)
    const kill = ev.find(e => e.type === 'kill')
    assert.equal(kill.victim, 'h1')
    assert.equal(kill.killer, 'h0')
    assert.equal(a.kills, 1)
    assert.equal(c.kills, 0)
  })
  it('resolveDeaths clamps a dying hero at 0 hp, never negative', () => {
    const { m, b } = duel()
    b.hp = -7
    run(m, PVP.tick)
    assert.equal(b.hp, 0)
  })
  it('a respawn while attack is held forces a release before it counts, keeping spawn protection', () => {
    const { m, b } = duel()
    b.hp = 0
    const held = { h1: { move: { x: 0, y: 0 }, facing: 'east', attack: true, alt: false, sprint: false } }
    const ev = run(m, PVP.respawnDelay + 0.1, held)
    assert.ok(ev.some(e => e.type === 'respawn' && e.hero === 'h1'))
    assert.equal(b.dead, false)
    assert.ok(b.spawnProtect > 0, `spawnProtect ${b.spawnProtect}`)
  })
  it('setClass applies at the next respawn only', () => {
    const { m, b } = duel()
    setClass(m, 'h1', 'warrior')
    assert.equal(b.cls, 'archer')
    b.hp = 0
    run(m, PVP.respawnDelay + 0.1)
    assert.equal(b.cls, 'warrior')
    assert.equal(b.weapon.weaponType, 'sword')
    assert.throws(() => setClass(m, 'h1', 'bard'))
  })
})

describe('crowd control is halved', () => {
  it('a lightning stun on a hero lasts half as long', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    const mg = byId(m, 'h0'), ar = byId(m, 'h1')
    placeHero(mg, { x: 2, y: 2 }); placeHero(ar, { x: 5, y: 2 })
    m.lightning.push({ x: 5, y: 2, t: 0, delay: 0.01, struck: false, owner: 'h0' })
    run(m, PVP.tick)
    assert.ok(ar.stunTimer > 0.4 && ar.stunTimer <= 0.5, `stun ${ar.stunTimer}`)
  })
  it('a lightning stun refreshing a running stun lands at max(new*ccMul, remainder), not a partial increase', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    const mg = byId(m, 'h0'), ar = byId(m, 'h1')
    placeHero(mg, { x: 2, y: 2 }); placeHero(ar, { x: 5, y: 2 })
    ar.stunTimer = 0.4 + PVP.tick   // decays to exactly 0.4 before the strike lands this tick
    m.lightning.push({ x: 5, y: 2, t: 0, delay: 0.01, struck: false, owner: 'h0' })
    run(m, PVP.tick)
    assert.ok(Math.abs(ar.stunTimer - 0.5) < 1e-9, `stun ${ar.stunTimer}`)
  })
})

describe('a blocked hit applies no onHit', () => {
  it('a shield-blocked crossbow bolt does zero damage and no knockback', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const w = byId(m, 'h0'), a = byId(m, 'h1')
    placeHero(w, { x: 5, y: 5 }); placeHero(a, { x: 8, y: 5 })
    // 12 px east of the warrior, closing fast enough to land this tick but
    // not fast enough to tunnel past its centre onto the far (unblocked) side.
    m.projectiles.push({ px: w.px + 12, py: w.py, dx: -280, dy: 0, damage: 5, friendly: true, owner: 'h1',
      onHit: { knockback: 45 } })
    const held = { h0: { move: { x: 0, y: 0 }, facing: 'east', attack: false, alt: true, sprint: false } }
    run(m, PVP.tick, held)
    assert.equal(w.hp, 10)
    assert.equal(w.knockback, null)
  })
})

describe('standings', () => {
  it('sorts by kills then fewer deaths and shares tied ranks', () => {
    const m = makeMatch({ roster: roster('mage', 'mage', 'mage') })
    const [a, b, c] = m.heroes
    a.kills = 3; a.deaths = 2; b.kills = 3; b.deaths = 1; c.kills = 3; c.deaths = 2
    const rows = standings(m)
    assert.deepEqual(rows.map(r => [r.id, r.rank]), [['h1', 1], ['h0', 2], ['h2', 2]])
  })
})

describe('farthestSpawn', () => {
  it('picks the spawn with the greatest distance to the nearest living hero', () => {
    const m = makeMatch({ roster: roster('mage') })
    placeHero(m.heroes[0], { x: 2, y: 2 })
    assert.deepEqual(farthestSpawn(m), { x: 29, y: 21 })
  })
})
