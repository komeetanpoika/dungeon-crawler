import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { canPay, pay, priceName, tryBuy } from '../renderer/systems/trade.js'
import { angerTribe, atPeace } from '../renderer/systems/tribes.js'
import { makeItem, addItem } from '../renderer/systems/inventory.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef } from '../renderer/systems/monsters.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { makePlayer, AMMO_CAPS } from '../renderer/systems/entities.js'
import { TRIBES, WARES } from '../renderer/data/tribes.js'

const S = 32
const hero = () => ({ ...makePlayer(5, 5), px: 5 * S + S / 2, py: 5 * S + S / 2 })
const count = (p, kind) => p.inventory.reduce((n, i) => n + (i.kind === kind ? i.count ?? 1 : 0), 0)
const meat2 = { item: 'cooked_meat', count: 2 }

describe('paying a price', () => {
  it('takes exactly the count of the one kind', () => {
    const p = hero()
    addItem(p, makeItem('cooked_meat', 5))
    addItem(p, makeItem('lumber', 3))
    assert.equal(canPay(p, meat2), true)
    assert.equal(pay(p, meat2), true)
    assert.equal(count(p, 'cooked_meat'), 3)
    assert.equal(count(p, 'lumber'), 3)
  })

  it('empties the slot when the price is all of it, and never goes below nothing', () => {
    const p = hero()
    addItem(p, makeItem('cooked_meat', 2))
    assert.equal(pay(p, meat2), true)
    assert.equal(p.inventory.length, 0)
    assert.equal(pay(p, meat2), false)
    assert.equal(p.inventory.length, 0)
  })

  it('short: false, and nothing is taken', () => {
    const p = hero()
    addItem(p, makeItem('cooked_meat', 1))
    addItem(p, makeItem('meat', 9))            // raw meat is not cooked meat
    assert.equal(canPay(p, meat2), false)
    assert.equal(pay(p, meat2), false)
    assert.equal(count(p, 'cooked_meat'), 1)
    assert.equal(count(p, 'meat'), 9)
  })

  it('a price that is no price cannot be paid', () => {
    const p = hero()
    addItem(p, makeItem('lumber', 3))
    for (const bad of [null, undefined, {}, { item: 'lumber' }, { item: 'lumber', count: 0 }, { item: 'lumber', count: -1 }, { item: 'gold', count: 1 }]) {
      assert.equal(canPay(p, bad), false)
      assert.equal(pay(p, bad), false)
    }
    assert.equal(count(p, 'lumber'), 3)
  })

  it('names what it is paid in', () => {
    assert.equal(priceName(meat2), 'cooked meat')
    assert.equal(priceName({ item: 'mushroom', count: 1 }), 'mushroom')
    assert.equal(priceName({ item: 'lumber', count: 3 }), 'lumber')
    assert.equal(priceName({ item: 'nosuch', count: 1 }), 'nosuch')
    for (const w of WARES) assert.equal(typeof priceName(w.price), 'string')
  })
})

describe('stepping onto a ware', () => {
  const FAKE_RIG = { RIG_ID: 'fakerig', PARAM_SCHEMA: [], drawMonster: () => {} }
  beforeEach(() => registerMonsters(
    [{ name: 'norppakauppias', rig: 'fakerig', stats: { hp: 6, speed: 60 }, behavior: { tribe: 'norpat', role: 'vendor' } },
     { name: 'norppavahti', rig: 'fakerig', stats: { hp: 9, speed: 60 }, behavior: { tribe: 'norpat', role: 'fighter' } }],
    { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} }))
  afterEach(clearMonsters)

  function camp({ vendorAt = [7, 5] } = {}) {
    const state = { player: hero(), entities: [], feedback: makeFeedback(), sfx: makeSfx() }
    const add = (name, x, y) => {
      const e = { ...makeMonsterFromDef(name, x, y), px: x * S + S / 2, py: y * S + S / 2 }
      e.peaceful = atPeace(state, e)
      state.entities.push(e)
      return e
    }
    const guard = add('norppavahti', 6, 4)
    const vendor = vendorAt ? add('norppakauppias', ...vendorAt) : null
    const ware = { type: 'floating_item', contents: { type: 'potion', amount: 4 }, price: meat2, tribe: 'norpat',
      x: 5, y: 5, px: 5 * S + S / 2, py: 5 * S + S / 2, progress: 1 }
    state.entities.push(ware)
    return { state, ware, vendor, guard }
  }

  it('with the price in the sack: the price is taken once and the ware granted', () => {
    const { state, ware } = camp()
    addItem(state.player, makeItem('cooked_meat', 3))
    const granted = []
    assert.equal(tryBuy(state, ware, c => { granted.push(c); return true }), 'bought')
    assert.equal(granted.length, 1)
    assert.ok(granted[0] === ware.contents)
    assert.equal(count(state.player, 'cooked_meat'), 1)
    assert.equal(state.feedback.bubble, null)
  })

  it('without: nothing is taken, nothing granted, and the vendor says what it costs, once every few seconds', () => {
    const { state, ware, vendor } = camp()
    addItem(state.player, makeItem('cooked_meat', 1))
    let grants = 0
    assert.equal(tryBuy(state, ware, () => { grants++; return true }), 'short')
    assert.equal(grants, 0)
    assert.equal(count(state.player, 'cooked_meat'), 1)
    assert.equal(state.feedback.bubble.text, TRIBES.norpat.priceLine(2, 'cooked meat'))
    assert.equal(state.feedback.bubble.anchorId, vendor.id)
    assert.ok(vendor.id !== undefined)
    // stood on: no new bubble until the throttle (game.js counts state.msgCooldown down) runs out
    state.feedback.bubble = null
    assert.equal(tryBuy(state, ware, () => true), 'short')
    assert.equal(state.feedback.bubble, null)
    assert.ok(state.msgCooldown.ware > 3 && state.msgCooldown.ware <= 4)
    state.msgCooldown.ware = 0
    tryBuy(state, ware, () => true)
    assert.ok(state.feedback.bubble)
  })

  it('nothing is sold during a grudge, even to a full purse', () => {
    const { state, ware, vendor } = camp()
    addItem(state.player, makeItem('cooked_meat', 9))
    angerTribe(state, 'norpat')
    let grants = 0
    assert.equal(tryBuy(state, ware, () => { grants++; return true }), 'grudge')
    assert.equal(grants, 0)
    assert.equal(count(state.player, 'cooked_meat'), 9)
    assert.equal(state.feedback.bubble.text, TRIBES.norpat.grudgeLine)
    assert.equal(state.feedback.bubble.anchorId, vendor.id)
  })

  it('a full sack: the price comes back whole', () => {
    const { state, ware } = camp()
    addItem(state.player, makeItem('cooked_meat', 2))
    assert.equal(tryBuy(state, ware, () => false), 'full')
    assert.equal(count(state.player, 'cooked_meat'), 2)
    addItem(state.player, makeItem('cooked_meat', 3))
    assert.equal(tryBuy(state, ware, () => false), 'full')
    assert.equal(count(state.player, 'cooked_meat'), 5)
    assert.equal(state.player.inventory.filter(i => i.kind === 'cooked_meat').length, 1)
  })

  it('a ware he could take nothing of is not sold: arrows for a full quiver', () => {
    const { state, ware } = camp()
    ware.contents = { type: 'ammo', ammoKind: 'arrow', count: 12 }
    ware.price = { item: 'lumber', count: 2 }
    addItem(state.player, makeItem('lumber', 5))
    state.player.ammo = { ...(state.player.ammo ?? {}), arrow: AMMO_CAPS.arrow }
    let grants = 0
    assert.equal(tryBuy(state, ware, () => { grants++; return true }), 'full')
    assert.equal(grants, 0)
    assert.equal(count(state.player, 'lumber'), 5)
    state.player.ammo.arrow = AMMO_CAPS.arrow - 1
    assert.equal(tryBuy(state, ware, () => { grants++; return true }), 'bought')
    assert.equal(count(state.player, 'lumber'), 3)
  })

  it('only a living vendor within eight tiles speaks: a guard never does, nor one far off or dead', () => {
    for (const vendorAt of [null, [5, 14]]) {
      const { state, ware } = camp({ vendorAt })
      assert.equal(tryBuy(state, ware, () => true), 'short')
      assert.equal(state.feedback.bubble, null)
    }
    const { state, ware, vendor } = camp()
    vendor.hp = 0
    assert.equal(tryBuy(state, ware, () => true), 'short')
    assert.equal(state.feedback.bubble, null)
  })

  it('the nearest vendor is the one who speaks', () => {
    const { state, ware, vendor } = camp({ vendorAt: [9, 5] })
    const nearer = { ...makeMonsterFromDef('norppakauppias', 6, 6), px: 6 * S + S / 2, py: 6 * S + S / 2, peaceful: true }
    state.entities.push(nearer)
    tryBuy(state, ware, () => true)
    assert.equal(state.feedback.bubble.anchorId, nearer.id)
    assert.notEqual(nearer.id, vendor.id)
  })
})
