// What worn pieces do: armor points that take blows before hp and mend by
// themselves, the weight of mail and plate on a sprint, and the reader the
// pieces' other powers are asked through.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARMOR, armorMax, armorNow, absorbHit, tickArmor, wornSprintMul, wornPower,
} from '../renderer/systems/worn.js'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'
import { makePlayer, makeWornContents } from '../renderer/systems/entities.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makeHero } from '../renderer/pvp/hero.js'
import * as wornModule from '../renderer/systems/worn.js'

const payload = key => { const { type, ...p } = makeWornContents(key); return p }
// a hero wearing `sets`: { melee: ['plate', 'helm'], magic: ['cap'] }
function hero(sets = {}, over = {}) {
  const p = { ...makePlayer(1, 1), px: 40, py: 60, hp: 10, ...over }
  for (const [stance, keys] of Object.entries(sets))
    for (const key of keys) p.gear[stance][makeWornContents(key).type] = payload(key)
  return p
}
const st = player => ({ player, feedback: makeFeedback(), sfx: makeSfx() })
const FULL = { melee: ['plate', 'helm', 'ironshod'] }   // 5 + 2 + 1

describe('armor points', () => {
  it('are the sum of what the character being played wears', () => {
    const p = hero({ melee: ['plate', 'helm', 'ironshod'], magic: ['cap'] })
    assert.equal(armorMax(p), 8)
    assert.equal(armorMax(p, 'magic'), 1)
    assert.equal(armorMax(p, 'ranged'), 0)
    p.attackMode = 'magic'
    assert.equal(armorMax(p), 1)
    assert.equal(armorNow(p), 1)
  })
  it('a hero with no gear record has none', () => {
    assert.equal(armorMax({ hp: 10 }), 0)
    assert.equal(armorNow({ hp: 10 }), 0)
    assert.deepEqual(absorbHit({ hp: 10 }, 3), { soaked: 0, left: 3 })
  })
  it('take a blow before hp does, and pass on what they cannot hold', () => {
    const p = hero({ melee: ['leather'] })                // 2
    assert.deepEqual(absorbHit(p, 3), { soaked: 2, left: 1 })
    assert.equal(armorNow(p), 0)
    assert.deepEqual(absorbHit(p, 2), { soaked: 0, left: 2 })
  })
})

describe('a blow on an armored hero', () => {
  it('lands on the armor: hp untouched, i-frames as ever, a clank and a grey number', () => {
    const s = st(hero(FULL))
    assert.equal(damagePlayer(s, 3, 'hit'), true)
    assert.equal(s.player.hp, 10)
    assert.equal(armorNow(s.player), 5)
    assert.equal(s.player.invulnTimer, INVULN_DURATION)
    assert.deepEqual(s.sfx.cues.map(c => c.name), ['armor-clank'])
    assert.deepEqual([s.feedback.floats.at(-1).text, s.feedback.floats.at(-1).kind], ['-3', 'armor'])
  })
  it('bigger than the armor left spills into hp, and hurts', () => {
    const s = st(hero({ melee: ['leather'] }))
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 9)
    assert.equal(armorNow(s.player), 0)
    assert.deepEqual(s.sfx.cues.map(c => c.name), ['player-hurt'])
    assert.deepEqual([s.feedback.floats.at(-1).text, s.feedback.floats.at(-1).kind], ['-1', 'taken'])
  })
  it('four weak monsters still get through plate: no immunity', () => {
    const s = st(hero(FULL))
    for (let i = 0; i < 9; i++) { s.player.invulnTimer = 0; damagePlayer(s, 1, 'hit') }
    assert.equal(armorNow(s.player), 0)
    assert.equal(s.player.hp, 9)
  })
  it('poison, fire and lightning ignore armor', () => {
    const s = st(hero(FULL))
    damagePlayer(s, 2, 'dot')
    damagePlayer(s, 3, 'lightning')
    assert.equal(s.player.hp, 5)
    assert.equal(armorNow(s.player), 8)
  })
  it('a blow of nothing dents nothing', () => {
    const s = st(hero(FULL))
    damagePlayer(s, 0, 'hit')
    assert.equal(armorNow(s.player), 8)
    assert.equal(s.player.hp, 10)
  })
  it('an outfit protects nothing any more', () => {
    const s = st(hero())
    s.player.gear.melee.outfit = { outfitType: 'plate', name: "Knight's Tabard", loadout: 'melee', heavy: true, protect: 2 }
    damagePlayer(s, 3, 'hit')
    assert.equal(s.player.hp, 7)
  })
})

describe('armor across a change of character', () => {
  it('the damage carries over: nothing mends and nothing mended is lost', () => {
    const p = hero({ melee: ['plate', 'helm', 'ironshod'], magic: ['leather'] })
    p.attackMode = 'magic'
    assert.equal(armorNow(p), 2)
    absorbHit(p, 1); absorbHit(p, 1)
    assert.equal(armorNow(p), 0)
    p.attackMode = 'melee'
    assert.equal(armorNow(p), 6)
  })
  it('is never below nothing and never above the character\'s own', () => {
    const p = hero({ melee: ['plate', 'helm', 'ironshod'], magic: ['cap'] })
    absorbHit(p, 5)
    p.attackMode = 'magic'
    assert.equal(armorNow(p), 0)
    p.attackMode = 'ranged'
    assert.equal(armorNow(p), 0)
    p.dents = 0
    p.attackMode = 'magic'
    assert.equal(armorNow(p), 1)
  })
  it('nothing clamps the dents when pieces change hands: the module offers no such thing to call', () => {
    // game.js used to call settleDents after every change in the bag, which
    // let armor be taken off and put back on whole, with the game paused
    assert.equal('settleDents' in wornModule, false)
  })
  it('taking a piece off and putting it back on repairs nothing', () => {
    // (the bag pauses the game: a clamp here would be a free, instant mend mid-fight)
    const p = hero(FULL)
    absorbHit(p, 8)
    assert.equal(armorNow(p), 0)
    const { head, armor, boots } = p.gear.melee
    Object.assign(p.gear.melee, { head: null, armor: null, boots: null })
    assert.equal(armorNow(p), 0)
    assert.equal(p.dents, 8, 'the damage is still owed')
    Object.assign(p.gear.melee, { head, armor, boots })
    assert.equal(armorNow(p), 0)
    // and a part of it: five dents, the cuirass off and on, still three points showing
    const q = hero(FULL)
    absorbHit(q, 5)
    const cuirass = q.gear.melee.armor
    q.gear.melee.armor = null
    assert.equal(armorNow(q), 0)
    q.gear.melee.armor = cuirass
    assert.equal(armorNow(q), 3)
  })
  it('dents owed beyond what is worn mend away in their own time, and never go below nothing', () => {
    const p = hero(FULL)
    absorbHit(p, 8)
    Object.assign(p.gear.melee, { head: null, armor: null, boots: null })
    tickArmor(p, ARMOR.mendDelay + ARMOR.mendEvery * 3)
    assert.equal(p.dents, 5)
    tickArmor(p, 1000)
    assert.equal(p.dents, 0)
  })
})

describe('mending', () => {
  const dented = n => { const p = hero(FULL); absorbHit(p, n); return p }
  it('waits out the delay, then gives a point back at a time', () => {
    const p = dented(3)
    tickArmor(p, ARMOR.mendDelay)
    assert.equal(armorNow(p), 5)
    tickArmor(p, ARMOR.mendEvery - 0.01)
    assert.equal(armorNow(p), 5)
    tickArmor(p, 0.02)
    assert.equal(armorNow(p), 6)
    tickArmor(p, ARMOR.mendEvery * 2)
    assert.equal(armorNow(p), 8)
    tickArmor(p, 60)
    assert.equal(armorNow(p), 8)
    assert.equal(p.dents, 0)
  })
  it('the numbers the design names', () => {
    assert.deepEqual(ARMOR, { mendDelay: 6, mendEvery: 2.5 })
  })
  it('a blow starts the wait again', () => {
    const p = dented(3)
    tickArmor(p, ARMOR.mendDelay + ARMOR.mendEvery - 0.1)
    absorbHit(p, 1)
    tickArmor(p, ARMOR.mendDelay)
    assert.equal(armorNow(p), 4)
  })
  it('a blow that reaches no armor starts the wait again too', () => {
    const s = st(hero({ melee: ['leather'] }))
    damagePlayer(s, 2, 'hit')
    tickArmor(s.player, ARMOR.mendDelay + ARMOR.mendEvery - 0.1)
    s.player.invulnTimer = 0
    damagePlayer(s, 1, 'hit')
    tickArmor(s.player, ARMOR.mendDelay)
    assert.equal(armorNow(s.player), 0)
  })
  it('is twice as fast with the Smith\'s Ring on the character being played', () => {
    const p = dented(3)
    p.gear.melee.ring = payload('smith')
    tickArmor(p, ARMOR.mendDelay + ARMOR.mendEvery / 2 + 0.01)
    assert.equal(armorNow(p), 6)
    const q = dented(3)
    q.gear.magic.ring = payload('smith')                   // another character's ring does nothing
    tickArmor(q, ARMOR.mendDelay + ARMOR.mendEvery / 2 + 0.01)
    assert.equal(armorNow(q), 5)
  })
  it('one long frame mends as many points as the time holds', () => {
    const p = dented(3)
    tickArmor(p, ARMOR.mendDelay + ARMOR.mendEvery * 2)
    assert.equal(armorNow(p), 7)
  })
})

describe('weight and powers', () => {
  it('sprint cost multiplies over what the played character wears', () => {
    assert.equal(wornSprintMul(hero()), 1)
    assert.equal(wornSprintMul(hero({ melee: ['plate'] })), 2)
    assert.equal(wornSprintMul(hero({ melee: ['elk'] })), 0.6)
    assert.ok(Math.abs(wornSprintMul(hero({ melee: ['chain', 'elk'] })) - 0.9) < 1e-9)
  })
  it('belongs to the wearer: another character sprints as if bare', () => {
    const p = hero({ melee: ['plate', 'elk'] }, { attackMode: 'ranged' })
    assert.equal(wornSprintMul(p), 1)
    assert.equal(wornSprintMul({ hp: 1 }), 1)
  })
  it('a power is had only while the character wearing its piece is played', () => {
    const p = hero({ melee: ['horned'], magic: ['breath'] })
    assert.equal(wornPower(p, 'ram'), true)
    assert.equal(wornPower(p, 'breath'), false)
    p.attackMode = 'magic'
    assert.equal(wornPower(p, 'ram'), false)
    assert.equal(wornPower(p, 'breath'), true)
    assert.equal(wornPower({ hp: 1 }, 'ram'), false)
  })
})

describe('an arena hero', () => {
  it('has no armor, whatever class', () => {
    for (const cls of ['warrior', 'archer', 'mage']) {
      const h = makeHero({ id: cls, name: cls, cls })
      assert.equal(armorMax(h), 0)
      assert.equal(wornSprintMul(h), 1)
    }
  })
  it('the warrior still pays double for a sprint, through the kit\'s outfit', () => {
    const w = makeHero({ id: 'w', name: 'W', cls: 'warrior' })
    assert.equal(w.gear.melee.outfit.sprintDrain, 2)
    assert.equal(makeHero({ id: 'a', name: 'A', cls: 'archer' }).gear.ranged.outfit.sprintDrain, undefined)
  })
})
