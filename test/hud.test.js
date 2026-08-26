import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateHUD } from '../renderer/render/hud.js'

function fakeDom() {
  const nodes = {}
  globalThis.document = { getElementById: (id) => (nodes[id] ??= { textContent: '', style: {}, dataset: {} }) }
  return nodes
}

function state(playerOver = {}) {
  return {
    level: 1, log: ['hi'],
    player: {
      hp: 10, maxHp: 10, inventory: [], weapon: null, ranged: null, attackMode: 'melee',
      talents: ['ranged_stance', 'magic_stance'],
      ...playerOver,
    },
  }
}

describe('updateHUD stance slots', () => {
  it('marks the melee slot active and shows a ranged placeholder', () => {
    const nodes = fakeDom()
    updateHUD(state())
    assert.equal(nodes['hud-weapon'].textContent, '▶ Unarmed')
    assert.equal(nodes['hud-ranged'].textContent, 'No ranged weapon')
  })

  it('marks the ranged slot active and shows the ammo count', () => {
    const nodes = fakeDom()
    updateHUD(state({
      weapon: { name: 'Sword', damage: 2 },
      ranged: { name: 'Shortbow', damage: 2, ammo: 8, maxAmmo: 12 },
      attackMode: 'ranged',
    }))
    assert.equal(nodes['hud-weapon'].textContent, 'Sword (2 dmg)')
    assert.equal(nodes['hud-ranged'].textContent, '▶ Shortbow (2 dmg) 8/12')
  })

  it('hides the ranged and magic slots until their talents are learned', () => {
    const nodes = fakeDom()
    const s = state({ talents: [] })
    updateHUD(s)
    assert.equal(nodes['hud-ranged'].style.display, 'none')
    assert.equal(nodes['hud-magic'].style.display, 'none')

    s.player.talents = ['ranged_stance', 'magic_stance']
    updateHUD(s)
    assert.equal(nodes['hud-ranged'].style.display, '')
    assert.equal(nodes['hud-magic'].style.display, '')
  })

  it('publishes the quick-use badge (next-up emoji + combined count) as data attributes', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [
      { kind: 'potion', emoji: '🧪', stackable: true, count: 2 },
      { kind: 'mushroom', emoji: '🍄', stackable: true, count: 3 },
    ] }))
    assert.equal(nodes['hud-items'].dataset.quickEmoji, '🧪')
    assert.equal(nodes['hud-items'].dataset.quickCount, '5')
  })

  it('clears the quick-use badge data when no consumables remain', () => {
    const nodes = fakeDom()
    updateHUD(state({ inventory: [{ kind: 'weapon', emoji: '⚔', stackable: false }] }))
    assert.equal(nodes['hud-items'].dataset.quickEmoji, '')
    assert.equal(nodes['hud-items'].dataset.quickCount, '')
  })

  it('defaults to hiding both slots when talents is absent', () => {
    const nodes = fakeDom()
    const s = state()
    delete s.player.talents
    updateHUD(s)
    assert.equal(nodes['hud-ranged'].style.display, 'none')
    assert.equal(nodes['hud-magic'].style.display, 'none')
  })
})
