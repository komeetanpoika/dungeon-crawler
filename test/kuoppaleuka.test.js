import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as hooks from '../renderer/systems/monsters/kuoppaleuka.js'
import * as rig from '../renderer/render/monster-rigs/antlion.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { tuningOf, isStoryCreature, spellSpares, getMonsterDef } from '../renderer/systems/monsters.js'
import { strikeCreature } from '../renderer/systems/creatures.js'
import { TILE } from '../renderer/systems/entities.js'
import { PLAYER_HALF } from '../renderer/systems/movement.js'
import { deathDrop } from '../renderer/systems/drops.js'
import { sandSlowMul, tickSandSlow } from '../renderer/systems/sand-slow.js'
import { register, world, spawn, moveHero, run, cues, tilesApart, S } from './helpers/desert-bench.js'
import { rigContract, poseOf, inked } from './helpers/rig-contract.js'

const { update } = hooks
const T = () => tuningOf('kuoppaleuka')
const pit = (s, x = 20, y = 20) => spawn(s, 'kuoppaleuka', x, y)

rigContract(rig, { channels: [{}, { sink: 1 }, { sink: 0, eyeGlow: 0.7 }, { sink: 0, flicker: 1 }, { sink: 1, burn: 0.6 }, { sink: 1, burn: 1 }] })

describe('the antlion drawn', () => {
  const P = defaultParams(rig.PARAM_SCHEMA)
  it('its funnel is wide, and fills in as it dies', () => {
    const whole = inked(rig, P, poseOf('idle', { sink: 1 })), half = inked(rig, P, poseOf('idle', { sink: 1, burn: 0.6 })), gone = inked(rig, P, poseOf('idle', { sink: 1, burn: 1 }))
    assert.ok(whole > 3000, `a funnel of ${whole} px`)
    assert.ok(half < whole && gone < half * 0.5)
  })
  it('with the head up there is more of it to see, and to hit', () => {
    assert.ok(inked(rig, P, poseOf('idle', { sink: 0, burn: 1 })) > inked(rig, P, poseOf('idle', { sink: 1, burn: 1 })))
    assert.ok(rig.hitShape(P).r >= 8)
  })
})

describe('kuoppaleuka', () => {
  beforeEach(() => register(['kuoppaleuka'], hooks))

  it('takes its tuning from the def; rooted, hook-driven, leaves a chest\'s worth', () => {
    for (const p of hooks.TUNING_SCHEMA) assert.ok(p.key in T(), p.key)
    const d = getMonsterDef('kuoppaleuka')
    assert.equal(d.spawn, null)
    assert.equal(d.behavior.driver, 'hook')
    assert.equal(d.behavior.drops, 'chest')
    const e = { type: 'kuoppaleuka', x: 3, y: 4, hp: 0, lootDepth: 4 }
    assert.deepEqual(deathDrop(e, d, depth => ({ depth })), { kind: 'floating_pickup', contents: { depth: 4 }, x: 3, y: 4 })
  })

  it('the slope carries a standing hero towards the jaws, faster nearer them', () => {
    const s = world(), e = pit(s)
    moveHero(s, 20 + T().radius - 0.3, 20)
    const d0 = tilesApart(e, s.player)
    run(s, e, update, 0.5)
    const d1 = tilesApart(e, s.player)
    const rim = (d0 - d1) * S / 0.5
    assert.ok(rim > T().pullRim * 0.9 && rim < T().pullCore, `at the rim ${rim.toFixed(0)} px/s`)
    moveHero(s, 20 + 1.3, 20)
    const c0 = tilesApart(e, s.player)
    run(s, e, update, 0.2)
    const core = (c0 - tilesApart(e, s.player)) * S / 0.2
    assert.ok(core > rim, `near the jaws ${core.toFixed(0)} px/s`)
    assert.equal(s.player.x, Math.floor(s.player.px / S))
  })

  it('outside the funnel nothing pulls', () => {
    const s = world(), e = pit(s)
    moveHero(s, 20 + T().radius + 0.5, 20)
    const at = s.player.px
    run(s, e, update, 1)
    assert.equal(s.player.px, at)
  })

  it('does not carry a hero on the coach, a frozen one, a dead one, or anyone into a wall', () => {
    for (const over of [{ riding: true }, { ice: { t: 2 } }, { hp: 0 }]) {
      const s = world(), e = pit(s)
      moveHero(s, 22, 20)
      Object.assign(s.player, over)
      const at = s.player.px
      run(s, e, update, 0.5)
      assert.equal(s.player.px, at, JSON.stringify(over))
    }
    const s = world(), e = pit(s)
    moveHero(s, 22, 20)
    s.map[20][21] = { tile: TILE.WALL }
    run(s, e, update, 1)
    assert.ok(s.player.px - PLAYER_HALF >= 22 * S, 'stopped at the wall')
    assert.ok(s.player.px < 22 * S + S / 2, 'having been carried up to it')
  })

  it('the jaws snap at a hero in the middle: damage, a throw outward, and not again at once', () => {
    const s = world(), e = pit(s)
    moveHero(s, 20 + T().jawR - 0.2, 20)
    run(s, e, update, 0.1)
    assert.equal(s.player.hp, 10 - T().snapDmg)
    assert.ok(s.player.knockback.vx > 0, 'thrown away from the jaws')
    s.player.knockback = null; s.player.invulnTimer = 0
    run(s, e, update, T().snapEvery - 0.3)
    assert.equal(s.player.hp, 10 - T().snapDmg)
    s.player.knockback = null; s.player.invulnTimer = 0
    run(s, e, update, 0.5)
    assert.equal(s.player.hp, 10 - 2 * T().snapDmg)
  })

  it('buried it absorbs blows and spells pass it; after a snap the head is up and it can be struck', () => {
    const s = world(), e = pit(s)
    moveHero(s, 30, 30)
    run(s, e, update, 0.3)
    assert.equal(isStoryCreature(e), true)
    assert.equal(spellSpares(e), true)
    assert.equal(strikeCreature(e, s, 2).absorbed, true)
    assert.equal(e.hp, getMonsterDef('kuoppaleuka').stats.hp)
    moveHero(s, 20.5, 20)
    run(s, e, update, 0.4)
    s.player.knockback = null
    assert.ok(e.sink < 0.5, 'head up')
    assert.equal(spellSpares(e), false)
    assert.equal(strikeCreature(e, s, 2).absorbed, false)
    assert.equal(e.hp, getMonsterDef('kuoppaleuka').stats.hp - 2)
    moveHero(s, 30, 30)
    run(s, e, update, T().upAfterSnap + 0.5)
    assert.equal(e.sink, 1)
    assert.equal(strikeCreature(e, s, 2).absorbed, true)
  })

  it('throws sand at a hero beyond the rim with a line of sight: the gob lands where he stood', () => {
    const s = world(), e = pit(s)
    moveHero(s, 20 + 4, 20)
    run(s, e, update, T().tossEvery + T().windup + 0.1)
    assert.ok(cues(s).includes('sand-toss'))
    assert.ok(e.pit.gob, 'a gob is in the air')
    assert.equal(e.pit.gob.x1, (20 + 4) * S + S / 2)
    // he stays: a shove towards the pit and a slowed walk
    run(s, e, update, T().flight + 0.05)
    assert.ok(cues(s).includes('sand-land'))
    assert.ok(s.player.knockback.vx < 0, 'shoved towards the pit')
    assert.ok(s.player.sandSlow > 0)
    assert.equal(sandSlowMul(s.player), 0.5)
    assert.equal(s.player.hp, 10)
    tickSandSlow(s.player, T().slow + 0.1)
    assert.equal(sandSlowMul(s.player), 1)
  })

  it('the head is up while it winds up and just after: the archer\'s moment', () => {
    const s = world(), e = pit(s)
    moveHero(s, 24, 20)
    let open = 0
    run(s, e, update, T().tossEvery + T().windup + T().upAfterToss + 1, () => { if (e.spellOpen) open++ })
    assert.ok(open / 60 > T().windup * 0.6, `open ${(open / 60).toFixed(2)} s`)
  })

  it('a hero who moves on is missed; nothing is thrown too near, too far or past a wall', () => {
    const s = world(), e = pit(s)
    moveHero(s, 24, 20)
    run(s, e, update, T().tossEvery + T().windup + 0.05)
    moveHero(s, 24, 23)
    run(s, e, update, T().flight + 0.1)
    assert.equal(s.player.knockback ?? null, null)
    assert.ok(!(s.player.sandSlow > 0))
    for (const x of [20 + T().tossMax + 1.5]) {
      const f = world(), g = pit(f)
      moveHero(f, x, 20)
      run(f, g, update, T().tossEvery * 2)
      assert.ok(!cues(f).includes('sand-toss'), `at ${x}`)
    }
    const w = world(), h = pit(w)
    moveHero(w, 24, 20)
    w.map[20][22] = { tile: TILE.WALL }
    run(w, h, update, T().tossEvery * 2)
    assert.ok(!cues(w).includes('sand-toss'))
  })

  it('stays where it is whatever shoves it', () => {
    const s = world(), e = pit(s)
    run(s, e, update, 0.05)
    e.knockback = { vx: 500, vy: 0 }
    e.px += 40
    run(s, e, update, 0.1)
    assert.deepEqual([e.px, e.py, e.knockback], [20 * S + S / 2, 20 * S + S / 2, null])
    assert.equal(typeof hooks.debugState(e), 'string')
  })
})
