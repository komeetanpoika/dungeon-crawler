import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { POISON, poisonPlayer, curePoison, tickPoison, isPoisoned } from '../renderer/systems/poison.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { updateHUD } from '../renderer/render/hud.js'
import { gearWearing } from './helpers/outfits.js'

const mk = (over = {}) => ({ player: { hp: 10, maxHp: 10, px: 0, py: 0, ...over }, feedback: makeFeedback(), sfx: { cues: [] } })
const run = (state, seconds, opts = {}) => { for (let t = 0; t < seconds * 20; t++) tickPoison(state, 1 / 20, opts) }

describe('poison', () => {
  it('takes one hp every four seconds, as many times as the sting gave', () => {
    const s = mk()
    poisonPlayer(s.player, 3)
    run(s, POISON.every - 0.1)
    assert.equal(s.player.hp, 10)
    run(s, 0.2)
    assert.equal(s.player.hp, 9)
    run(s, POISON.every * 2 + 1)
    assert.equal(s.player.hp, 7)
    assert.equal(s.player.poison, undefined)
    run(s, 20)
    assert.equal(s.player.hp, 7)
  })
  it('never takes the last heart, and still wears off', () => {
    const s = mk({ hp: 2 })
    poisonPlayer(s.player, 5)
    run(s, POISON.every * 5 + 1)
    assert.equal(s.player.hp, POISON.floor)
    assert.equal(s.player.poison, undefined)
  })
  it('a second sting restarts the clock and keeps the larger count, never stacking', () => {
    const s = mk()
    poisonPlayer(s.player, 5)
    run(s, POISON.every + 0.1)          // one taken, four left
    assert.equal(s.player.poison.left, 4)
    run(s, 2)
    poisonPlayer(s.player, 3)
    assert.equal(s.player.poison.left, 4)
    assert.equal(s.player.poison.next, POISON.every)
    poisonPlayer(s.player, 6)
    assert.equal(s.player.poison.left, 6)
  })
  it('is cured at once by a cure, and by a second beside water', () => {
    const s = mk()
    poisonPlayer(s.player, 3)
    assert.equal(curePoison(s.player), true)
    assert.equal(curePoison(s.player), false)
    run(s, 20)
    assert.equal(s.player.hp, 10)
    poisonPlayer(s.player, 3)
    run(s, POISON.cureAfter - 0.2, { water: true })
    assert.ok(s.player.poison)
    run(s, 0.4, { water: true })
    assert.equal(s.player.poison, undefined)
  })
  it('a moment beside water does not add up over visits', () => {
    const s = mk()
    poisonPlayer(s.player, 3)
    run(s, 0.6, { water: true }); run(s, 0.2); run(s, 0.6, { water: true })
    assert.ok(s.player.poison)
  })
  it('holds its clock on the coach, and ends with the hero', () => {
    const s = mk({ riding: true })
    poisonPlayer(s.player, 3)
    run(s, 10)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.poison.left, 3)
    const d = mk({ hp: 0 })
    poisonPlayer(d.player, 3)
    run(d, 10)
    assert.equal(d.player.hp, 0)
    assert.equal(d.player.poison, undefined)
  })
  it('is heard and shown as it bites', () => {
    const s = mk()
    poisonPlayer(s.player, 1)
    run(s, POISON.every + 0.1)
    assert.ok(s.sfx.cues.some(c => c.name === 'poison'))
  })
})

describe('isPoisoned', () => {
  it('knows the sting\'s poison from the arena\'s Venom, which draws its own wash', () => {
    assert.equal(isPoisoned({ poison: { left: 2, next: 1, wash: 0 } }), true)
    assert.equal(isPoisoned({ poison: { owner: 'h2', t: 3, next: 1 } }), false)
    assert.equal(isPoisoned({}), false)
  })
})

describe('the hearts of a poisoned hero', () => {
  it('are green', () => {
    const nodes = {}
    globalThis.document = { getElementById: id => (nodes[id] ??= { textContent: '', style: {}, dataset: {}, innerHTML: '' }) }
    const player = { hp: 7, maxHp: 10, stamina: 100, maxStamina: 100, inventory: [], weapon: null, ranged: null, wand: null,
      ammo: { arrow: 0, bolt: 0, stone: 0 }, attackMode: 'melee', gear: gearWearing('ranger', 'robe') }
    updateHUD({ level: 1, log: [], player })
    const plain = nodes['hud-hearts'].innerHTML
    assert.ok(!plain.includes('data-poison'))
    updateHUD({ level: 1, log: [], player: { ...player, poison: { left: 2, next: 1 } } })
    const sick = nodes['hud-hearts'].innerHTML
    assert.ok(sick.includes('data-poison'))
    assert.ok(!sick.includes('#ef4444'))
  })
})
