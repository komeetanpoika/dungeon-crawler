import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { order, fareCost, sleepItOff, tickTavern, tavernSpeedMul, stagger, sway, drunkOf, fullOf,
  DRINK_FADE, FOOD_FADE, TIPSY_AT, HIC_AT, PASS_OUT, HANGOVER, STUFFED_AT, BURSTING_AT, MOP_FEE } from '../renderer/systems/tavern.js'
import { coinsOf } from '../renderer/systems/coin.js'
import { FARE } from '../renderer/data/coin.js'
import { makePlayer } from '../renderer/systems/entities.js'

const hero = (over = {}) => ({ ...makePlayer(5, 5), ...over })
const fare = id => FARE.find(f => f.id === id)

describe('the fare', () => {
  it('every serving has a name and costs whole coin', () => {
    for (const f of FARE) {
      assert.ok(f.name, f.id)
      const c = fareCost(f, 4)
      assert.ok(Number.isInteger(c) && c > 0, f.id)
      assert.ok((f.drink ?? 0) + (f.food ?? 0) > 0, `${f.id} is eaten or drunk`)
    }
  })

  it('a round is priced by the head and never under its floor', () => {
    const round = fare('round')
    assert.equal(fareCost(round, 0), round.min)
    assert.equal(fareCost(round, 1), round.min)
    assert.equal(fareCost(round, 5), 5 * round.each)
  })
})

describe('ordering', () => {
  it('takes the price, mends, and goes to the head or the belly', () => {
    const p = hero({ coins: 20, hp: 4 })
    const r = order(p, fare('stew'))
    assert.equal(r.cost, fare('stew').price)
    assert.equal(r.healed, 3)
    assert.equal(p.hp, 7)
    assert.equal(coinsOf(p), 20 - fare('stew').price)
    assert.equal(fullOf(p), 1)
    assert.equal(drunkOf(p), 0)
    order(p, fare('ale'))
    assert.equal(drunkOf(p), 1)
  })

  it('never heals past whole, and a whole hero may eat all the same', () => {
    const p = hero({ coins: 100 })
    const r = order(p, fare('feast'))
    assert.equal(r.healed, 0)
    assert.equal(p.hp, p.maxHp)
    assert.equal(coinsOf(p), 70)
    p.hp = 2
    assert.equal(order(p, fare('feast')).healed, p.maxHp - 2)
  })

  it('short: null, and nothing changes', () => {
    const p = hero({ coins: 1, hp: 3 })
    assert.equal(order(p, fare('ale')), null)
    assert.equal(coinsOf(p), 1)
    assert.equal(drunkOf(p), 0)
    assert.equal(p.hp, 3)
    assert.equal(order(hero(), fare('ale')), null)   // no purse at all
  })

  it('a hero can drink himself broke: nothing but the purse stops the next mug', () => {
    const p = hero({ coins: 13 })
    let mugs = 0
    while (order(p, fare('ale'))) { mugs++; if (drunkOf(p) >= PASS_OUT) sleepItOff(p) }
    assert.ok(mugs >= 4)
    assert.ok(coinsOf(p) < fare('ale').price)
  })

  it('and eat himself broke: a stuffed hero is still served', () => {
    const p = hero({ coins: 40 })
    let bowls = 0
    while (order(p, fare('stew'))) bowls++
    assert.equal(bowls, 10)
    assert.equal(coinsOf(p), 0)
    assert.ok(fullOf(p) >= BURSTING_AT)
  })

  it('remarks when a serving takes him over a line, and on the last coin', () => {
    const p = hero({ coins: 6 })
    assert.equal(order(p, fare('ale')).remark, null)
    assert.match(order(p, fare('ale')).remark, /easy/)
    assert.match(order(p, fare('ale')).remark, /last of my coin/)
    const q = hero({ coins: 100 })
    const said = []
    for (let i = 0; i < STUFFED_AT; i++) said.push(order(q, fare('stew')).remark)
    assert.match(said.at(-1), /another bite/)
    assert.equal(said.slice(0, -1).every(s => s === null), true)
  })

  it('the round costs by the head and puts one mug in the hero', () => {
    const p = hero({ coins: 30 })
    const r = order(p, fare('round'), 4)
    assert.equal(r.cost, 12)
    assert.equal(coinsOf(p), 18)
    assert.equal(drunkOf(p), 1)
  })
})

describe('under the table', () => {
  it('the mug that reaches PASS_OUT says so', () => {
    const p = hero({ coins: 100 })
    let r
    for (let i = 0; i < PASS_OUT - 1; i++) { r = order(p, fare('ale')); assert.equal(r.passedOut, false) }
    r = order(p, fare('ale'))
    assert.equal(r.passedOut, true)
  })

  it('he wakes with a thick head and the innkeeper\'s fee gone, or what there was of it', () => {
    const p = hero({ coins: 50, drunk: PASS_OUT })
    assert.equal(sleepItOff(p), MOP_FEE)
    assert.equal(coinsOf(p), 50 - MOP_FEE)
    assert.equal(drunkOf(p), HANGOVER)
    const broke = hero({ coins: 2, drunk: PASS_OUT })
    assert.equal(sleepItOff(broke), 2)
    assert.equal(coinsOf(broke), 0)
    assert.equal(sleepItOff(hero({ coins: 0, drunk: PASS_OUT })), 0)
  })
})

describe('wearing off', () => {
  it('a drink fades in DRINK_FADE seconds and a helping in FOOD_FADE', () => {
    const p = hero({ drunk: 1, full: 1 })
    for (let t = 0; t < DRINK_FADE / 2; t += 0.5) tickTavern(p, 0.5, () => 0.5)
    assert.ok(Math.abs(drunkOf(p) - 0.5) < 1e-6)
    for (let t = 0; t < DRINK_FADE; t += 0.5) tickTavern(p, 0.5, () => 0.5)
    assert.equal(drunkOf(p), 0)
    assert.equal(fullOf(p), 0)
    assert.ok(FOOD_FADE < DRINK_FADE * 2)
  })

  it('a sober, empty hero is left alone', () => {
    const p = hero()
    assert.equal(tickTavern(p, 1), null)
    assert.equal(p.drunk, undefined)
    assert.equal(tickTavern(null, 1), null)
  })

  it('hiccups now and then from HIC_AT, never below it', () => {
    const p = hero({ drunk: HIC_AT + 3 })
    let hics = 0
    for (let t = 0; t < 30; t += 0.1) if (tickTavern(p, 0.1, () => 0.5) === 'hic') hics++
    assert.ok(hics >= 3 && hics <= 8, `${hics} hiccups in 30 s`)
    const q = hero({ drunk: HIC_AT - 0.5 })
    for (let t = 0; t < 30; t += 0.1) assert.equal(tickTavern(q, 0.1, () => 0.5), null)
  })
})

describe('what it does to him', () => {
  it('a sober hero walks straight and sees straight', () => {
    const p = hero({ drunk: TIPSY_AT - 0.1 })
    for (let t = 0; t < 10; t += 0.37) {
      assert.equal(stagger(p, t), 0)
      assert.deepEqual(sway(p, t), { dx: 0, dy: 0 })
    }
  })

  it('a tipsy one wanders, more with every drink, but never turns right round', () => {
    const peak = d => { let m = 0; for (let t = 0; t < 40; t += 0.05) m = Math.max(m, Math.abs(stagger(hero({ drunk: d }), t))); return m }
    assert.ok(peak(2) > 0.1)
    assert.ok(peak(5) > peak(2))
    assert.ok(peak(50) <= 0.9 + 1e-9)
    const s = sway(hero({ drunk: 50 }), 1.3)
    assert.ok(Math.abs(s.dx) <= 10 && Math.abs(s.dy) <= 10)
    assert.ok(Number.isInteger(s.dx) && Number.isInteger(s.dy))
  })

  it('a stuffed hero is slow and a bursting one slower', () => {
    assert.equal(tavernSpeedMul(hero()), 1)
    assert.equal(tavernSpeedMul(hero({ full: STUFFED_AT - 0.1 })), 1)
    assert.ok(tavernSpeedMul(hero({ full: STUFFED_AT })) < 1)
    assert.ok(tavernSpeedMul(hero({ full: BURSTING_AT })) < tavernSpeedMul(hero({ full: STUFFED_AT })))
  })
})
