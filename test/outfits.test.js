import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RETIRED_TALENT_OUTFITS, MAP_CLEAR_OUTFITS, BOSS_DROP_OUTFITS, RUSH_START_OUTFITS,
  wearOutfit, ownsOutfit, migrateTalentsToOutfits, outfitToast, OUTFIT_TOAST_LINES,
} from '../renderer/systems/outfits.js'
import { makeOutfitContents, makePlayer, OUTFIT_TYPES, emptyAmmo } from '../renderer/systems/entities.js'
import { itemFromContents, loadoutAvailable } from '../renderer/systems/inventory.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const payload = ot => { const { type, ...p } = makeOutfitContents(ot); return p }

describe('sources', () => {
  it('every source names a real outfit', () => {
    const all = [...Object.values(RETIRED_TALENT_OUTFITS), ...Object.values(MAP_CLEAR_OUTFITS),
      ...Object.values(BOSS_DROP_OUTFITS), ...RUSH_START_OUTFITS]
    for (const ot of all) assert.ok(OUTFIT_TYPES[ot], ot)
  })
  it('the three retired talents map to the three story outfits, and rush wears all three', () => {
    assert.deepEqual(RETIRED_TALENT_OUTFITS, { ranged_stance: 'ranger', magic_stance: 'robe', heavy_weapons: 'plate' })
    assert.deepEqual([...RUSH_START_OUTFITS].sort(), ['plate', 'ranger', 'robe'])
    assert.equal(MAP_CLEAR_OUTFITS['forest-1-clearings'], 'ranger')
    assert.equal(BOSS_DROP_OUTFITS.cyclops, 'plate')
  })
})

describe('wearOutfit / ownsOutfit', () => {
  it('wears into the outfit’s own loadout when empty and opens it', () => {
    const p = makePlayer(1, 1)
    assert.equal(wearOutfit(p, payload('ranger')), true)
    assert.equal(p.gear.ranged.outfit.outfitType, 'ranger')
    assert.equal(loadoutAvailable(p, 'ranged'), true)
    assert.equal(wearOutfit(p, payload('ranger')), false)   // slot taken
  })
  it('a leather coat goes to the named stance, defaulting to the active one', () => {
    const p = { ...makePlayer(1, 1), attackMode: 'magic' }
    assert.equal(wearOutfit(p, payload('leather')), true)
    assert.equal(p.gear.magic.outfit.outfitType, 'leather')
    const q = makePlayer(1, 1)
    assert.equal(wearOutfit(q, payload('leather'), 'ranged'), true)
    assert.equal(q.gear.ranged.outfit.outfitType, 'leather')
  })
  it('refuses to wear a loadout-bound outfit into another loadout', () => {
    const p = makePlayer(1, 1)
    assert.equal(wearOutfit(p, payload('robe'), 'melee'), false)
    assert.equal(p.gear.melee.outfit, null)
  })
  it('ownsOutfit sees worn and sacked outfits', () => {
    const p = makePlayer(1, 1)
    assert.equal(ownsOutfit(p, 'plate'), false)
    wearOutfit(p, payload('plate'))
    assert.equal(ownsOutfit(p, 'plate'), true)
    const q = makePlayer(1, 1)
    q.inventory.push(itemFromContents(makeOutfitContents('robe')))
    assert.equal(ownsOutfit(q, 'robe'), true)
    assert.equal(ownsOutfit({}, 'robe'), false)
  })
})

describe('migrateTalentsToOutfits', () => {
  it('turns retired talents into worn outfits and keeps the rest', () => {
    const { body, talents } = migrateTalentsToOutfits(null, ['magic_stance', 'ski_legs', 'heavy_weapons'])
    assert.deepEqual(talents, ['ski_legs'])
    assert.equal(body.gear.magic.outfit.outfitType, 'robe')
    assert.equal(body.gear.melee.outfit.outfitType, 'plate')
    assert.equal(body.gear.ranged.outfit, null)
    assert.deepEqual(body.ammo, emptyAmmo())
    assert.deepEqual(body.inventory, [])
  })
  it('is a no-op on a current save', () => {
    const cur = { weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: makePlayer(1, 1).gear, belt: null }
    const r = migrateTalentsToOutfits(cur, ['ski_legs'])
    assert.deepEqual(r, { body: cur, talents: ['ski_legs'] })
    assert.equal(migrateTalentsToOutfits(null, []).body, null)
  })
  it('never overwrites an outfit already worn', () => {
    const body = { weapon: null, ranged: null, wand: null, ammo: emptyAmmo(), inventory: [], gear: makePlayer(1, 1).gear, belt: null }
    body.gear.melee.outfit = payload('leather')
    const r = migrateTalentsToOutfits(body, ['heavy_weapons'])
    assert.equal(r.body.gear.melee.outfit.outfitType, 'leather')
    assert.deepEqual(r.talents, [])
  })
})

describe('outfitToast', () => {
  it('queues the toast and the learned cue', () => {
    const state = { feedback: makeFeedback(), sfx: makeSfx() }
    outfitToast(state, payload('ranger'))
    assert.deepEqual(state.feedback.toasts, [{ title: 'Outfit found', lines: [OUTFIT_TOAST_LINES.ranger] }])
    assert.deepEqual(state.sfx.cues.map(c => c.name), ['talent-learned'])
  })
  it('has a line for every outfit', () => {
    for (const ot of Object.keys(OUTFIT_TYPES)) assert.ok(OUTFIT_TOAST_LINES[ot], ot)
  })
})
