import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch, addHero, removeHero, arenaMap } from '../renderer/pvp/sim.js'
import { makeHero, placeHero, moveHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { swing } from '../renderer/pvp/attacks.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { grantRune } from '../renderer/pvp/pickups.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'
import { testMatch } from './pvp-helpers.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `h${i}`, name: `H${i}`, cls: c }))
const ticks = (m, n, inputs = {}) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...stepMatch(m, inputs, PVP.tick)); return ev }
const east = { ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' }

describe('NET constants', () => {
  it('carries the spec numbers', () => {
    assert.equal(NET.protocolVersion, 1)
    assert.equal(NET.snapshotHz, 20)
    assert.equal(NET.rewindMaxTicks, 6)
    assert.equal(NET.maxPayload, 4096)
    assert.equal(PVP.minHeroes, 2)
  })
})

describe('match tick and the waiting clock', () => {
  it('the tick counter counts every simulated tick', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    ticks(m, 5)
    assert.equal(m.tick, 5)
  })
  it('a lone hero waits: the clock stays at 0 and the match never ends', () => {
    const m = makeMatch({ roster: roster('mage'), matchLength: 1 })
    assert.equal(m.waiting, true)
    const ev = ticks(m, 60)
    assert.equal(m.clock, 0)
    assert.equal(m.tick, 60)
    assert.equal(ev.some(e => e.type === 'matchEnd'), false)
  })
  it('the clock runs once a second hero arrives, and matchLength ends it', () => {
    const m = makeMatch({ roster: roster('mage'), matchLength: 1 })
    addHero(m, { id: 'h9', name: 'N', cls: 'archer' })
    const ev = ticks(m, 40)
    assert.equal(m.waiting, false)
    assert.ok(ev.some(e => e.type === 'matchEnd'))
  })
})

describe('addHero / removeHero', () => {
  it('adds at the farthest spawn with spawn protection and a join event', () => {
    const m = makeMatch({ roster: roster('mage') })
    placeHero(m.heroes[0], { x: 2, y: 2 })
    const h = addHero(m, { id: 'p2', name: 'Two', cls: 'warrior' })
    assert.deepEqual([h.x, h.y], [29, 21])
    assert.equal(h.spawnProtect, PVP.spawnProtect)
    assert.ok(m.events.some(e => e.type === 'join' && e.hero === 'p2'))
    assert.equal(m.heroes.length, 2)
  })
  it('rejects a duplicate id and a full arena', () => {
    const m = makeMatch({ roster: roster('mage') })
    assert.throws(() => addHero(m, { id: 'h0', name: 'X', cls: 'mage' }))
    for (let i = 1; i < 6; i++) addHero(m, { id: `x${i}`, name: 'X', cls: 'mage' })
    assert.throws(() => addHero(m, { id: 'x9', name: 'X', cls: 'mage' }))
  })
  it('removes a hero, returns a held rune to its pedestal and emits leave', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const rune = m.pickups.find(p => p.kind === 'rune')
    rune.up = false; rune.t = 50
    grantRune(m, m.heroes[0])
    assert.equal(removeHero(m, 'h0'), true)
    assert.equal(m.heroes.length, 1)
    assert.equal(rune.up, true)
    assert.ok(m.events.some(e => e.type === 'leave' && e.hero === 'h0'))
    assert.equal(m.entities.some(e => e.id === 'h0'), false)
    assert.equal(removeHero(m, 'nope'), false)
  })
})

describe('arenaMap', () => {
  it('is the same map makeMatch builds', () => {
    const map = arenaMap()
    const m = makeMatch({ roster: roster('mage') })
    assert.equal(map.length, m.map.length)
    assert.equal(map[0].length, m.map[0].length)
    assert.deepEqual(map.map(r => r.map(c => c.tile)), m.map.map(r => r.map(c => c.tile)))
  })
})

describe('moveHero', () => {
  it('moves exactly as tickHero does but never attacks', () => {
    const a = makeHero({ id: 'a', name: 'a', cls: 'warrior' }); placeHero(a, { x: 5, y: 5 })
    const b = makeHero({ id: 'b', name: 'b', cls: 'warrior' }); placeHero(b, { x: 5, y: 5 })
    const ma = testMatch([a]), mb = testMatch([b])
    const input = { ...east, attack: true }
    for (let i = 0; i < 10; i++) { moveHero(ma, a, input, PVP.tick); tickHero(mb, b, input, PVP.tick) }
    assert.equal(a.px, b.px)
    assert.equal(a.py, b.py)
    assert.equal(a.meleeCooldown, 0)        // moveHero never swung
    assert.ok(b.meleeCooldown > 0)          // tickHero did
  })
})

describe('swing hitPos seam', () => {
  const pair = () => {
    const w = makeHero({ id: 'w', name: 'w', cls: 'warrior' }); placeHero(w, { x: 5, y: 5 }); w.facing = 'east'
    const a = makeHero({ id: 'a', name: 'a', cls: 'archer' }); placeHero(a, { x: 8, y: 5 })   // 96 px: out of reach
    return { w, a, m: testMatch([w, a]) }
  }
  it('without hitPos a foe out of reach is missed', () => {
    const { w, a, m } = pair()
    swing(m, w, resolveCharge('sword', 0))
    assert.equal(a.hp, 10)
  })
  it('hitPos moves only the hit test: the rewound position is hit, damage lands on the real hero', () => {
    const { w, a, m } = pair()
    m.hitPos = foe => ({ type: foe.type, px: w.px + 32, py: w.py })
    swing(m, w, resolveCharge('sword', 0))
    assert.equal(a.hp, 8)
    assert.equal(a.px, 8 * 32 + 16)
  })
})
