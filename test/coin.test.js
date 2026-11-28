import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coinsOf, hasPurse, addCoins, spend, worth, offer, sell, stock, buy, cityVendor, vendorOf, vendorName, vendorNear, greeting, purseOf } from '../renderer/systems/coin.js'
import { VALUES, MARKUP, VENDORS, HOME_VENDORS, CITY_VENDORS, CITY_STALLS, FARE, PURSES, SAID, SELL_REACH } from '../renderer/data/coin.js'
import { makePlayer, weaponContents, makeRangedContents, makeWandContents, makeShieldContents, makeOutfitContents,
  WEAPON_TYPES, RANGED_WEAPON_TYPES, WAND_TYPES, SHIELD_TYPES, OUTFIT_TYPES, AMMO_CAPS } from '../renderer/systems/entities.js'
import { makeItem, addItem, itemFromContents, autoEquipOnPickup } from '../renderer/systems/inventory.js'
import { TRADE_LIST, houseSpec, houseVendors, markVendors } from '../renderer/interior/versions.js'
import { generateInterior } from '../renderer/interior/index.js'
import { JOBS, NAMED } from '../renderer/wilds/city/folk.js'
import { ACTS } from '../renderer/wilds/city/schedule.js'
import { TRADING_ACTS } from '../renderer/data/coin.js'

const S = 32
const hero = (over = {}) => ({ ...makePlayer(5, 5), px: 5 * S + S / 2, py: 5 * S + S / 2, ...over })
const blade = type => itemFromContents({ type: 'weapon', ...weaponContents(type) })
const give = (p, item) => { p.inventory.push(item); return item }
// game.js's own pickup, as far as these tests need it
const grantTo = p => contents => autoEquipOnPickup(p, itemFromContents(contents)).ok
const npc = (over = {}) => ({ type: 'npc', species: 'villager', hp: 5, hostile: false, px: 6 * S, py: 5 * S + S / 2, ...over })

describe('the purse', () => {
  it('is absent until the first coin, and then never negative', () => {
    const p = hero()
    assert.equal(hasPurse(p), false)
    assert.equal(coinsOf(p), 0)
    assert.equal(addCoins(p, 7), 7)
    assert.equal(hasPurse(p), true)
    assert.equal(spend(p, 7), true)
    assert.equal(coinsOf(p), 0)
    assert.equal(hasPurse(p), true)   // an empty purse is still a purse
  })

  it('spends only what is there, whole coins, all or nothing', () => {
    const p = hero({ coins: 5 })
    assert.equal(spend(p, 6), false)
    assert.equal(coinsOf(p), 5)
    assert.equal(spend(p, 2.5), false)
    assert.equal(spend(p, -1), false)
    assert.equal(coinsOf(p), 5)
    assert.equal(spend(p, 0), true)
    addCoins(p, -3)
    addCoins(p, NaN)
    assert.equal(coinsOf(p), 5)
  })
})

describe('what a thing is worth', () => {
  it('every piece of chest gear has a worth, and the worth names a real thing', () => {
    const tables = { weapon: WEAPON_TYPES, ranged: RANGED_WEAPON_TYPES, wand: WAND_TYPES, shield: SHIELD_TYPES, outfit: OUTFIT_TYPES }
    for (const [kind, rows] of Object.entries(VALUES)) for (const [key, v] of Object.entries(rows)) {
      assert.ok(tables[kind][key], `${kind} ${key} is in its table`)
      assert.ok(Number.isInteger(v) && v > 0, `${kind} ${key} is worth whole coin`)
    }
    for (const key of ['dagger', 'sword', 'longsword', 'axe']) assert.ok(worth(blade(key)) > 0)
    assert.equal(worth(itemFromContents(makeRangedContents('crossbow'))), VALUES.ranged.crossbow)
    assert.equal(worth(itemFromContents(makeWandContents('stormwand'))), VALUES.wand.stormwand)
    assert.equal(worth(itemFromContents(makeShieldContents('kite'))), VALUES.shield.kite)
    assert.equal(worth(itemFromContents(makeOutfitContents('leather'))), VALUES.outfit.leather)
  })

  it('nobody buys a tale\'s things, a quest\'s reward, a story outfit, food or wood', () => {
    for (const key of ['flute', 'lalli_axe', 'ukonvasara', 'maunonmiekka']) assert.equal(worth(blade(key)), 0, key)
    assert.equal(worth(itemFromContents(makeRangedContents('tervajousi'))), 0)
    for (const key of ['ranger', 'robe', 'plate']) assert.equal(worth(itemFromContents(makeOutfitContents(key))), 0, key)
    for (const kind of ['potion', 'cooked_meat', 'lumber', 'herring', 'pike_jaw', 'bread', 'turnip']) assert.equal(worth(makeItem(kind, 3)), 0, kind)
    assert.equal(worth(null), 0)
  })

  it('a smith pays in full, everyone else half, and never less than one coin', () => {
    const sword = blade('sword'), dagger = blade('dagger')
    assert.equal(offer('smith', sword), VALUES.weapon.sword)
    assert.equal(offer('innkeeper', sword), Math.floor(VALUES.weapon.sword / 2))
    assert.equal(offer('baker', dagger), 2)
    assert.ok(offer('farmer', blade('hatchet')) >= 1)
    assert.equal(offer('smith', makeItem('potion')), 0)
    assert.equal(offer('nobody', sword), 0)
  })
})

describe('selling out of the bag', () => {
  it('the thing leaves the bag and its price joins the purse', () => {
    const p = hero()
    give(p, blade('sword')); const keep = give(p, blade('dagger')); give(p, blade('sword'))
    const r = sell(p, 0, 'smith')
    assert.deepEqual({ ok: r.ok, coins: r.coins }, { ok: true, coins: 8 })
    assert.equal(coinsOf(p), 8)
    assert.equal(p.inventory.length, 2)
    assert.ok(p.inventory[0] === keep)
    assert.equal(sell(p, 1, 'innkeeper').coins, 4)
    assert.equal(coinsOf(p), 12)
  })

  it('what is not bought stays, and an empty slot sells nothing', () => {
    const p = hero()
    addItem(p, makeItem('potion', 3))
    give(p, blade('flute'))
    assert.equal(sell(p, 0, 'smith').ok, false)
    assert.equal(sell(p, 1, 'smith').ok, false)
    assert.equal(sell(p, 9, 'smith').ok, false)
    assert.equal(p.inventory.length, 2)
    assert.equal(hasPurse(p), false)
  })

  it('five spare swords at the smith buy one better blade from him', () => {
    const p = hero()
    for (let i = 0; i < 5; i++) give(p, blade('sword'))
    while (p.inventory.length) sell(p, 0, 'smith')
    const longsword = stock('smith').find(r => r.id === 'longsword')
    assert.ok(coinsOf(p) < longsword.price, 'five do not quite make it')
    give(p, blade('sword')); sell(p, 0, 'smith')
    assert.equal(buy(p, longsword, grantTo(p)), 'bought')
  })
})

describe('a vendor\'s stock', () => {
  it('every kind has a title and greetings, and every row a name and a price', () => {
    for (const [kind, v] of Object.entries(VENDORS)) {
      assert.ok(v.title, kind)
      assert.ok(v.greet.length > 0, kind)
      assert.ok(v.greet.includes(greeting(kind, () => 0.999)), kind)
      for (const row of stock(kind)) {
        assert.ok(row.label && !/undefined/.test(row.label), `${kind} ${row.id} has a name`)
        assert.ok(Number.isInteger(row.price) && row.price > 0, `${kind} ${row.id} has a price`)
        assert.ok(itemFromContents(row.contents), `${kind} ${row.id} is a thing the bag knows`)
      }
      assert.equal(stock(kind).length, v.goods.length, `${kind}: nothing dropped from the stock`)
    }
    assert.deepEqual(stock('nobody'), [])
  })

  it('gear costs MARKUP times its worth, so nothing can be bought and sold back at a gain', () => {
    for (const kind of Object.keys(VENDORS)) for (const row of stock(kind)) {
      const item = itemFromContents(row.contents)
      if (!worth(item)) continue
      assert.equal(row.price, worth(item) * MARKUP)
      assert.ok(offer('smith', item) < row.price)
    }
  })

  it('a bundle is named with its count', () => {
    assert.ok(stock('fletcher').some(r => r.label === 'Arrows ×10'))
    assert.ok(stock('provisions').some(r => r.label === 'Turnip'))
  })

  it('an innkeeper serves fare and sells no goods', () => {
    assert.deepEqual(stock('innkeeper'), [])
    assert.ok(VENDORS.innkeeper.fare === FARE)
  })
})

describe('buying', () => {
  const potion = () => stock('provisions').find(r => r.id === 'potion')

  it('takes the price and grants the thing', () => {
    const p = hero({ coins: 25 })
    assert.equal(buy(p, potion(), grantTo(p)), 'bought')
    assert.equal(coinsOf(p), 15)
    assert.equal(p.inventory[0].kind, 'potion')
  })

  it('short: nothing changes hands', () => {
    const p = hero({ coins: 9 })
    assert.equal(buy(p, potion(), grantTo(p)), 'short')
    assert.equal(coinsOf(p), 9)
    assert.equal(p.inventory.length, 0)
  })

  it('a full bag gives the price back', () => {
    const p = hero({ coins: 50, weapon: weaponContents('dagger') })   // (an empty hand would simply take it)
    for (let i = 0; i < p.maxInventory; i++) give(p, blade('dagger'))
    assert.equal(buy(p, stock('smith').find(r => r.id === 'sword'), grantTo(p)), 'full')
    assert.equal(coinsOf(p), 50)
    assert.equal(p.inventory.length, p.maxInventory)
  })

  it('is not sold what he could take nothing of: a full quiver, a coat he owns, a bow he carries', () => {
    const p = hero({ coins: 500 })
    p.ammo.arrow = AMMO_CAPS.arrow
    assert.equal(buy(p, stock('fletcher').find(r => r.id === 'arrows'), grantTo(p)), 'nothing')
    give(p, itemFromContents(makeOutfitContents('leather')))
    assert.equal(buy(p, stock('weaver')[0], grantTo(p)), 'nothing')
    p.ranged = (({ type, ...rest }) => rest)(makeRangedContents('longbow'))
    assert.equal(buy(p, stock('fletcher').find(r => r.id === 'longbow'), grantTo(p)), 'nothing')
    assert.equal(coinsOf(p), 500)
    assert.equal(buy(p, stock('fletcher').find(r => r.id === 'crossbow'), grantTo(p)), 'bought')
  })

  it('every answer has something said to it', () => {
    for (const k of ['bought', 'short', 'nothing', 'full', 'noSale', 'served', 'round']) assert.ok(SAID[k], k)
  })
})

describe('who trades', () => {
  it('a village household\'s every trade is a kind of vendor', () => {
    for (const trade of TRADE_LIST) assert.ok(VENDORS[HOME_VENDORS[trade]], trade)
  })

  it('Kalevanlinna\'s trading jobs are real jobs, their stalls real kinds and their acts real acts', () => {
    const jobs = new Set([...JOBS, ...NAMED.map(n => n.job)])
    for (const [job, kind] of Object.entries(CITY_VENDORS)) {
      assert.ok(jobs.has(job), job)
      assert.ok(kind === 'stall' || VENDORS[kind], kind)
    }
    for (const kind of CITY_STALLS) assert.ok(VENDORS[kind], kind)
    for (const act of TRADING_ACTS) assert.ok(ACTS.includes(act), act)
  })

  it('in the street they trade only while at work; at home or in the shop, always', () => {
    const baker = { id: 'p12', job: 'baker', name: 'Aino' }
    assert.equal(cityVendor(baker, { act: 'shop' }), 'baker')
    assert.equal(cityVendor(baker, { act: 'church' }), null)
    assert.equal(cityVendor(baker, { act: 'home' }), null)
    assert.equal(cityVendor(baker, { indoors: true }), 'baker')
    assert.equal(cityVendor({ id: 'p3', job: 'porter' }, { act: 'work' }), null)
    assert.equal(cityVendor(null, { act: 'work' }), null)
  })

  it('the innkeeper and the servers pour only in the inn', () => {
    const keeper = { id: 'innkeeper', job: 'innkeeper' }
    assert.equal(cityVendor(keeper, { indoors: true, inn: true }), 'innkeeper')
    assert.equal(cityVendor(keeper, { indoors: true, inn: false }), null)
    assert.equal(cityVendor(keeper, { act: 'shop' }), null)
    assert.equal(cityVendor({ id: 's1', job: 'server' }, { indoors: true, inn: true }), 'innkeeper')
  })

  it('a stallholder keeps the same stall every time, and the market has every kind of stall', () => {
    const kinds = new Set()
    for (let i = 0; i < 40; i++) {
      const p = { id: `p${i}`, job: 'stallholder' }
      const k = cityVendor(p, { act: 'stall' })
      assert.ok(CITY_STALLS.includes(k))
      assert.equal(cityVendor(p, { act: 'stall' }), k)
      kinds.add(k)
    }
    assert.equal(kinds.size, new Set(CITY_STALLS).size)
  })

  it('vendorOf reads an npc built with a trade, or one of the city\'s at work', () => {
    assert.equal(vendorOf(npc({ vendor: 'smith' })), 'smith')
    assert.equal(vendorOf(npc({ vendor: 'smith', hostile: true })), null)
    assert.equal(vendorOf(npc({ vendor: 'smith', hp: 0 })), null)
    assert.equal(vendorOf(npc({ vendor: 'dragon' })), null)
    assert.equal(vendorOf(npc()), null)
    assert.equal(vendorOf({ type: 'guard', vendor: 'smith', hp: 3 }), null)
    const seppo = npc({ city: { person: { id: 'seppo', job: 'smith', name: 'Seppo' }, entry: { act: 'work' } } })
    assert.equal(vendorOf(seppo), 'smith')
    assert.equal(vendorName(seppo), 'Seppo')
    seppo.city.entry = { act: 'church' }
    assert.equal(vendorOf(seppo), null)
    assert.equal(vendorName(npc({ vendor: 'hunter' })), 'The hunter')
    assert.equal(vendorName(npc({ vendor: 'baker', vendorName: 'Aino' })), 'Aino')
  })

  it('vendorNear finds the nearest one within reach', () => {
    const p = hero()
    const far = npc({ vendor: 'smith', px: p.px + SELL_REACH + 10, py: p.py })
    const near = npc({ vendor: 'baker', px: p.px + 40, py: p.py })
    const nearer = npc({ px: p.px + 10, py: p.py })   // trades nothing
    assert.equal(vendorNear({ player: p, entities: [far, nearer] }), null)
    assert.ok(vendorNear({ player: p, entities: [far, near, nearer] }) === near)
  })
})

describe('purses', () => {
  it('fall once from those who carry one, within their bounds', () => {
    for (const [type, [lo, hi]] of Object.entries(PURSES)) {
      for (const r of [0, 0.5, 0.999]) {
        const seq = [0, r]   // the odds roll (always dropped), then the count
        const e = { type, hp: 0 }
        const n = purseOf(e, () => seq.shift())
        assert.ok(n >= lo && n <= hi, `${type}: ${n} in ${lo}..${hi}`)
        assert.equal(purseOf(e, () => 0), 0, 'once')
      }
    }
  })

  it('nothing from the living, from beasts, or when the odds say no', () => {
    assert.equal(purseOf({ type: 'guard', hp: 2 }, () => 0), 0)
    assert.equal(purseOf({ type: 'wolf', hp: 0 }, () => 0), 0)
    const unlucky = { type: 'guard', hp: 0 }
    assert.equal(purseOf(unlucky, () => 0.99), 0)
    assert.equal(purseOf(unlucky, () => 0), 0)   // and not asked again
  })
})

describe('who trades in a house of the Wilds', () => {
  const door = (i, over = {}) => ({ x: i, y: 3, label: `house:wilds:${i},3`, tier: 'safe', story: null, toughness: 1, look: { w: 4, storeys: 1, wall: 'stone' }, ...over })

  it('a village home: the one who keeps it, in what the household makes; nobody else', () => {
    let homes = 0
    const kinds = new Set()
    for (let i = 0; i < 60; i++) {
      const spec = houseSpec(door(i), { worldSeed: 7 })
      const who = houseVendors(spec)
      const built = generateInterior(spec).entitySpawns.filter(sp => sp.vendor)
      assert.ok(built.length <= 1)
      for (const sp of built) assert.equal(who[sp.id], sp.vendor)
      if (spec.version !== 'home') { assert.deepEqual(who, {}); continue }
      homes++
      assert.deepEqual(who, { [`${spec.label}:npc0`]: HOME_VENDORS[spec.trade] })
      assert.equal(built.length, 1, 'the householder is at home')
      kinds.add(built[0].vendor)
    }
    assert.ok(homes >= 20, `${homes} homes`)
    assert.ok(kinds.size >= 5, [...kinds].join(' '))
  })

  it('a hermit in his hut keeps to himself', () => {
    for (let i = 0; i < 30; i++) assert.deepEqual(houseVendors(houseSpec(door(i, { tier: 'hut' }), { worldSeed: 7 })), {})
  })

  it('a crossroads inn: the keeper pours and buys, the guests do not', () => {
    const spec = houseSpec(door(1, { kind: 'inn', inn: { keeper: ['Beds upstairs.'], news: [] } }), { worldSeed: 7 })
    assert.deepEqual(houseVendors(spec), { 'house:wilds:1,3:keeper': 'innkeeper' })
    const people = generateInterior(spec).entitySpawns.filter(sp => sp.kind === 'npc')
    assert.deepEqual(people.filter(sp => sp.vendor).map(sp => sp.id), ['house:wilds:1,3:keeper'])
    assert.ok(people.length >= 4)
  })

  it('a house kept from before there was coin gets its trader when walked into again', () => {
    const spec = houseSpec(door(1, { kind: 'inn', inn: { keeper: ['Beds upstairs.'], news: [] } }), { worldSeed: 7 })
    const kept = [
      { type: 'npc', id: 'house:wilds:1,3:keeper', hp: 5, hostile: false },
      { type: 'npc', id: 'house:wilds:1,3:guest0', hp: 5, hostile: false },
      { type: 'floating_item', id: 'house:wilds:1,3:keeper' },
    ]
    markVendors(kept, spec)
    assert.deepEqual(kept.map(e => e.vendor ?? null), ['innkeeper', null, null])
    assert.equal(vendorOf(kept[0]), 'innkeeper')
    // one turned on the hero is left as he is
    const angry = [{ type: 'npc', id: 'house:wilds:1,3:keeper', hp: 5, hostile: true }]
    markVendors(angry, spec)
    assert.equal(angry[0].vendor, undefined)
    markVendors(null, spec)
  })
})
