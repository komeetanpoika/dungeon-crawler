import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gearPanel, placesFor, refusal, buttonsFor, describe as tell, moveSelection, settle, edible, GEAR_SLOTS, GEAR_ROOM } from '../renderer/ui/inventory-panel-model.js'
import { makePlayer, weaponContents, makeRangedContents, makeOutfitContents, SACK_BASE } from '../renderer/systems/entities.js'
import { makeItem, addItem, itemFromContents } from '../renderer/systems/inventory.js'
import { gearWearing } from './helpers/outfits.js'

const mk = over => ({ ...makePlayer(1, 1), ...over })
const give = (p, contents) => { const item = itemFromContents(contents); p.inventory.push(item); return item }
const blade = type => ({ type: 'weapon', ...weaponContents(type) })
const sack = i => ({ area: 'sack', index: i })
const gear = slot => ({ area: 'gear', index: GEAR_SLOTS.indexOf(slot) })

describe('gearPanel', () => {
  it('shows only the character being played: main, off, outfit and the shared belt', () => {
    const p = mk({ weapon: weaponContents('sword'), belt: weaponContents('pick'), gear: gearWearing('plate', 'ranger') })
    addItem(p, makeItem('potion', 2))
    const g = gearPanel(p)
    assert.equal(g.name, 'Warrior')
    assert.deepEqual(g.tiles.map(t => t.slot), ['main', 'off', 'outfit', 'belt'])
    assert.equal(g.tiles[0].item.payload.weaponType, 'sword')
    assert.deepEqual(g.tiles[1].item, { kind: 'consumable', item: 'potion', name: 'Potion', emoji: '🧪', count: 2 })
    assert.equal(g.tiles[2].item.payload.outfitType, 'plate')
    assert.equal(g.tiles[3].item.payload.weaponType, 'pick')
    p.attackMode = 'ranged'
    const a = gearPanel(p)
    assert.equal(a.name, 'Archer')
    assert.equal(a.tiles[0].item, null)
    assert.equal(a.tiles[3].item.payload.weaponType, 'pick')   // the belt comes along
  })
  it('there is room for eight slots and four are in use', () => {
    assert.equal(GEAR_SLOTS.length, 4)
    assert.equal(GEAR_ROOM, 8)
  })
})

describe('placesFor: where Equip puts a thing', () => {
  it('a longsword has one place, a dagger two, a hatchet three', () => {
    const p = mk({ gear: gearWearing('plate') })   // the longsword is heavy: it takes the plate
    assert.deepEqual(placesFor(p, give(p, blade('longsword'))).map(x => x.slot), ['main'])
    assert.equal(refusal(mk(), p.inventory[0]), 'Too heavy — I lack the strength.')
    assert.deepEqual(placesFor(p, give(p, blade('dagger'))).map(x => x.slot), ['main', 'off'])
    assert.deepEqual(placesFor(p, give(p, blade('hatchet'))).map(x => [x.slot, x.fn]), [['main', 'onEquip'], ['off', 'onEquipOff'], ['belt', 'onEquipBelt']])
  })
  it('food and potions go to the offhand', () => {
    const p = mk()
    assert.deepEqual(placesFor(p, makeItem('potion', 1)).map(x => [x.slot, x.fn]), [['off', 'onEquipOff']])
    assert.deepEqual(placesFor(p, makeItem('meat', 1)).map(x => x.slot), ['off'])
  })
  it('a bow is the Archer\'s: no place while the Warrior is played, the main hand once switched', () => {
    const p = mk({ gear: gearWearing('ranger') })
    const bow = give(p, makeRangedContents('shortbow'))
    assert.deepEqual(placesFor(p, bow), [])
    assert.equal(refusal(p, bow), 'The Archer carries this.')
    p.attackMode = 'ranged'
    assert.deepEqual(placesFor(p, bow).map(x => x.slot), ['main'])
    assert.equal(refusal(p, bow), null)
  })
  it('a bow with no Archer yet says why', () => {
    const p = mk()
    assert.equal(refusal(p, give(p, makeRangedContents('shortbow'))), "I don't know how to use this.")
  })
  it('an outfit can always be worn: that is how its character is opened', () => {
    const p = mk()
    const coat = give(p, makeOutfitContents('ranger'))
    assert.deepEqual(placesFor(p, coat).map(x => [x.slot, x.fn]), [['outfit', 'onEquip']])
  })
  it('a quest thing and plain lumber go nowhere', () => {
    const p = mk()
    assert.deepEqual(placesFor(p, { ...makeItem('lumber', 3) }), [])
    assert.deepEqual(placesFor(p, { ...give(p, blade('sword')), quest: true }), [])
  })
})

describe('buttonsFor', () => {
  it('a longsword in the bag: red equips, green is off, blue drops on a hold, yellow needs another character', () => {
    const p = mk({ gear: gearWearing('plate') })
    give(p, blade('longsword'))
    const b = buttonsFor(p, sack(0))
    assert.deepEqual([b.red.label, b.red.fn, b.red.places.length], ['Equip', 'onEquip', 1])
    assert.deepEqual(b.green, { label: 'Use', fn: null })
    assert.deepEqual([b.blue.fn, b.blue.hold], ['onDrop', 0.5])
    assert.equal(b.yellow.fn, null)
  })
  it('yellow switches once a second character is open', () => {
    const p = mk({ gear: gearWearing('ranger') })
    assert.equal(buttonsFor(p, sack(0)).yellow.fn, 'onSwap')
  })
  it('green eats, drinks and builds', () => {
    const p = mk()
    addItem(p, makeItem('potion', 1)); addItem(p, makeItem('meat', 2)); addItem(p, makeItem('lumber', 3)); addItem(p, makeItem('herring', 12)); addItem(p, makeItem('mushroom', 1))
    assert.deepEqual(p.inventory.map((_, i) => buttonsFor(p, sack(i)).green), [
      { label: 'Drink', fn: 'onUse' }, { label: 'Eat', fn: 'onUse' }, { label: 'Build fire', fn: 'onBuild' }, { label: 'Eat', fn: 'onUse' }, { label: 'Eat', fn: 'onUse' },
    ])
    assert.equal(edible(makeItem('herring', 1)), true)
    assert.equal(edible(makeItem('lumber', 1)), false)
  })
  it('an outfit is worn, not equipped', () => {
    const p = mk()
    give(p, makeOutfitContents('leather'))
    assert.equal(buttonsFor(p, sack(0)).red.label, 'Wear')
  })
  it('on the character: red unequips what is there, and nothing else is offered', () => {
    const p = mk({ weapon: weaponContents('sword') })
    const b = buttonsFor(p, gear('main'))
    assert.deepEqual([b.red.label, b.red.fn, b.red.slot], ['Unequip', 'onUnequip', 'main'])
    assert.equal(b.green.fn, null)
    assert.equal(b.blue.fn, null)
    assert.equal(buttonsFor(p, gear('belt')).red.fn, null)
    assert.equal(buttonsFor(p, gear('off')).red.label, 'Clear')   // the potion pointer
    p.gear.melee.off = null
    assert.equal(buttonsFor(p, gear('off')).red.fn, null)
  })
  it('an empty bag offers nothing but the switch', () => {
    const p = mk()
    const b = buttonsFor(p, sack(0))
    assert.deepEqual([b.red.fn, b.green.fn, b.blue.fn], [null, null, null])
  })
})

describe('describe', () => {
  it('names the thing, its numbers and why it cannot be equipped', () => {
    const p = mk()
    give(p, blade('sword')); addItem(p, makeItem('meat', 4)); give(p, makeRangedContents('shortbow'))
    const sword = tell(p, sack(0))
    assert.equal(sword.title, 'Sword')
    assert.ok(sword.lines.some(l => /damage/.test(l)))
    assert.equal(tell(p, sack(1)).title, 'Meat ×4')
    assert.deepEqual(tell(p, sack(1)).lines, ['Heals 1.'])
    assert.equal(tell(p, sack(2)).warn, "I don't know how to use this.")
  })
  it('an empty slot on the character says so', () => {
    assert.deepEqual(tell(mk(), gear('main')), { title: 'Main', lines: ['Nothing here.'] })
  })
})

describe('moveSelection', () => {
  const c = { sack: 12, cols: 8 }
  it('moves about the bag and stops at its edges', () => {
    assert.deepEqual(moveSelection(sack(0), 'ArrowRight', c), sack(1))
    assert.deepEqual(moveSelection(sack(11), 'ArrowRight', c), sack(11))
    assert.deepEqual(moveSelection(sack(2), 'ArrowDown', c), sack(10))
    assert.deepEqual(moveSelection(sack(6), 'ArrowDown', c), sack(11))   // the last row is short: its last thing
    assert.deepEqual(moveSelection(sack(10), 'ArrowDown', c), sack(10))
    assert.deepEqual(moveSelection(sack(10), 'ArrowUp', c), sack(2))
    assert.deepEqual(moveSelection(sack(2), 'ArrowUp', c), sack(2))
  })
  it('left from the first column goes to the gear, right from the gear comes back to that row', () => {
    const g = moveSelection(sack(8), 'ArrowLeft', c)
    assert.deepEqual([g.area, g.index], ['gear', 3])
    assert.deepEqual(moveSelection(g, 'ArrowRight', c), sack(8))
    const left = moveSelection(g, 'ArrowLeft', c)
    assert.deepEqual([left.area, left.index], ['gear', 2])
    assert.equal(moveSelection({ area: 'gear', index: 0 }, 'ArrowLeft', c).index, 0)
    assert.equal(moveSelection({ area: 'gear', index: 1 }, 'ArrowUp', c).index, 1)
  })
  it('with an empty bag the cursor stays on the gear', () => {
    assert.deepEqual(moveSelection({ area: 'gear', index: 3 }, 'ArrowRight', { sack: 0, cols: 8 }), { area: 'gear', index: 3 })
    assert.deepEqual(settle(sack(0), 0), { area: 'gear', index: 0 })
    assert.deepEqual(settle(sack(5), 3), sack(2))
  })
  it('a narrower grid moves by its own width', () => {
    assert.deepEqual(moveSelection(sack(1), 'ArrowDown', { sack: 12, cols: 5 }), sack(6))
    assert.equal(moveSelection(sack(5), 'ArrowLeft', { sack: 12, cols: 5 }).area, 'gear')
  })
})

describe('the bag holds 24', () => {
  it('a new player has 24 slots, and bonus slots come on top', () => {
    assert.equal(SACK_BASE, 24)
    assert.equal(makePlayer(1, 1).maxInventory, 24)
    assert.equal(makePlayer(1, 1, ['extra_slot', 'extra_slot']).maxInventory, 26)
  })
})

describe('beside a vendor the bag sells', () => {
  const smith = { kind: 'smith', name: 'Seppo' }, inn = { kind: 'innkeeper', name: 'The innkeeper' }

  it('Drop becomes Sell for what the vendor buys, with what they pay', () => {
    const p = mk()
    give(p, blade('sword'))
    addItem(p, makeItem('potion', 2))
    assert.deepEqual(buttonsFor(p, sack(0)).blue, { label: 'Drop', fn: 'onDrop', hold: 0.5 })
    assert.deepEqual(buttonsFor(p, sack(0), { buyer: smith }).blue, { label: 'Sell for 8', fn: 'onSell', hold: 0.5, coins: 8 })
    assert.equal(buttonsFor(p, sack(0), { buyer: inn }).blue.label, 'Sell for 4')
    // a potion is not bought: it can still be dropped
    assert.equal(buttonsFor(p, sack(1), { buyer: smith }).blue.fn, 'onDrop')
    // the other buttons are as ever
    assert.equal(buttonsFor(p, sack(0), { buyer: smith }).red.label, 'Equip')
  })

  it('a tale\'s flute is never sold, and gear on the body is not for sale from there', () => {
    const p = mk({ weapon: weaponContents('axe') })
    give(p, blade('flute'))
    assert.equal(buttonsFor(p, sack(0), { buyer: smith }).blue.fn, 'onDrop')
    assert.equal(buttonsFor(p, gear('main'), { buyer: smith }).blue.fn, null)
  })

  it('the description says what it fetches: from the vendor at hand, or from a smith once coin is known', () => {
    const p = mk()
    give(p, blade('sword'))
    addItem(p, makeItem('potion', 2))
    assert.equal(tell(p, sack(0)).lines.some(l => /coin/.test(l)), false)   // a hero who never met coin is told nothing
    assert.ok(tell(p, sack(0), { buyer: smith }).lines.includes('Seppo pays 8 coin.'))
    assert.ok(tell(p, sack(1), { buyer: smith }).lines.includes('Seppo does not buy this.'))
    p.coins = 0
    assert.ok(tell(p, sack(0)).lines.includes('Worth 8 coin to a smith.'))
    assert.equal(tell(p, sack(1)).lines.some(l => /coin/.test(l)), false)
  })
})
