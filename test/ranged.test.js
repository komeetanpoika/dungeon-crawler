import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RANGED_WEAPON_TYPES, makeRangedContents, makePlayer } from '../renderer/systems/entities.js'

describe('RANGED_WEAPON_TYPES', () => {
  it('defines the four-weapon roster with full stat blocks', () => {
    assert.deepEqual(Object.keys(RANGED_WEAPON_TYPES), ['shortbow', 'longbow', 'sparkwand', 'stormwand'])
    for (const [wt, def] of Object.entries(RANGED_WEAPON_TYPES)) {
      assert.equal(typeof def.name, 'string', wt)
      assert.ok(def.damage > 0 && def.maxAmmo > 0 && def.cooldown > 0, wt)
      assert.match(def.color, /^#[0-9a-f]{6}$/, wt)
      assert.ok(def.kind === 'bow' || def.kind === 'wand', wt)
    }
  })

  it('bows are bows and wands are wands', () => {
    assert.equal(RANGED_WEAPON_TYPES.shortbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.longbow.kind, 'bow')
    assert.equal(RANGED_WEAPON_TYPES.sparkwand.kind, 'wand')
    assert.equal(RANGED_WEAPON_TYPES.stormwand.kind, 'wand')
  })
})

describe('makeRangedContents', () => {
  it('builds full-ammo chest contents from a weapon type', () => {
    const c = makeRangedContents('stormwand')
    assert.deepEqual(c, {
      type: 'ranged', weaponType: 'stormwand', name: 'Storm Wand',
      damage: 5, ammo: 6, maxAmmo: 6, cooldown: 0.8, color: '#a78bfa', kind: 'wand',
    })
  })

  it('falls back to shortbow for unknown types', () => {
    assert.equal(makeRangedContents('bazooka').weaponType, 'shortbow')
    assert.equal(makeRangedContents().weaponType, 'shortbow')
  })
})

describe('makePlayer ranged fields', () => {
  it('starts with no ranged weapon, in melee stance', () => {
    const p = makePlayer(1, 1)
    assert.equal(p.ranged, null)
    assert.equal(p.attackMode, 'melee')
  })
})
