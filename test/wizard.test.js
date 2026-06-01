import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeWizard, updateWizard } from '../renderer/systems/wizard.js'
import { createMap } from '../renderer/systems/map.js'
import { TILE } from '../renderer/systems/entities.js'

const S = 32

function openMap(w = 20, h = 20) {
  const map = createMap(w, h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      map[y][x].tile = TILE.FLOOR
  return map
}

function makeState(wizard, player) {
  return { player, map: openMap(), projectiles: [], entities: [wizard], log: [] }
}

describe('makeWizard', () => {
  it('has correct initial fields', () => {
    const w = makeWizard(5, 5)
    assert.equal(w.type, 'wizard')
    assert.equal(w.hp, 12)
    assert.equal(w.maxHp, 12)
    assert.equal(w.spellIndex, 0)
    assert.equal(w.shieldTimer, 0)
    assert.equal(w.inCombat, false)
    assert.ok(typeof w.id === 'string' && w.id.startsWith('wizard_'))
    assert.ok(w.strafeDir === 1 || w.strafeDir === -1)
    assert.equal(typeof w.strafeDirTimer, 'number')
  })
})

describe('updateWizard — spell rotation', () => {
  it('fires a single bolt at spell index 0 when in LOS with spellCooldown 0', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 0
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 1)
    assert.equal(state.projectiles[0].damage, 2)
    assert.equal(state.projectiles[0].friendly, false)
    assert.equal(state.projectiles[0].color, '#a855f7')
    assert.equal(w.spellIndex, 1)
  })

  it('fires 3 spread projectiles at spell index 2', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 2
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 3)
    assert.ok(state.projectiles.every(p => p.damage === 1 && p.color === '#a855f7'))
  })

  it('activates shield at spell index 3, resets index to 0, fires no projectile', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 0; w.spellIndex = 3
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.ok(w.shieldTimer > 0)
    assert.equal(w.spellIndex, 0)
    assert.equal(state.projectiles.length, 0)
  })

  it('does not cast when spellCooldown > 0', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.spellCooldown = 1.5; w.spellIndex = 0
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.016)
    assert.equal(state.projectiles.length, 0)
  })
})

describe('updateWizard — summoning', () => {
  it('pushes at least one bat to state.entities when summonTimer expires', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.summonTimer = 0.01
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    const state = makeState(w, player)
    updateWizard(w, state, 0.02)
    const bats = state.entities.filter(e => e.summonedBy === w.id)
    assert.ok(bats.length >= 1)
    assert.ok(bats.every(b => b.type === 'monster' && b.variant === 'weak'))
  })

  it('does not summon beyond MAX_MINIONS cap', () => {
    const w = makeWizard(5, 5)
    w.px = 5 * S + 16; w.py = 5 * S + 16
    w.summonTimer = 0.01
    const player = { x: 8, y: 5, px: 8 * S + 16, py: 5 * S + 16, hp: 10, grabbed: false }
    // Pre-populate 4 minions
    const minions = Array.from({ length: 4 }, (_, i) => ({
      type: 'monster', variant: 'weak', hp: 1, maxHp: 1, summonedBy: w.id,
      x: 5, y: 5, px: (5 + i) * S, py: 5 * S,
    }))
    const state = { player, map: openMap(), projectiles: [], entities: [w, ...minions], log: [] }
    updateWizard(w, state, 0.02)
    const after = state.entities.filter(e => e.summonedBy === w.id)
    assert.equal(after.length, 4)  // cap not exceeded
  })
})
