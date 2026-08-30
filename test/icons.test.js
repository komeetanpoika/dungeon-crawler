import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { iconSpriteFor, iconSrcFor } from '../renderer/render/icons.js'
import { SPRITES } from '../renderer/render/sprites.js'

describe('iconSpriteFor', () => {
  it('maps consumables by kind', () => {
    assert.equal(iconSpriteFor({ kind: 'potion' }), 'potion')
    assert.equal(iconSpriteFor({ kind: 'mushroom' }), 'ow_mushroom')
    assert.equal(iconSpriteFor({ kind: 'meat' }), 'item_meat')
    assert.equal(iconSpriteFor({ kind: 'cooked_meat' }), 'item_meat_cooked')
    assert.equal(iconSpriteFor({ kind: 'lumber' }), 'item_lumber')
  })
  it('maps quest items by kind', () => {
    assert.equal(iconSpriteFor({ kind: 'clapper' }), 'item_clapper')
    assert.equal(iconSpriteFor({ kind: 'fleece' }), 'item_fleece')
  })
  it('maps weapons by payload weaponType', () => {
    assert.equal(iconSpriteFor({ kind: 'weapon', payload: { weaponType: 'axe' } }), 'weapon_axe')
    assert.equal(iconSpriteFor({ kind: 'ranged', payload: { weaponType: 'longbow' } }), 'weapon_longbow')
  })
  it('falls back to sword/shortbow for unknown weapon types', () => {
    assert.equal(iconSpriteFor({ kind: 'weapon', payload: { weaponType: 'nonsense' } }), 'weapon_sword')
    assert.equal(iconSpriteFor({ kind: 'ranged', payload: {} }), 'weapon_shortbow')
  })
  it('returns null for unknown kinds and missing items', () => {
    assert.equal(iconSpriteFor({ kind: 'key' }), null)
    assert.equal(iconSpriteFor(null), null)
  })
  it('every mappable sprite key resolves to a file in the atlas or itself', () => {
    for (const key of ['weapon_dagger', 'weapon_sword', 'weapon_longsword', 'weapon_axe',
      'weapon_club', 'weapon_maunonmiekka', 'weapon_shortbow', 'weapon_longbow',
      'weapon_sparkwand', 'weapon_stormwand', 'potion']) {
      assert.ok(SPRITES[key], `SPRITES lacks ${key}`)
    }
  })
})

describe('iconSrcFor', () => {
  it('builds the tile path through the SPRITES file map', () => {
    assert.equal(iconSrcFor({ kind: 'potion' }), `./assets/tiles/${SPRITES.potion}.png`)
  })
  it('uses the key itself when SPRITES has no entry (file-named sprites)', () => {
    const src = iconSrcFor({ kind: 'mushroom' })
    assert.ok(src === `./assets/tiles/${SPRITES.ow_mushroom ?? 'ow_mushroom'}.png`)
  })
  it('returns null when there is no icon', () => {
    assert.equal(iconSrcFor({ kind: 'key' }), null)
  })
})
