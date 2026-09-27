// Sub-project 2b: the buff numbers and the match's seeded rolls.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PVP, BOTS, BUFF_KINDS, EDGE_KINDS, BUFFS, DOTS, BUFF_SPOTS, BUFF_COLORS } from '../renderer/data/pvp.js'
import { mulberry32, randomSeed, rollBuff } from '../renderer/pvp/rng.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { makeLocalMatch } from '../renderer/pvp/local.js'
import { makeLobby, createRoom } from '../server/rooms.js'

describe('2b numbers', () => {
  it('the five buffs, minor and major', () => {
    assert.deepEqual(BUFF_KINDS, ['haste', 'might', 'ward', 'ember', 'venom'])
    assert.deepEqual(EDGE_KINDS, ['ember', 'venom'])
    assert.deepEqual(BUFFS.haste, { minor: { dur: 8, mul: 1.2 }, major: { dur: 15, mul: 1.5 } })
    assert.deepEqual(BUFFS.might, { minor: { dur: 8, bonus: 1 }, major: { dur: 12, bonus: 2 } })
    assert.deepEqual(BUFFS.ward, { minor: { dur: 15, pool: 2 }, major: { dur: 15, pool: 4 } })
    assert.deepEqual(BUFFS.ember, { minor: { dur: 10, burn: 2 }, major: { dur: 15, burn: 3, emberPatchTiles: 5 } })
    assert.deepEqual(BUFFS.venom, { minor: { dur: 10, poison: 3, slow: 0.2 }, major: { dur: 15, poison: 4.5, slow: 0.35 } })
    assert.deepEqual(DOTS, { burn: { interval: 1, damage: 1 }, poison: { interval: 1.5, damage: 1 } })
    for (const k of BUFF_KINDS) assert.match(BUFF_COLORS[k], /^#[0-9a-f]{6}$/)
  })
  it('the spots, the large-arena floor and the bots', () => {
    assert.deepEqual(BUFF_SPOTS, { minorRespawn: 20, majorRespawn: 45, majorFirstSpawn: 30 })
    assert.equal(PVP.largeMinHeroes, 4)
    assert.equal(BOTS.buffSeekFoe, 4)
    assert.equal(BOTS.buffSeek, 6)
    assert.equal(BOTS.majorSeek, 10)
  })
})

describe('the seeded rolls', () => {
  it('mulberry32 is repeatable for a seed and differs between seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const xs = Array.from({ length: 5 }, () => a())
    assert.deepEqual(Array.from({ length: 5 }, () => b()), xs)
    assert.notDeepEqual(Array.from({ length: 5 }, () => c()), xs)
    for (const x of xs) assert.ok(x >= 0 && x < 1)
  })
  it('rollBuff: all five kinds come up, none far off a fifth over 5000 rolls', () => {
    const rng = mulberry32(7)
    const n = Object.fromEntries(BUFF_KINDS.map(k => [k, 0]))
    for (let i = 0; i < 5000; i++) n[rollBuff(rng)]++
    for (const k of BUFF_KINDS) assert.ok(n[k] > 900 && n[k] < 1100, `${k} ${n[k]}`)
    assert.equal(rollBuff(() => 0.999999999), 'venom')
    assert.equal(rollBuff(() => 0), 'haste')
  })
  it('randomSeed maps a [0, 1) source onto 32 bits', () => {
    assert.equal(randomSeed(() => 0), 0)
    assert.equal(randomSeed(() => 0.5), 2147483648)
    assert.equal(randomSeed(() => 0.9999999999), 4294967295)
  })
  it('makeMatch keeps the seed and a PRNG seeded with it; the default seed is 1', () => {
    const roster = [{ id: 'a', name: 'A', cls: 'mage' }]
    const m = makeMatch({ roster, seed: 99 }), n = makeMatch({ roster, seed: 99 })
    assert.equal(m.seed, 99)
    assert.equal(m.rng(), n.rng())
    assert.equal(makeMatch({ roster }).seed, 1)
  })
  it('the server seeds each match from the lobby random; the local mode takes one or makes one', () => {
    const lobby = makeLobby({ random: () => 0.5 })
    const { room } = createRoom(lobby, { name: 'Aino', cls: 'mage' })
    assert.equal(room.match.seed, 2147483648)
    assert.equal(makeLocalMatch({ cls: 'mage', seed: 7 }).seed, 7)
    assert.ok(Number.isInteger(makeLocalMatch({ cls: 'mage' }).seed))
  })
})
