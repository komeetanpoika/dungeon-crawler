import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HAMMER, lightningMods, applyShock, tickShock, chainNodes, applyChain, thunderclap }
  from '../renderer/systems/hammer.js'
import { CHARGE, resolveCharge, isChargeWeapon } from '../renderer/systems/melee.js'
import { WEAPON_TYPES, weaponContents } from '../renderer/systems/entities.js'

const T = 32
const enemy = (x, y, extra = {}) => ({ type: 'monster', px: x * T + 16, py: y * T + 16, hp: 20, maxHp: 20, ...extra })
const player = (x = 0, y = 0) => ({ type: 'player', px: x * T + 16, py: y * T + 16, hp: 10 })

// Record every hurt the hooks see: [entity, damage, meta].
const recorder = () => {
  const hits = []
  const hooks = { hurt: (e, d, m) => { hits.push([e, d, m]); e.hp -= d } }
  return { hits, hooks }
}

describe('Ukonvasara as a charge weapon', () => {
  it('charges like the axe and every tier hits for the flat 3', () => {
    assert.ok(isChargeWeapon('ukonvasara'))
    assert.equal(WEAPON_TYPES.ukonvasara.damage, 3)
    assert.equal(weaponContents('ukonvasara').lightning, true)
    assert.equal(WEAPON_TYPES.ukonvasara.lightning, true)
    for (const held of [0, CHARGE.ukonvasara.full, CHARGE.ukonvasara.over]) {
      assert.equal(resolveCharge('ukonvasara', held).dmgMul, 1, `held ${held}`)
    }
    assert.equal(resolveCharge('ukonvasara', 0).tier, 'tap')
    assert.equal(resolveCharge('ukonvasara', CHARGE.ukonvasara.full).tier, 'full')
    assert.equal(resolveCharge('ukonvasara', CHARGE.ukonvasara.over).tier, 'over')
  })

  it('other charge weapons keep their tier multipliers', () => {
    assert.ok(resolveCharge('axe', 0).dmgMul < 1)
    assert.ok(resolveCharge('axe', CHARGE.axe.over).dmgMul > 1)
  })
})

describe('shock (the full-charge DoT)', () => {
  it('lands three 1-damage lightning strokes a second apart, then clears', () => {
    const e = enemy(0, 0)
    applyShock(e)
    const { hits, hooks } = recorder()
    let strokes = 0
    strokes += tickShock(e, 0.5, hooks).strokes
    assert.equal(strokes, 0, 'nothing before the first second')
    for (let i = 0; i < 5; i++) strokes += tickShock(e, 0.5, hooks).strokes
    assert.equal(strokes, HAMMER.shock.strokes)
    assert.equal(e.hp, 20 - HAMMER.shock.strokes * HAMMER.shock.damage)
    assert.ok(hits.every(([, d, m]) => d === HAMMER.shock.damage && m.source === 'lightning'))
    assert.equal(e.shock, undefined, 'spent shock is cleared')
    assert.equal(tickShock(e, 1, hooks).strokes, 0, 'nothing once cleared')
  })

  it('re-applying refreshes the count rather than stacking', () => {
    const e = enemy(0, 0)
    applyShock(e)
    const { hooks } = recorder()
    tickShock(e, 1.01, hooks)
    assert.equal(e.shock.left, HAMMER.shock.strokes - 1)
    applyShock(e)
    assert.equal(e.shock.left, HAMMER.shock.strokes)
  })

  it('a shocked entity that dies mid-DoT stops ticking', () => {
    const e = enemy(0, 0, { hp: 1 })
    applyShock(e)
    const { hits, hooks } = recorder()
    tickShock(e, 1.01, hooks)
    assert.equal(hits.length, 1)
    tickShock(e, 1.01, hooks)
    assert.equal(hits.length, 1, 'no stroke on a corpse')
  })
})

describe('chainNodes', () => {
  it('walks nearest-to-nearest within range, ending on the player when enemies run out', () => {
    const p = player(0, 0)
    const a = enemy(1, 0), b = enemy(3, 0), c = enemy(3, 2), far = enemy(9, 9)
    const nodes = chainNodes(p, [a], [a, b, c, far], { range: HAMMER.chain.range })
    assert.deepEqual(nodes.map(n => n.e ?? 'player'), [a, b, c, 'player'])
    assert.deepEqual(nodes.map(n => n.damage), HAMMER.chain.damage)
  })

  it('one enemy: 4 to it, 3 to the hero; two enemies: the hero takes 2', () => {
    const p = player(0, 0)
    const a = enemy(1, 0), b = enemy(2, 0)
    const one = chainNodes(p, [a], [a], { range: 3 })
    assert.deepEqual(one.map(n => [n.e ?? 'player', n.damage]), [[a, 4], ['player', 3]])
    const two = chainNodes(p, [a], [a, b], { range: 3 })
    assert.deepEqual(two.map(n => [n.e ?? 'player', n.damage]), [[a, 4], [b, 3], ['player', 2]])
  })

  it('four enemies fill the chain and the hero is spared', () => {
    const p = player(0, 0)
    const es = [enemy(1, 0), enemy(2, 0), enemy(3, 0), enemy(4, 0)]
    const nodes = chainNodes(p, [es[0]], es, { range: 3 })
    assert.equal(nodes.length, 4)
    assert.ok(nodes.every(n => n.e))
  })

  it('range is measured from the current node, not the player', () => {
    const p = player(0, 0)
    const a = enemy(3, 0), b = enemy(6, 0)   // b is 6 tiles from the player, 3 from a
    const nodes = chainNodes(p, [a], [a, b], { range: 3 })
    assert.deepEqual(nodes.map(n => n.e ?? 'player'), [a, b, 'player'])
  })

  it('the first node is the struck enemy nearest the player', () => {
    const p = player(0, 0)
    const near = enemy(1, 0), farther = enemy(2, 0)
    const nodes = chainNodes(p, [farther, near], [near, farther], { range: 3 })
    assert.equal(nodes[0].e, near)
  })

  it('a whiff with nothing struck seeks the nearest target in range of the player, else zaps the hero', () => {
    const p = player(0, 0)
    const b = enemy(2, 0)
    assert.deepEqual(chainNodes(p, [], [b], { range: 3 }).map(n => n.e ?? 'player'), [b, 'player'])
    assert.deepEqual(chainNodes(p, [], [enemy(8, 8)], { range: 3 }).map(n => [n.e ?? 'player', n.damage]), [['player', 4]])
  })

  it('bonus damage and range from the player ride every node', () => {
    const p = player(0, 0)
    const a = enemy(1, 0), b = enemy(6, 0)   // 5 tiles apart: out of base reach, in with +2
    const mods = lightningMods({ lightningBonus: { range: 2, damage: 1 } })
    assert.equal(mods.range, HAMMER.chain.range + 2)
    const nodes = chainNodes(p, [a], [a, b], mods)
    assert.deepEqual(nodes.map(n => [n.e ?? 'player', n.damage]), [[a, 5], [b, 4], ['player', 3]])
    assert.deepEqual(lightningMods({}), { range: HAMMER.chain.range, damage: 0 })
  })
})

describe('applyChain', () => {
  it('hurts each node with lightning, zaps the hero through the player hook, and records the arcs', () => {
    const p = player(0, 0)
    const a = enemy(1, 0), b = enemy(2, 0)
    const { hits, hooks } = recorder()
    let heroDmg = 0
    hooks.damagePlayer = d => { heroDmg += d }
    const state = { player: p, arcs: [] }
    const nodes = chainNodes(p, [a], [a, b], { range: 3 })
    const res = applyChain(state, nodes, hooks)
    assert.deepEqual(hits.map(([e, d, m]) => [e, d, m.source]), [[a, 4, 'lightning'], [b, 3, 'lightning']])
    assert.equal(heroDmg, 2)
    assert.equal(res.enemies, 2)
    assert.equal(res.hero, 2)
    // arcs: player→a, a→b, b→player
    assert.equal(state.arcs.length, 3)
    assert.deepEqual([state.arcs[0].x0, state.arcs[0].y0, state.arcs[0].x1, state.arcs[0].y1], [p.px, p.py, a.px, a.py])
    assert.deepEqual([state.arcs[2].x1, state.arcs[2].y1], [p.px, p.py])
  })
})

describe('thunderclap', () => {
  it('shoves and slows every spell target inside the radius, no damage', () => {
    const p = player(3, 3)
    const near = enemy(4, 3), far = enemy(9, 3), villager = { type: 'npc', px: p.px + 20, py: p.py, hp: 3 }
    const n = thunderclap(p, [near, far, villager])
    assert.equal(n, 1)
    assert.ok(near.knockback && near.knockback.vx > 0)
    assert.equal(near.hp, 20)
    assert.equal(near.slowTimer, HAMMER.clap.slow.dur)
    assert.equal(near.slowMul, HAMMER.clap.slow.mul)
    assert.equal(far.knockback, undefined)
    assert.equal(far.slowTimer, undefined)
    assert.equal(villager.knockback, undefined, 'peaceful villagers are spared')
  })
})

describe('drawShockCloud', () => {
  it('paints a belly and a body of three lumps above the enemy, bobbing with time', async () => {
    const { drawShockCloud } = await import('../renderer/render/canvas.js')
    const fake = () => {
      const log = { arcs: [], fills: [] }
      const ctx = {
        save() {}, restore() {}, beginPath() {}, moveTo() {},
        arc: (x, y, r) => log.arcs.push([x, y, r]),
        fill() { log.fills.push(ctx.fillStyle) },
      }
      return { ctx, log }
    }
    const a = fake(), b = fake()
    drawShockCloud(a.ctx, 100, 50, 32, 0)
    drawShockCloud(b.ctx, 100, 50, 32, 0.4)
    assert.equal(a.log.arcs.length, 6, 'three lumps, twice: belly then body')
    assert.deepEqual(a.log.fills, ['#6b7280', '#e5e7eb'])
    assert.ok(a.log.arcs.every(([, y]) => y < 60), 'sits above the anchor')
    assert.notEqual(a.log.arcs[0][1], b.log.arcs[0][1], 'bobs over time')
  })
})
