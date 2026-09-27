// The Mage (spec 2a §4): Call Lightning with a match's numbers, and the
// fireball rune.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch, removeHero } from '../renderer/pvp/sim.js'
import { placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { tryCast, castCost, SPELLS } from '../renderer/systems/spells.js'
import { castLightning, tickLightning, LIGHTNING } from '../renderer/systems/spells/lightning.js'
import { makePlayer, makeWandContents } from '../renderer/systems/entities.js'
import { applyLoadout } from '../renderer/systems/loadout.js'
import { PVP, SPELL_OVERRIDES } from '../renderer/data/pvp.js'
import { openMap } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
const dt = PVP.tick
const play = (m, inputs, ticks) => { const ev = []; for (let i = 0; i < ticks; i++) ev.push(...stepMatch(m, inputs(i), PVP.tick)); return ev }
const duel = (cls = 'archer', foeCell = { x: 6, y: 8 }) => {
  const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, { id: 'f', name: 'f', cls }] })
  const [mg, f] = m.heroes
  placeHero(mg, { x: 3, y: 8 }); placeHero(f, foeCell)
  mg.spawnProtect = 0; f.spawnProtect = 0; mg.facing = 'east'
  return { m, mg, f }
}

describe('Call Lightning in a match', () => {
  it('a tap marks 3 tiles ahead with a 0.4 s delay and a 1.5 s cooldown; the strike deals 3 and stuns 0.3 s', () => {
    const { m, mg, f } = duel()
    play(m, i => ({ m: input({ attack: i === 0, facing: 'east' }) }), 2)   // press, release
    assert.equal(m.lightning.length, 1)
    assert.deepEqual([m.lightning[0].x, m.lightning[0].y, m.lightning[0].delay], [6, 8, 0.4])
    assert.equal(mg.magicCooldown, 1.5)                       // set on the release tick
    let stunned = 0
    for (let i = 0; i < 15 && f.hp === PVP.hp; i++) { stepMatch(m, {}, PVP.tick); stunned = f.stunTimer }
    assert.equal(f.hp, PVP.hp - 3)
    assert.ok(Math.abs(stunned - 0.6 * PVP.ccMul) < 1e-9, `stun ${stunned}`)
    assert.equal(f.lastHitBy.id, 'm')
  })
  it('the tiers aim as before: a full charge 6 tiles ahead, an overcharge the line of 4, 6 and 8', () => {
    const tiles = hold => {
      const { m } = duel('archer', { x: 20, y: 3 })
      play(m, i => ({ m: input({ attack: i < hold, facing: 'east' }) }), hold + 1)
      return m.lightning.map(k => k.x - 3)
    }
    assert.deepEqual(tiles(18), [6])
    assert.deepEqual(tiles(40), [4, 6, 8])
  })
  it('the stamina costs are unchanged: 20, 30, 50', () => {
    const h = makePlayer(0, 0)
    for (const [tier, cost] of [['tap', 20], ['full', 30], ['over', 50]]) {
      h.stamina = 100
      assert.equal(castCost(h, 'lightning', tier, SPELL_OVERRIDES.lightning).stamina, cost)
    }
    assert.equal(castCost(h, 'lightning', 'tap', SPELL_OVERRIDES.lightning).cooldown, 1.5)
  })
})

describe('the Storm Wand charge and a stun (m1)', () => {
  it('a stun mid charge needs a release before it charges again', () => {
    const { m, mg } = duel()
    tickHero(m, mg, input({ attack: true, facing: 'east' }), dt)   // wind-up begins
    assert.deepEqual(mg.charging, { t: 0, kind: 'spell' })
    mg.stunTimer = 0.1
    tickHero(m, mg, input({ attack: true }), dt)                   // stun cancels it, key still down
    assert.equal(mg.charging, null)
    assert.equal(mg.needRelease, true)
    mg.stunTimer = 0
    tickHero(m, mg, input({ attack: true }), dt)                   // still held: no new charge
    assert.equal(mg.charging, null, 'no new charge until the key is let go')
    tickHero(m, mg, input({ attack: false }), dt)                  // let go
    tickHero(m, mg, input({ attack: true }), dt)                   // a fresh press
    assert.deepEqual(mg.charging, { t: 0, kind: 'spell' })
  })
})

describe("single-player's Call Lightning is unchanged", () => {
  it('no override: cooldown 4, delay 0.6, damage 5, stun 1', () => {
    const p = makePlayer(3, 5)
    p.px = 3 * 32 + 16; p.py = 5 * 32 + 16; p.facing = 'east'
    applyLoadout(p, { wandType: 'stormwand', outfits: ['robe'] })
    const foe = { type: 'monster', x: 6, y: 5, px: 6 * 32 + 16, py: 5 * 32 + 16, hp: 9 }
    const state = { map: openMap(), player: p, entities: [foe], lightning: [], strikes: [] }
    const cast = tryCast(state, 'lightning', 'tap', { modules: { lightning: castLightning } })
    assert.equal(cast.ok, true)
    assert.equal(cast.spell, SPELLS.lightning)
    assert.equal(p.magicCooldown, 4)
    assert.deepEqual(state.lightning[0], { x: 6, y: 5, t: 0, delay: LIGHTNING.delay, struck: false })
    const hurt = []
    tickLightning(state, LIGHTNING.delay, { hurt: (e, d) => hurt.push(d) })
    assert.deepEqual(hurt, [5])
    assert.equal(foe.stunTimer, 1.0)
  })
})

describe('the fireball rune', () => {
  const fireball = (foes, facing = 'east') => {
    const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, ...foes.map((c, i) => ({ id: `f${i}`, name: `f${i}`, cls: 'archer' }))] })
    const [mg, ...fs] = m.heroes
    placeHero(mg, { x: 3, y: 8 }); mg.spawnProtect = 0
    foes.forEach((cell, i) => { placeHero(fs[i], cell); fs[i].spawnProtect = 0 })
    mg.rune = { t: 30, saved: {} }; mg.wand = makeWandContents('firewand')
    play(m, i => ({ m: input({ attack: i === 0, facing }) }), 2)         // press, release: a tap
    return { m, mg, fs }
  }
  const untilGone = m => { for (let i = 0; i < 60 && m.projectiles.length; i++) stepMatch(m, {}, PVP.tick) }
  it("the direct hit is the spell's 4 and no burst; a neighbour takes the 2 burst, credited to the caster", () => {
    const { m, fs: [direct, near] } = fireball([{ x: 7, y: 8 }, { x: 7, y: 9 }])
    untilGone(m)
    assert.equal(direct.hp, PVP.hp - 4)
    assert.equal(near.hp, PVP.hp - 2)
    assert.equal(near.lastHitBy.id, 'm')
    assert.equal(m.fireZones.length, 1)
    assert.equal(m.fireZones[0].owner, 'm')
  })
  it('the patch burns 1 a second for 3 s into whoever stands in it, then goes out', () => {
    const { m, fs: [direct, near] } = fireball([{ x: 7, y: 8 }, { x: 7, y: 9 }])
    untilGone(m)
    for (let i = 0; i < Math.round(3 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(direct.hp, PVP.hp - 4 - 3)
    assert.equal(near.hp, PVP.hp - 2 - 3)
    assert.equal(m.fireZones.length, 0)
  })
  it('the burst is unblockable: a buckler raised toward the caster still burns', () => {
    const m = makeMatch({ roster: [{ id: 'm', name: 'm', cls: 'mage' }, { id: 'a', name: 'a', cls: 'archer' }, { id: 'w', name: 'w', cls: 'warrior' }] })
    const [mg, a, w] = m.heroes
    placeHero(mg, { x: 3, y: 8 }); placeHero(a, { x: 7, y: 8 }); placeHero(w, { x: 7, y: 9 })
    for (const h of m.heroes) h.spawnProtect = 0
    mg.rune = { t: 30, saved: {} }; mg.wand = makeWandContents('firewand')
    for (let i = 0; i < 40; i++) stepMatch(m, { m: input({ attack: i === 0, facing: 'east' }), w: input({ alt: true, facing: 'west' }) }, PVP.tick)
    assert.equal(w.hp, PVP.hp - 2)
  })
  it('a patch whose caster has left the match burns on, crediting nobody', () => {
    const { m, fs: [direct] } = fireball([{ x: 7, y: 8 }])
    untilGone(m)
    removeHero(m, 'm')
    for (let i = 0; i < Math.round(1.1 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(direct.hp, PVP.hp - 4 - 1)
    assert.equal(direct.lastHitBy.id, 'm', 'the last credited hit is still the fireball itself')
  })
  it('the caster takes neither the burst nor the patch', () => {
    const { m, mg } = fireball([{ x: 20, y: 20 }], 'west')      // straight into the wall beside the caster
    untilGone(m)
    assert.equal(m.fireZones.length, 1)
    assert.ok(m.fireZones[0].tiles.some(t => t.x === 3 && t.y === 8), 'the caster stands in the blast')
    for (let i = 0; i < Math.round(3 / PVP.tick); i++) stepMatch(m, {}, PVP.tick)
    assert.equal(mg.hp, PVP.hp)
  })
})
