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
      hp: 10, maxHp: 10, stamina: 100, maxStamina: 100, inventory: [], weapon: null, ranged: null, wand: null,
      ammo: { arrow: 0, bolt: 0, stone: 0 }, attackMode: 'melee',
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

describe('updateHUD tool slot', () => {
  // #hud-ammo is the shared "tool" slot: which hand it shows follows the
  // stance (magic -> wand, ranged/melee -> bow), not merely what's carried.
  const bow = { weaponType: 'shortbow', name: 'Shortbow', ammoKind: 'arrow' }
  const wand = { weaponType: 'sparkwand', name: 'Spark Wand' }

  it('stays hidden in ranged/melee stance with no bow in hand', () => {
    const nodes = fakeDom()
    updateHUD(state({ attackMode: 'melee' }))
    assert.equal(nodes['hud-ammo'].hidden, true)
    updateHUD(state({ attackMode: 'ranged' }))
    assert.equal(nodes['hud-ammo'].hidden, true)
  })
  it('stays hidden in magic stance with no wand in hand', () => {
    const nodes = fakeDom()
    updateHUD(state({ attackMode: 'magic', wand: null }))
    assert.equal(nodes['hud-ammo'].hidden, true)
  })
  it('shows the bow with the pooled ammo count in ranged stance', () => {
    const nodes = fakeDom()
    updateHUD(state({ ranged: bow, ammo: { arrow: 9, bolt: 0, stone: 0 }, attackMode: 'ranged' }))
    assert.equal(nodes['hud-ammo'].hidden, false)
    assert.match(nodes['hud-ammo'].innerHTML, /assets\/tiles\/weapon_shortbow\.png/)
    assert.match(nodes['hud-ammo'].innerHTML, /×9/)
    assert.doesNotMatch(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
    assert.equal(nodes['hud-ammo'].dataset.active, '1')
  })
  it('dims the bow icon when its ammo pool is empty', () => {
    const nodes = fakeDom()
    updateHUD(state({ ranged: bow, ammo: { arrow: 0, bolt: 0, stone: 0 }, attackMode: 'ranged' }))
    assert.match(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
    assert.match(nodes['hud-ammo'].innerHTML, /×0/)
  })
  it('still shows the bow in melee stance, but not flagged active', () => {
    const nodes = fakeDom()
    updateHUD(state({ ranged: bow, ammo: { arrow: 9, bolt: 0, stone: 0 }, attackMode: 'melee' }))
    assert.equal(nodes['hud-ammo'].hidden, false)
    assert.equal(nodes['hud-ammo'].dataset.active, '')
  })
  it('shows the wand with no count in magic stance, active, dimmed below the tap cost', () => {
    const nodes = fakeDom()
    updateHUD(state({ wand, stamina: 100, attackMode: 'magic' }))
    assert.equal(nodes['hud-ammo'].hidden, false)
    assert.match(nodes['hud-ammo'].innerHTML, /assets\/tiles\/tile_0130\.png/)
    assert.doesNotMatch(nodes['hud-ammo'].innerHTML, /hud-count/)
    assert.doesNotMatch(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
    assert.equal(nodes['hud-ammo'].dataset.active, '1')
    // Spark Wand taps at 8 stamina (SPELLS.spark.cost.tap) — below that, dim.
    updateHUD(state({ wand, stamina: 1, attackMode: 'magic' }))
    assert.match(nodes['hud-ammo'].innerHTML, /hud-icon-empty/)
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

describe('updateHUD DOM churn', () => {
  // innerHTML setters counted per element: the HUD runs every frame, and a
  // rewrite re-parses markup and re-lays out the overlay even when identical.
  function countingDom() {
    const nodes = {}, writes = {}
    globalThis.document = { getElementById: (id) => (nodes[id] ??= {
      textContent: '', style: {}, dataset: {}, _html: '',
      get innerHTML() { return this._html }, set innerHTML(v) { this._html = v; writes[id] = (writes[id] ?? 0) + 1 },
    }) }
    return { nodes, writes }
  }
  it('writes each slot once for an unchanged state', () => {
    const { writes } = countingDom()
    const s = state({ hp: 7, inventory: [{ kind: 'potion', emoji: '🧪', stackable: true, count: 3 }],
      ranged: { weaponType: 'shortbow', name: 'Shortbow', ammoKind: 'arrow' },
      ammo: { arrow: 9, bolt: 0, stone: 0 }, attackMode: 'ranged' })
    updateHUD(s); updateHUD(s); updateHUD(s)
    assert.deepEqual(writes, { 'hud-hearts': 1, 'hud-consumable': 1, 'hud-ammo': 1 })
  })
  it('rewrites only the slot whose state changed', () => {
    const { writes, nodes } = countingDom()
    const s = state({ hp: 7 })
    updateHUD(s)
    s.player.hp = 5
    updateHUD(s)
    assert.equal(writes['hud-hearts'], 2)
    assert.equal(writes['hud-consumable'], 1)
    assert.match(nodes['hud-hearts'].innerHTML, /half/)
  })
})
