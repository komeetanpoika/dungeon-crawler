import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateHUD } from '../renderer/render/hud.js'

function fakeDom() {
  const nodes = {}
  globalThis.document = { getElementById: (id) => (nodes[id] ??= { textContent: '' }) }
  return nodes
}

function state(playerOver = {}) {
  return {
    level: 1, log: ['hi'],
    player: { hp: 10, maxHp: 10, inventory: [], weapon: null, ranged: null, attackMode: 'melee', ...playerOver },
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
})
