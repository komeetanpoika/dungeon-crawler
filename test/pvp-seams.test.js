import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { tryBlock } from '../renderer/systems/shield.js'
import { isEnemy, isHittable, isSpellTarget } from '../renderer/systems/factions.js'
import { hitShape, PLAYER_SHAPE } from '../renderer/systems/hitbox.js'
import { makeFeedback } from '../renderer/systems/feedback.js'

const hero = (over = {}) => ({ type: 'hero', id: 'h', px: 100, py: 100, hp: 10, maxHp: 10, facing: 'east',
  attackMode: 'melee', gear: { melee: { off: null, outfit: null }, ranged: { off: null, outfit: null }, magic: { off: null, outfit: null } },
  stamina: 100, ...over })

describe('seam: damagePlayer hero argument', () => {
  it('damages the given hero, not state.player', () => {
    const player = hero({ id: 'p' }), target = hero({ id: 't' })
    const state = { player, feedback: makeFeedback() }
    assert.equal(damagePlayer(state, 3, 'hit', null, target), true)
    assert.equal(target.hp, 7)
    assert.equal(player.hp, 10)
  })
  it('defaults to state.player when no hero is passed', () => {
    const state = { player: hero(), feedback: makeFeedback() }
    damagePlayer(state, 2, 'hit')
    assert.equal(state.player.hp, 8)
  })
  it("reads the given hero's outfit protect", () => {
    const target = hero()
    target.gear.melee.outfit = { outfitType: 'plate', protect: 1 }
    const state = { player: hero({ id: 'p' }), feedback: makeFeedback() }
    damagePlayer(state, 2, 'hit', null, target)
    assert.equal(target.hp, 9)
  })
})

describe('seam: tryBlock player argument', () => {
  it("blocks with the given hero's shield, not state.player's", () => {
    const target = hero({ blocking: true })
    target.gear.melee.off = { kind: 'shield', weaponType: 'buckler', blockCost: 8 }
    const state = { player: hero({ id: 'p' }) }
    assert.equal(tryBlock(state, { px: 130, py: 100 }, target), true)
    assert.equal(target.stamina, 92)
    assert.equal(target.blockedHit, true)
  })
  it('damagePlayer passes its hero to tryBlock (frontal hit blocked, rear hit lands)', () => {
    const target = hero({ blocking: true })
    target.gear.melee.off = { kind: 'shield', weaponType: 'buckler', blockCost: 8 }
    const state = { player: hero({ id: 'p' }), feedback: makeFeedback() }
    assert.equal(damagePlayer(state, 2, 'hit', { px: 130, py: 100 }, target), false)
    assert.equal(target.hp, 10)
    assert.equal(damagePlayer(state, 2, 'hit', { px: 70, py: 100 }, target), true)
    assert.equal(target.hp, 8)
  })
})

describe('seam: heroes are enemies and use the player shape', () => {
  it('a hero is an enemy, hittable and a spell target', () => {
    const h = hero()
    assert.equal(isEnemy(h), true)
    assert.equal(isHittable(h), true)
    assert.equal(isSpellTarget(h), true)
  })
  it('a hero hit shape is PLAYER_SHAPE', () => {
    assert.equal(hitShape(hero()).r, PLAYER_SHAPE.r)
  })
})
