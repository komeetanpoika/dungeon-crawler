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

describe('updateHUD weapon slot', () => {
  it('shows the active stance weapon only', () => {
    const nodes = fakeDom()
    updateHUD(state({ weapon: { name: 'Sword', damage: 2 },
      ranged: { name: 'Shortbow', damage: 2, ammo: 8, maxAmmo: 12 }, attackMode: 'ranged' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Shortbow 8/12')
  })
  it('melee shows name and damage; unarmed says so; magic says Gust', () => {
    const nodes = fakeDom()
    updateHUD(state({ weapon: { name: 'Axe', damage: 4 }, attackMode: 'melee' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Axe (4 dmg)')
    updateHUD(state({ attackMode: 'melee' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Unarmed')
    updateHUD(state({ attackMode: 'magic' }))
    assert.equal(nodes['hud-weapon-slot'].textContent, 'Gust')
  })
})

describe('updateHUD consumable slot', () => {
  it('shows next-up emoji with count and publishes the badge attribute', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }] }))
    assert.equal(nodes['hud-consumable'].textContent, '🧪×3')
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '🧪')
  })
  it('empty sack shows a dash and clears the badge', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-consumable'].textContent, '—')
    assert.equal(nodes['hud-consumable'].dataset.quickEmoji, '')
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
