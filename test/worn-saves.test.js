// Worn pieces in saves: slots rebuilt from the table on every load, the one
// step that turns an old save's plate, Leather Coat and Ski-legs into the
// pieces that took their place, and the kits and tables that hand pieces out.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBody, normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { migrateToWorn, RUSH_START_WORN, BOSS_DROP_WORN } from '../renderer/systems/outfits.js'
import { applyLoadout } from '../renderer/systems/loadout.js'
import { TALENTS, RUSH_START_TALENTS } from '../renderer/systems/talents.js'
import { defaultGear, makePlayer, makeWornContents, makeOutfitContents, WORN_TYPES, WORN_SLOTS } from '../renderer/systems/entities.js'
import { itemFromContents } from '../renderer/systems/inventory.js'
import { armorMax } from '../renderer/systems/worn.js'

const body = (over = {}) => ({ weapon: null, ranged: null, wand: null, ammo: { arrow: 0, bolt: 0, stone: 0 }, inventory: [], gear: defaultGear(), belt: null, ...over })
const worn = key => { const { type, ...p } = makeWornContents(key); return p }
const outfit = key => { const { type, ...p } = makeOutfitContents(key); return p }
const save = (b, talents = [], flags = { v6: true, v7: true, v8: true }) =>
  ({ caves: {}, progress: { mapDepth: 12, cleared: {}, visited: [] }, talents, body: b, gates: {}, npcs: {}, felled: {}, leaps: {}, quests: {}, clock: 0, ...flags })

describe('worn slots on load', () => {
  it('are rebuilt from the table by key', () => {
    const b = body()
    b.gear.melee.armor = { gearType: 'chain', name: 'Old Mail', armor: 99 }
    b.gear.magic.ring = { gearType: 'breath' }
    const n = normalizeBody(b)
    assert.deepEqual(n.gear.melee.armor, worn('chain'))
    assert.deepEqual(n.gear.magic.ring, worn('breath'))
    assert.deepEqual(normalizeBody(n), n)
  })
  it('a key the table does not know, or one of another slot, leaves the slot bare', () => {
    const b = body()
    b.gear.melee.head = { gearType: 'crown' }
    b.gear.melee.boots = { gearType: 'helm' }
    const n = normalizeBody(b)
    assert.equal(n.gear.melee.head, null)
    assert.equal(n.gear.melee.boots, null)
  })
  it('a body from before the slots has them, empty', () => {
    const old = body({ gear: { melee: { off: null, outfit: null }, ranged: { off: null, outfit: null }, magic: { off: null, outfit: null } } })
    const n = normalizeBody(old)
    for (const stance of ['melee', 'ranged', 'magic']) for (const slot of WORN_SLOTS) assert.equal(n.gear[stance][slot], null)
  })
  it('bag pieces are rebuilt too, and unknown ones dropped', () => {
    const n = normalizeBody(body({ inventory: [
      { kind: 'boots', name: 'Old Boots', stackable: false, payload: { gearType: 'elk', sprintMul: 0.1 } },
      { kind: 'ring', name: 'Ring of Nothing', stackable: false, payload: { gearType: 'nothing' } },
    ] }))
    assert.equal(n.inventory.length, 1)
    assert.deepEqual(n.inventory[0].payload, worn('elk'))
    assert.equal(n.inventory[0].name, 'Elk-hide Boots')
  })
  it('a save wearing every slot comes back as it went', () => {
    const b = body()
    b.gear.melee = { ...b.gear.melee, outfit: outfit('plate'), head: worn('helm'), armor: worn('plate'), boots: worn('ironshod'), ring: worn('smith') }
    b.gear.ranged = { ...b.gear.ranged, outfit: outfit('ranger'), head: worn('cloth'), armor: worn('leather'), boots: worn('elk'), ring: worn('miser') }
    const once = normalizeAdventureSave(save(b, [], { v6: true, v7: true, v8: true, v9: true }))
    assert.deepEqual(once.body.gear, b.gear)
    assert.deepEqual(normalizeAdventureSave(structuredClone(once)), once)
  })
})

describe('the Leather Coat in an old save', () => {
  const coat = { outfitType: 'leather', name: 'Leather Coat', loadout: null, protect: 1 }
  it('worn by the Warrior, is the Leather Jerkin on him', () => {
    const b = body(); b.gear.melee.outfit = { ...coat }
    const n = normalizeBody(b)
    assert.equal(n.gear.melee.outfit, null)
    assert.deepEqual(n.gear.melee.armor, worn('leather'))
    assert.equal(armorMax({ gear: n.gear }), 2)
    assert.deepEqual(normalizeBody(n), n)
  })
  it('in the bag, is a Leather Jerkin there', () => {
    const n = normalizeBody(body({ inventory: [{ kind: 'outfit', name: 'Leather Coat', stackable: false, payload: { ...coat } }] }))
    assert.deepEqual(n.inventory.map(i => [i.kind, i.payload.gearType]), [['armor', 'leather']])
  })
  it('a story outfit in the bag is left as it is', () => {
    const robe = itemFromContents(makeOutfitContents('robe'))
    assert.deepEqual(normalizeBody(body({ inventory: [robe] })).inventory, [robe])
  })
})

describe('the step that turns old power into pieces (v9)', () => {
  it('Ski-legs is a pair of Elk-hide Boots on the Warrior, and no talent', () => {
    const s = normalizeAdventureSave(save(body(), ['ski_legs', 'lake_breath']))
    assert.deepEqual(s.talents, ['lake_breath'])
    assert.deepEqual(s.body.gear.melee.boots, worn('elk'))
    assert.equal(s.body.gear.ranged.boots, null)
    assert.equal(s.body.gear.magic.boots, null)
    assert.equal(s.v9, true)
  })
  it('plate on the Warrior stays, as the tabard, with a Plate Cuirass under it', () => {
    const b = body(); b.gear.melee.outfit = { outfitType: 'plate', name: 'Plated Armor', loadout: 'melee', protect: 2, heavy: true, sprintDrain: 2 }
    const s = normalizeAdventureSave(save(b))
    assert.equal(s.body.gear.melee.outfit.name, "Knight's Tabard")
    assert.equal(s.body.gear.melee.outfit.heavy, true)
    assert.deepEqual(s.body.gear.melee.armor, worn('plate'))
  })
  it('happens once: a second load mints nothing', () => {
    const b = body(); b.gear.melee.outfit = outfit('plate')
    const once = normalizeAdventureSave(save(b, ['ski_legs']))
    const twice = normalizeAdventureSave(structuredClone(once))
    assert.deepEqual(twice, once)
    // and a cuirass taken off since stays off
    once.body.gear.melee.armor = null
    assert.equal(normalizeAdventureSave(structuredClone(once)).body.gear.melee.armor, null)
  })
  it('a v7 save goes all the way: talents to outfits, then to pieces', () => {
    const v7 = save({ weapon: null, ranged: null, wand: null, ammo: { arrow: 0, bolt: 0, stone: 0 }, inventory: [] },
      ['heavy_weapons', 'ski_legs'], { v6: true, v7: true })
    const s = normalizeAdventureSave(v7)
    assert.deepEqual(s.talents, [])
    assert.equal(s.body.gear.melee.outfit.outfitType, 'plate')
    assert.equal(s.body.gear.melee.armor.gearType, 'plate')
    assert.equal(s.body.gear.melee.boots.gearType, 'elk')
  })
  it('Ski-legs with no body yet conjures one to wear the boots', () => {
    const s = normalizeAdventureSave({ caves: {}, progress: { mapDepth: 7, cleared: {} }, talents: ['ski_legs'], body: null })
    assert.equal(s.body.gear.melee.boots.gearType, 'elk')
    assert.deepEqual(s.talents, [])
  })
  it('a fresh save and a save with nothing to turn are left alone', () => {
    assert.equal(normalizeAdventureSave(null).body, null)
    assert.equal(normalizeAdventureSave(null).v9, true)
    const b = body(), t = ['lake_breath']
    const m = migrateToWorn(b, t)
    assert.ok(m.body === b)
    assert.ok(m.talents === t)
  })
  it('a slot already taken sends the piece to the bag', () => {
    const b = body(); b.gear.melee.boots = worn('ironshod')
    const m = migrateToWorn(b, ['ski_legs'])
    assert.equal(m.body.gear.melee.boots.gearType, 'ironshod')
    assert.deepEqual(m.body.inventory.map(i => [i.kind, i.payload.gearType]), [['boots', 'elk']])
    assert.equal(b.inventory.length, 0, 'the body handed in is not changed')
  })
})

describe('tables that hand pieces out', () => {
  it('Ski-legs is no talent any more, and a Rush run starts with none', () => {
    assert.equal('ski_legs' in TALENTS, false)
    assert.deepEqual([...RUSH_START_TALENTS], [])
  })
  it('a Rush run wears a cuirass on the Warrior and elk boots on all three', () => {
    assert.deepEqual(RUSH_START_WORN, { melee: { armor: 'plate', boots: 'elk' }, ranged: { boots: 'elk' }, magic: { boots: 'elk' } })
  })
  it('the cyclops drops a Plate Cuirass beside the tabard', () => {
    assert.deepEqual(BOSS_DROP_WORN, { cyclops: 'plate' })
    for (const key of Object.values(BOSS_DROP_WORN)) assert.ok(WORN_TYPES[key], key)
  })
})

describe('a kit may dress its characters (applyLoadout `worn`)', () => {
  it('by table key, each piece on the character named', () => {
    const p = makePlayer(1, 1)
    applyLoadout(p, { worn: RUSH_START_WORN })
    assert.deepEqual(p.gear.melee.armor, worn('plate'))
    assert.deepEqual(p.gear.melee.boots, worn('elk'))
    assert.deepEqual(p.gear.ranged.boots, worn('elk'))
    assert.equal(p.gear.ranged.armor, null)
    applyLoadout(p, { worn: { magic: { head: 'cap', ring: 'breath' } } })
    assert.deepEqual([p.gear.magic.head.gearType, p.gear.magic.ring.gearType, p.gear.magic.boots.gearType], ['cap', 'breath', 'elk'])
  })
  it('skips, with a warning, a key it does not know or one named for the wrong slot', () => {
    const p = makePlayer(1, 1), warnings = []
    applyLoadout(p, { worn: { melee: { head: 'crown', boots: 'helm' }, sideways: { head: 'cap' } } }, w => warnings.push(w))
    assert.equal(p.gear.melee.head, null)
    assert.equal(p.gear.melee.boots, null)
    assert.equal(warnings.length, 3)
  })
})
