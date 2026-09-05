import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateHUD } from '../renderer/render/hud.js'

function fakeDom() {
  const nodes = {}
  globalThis.document = { getElementById: (id) => (nodes[id] ??= { textContent: '', style: {}, dataset: {}, innerHTML: '' }) }
  return nodes
}

function state(playerOver = {}) {
  return {
    level: 1, log: ['hi'],
    player: {
      hp: 10, maxHp: 10, stamina: 100, maxStamina: 100, inventory: [], weapon: null, ranged: null, attackMode: 'melee',
      talents: ['ranged_stance', 'magic_stance'],
      ...playerOver,
    },
  }
}

describe('updateHUD hearts', () => {
  const hearts = nodes => [...nodes['hud-hearts'].innerHTML.matchAll(/data-state="(\w+)"/g)].map(m => m[1])
  it('renders maxHp/2 hearts, half a heart per hitpoint', () => {
    const nodes = fakeDom()
    updateHUD(state({ hp: 7, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['full', 'full', 'full', 'half', 'empty'])
  })
  it('full and empty extremes', () => {
    const nodes = fakeDom()
    updateHUD(state({ hp: 10, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['full', 'full', 'full', 'full', 'full'])
    updateHUD(state({ hp: 0, maxHp: 10 }))
    assert.deepEqual(hearts(nodes), ['empty', 'empty', 'empty', 'empty', 'empty'])
  })
})

describe('updateHUD consumable slot', () => {
  it('shows the next-up item icon with count and publishes the badge attribute', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }] }))
    assert.match(nodes['hud-consumable'].innerHTML, /assets\/tiles\/.*\.png/)
    assert.match(nodes['hud-consumable'].innerHTML, /×3/)
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '🧪')
  })
  it('empty sack renders a dimmed placeholder icon and clears the badge', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.match(nodes['hud-consumable'].innerHTML, /assets\/tiles\/.*\.png/)
    assert.match(nodes['hud-consumable'].innerHTML, /hud-icon-empty/)
    assert.doesNotMatch(nodes['hud-consumable'].innerHTML, /hud-count/)
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '')
  })
})

describe('updateHUD ammo slot', () => {
  const wand = { weaponType: 'sparkwand', name: 'Spark Wand', ammo: 9, maxAmmo: 16, kind: 'wand' }
  it('stays hidden with nothing in the ranged hand', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-ammo'].hidden, true)
  })
  it('shows the equipped weapon icon with its ammo count', () => {
    const nodes = fakeDom()
    updateHUD(state({ ranged: wand }))
    assert.equal(nodes['hud-ammo'].hidden, false)
    assert.match(nodes['hud-ammo'].innerHTML, /assets\/tiles\/tile_0130\.png/)
    assert.match(nodes['hud-ammo'].innerHTML, /×9/)
    assert.doesNotMatch(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
  })
  it('dims the icon when the weapon is out of ammo and flags the ranged stance', () => {
    const nodes = fakeDom()
    updateHUD(state({ ranged: { ...wand, ammo: 0 }, attackMode: 'ranged' }))
    assert.match(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
    assert.match(nodes['hud-ammo'].innerHTML, /×0/)
    assert.equal(nodes['hud-ammo'].dataset.active, '1')
    updateHUD(state({ ranged: wand, attackMode: 'melee' }))
    assert.equal(nodes['hud-ammo'].dataset.active, '')
  })
})

describe('updateHUD stamina bar', () => {
  it('fills proportionally', () => {
    const nodes = fakeDom()
    updateHUD(state({ stamina: 45, maxStamina: 100 }))
    assert.equal(nodes['hud-stamina-fill'].style.width, '45%')
  })
  it('flags the refusal flash while staminaRefusedT is live', () => {
    const nodes = fakeDom()
    updateHUD(state({ staminaRefusedT: 0.3 }))
    assert.equal(nodes['hud-stamina'].dataset.refused, '1')
    updateHUD(state({ staminaRefusedT: 0 }))
    assert.equal(nodes['hud-stamina'].dataset.refused, '')
  })
})
