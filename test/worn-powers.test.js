// What the pieces' powers do, each at the place the thing happens: the
// Horned Helm's ram, the Desert Headcloth in the heat, the Ring of Breath on
// the stamina, the Ring of Mending on the hearts, the Miser's Ring on a
// purse, the Wayfarer's Boots on a walk. Every one is had only while the
// character wearing the piece is the one being played.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tickMending, MENDING_EVERY, purseMul, walkMul, WAYFARER_WALK, BREATH_REGAIN, MISER_PURSE } from '../renderer/systems/worn.js'
import { tickRam, RAM } from '../renderer/systems/ram.js'
import { tickStamina, STAMINA_MAX } from '../renderer/systems/stamina.js'
import { tickHeat, HEAT } from '../renderer/wilds/heat.js'
import { makePlayer, makeWornContents, makeMonster, TILE } from '../renderer/systems/entities.js'
import { makeNpc } from '../renderer/systems/npc.js'
import { createMap } from '../renderer/systems/map.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const S = 32
const worn = key => { const { type, ...p } = makeWornContents(key); return p }
// a hero whose `stance` character wears `keys`
function hero(keys = [], { stance = 'melee', ...over } = {}) {
  const p = { ...makePlayer(5, 5), px: 5 * S + 16, py: 5 * S + 16, hp: 10, maxHp: 10, stamina: 100, maxStamina: 100, ...over }
  for (const key of keys) p.gear[stance][makeWornContents(key).type] = worn(key)
  return p
}
// the same pieces on the Mage, while the Warrior is played
const onAnother = keys => hero(keys, { stance: 'magic' })

describe('the Ring of Mending', () => {
  it('gives a hitpoint back every forty seconds while the hero is hurt', () => {
    assert.equal(MENDING_EVERY, 40)
    const p = hero(['mending'], { hp: 7 })
    assert.equal(tickMending(p, 39.9), 0)
    assert.equal(p.hp, 7)
    assert.equal(tickMending(p, 0.2), 1)
    assert.equal(p.hp, 8)
    assert.equal(tickMending(p, 40), 1)
    assert.equal(p.hp, 9)
  })
  it('does not count while he is whole, nor bank time for the next wound', () => {
    const p = hero(['mending'], { hp: 10 })
    assert.equal(tickMending(p, 100), 0)
    p.hp = 9
    assert.equal(tickMending(p, 39), 0)
    assert.equal(p.hp, 9)
  })
  it('never lifts him past full, and does nothing for the dead', () => {
    const p = hero(['mending'], { hp: 9 })
    tickMending(p, 400)
    assert.equal(p.hp, 10)
    const dead = hero(['mending'], { hp: 0 })
    assert.equal(tickMending(dead, 100), 0)
    assert.equal(dead.hp, 0)
  })
  it('is nothing on a hero without it, or with it on another character', () => {
    for (const p of [hero([], { hp: 5 }), Object.assign(onAnother(['mending']), { hp: 5 })]) {
      assert.equal(tickMending(p, 100), 0)
      assert.equal(p.hp, 5)
    }
  })
})

describe('the Miser\'s Ring and the Wayfarer\'s Boots', () => {
  it('a purse falls half again as heavy', () => {
    assert.equal(MISER_PURSE, 1.5)
    assert.equal(purseMul(hero(['miser'])), 1.5)
    assert.equal(purseMul(hero()), 1)
    assert.equal(purseMul(onAnother(['miser'])), 1)
  })
  it('a walk is 12% quicker', () => {
    assert.equal(WAYFARER_WALK, 1.12)
    assert.equal(walkMul(hero(['wayfarer'])), 1.12)
    assert.equal(walkMul(hero()), 1)
    assert.equal(walkMul(onAnother(['wayfarer'])), 1)
  })
})

describe('the Ring of Breath', () => {
  // past the regain delay, one second of rest
  const regain = p => { p.stamina = 10; p.staminaRegenT = 100; tickStamina(p, 1); return p.stamina - 10 }
  it('brings stamina back 30% faster', () => {
    assert.equal(BREATH_REGAIN, 1.3)
    const plain = regain(hero()), ringed = regain(hero(['breath']))
    assert.ok(plain > 0)
    assert.ok(Math.abs(ringed / plain - 1.3) < 1e-9, `${ringed} against ${plain}`)
  })
  it('only on the character who wears it, and never past the tank', () => {
    assert.equal(regain(onAnother(['breath'])), regain(hero()))
    const p = hero(['breath'], { stamina: STAMINA_MAX - 1, staminaRegenT: 100 })
    tickStamina(p, 5)
    assert.equal(p.stamina, STAMINA_MAX)
  })
})

describe('the Desert Headcloth', () => {
  const NOON = 0.5 * DAY_LENGTH
  function sand(player) {
    const map = createMap(40, 20)
    for (const row of map) for (const c of row) { c.tile = TILE.FLOOR; c.skin = 'ow_sand_0' }
    Object.assign(player, { x: 30, y: 10, px: 30 * S + 16, py: 10 * S + 16 })
    return { map, player, entities: [], sfx: makeSfx(), feedback: makeFeedback() }
  }
  const heat = player => { const state = sand(player); tickHeat(state, { seed: 7, day: 3, playtime: 1000 }, { clock: NOON, delta: 0.1, desert: true }); return state }
  it('keeps the midday sun from halving the stamina\'s return', () => {
    assert.equal(heat(hero()).player.regenScale, HEAT.factor)
    assert.equal(heat(hero(['cloth'])).player.regenScale, 1)
  })
  it('does not cool the day itself: the air still shimmers', () => {
    assert.ok(heat(hero(['cloth'])).heat > 0)
  })
  it('on another character\'s head it shades nobody', () => {
    assert.equal(heat(onAnother(['cloth'])).player.regenScale, HEAT.factor)
  })
})

describe('the Horned Helm\'s ram', () => {
  const foe = (dx = 16, over = {}) => ({ ...makeMonster(5, 5, 'medium'), px: 5 * S + 16 + dx, py: 5 * S + 16, ...over })
  const world = (player, ...entities) => ({ player, entities, sfx: makeSfx(), feedback: makeFeedback() })
  const run = (state, sprinting = true, dt = 0.016) => tickRam(state, state.player, { sprinting, dt })

  it('a sprint into an enemy shoves it away, stuns it and costs stamina', () => {
    assert.deepEqual(RAM, { cost: 12, shove: 40, stun: 0.6, every: 1 })
    const e = foe()
    const state = world(hero(['horned']), e)
    assert.deepEqual(run(state), [e])
    assert.equal(state.player.stamina, 88)
    assert.equal(e.stunTimer, RAM.stun)
    assert.ok(e.knockback.vx > 0 && Math.abs(e.knockback.vy) < 1e-9, 'shoved straight away from the hero')
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['ram'])
  })
  it('the same enemy is not rammed again for a second', () => {
    const e = foe()
    const state = world(hero(['horned']), e)
    run(state)
    assert.deepEqual(run(state, true, 0.5), [])
    assert.equal(state.player.stamina, 88)
    assert.deepEqual(run(state, true, 0.6), [e])
    assert.equal(state.player.stamina, 76)
  })
  it('only at a sprint, only in reach, only with the helm on the character being played', () => {
    assert.deepEqual(run(world(hero(['horned']), foe()), false), [], 'walking')
    assert.deepEqual(run(world(hero(['horned']), foe(60))), [], 'two tiles off')
    assert.deepEqual(run(world(hero(), foe())), [], 'no helm')
    assert.deepEqual(run(world(onAnother(['horned']), foe())), [], 'the Mage\'s helm')
  })
  it('needs the stamina: with less than twelve nothing happens', () => {
    const e = foe()
    const state = world(hero(['horned'], { stamina: 11 }), e)
    assert.deepEqual(run(state), [])
    assert.equal(state.player.stamina, 11)
    assert.equal(e.knockback, undefined)
  })
  it('a boss is stunned but not moved', () => {
    const e = foe(16, { isBoss: true })
    const state = world(hero(['horned']), e)
    assert.deepEqual(run(state), [e])
    assert.equal(e.stunTimer, RAM.stun)
    assert.equal(e.knockback, undefined)
    assert.equal(state.player.stamina, 88)
  })
  it('never a villager, a friend at peace, a chest or the dying', () => {
    const villager = { ...makeNpc({ species: 'villager', x: 5, y: 5, id: 'v' }), px: 5 * S + 20, py: 5 * S + 16 }
    const state = world(hero(['horned']), villager, foe(16, { peaceful: true }), foe(16, { dying: 0.3 }),
      { type: 'chest', x: 5, y: 5, px: 5 * S + 20, py: 5 * S + 16 })
    assert.deepEqual(run(state), [])
    assert.equal(state.player.stamina, 100)
  })
  it('two enemies in the way are both rammed, while the stamina lasts', () => {
    const a = foe(14), b = foe(-14)
    const state = world(hero(['horned'], { stamina: 20 }), a, b)
    assert.deepEqual(run(state), [a])
    assert.equal(state.player.stamina, 8)
    assert.equal(b.stunTimer ?? 0, 0)
  })
})
