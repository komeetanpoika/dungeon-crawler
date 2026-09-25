import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { tryBlock } from '../renderer/systems/shield.js'
import { isEnemy, isHittable, isSpellTarget } from '../renderer/systems/factions.js'
import { hitShape, PLAYER_SHAPE } from '../renderer/systems/hitbox.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { tryCast } from '../renderer/systems/spells.js'
import { castCone } from '../renderer/systems/magic.js'
import { castLightning, tickLightning, LIGHTNING } from '../renderer/systems/spells/lightning.js'
import { applyChain } from '../renderer/systems/hammer.js'
import { stepProjectiles } from '../renderer/systems/projectiles.js'
import { TILE } from '../renderer/systems/entities.js'

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

const floor = (w = 20, h = 20) => Array.from({ length: h }, () => Array.from({ length: w }, () => ({ tile: TILE.FLOOR })))
const robed = over => {
  const h = hero({ attackMode: 'magic', ...over })
  h.gear.magic.outfit = { outfitType: 'robe', loadout: 'magic', protect: 0 }
  return h
}
const at = (x, y, over) => hero({ px: x * 32 + 16, py: y * 32 + 16, x, y, ...over })

describe('seam: tryCast caster', () => {
  it('a bolt from an explicit caster carries its owner and bills its tank', () => {
    const caster = robed({ id: 'm' })
    const state = { map: floor(), entities: [], player: hero({ id: 'p', stamina: 0 }) }
    const cast = tryCast(state, 'spark', 'tap', { caster })
    assert.equal(cast.ok, true)
    assert.equal(cast.projectiles[0].owner, 'm')
    assert.equal(caster.stamina, 92)
  })
  it('blink moves the caster, not state.player', () => {
    const caster = robed({ id: 'm', px: 5 * 32 + 16, py: 5 * 32 + 16, x: 5, y: 5, facing: 'east' })
    const state = { map: floor(), entities: [], player: hero({ id: 'p', px: 16, py: 16 }) }
    tryCast(state, 'blink', 'tap', { caster })
    assert.equal(caster.x, 9)
    assert.equal(state.player.px, 16)
  })
  it('without a caster the single-player bolt has no owner', () => {
    const state = { map: floor(), entities: [], player: robed({ id: undefined }) }
    const cast = tryCast(state, 'spark', 'tap')
    assert.equal('owner' in cast.projectiles[0], false)
  })
})

describe('seam: castCone caster', () => {
  it('the cone never catches its own caster and stuns the foe in front', () => {
    const caster = at(5, 5, { id: 'a', facing: 'east' })
    const foe = at(6, 5, { id: 'b' })
    const state = { entities: [caster, foe] }
    castCone(state, { mul: 1, stun: 1, knockback: 0, bossKnockback: 0 }, caster)
    assert.equal(foe.stunTimer, 1)
    assert.equal(caster.stunTimer, undefined)
  })
})

describe('seam: lightning owner', () => {
  it('marks carry the caster id; the strike spares the owner and names it to hurt', () => {
    const caster = at(5, 5, { id: 'a', facing: 'east' })
    const foe = at(8, 5, { id: 'b' })
    const state = { map: floor(), entities: [caster, foe], lightning: [], strikes: [] }
    const { marks } = castLightning(state, 'tap', caster)
    assert.equal(marks[0].owner, 'a')
    caster.px = foe.px; caster.py = foe.py   // the caster walks into its own strike
    const hits = []
    tickLightning(state, LIGHTNING.delay + 0.01, { hurt: (e, d, info) => hits.push([e.id, d, info.owner]) })
    assert.deepEqual(hits, [['b', LIGHTNING.damage, 'a']])
  })
})

describe('seam: applyChain caster', () => {
  it('arcs start at the given caster', () => {
    const caster = at(1, 1, { id: 'a' }), foe = at(3, 1, { id: 'b' })
    const state = { player: at(9, 9, { id: 'p' }), arcs: [] }
    applyChain(state, [{ e: foe, damage: 4 }], { hurt: () => {} }, caster)
    assert.equal(state.arcs[0].x0, caster.px)
  })
})

describe('seam: projectile owner', () => {
  const hooks = hits => ({ isHittable: () => true, hurt: (e, d) => { hits.push(e.id); return e }, detonate() {}, damagePlayer() {}, cull: es => es })
  it('flies through its owner and hits the next hero', () => {
    const a = at(5, 5, { id: 'a' }), b = at(7, 5, { id: 'b' })
    const state = { map: floor(), entities: [a, b], player: null,
      projectiles: [{ px: a.px, py: a.py, dx: 280, dy: 0, damage: 2, friendly: true, owner: 'a' }] }
    const hits = []
    for (let i = 0; i < 20 && state.projectiles.length; i++) stepProjectiles(state, 1 / 30, hooks(hits))
    assert.deepEqual(hits, ['b'])
  })
  it('a chaining bolt never arcs back to its owner', () => {
    const a = at(5, 5, { id: 'a' }), b = at(6, 5, { id: 'b' })
    const state = { map: floor(), entities: [a, b], player: null,
      projectiles: [{ px: b.px - 4, py: b.py, dx: 340, dy: 0, damage: 2, friendly: true, owner: 'a', chain: { left: 2, range: 96 } }] }
    const hits = []
    for (let i = 0; i < 30 && state.projectiles.length; i++) stepProjectiles(state, 1 / 30, hooks(hits))
    assert.deepEqual(hits, ['b'])
  })
})
