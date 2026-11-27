import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as hooks from '../renderer/systems/monsters/skorpioni.js'
import * as emperor from '../renderer/systems/monsters/keisariskorpioni.js'
import { tuningOf, isStoryCreature, spellSpares, getMonsterDef } from '../renderer/systems/monsters.js'
import { strikeCreature } from '../renderer/systems/creatures.js'
import { makeShieldContents } from '../renderer/systems/entities.js'
import { register, world, spawn, moveHero, run, cues, cell, S } from './helpers/desert-bench.js'

const { update } = hooks
const scorp = (state, x = 20, y = 16, name = 'skorpioni') => spawn(state, name, x, y)

describe('skorpioni', () => {
  beforeEach(() => register(['skorpioni', 'keisariskorpioni'], { skorpioni: hooks, keisariskorpioni: emperor }))

  it('takes its tuning from the def, every TUNING_SCHEMA key present, the emperor its own', () => {
    for (const p of hooks.TUNING_SCHEMA) { assert.ok(p.key in tuningOf('skorpioni'), p.key); assert.ok(p.key in tuningOf('keisariskorpioni'), p.key) }
    assert.ok(tuningOf('keisariskorpioni').wake > tuningOf('skorpioni').wake)
    assert.ok(tuningOf('keisariskorpioni').poisonTicks > tuningOf('skorpioni').poisonTicks)
    assert.equal(getMonsterDef('skorpioni').spawn, null)
    assert.equal(getMonsterDef('skorpioni').behavior.weapon, 'claw')
  })

  it('lies buried by day: still, sunk, driven by its hook, open to spells', () => {
    const s = world(), e = scorp(s)
    run(s, e, update, 2)
    assert.equal(e.scorp.state, 'buried')
    assert.equal(e.sink, 1)
    assert.deepEqual([e.x, e.y], [20, 16])
    assert.equal(isStoryCreature(e), true)
    assert.equal(spellSpares(e), false)
    assert.equal(typeof hooks.debugState(e), 'string')
  })

  it('is out at night, on hard ground, and with burying switched off', () => {
    const night = world(); night.night = true
    const a = scorp(night); run(night, a, update, 0.1)
    assert.equal(a.scorp.state, 'out')
    assert.equal(a.brainDriven, true)
    const hard = world({ skin: 'ow_hardpan_cracked_0_0' })
    const b = scorp(hard); run(hard, b, update, 0.1)
    assert.equal(b.scorp.state, 'out')
  })

  it('bursts out when the hero comes within its wake, and then the brain drives it', () => {
    const s = world(), e = scorp(s)
    moveHero(s, 20, 16 + tuningOf('skorpioni').wake + 0.5)
    run(s, e, update, 1)
    assert.equal(e.scorp.state, 'buried')
    moveHero(s, 20, 16 + tuningOf('skorpioni').wake - 0.2)
    run(s, e, update, 0.1)
    assert.equal(e.scorp.state, 'bursting')
    assert.ok(e.sink < 1 && e.sink > 0)
    run(s, e, update, tuningOf('skorpioni').burst + 0.1)
    assert.ok(['out', 'rearing'].includes(e.scorp.state))
    assert.equal(e.sink, 0)
    assert.equal(e.brainDriven, true)
    assert.equal(isStoryCreature(e), false)
  })

  it('comes out at dusk without being roused', () => {
    const s = world(), e = scorp(s)
    run(s, e, update, 1)
    s.night = true
    run(s, e, update, 1)
    assert.equal(e.scorp.state, 'out')
  })

  it('a blow on a buried one lands and rouses it', () => {
    const s = world(), e = scorp(s)
    run(s, e, update, 0.5)
    const r = strikeCreature(e, s, 1)
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, getMonsterDef('skorpioni').stats.hp - 1)
    run(s, e, update, 0.05)
    assert.notEqual(e.scorp.state, 'buried')
  })

  const roused = (s, name = 'skorpioni') => {
    const e = scorp(s, 20, 16, name)
    s.night = true
    run(s, e, update, 0.1)
    return e
  }

  it('rears with the hero in reach, pinned where it stands, then stings: damage and poison', () => {
    const s = world(), e = roused(s), T = tuningOf('skorpioni')
    moveHero(s, 20, 16 + T.reach - 0.3)
    run(s, e, update, 0.05)
    assert.equal(e.scorp.state, 'rearing')
    const at = [e.px, e.py]
    e.px += 30                                       // the brain's step this frame is undone
    run(s, e, update, 0.05)
    assert.deepEqual([e.px, e.py], at)
    assert.ok(e.pose.eyeGlow > 0 && e.pose.eyeGlow < 1)
    run(s, e, update, T.rear + 0.05)
    assert.equal(s.player.hp, 10 - T.stingDmg)
    assert.equal(s.player.poison.left, T.poisonTicks)
    assert.ok(cues(s).includes('sting'))
    run(s, e, update, 1)
    assert.equal(e.scorp.state, 'out')
    assert.equal(e.pose.eyeGlow, 0)
    assert.equal(s.player.hp, 10 - T.stingDmg)       // once, and not again inside the cooldown
  })

  it('misses a hero who has stepped out of reach by the time it strikes', () => {
    const s = world(), e = roused(s), T = tuningOf('skorpioni')
    moveHero(s, 20, 16 + T.reach - 0.3)
    run(s, e, update, 0.05)
    moveHero(s, 20, 16 + T.reach + 1.5)
    run(s, e, update, T.rear + 0.3)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.poison, undefined)
    assert.equal(e.scorp.state, 'out')
  })

  it('a raised shield facing it stops the sting and its poison', () => {
    const s = world(), e = roused(s), T = tuningOf('skorpioni')
    moveHero(s, 20, 16 + T.reach - 0.3)
    const { type, ...buckler } = makeShieldContents('buckler')
    s.player.gear.melee.off = { kind: 'shield', ...buckler }
    Object.assign(s.player, { facing: 'north', blocking: true })
    run(s, e, update, T.rear + 0.2)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.poison, undefined)
  })

  it('the emperor stings harder, further and for longer', () => {
    const s = world(), e = roused(s, 'keisariskorpioni'), T = tuningOf('keisariskorpioni')
    moveHero(s, 20, 16 + T.reach - 0.3)
    run(s, e, emperor.update, T.rear + 0.2)
    assert.equal(s.player.hp, 10 - T.stingDmg)
    assert.equal(s.player.poison.left, T.poisonTicks)
  })

  it('does not stay reared over a dead hero, nor sting one on the coach', () => {
    const s = world(), e = roused(s), T = tuningOf('skorpioni')
    moveHero(s, 20, 16 + T.reach - 0.3)
    run(s, e, update, 0.05)
    s.player.hp = 0
    run(s, e, update, T.rear + 0.5)
    assert.equal(e.scorp.state, 'out')
    const c = world(), f = roused(c)
    moveHero(c, 20, 16 + T.reach - 0.3)
    c.player.riding = true
    run(c, f, update, 3)
    assert.equal(c.player.hp, 10)
    assert.equal(f.scorp.state, 'out')
  })

  it('with the hero long gone by day it digs in again where it stands, on loose sand only', () => {
    const s = world(), e = scorp(s), T = tuningOf('skorpioni')
    moveHero(s, 20, 17)
    run(s, e, update, T.burst + 0.2)
    moveHero(s, 20, 36)
    run(s, e, update, T.rebury + 1.5)
    assert.equal(e.scorp.state, 'buried')
    assert.equal(e.brainDriven, false)
    // on hard ground it stays out
    const h = world(), g = scorp(h)
    moveHero(h, 20, 17)
    run(h, g, update, T.burst + 0.2)
    h.map[g.y][g.x] = cell('ow_road_sand_0')
    moveHero(h, 20, 36)
    run(h, g, update, T.rebury + 1.5)
    assert.equal(g.scorp.state, 'out')
  })

  it('a shove while buried rouses it rather than sliding a mound about', () => {
    const s = world(), e = scorp(s)
    run(s, e, update, 0.2)
    e.knockback = { vx: 100, vy: 0 }
    run(s, e, update, 0.05)
    assert.notEqual(e.scorp.state, 'buried')
  })
})
