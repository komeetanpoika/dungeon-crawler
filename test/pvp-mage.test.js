// The Mage (spec 2a §4): Call Lightning with a match's numbers, and the
// fireball rune.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { placeHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { tryCast, castCost, SPELLS } from '../renderer/systems/spells.js'
import { castLightning, tickLightning, LIGHTNING } from '../renderer/systems/spells/lightning.js'
import { makePlayer } from '../renderer/systems/entities.js'
import { applyLoadout } from '../renderer/systems/loadout.js'
import { PVP, SPELL_OVERRIDES } from '../renderer/data/pvp.js'
import { openMap } from './pvp-helpers.js'

const input = over => ({ ...NEUTRAL_INPUT, move: { x: 0, y: 0 }, ...over })
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
