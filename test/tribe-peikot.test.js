import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as mohkale from '../renderer/systems/monsters/mohkale.js'
import * as louhija from '../renderer/systems/monsters/louhija.js'
import * as rumpali from '../renderer/systems/monsters/rumpali.js'
import * as king from '../renderer/systems/monsters/vuorenkuningas.js'
import { dropStones, tickStones, drawStones, STONE_TUNING } from '../renderer/systems/tribes/rockfall.js'
import { tuningOf, getMonsterDef, updateMonsterPose, isStoryCreature } from '../renderer/systems/monsters.js'
import { strikeCreature, hurtCreature, CREATURE_HIT, CREATURE_UPDATE } from '../renderer/systems/creatures.js'
import { tribeOf, roleOf } from '../renderer/systems/tribes.js'
import { applySlow, applyRoot, applyFreeze, applyHaste, hasteMul, tickStatus } from '../renderer/systems/status.js'
import { defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { makeShieldContents, TILE } from '../renderer/systems/entities.js'
import { deathDrop } from '../renderer/systems/drops.js'
import { register, world, spawn, moveHero, cues, tilesApart, S } from './helpers/desert-bench.js'
import { recordingCtx } from './helpers/rig-contract.js'

const HOOKS = { mohkale, louhija, rumpali, vuorenkuningas: king }
const NAMES = Object.keys(HOOKS)
const DT = 1 / 60
const BLADE = { source: 'player', via: 'melee', knockback: 0 }
const ARROW = { source: 'player', via: 'shot' }
const SPELL = { source: 'player', via: 'spell' }
const STONES = defaultParams(STONE_TUNING)

// The whole band for `seconds`, the way the enemy loop runs a troll that the
// brain drives: its timers, then its hook, then its pose (no brain here: a
// test moves what it wants moved in `each`).
function runAll(state, seconds, each = null) {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) {
    each?.(i)
    state.player.invulnTimer = Math.max(0, (state.player.invulnTimer ?? 0) - DT)
    for (const e of [...state.entities]) {
      if (!HOOKS[e.type] || !(e.hp > 0)) continue
      tickStatus(e, DT)
      if (e.stunTimer > 0) { e.stunTimer -= DT; continue }
      e.damageCooldown = Math.max(0, (e.damageCooldown ?? 0) - DT)
      HOOKS[e.type].update(e, state, DT)
      updateMonsterPose(e, DT)
    }
  }
}
function raiseShield(state, facing) {
  const { type, ...buckler } = makeShieldContents('buckler')
  state.player.gear.melee.off = { kind: 'shield', ...buckler }
  Object.assign(state.player, { facing, blocking: true })
}
const count = (state, cue) => cues(state).filter(c => c === cue).length
const fills = ctx => ctx.ops.filter(o => o[0] === 'fillRect')

describe('the trolls', () => {
  beforeEach(() => register(NAMES, HOOKS))

  it('are four of one tribe, dealt only by the Wilds, each with its hook and every tuning key', () => {
    const roles = { mohkale: 'fighter', louhija: 'mage', rumpali: 'healer', vuorenkuningas: 'boss' }
    for (const name of NAMES) {
      const d = getMonsterDef(name)
      assert.equal(d.spawn, null, name)
      assert.equal(d.rigId, 'troll', name)
      assert.equal(tribeOf({ type: name }), 'peikot', name)
      assert.equal(roleOf({ type: name }), roles[name], name)
      assert.equal(isStoryCreature({ type: name }), false, `${name} is driven by the brain`)
      assert.equal(typeof CREATURE_UPDATE[name], 'function', name)
      assert.equal(typeof CREATURE_HIT[name], 'function', name)
      for (const p of HOOKS[name].TUNING_SCHEMA) assert.ok(p.key in tuningOf(name), `${name}.${p.key}`)
      assert.deepEqual(d.warnings, [], name)
    }
    assert.deepEqual([8, 4, 5, 40], NAMES.map(n => getMonsterDef(n).stats.hp))
    assert.deepEqual([62, 70, 75, 46], NAMES.map(n => getMonsterDef(n).stats.speed))
    assert.equal(getMonsterDef('mohkale').behavior.weapon, 'maul')
    assert.equal(getMonsterDef('vuorenkuningas').behavior.weaponOverrides.damage, 3)
    assert.equal(getMonsterDef('vuorenkuningas').behavior.drops, 'chest')
    assert.equal(getMonsterDef('louhija').behavior.weapon, undefined)
    assert.equal(getMonsterDef('rumpali').behavior.weapon, undefined)
    // nobody of a war band routs
    for (const name of NAMES) assert.equal(getMonsterDef(name).behavior.fleeHp, 0, name)
    // the King is drawn big and walks where the others walk
    assert.ok(getMonsterDef('vuorenkuningas').stats.half <= 16)
  })
})

describe('Möhkäle and his slab', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const lump = s => { const e = spawn(s, 'mohkale', 20, 16, { damageCooldown: 0 }); runAll(s, 0.3); return e }

  it('stops a blade and an arrow with a clank while it is up', () => {
    const s = world(), e = lump(s)
    assert.equal(mohkale.slabUp(e), true)
    for (const blow of [BLADE, ARROW]) {
      const r = strikeCreature(e, s, 3, blow)
      assert.equal(r.absorbed, true)
      assert.equal(r.cue, 'clank')
      assert.ok(r.entity === e)
    }
    assert.equal(e.hp, 8)
    assert.equal(e.channels.slab, 1)
  })

  it('never stops a spell, fire, lightning or a falling stone', () => {
    const s = world(), e = lump(s)
    for (const blow of [SPELL, { source: 'fire' }, { source: 'lightning' }, { source: 'rockfall' }, { source: 'slam' }]) {
      const hp = e.hp
      assert.equal(strikeCreature(e, s, 1, blow).absorbed, false, JSON.stringify(blow))
      assert.equal(e.hp, hp - 1)
    }
    assert.equal(e.inCombat, true)
  })

  it('is down while he swings and for a while after, then up again', () => {
    const s = world(), e = lump(s), T = tuningOf('mohkale')
    e.attack = { phase: 'swing', timer: 0.3, duration: 0.3, angle: 0 }
    runAll(s, 0.1)
    assert.equal(mohkale.slabUp(e), false)
    assert.ok(e.channels.slab < 1, 'the slab is seen coming down')
    assert.equal(strikeCreature(e, s, 2, BLADE).absorbed, false)
    assert.equal(e.hp, 6)
    e.attack = null
    runAll(s, T.open - 0.2)
    assert.equal(mohkale.slabUp(e), false, 'still open after the swing')
    assert.equal(e.channels.slab, 0)
    assert.equal(strikeCreature(e, s, 1, ARROW).absorbed, false)
    runAll(s, 0.4)
    assert.equal(mohkale.slabUp(e), true)
    assert.equal(strikeCreature(e, s, 1, BLADE).absorbed, true)
    assert.equal(e.hp, 5)
  })

  it('is down whenever a spell holds him: slowed, rooted, frozen, stunned', () => {
    for (const hold of [e => applySlow(e, 0.5, 2), e => applyRoot(e, 2), e => applyFreeze(e, 2), e => { e.stunTimer = 2 }]) {
      const s = world(), e = lump(s)
      hold(e)
      assert.equal(mohkale.slabUp(e), false)
      assert.equal(strikeCreature(e, s, 1, BLADE).absorbed, false)
      assert.equal(e.channels.slab, 0, 'a blow that lands on a held one shows the slab down at once')
      runAll(s, 2.3)
      assert.equal(mohkale.slabUp(e), true)
    }
  })

  it('a blade on a frozen one shatters the rime for two more, and shoves him', () => {
    const s = world(), e = lump(s)
    applyFreeze(e, 2)
    strikeCreature(e, s, 1, { ...BLADE, knockback: 30 })
    assert.equal(e.hp, 8 - 3)
    assert.equal(e.frozen, false)
    assert.ok(e.knockback, 'shoved away from the hero')
  })

  it('shows red eyes while the drum has him, and copes with a first frame before any pose', () => {
    const s = world(), e = spawn(s, 'mohkale', 20, 16)
    assert.equal(e.pose, undefined)
    mohkale.update(e, s, DT)
    assert.equal(strikeCreature(e, s, 1, BLADE).absorbed, true)
    applyHaste(e, 1.3, 1)
    runAll(s, 0.1)
    assert.equal(e.channels.stirred, 1)
    runAll(s, 1.2)
    assert.equal(e.channels.stirred, 0)
    // which way he faces follows his heading only when it leans well to a side
    assert.equal(e.channels.side, 1)
    e.pose.facing = Math.PI * 0.9; runAll(s, 0.05)
    assert.equal(e.channels.side, -1)
    e.pose.facing = -Math.PI / 2 + 0.1; runAll(s, 0.05)
    assert.equal(e.channels.side, -1, 'walking up the screen he keeps the side he had')
    e.pose.facing = 0.2; runAll(s, 0.05)
    assert.equal(e.channels.side, 1)
    assert.equal(typeof mohkale.debugState(e), 'string')
  })
})

describe('the rockfall', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const owner = s => spawn(s, 'louhija', 5, 5)
  const at = (x, y) => ({ px: x * S + S / 2, py: y * S + S / 2 })

  it('lands where it was marked, after the shadow has grown, and hurts the hero under it', () => {
    const s = world(), o = owner(s)
    dropStones(s, o, [at(20, 20)], STONES)
    assert.equal(o.stones.length, 1)
    assert.equal(o.stones[0].px, 20 * S + S / 2)
    for (let i = 0; i < Math.round((STONES.fall - 0.1) * 60); i++) tickStones(s, o, DT, STONES)
    assert.equal(s.player.hp, 10, 'nothing yet: the shadow is still growing')
    assert.equal(count(s, 'rockfall'), 0)
    for (let i = 0; i < 12; i++) tickStones(s, o, DT, STONES)
    assert.equal(s.player.hp, 10 - STONES.stoneDmg)
    assert.equal(count(s, 'rockfall'), 1)
    for (let i = 0; i < 60; i++) tickStones(s, o, DT, STONES)
    assert.equal(o.stones.length, 0, 'the stone and its dust are gone')
    assert.equal(s.player.hp, 10 - STONES.stoneDmg)
  })

  it('comes from above: a raised shield is no help, a step out of the mark is', () => {
    const s = world(), o = owner(s)
    raiseShield(s, 'north')
    dropStones(s, o, [at(20, 19.5)], STONES)
    for (let i = 0; i < 70; i++) tickStones(s, o, DT, STONES)
    assert.equal(s.player.hp, 10 - STONES.stoneDmg)

    const t = world(), p = owner(t)
    dropStones(t, p, [at(20, 20)], STONES)
    moveHero(t, 20 + STONES.stoneR + 0.3, 20)
    for (let i = 0; i < 70; i++) tickStones(t, p, DT, STONES)
    assert.equal(t.player.hp, 10)
  })

  it('never reaches a hero on the coach', () => {
    const s = world(), o = owner(s)
    s.player.riding = true
    dropStones(s, o, [at(20, 20)], STONES)
    for (let i = 0; i < 70; i++) tickStones(s, o, DT, STONES)
    assert.equal(s.player.hp, 10)
  })

  it('hurts a troll under a stone (his slab is no roof), once a volley, and never the one who called it', () => {
    const s = world(), o = owner(s)
    moveHero(s, 35, 35)
    const lumpUnder = spawn(s, 'mohkale', 12, 12), lumpAway = spawn(s, 'mohkale', 16, 12)
    runAll(s, 0.2)
    assert.equal(mohkale.slabUp(lumpUnder), true)
    dropStones(s, o, [at(12, 12), at(12.3, 12), at(5, 5)], STONES)
    for (let i = 0; i < 70; i++) tickStones(s, o, DT, STONES)
    assert.equal(lumpUnder.hp, 8 - STONES.trollDmg)
    assert.equal(lumpAway.hp, 8)
    assert.equal(o.hp, 4)
    assert.equal(s.player.hp, 10)
  })

  it('draws a shadow that grows, then a stone and its dust', () => {
    const s = world(), o = owner(s)
    dropStones(s, o, [at(6, 5)], STONES)
    const shadowW = () => { const c = recordingCtx(); drawStones(c, o, 32); return Math.max(...fills(c).map(f => f[3])) }
    for (let i = 0; i < 6; i++) tickStones(s, o, DT, STONES)
    const early = shadowW()
    for (let i = 0; i < 48; i++) tickStones(s, o, DT, STONES)
    const late = shadowW()
    assert.ok(late > early, `${early} -> ${late}`)
    const falling = recordingCtx(); drawStones(falling, o, 32)
    for (let i = 0; i < 10; i++) tickStones(s, o, DT, STONES)
    const landed = recordingCtx(); drawStones(landed, o, 32)
    assert.ok(fills(landed).length > 4)
    assert.notDeepEqual(landed.ops, falling.ops)
    assert.equal(landed.ops.filter(o => o[0] === 'save').length, landed.ops.filter(o => o[0] === 'restore').length)
    // nothing to draw, nothing drawn
    const none = recordingCtx(); drawStones(none, { px: 0, py: 0 }, 32)
    assert.equal(fills(none).length, 0)
  })
})

describe('Louhija', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const T = () => tuningOf('louhija')
  // the hero six tiles south of him
  const scene = () => { const s = world(), e = spawn(s, 'louhija', 20, 14); return { s, e } }

  it('raises his staff, pinned, then marks three spots: under the hero, ahead of him, beside him', () => {
    const { s, e } = scene()
    runAll(s, T().first + 0.1)
    assert.equal(e.quarry.wind > 0, true, 'the staff is going up')
    assert.ok(e.pose.eyeGlow > 0 && e.pose.eyeGlow < 1)
    assert.equal(e.stones?.length ?? 0, 0)
    // the brain would walk him: he stays where he stood
    const px = e.px
    runAll(s, T().raise - 0.2, () => { e.px += 2 })
    assert.equal(e.px, px)
    // the hero walks east at a walk's pace from here on
    runAll(s, 0.3, () => moveHero(s, (s.player.px + 2 - S / 2) / S, 20))
    assert.equal(e.stones.length, 3)
    assert.equal(e.pose.eyeGlow, 0)
    const [under, ahead, beside] = e.stones
    const hero = s.player
    // (he has walked on for a fifth of a second since)
    assert.ok(Math.hypot(under.px - hero.px, under.py - hero.py) < S, 'one where he stood')
    assert.ok(ahead.px - under.px > T().lead * 120 * 0.6, `one where he will be: ${(ahead.px - under.px).toFixed(0)} px ahead`)
    const off = Math.hypot(beside.px - under.px, beside.py - under.py)
    assert.ok(off > S * 0.8 && off < S * 2.5, `one beside: ${off.toFixed(0)} px`)
    // free again while the shadows grow
    runAll(s, 0.1, () => { e.px += 1 })
    assert.ok(e.px > px)
  })

  it('his stones land on a hero who stands still, and not on one who keeps moving', () => {
    const still = scene()
    runAll(still.s, T().first + T().raise + T().fall + 0.3)
    assert.equal(still.s.player.hp, 10 - T().stoneDmg)
    assert.ok(count(still.s, 'rockfall') >= 1)

    const { s } = scene()
    runAll(s, T().first + T().raise + 0.05)
    moveHero(s, 20, 20 + 4)
    runAll(s, T().fall + 0.3)
    assert.equal(s.player.hp, 10)
  })

  it('calls again only after his rest, and not at a hero out of reach or out of sight', () => {
    const { s, e } = scene()
    runAll(s, T().first + T().raise + 0.1)
    assert.equal(e.stones.length, 3)
    runAll(s, T().every - T().raise - 0.5)
    assert.ok(!(e.quarry.wind > 0), 'resting')
    runAll(s, 1)
    assert.ok(e.quarry.wind > 0 || e.stones.some(m => m.t < 0.5), 'the next call')

    const far = world(), a = spawn(far, 'louhija', 20, 20 - T().range - 1.5)
    runAll(far, T().first + 2)
    assert.equal(a.stones?.length ?? 0, 0)

    const blind = world(), b = spawn(blind, 'louhija', 20, 14)
    for (let x = 0; x < 40; x++) blind.map[17][x] = { tile: TILE.WALL }
    runAll(blind, T().first + 2)
    assert.equal(b.stones?.length ?? 0, 0)
  })

  it('a hero who dies or rides off ends the wind-up: nothing is called and he is free', () => {
    for (const over of [{ hp: 0 }, { riding: true }]) {
      const { s, e } = scene()
      runAll(s, T().first + 0.2)
      assert.ok(e.quarry.wind > 0)
      Object.assign(s.player, over)
      runAll(s, 0.1)
      assert.ok(!(e.quarry.wind > 0), JSON.stringify(over))
      assert.equal(e.pose.eyeGlow, 0)
      const px = e.px
      runAll(s, 1, () => { e.px += 1 })
      assert.ok(e.px > px, 'not pinned')
      assert.equal(e.stones?.length ?? 0, 0)
    }
  })

  it('copes with a first frame before any pose; his stones go when he does', () => {
    const { s, e } = scene()
    assert.equal(e.pose, undefined)
    e.quarry = undefined
    louhija.update(e, s, DT)
    runAll(s, T().first + T().raise + 0.2)
    assert.equal(e.stones.length, 3)
    const ctx = recordingCtx()
    louhija.drawFx(ctx, e, 32)
    assert.ok(fills(ctx).length >= 3)
    const r = hurtCreature(s, e, 9, BLADE)
    assert.equal(r.absorbed, false)
    assert.ok(e.hp <= 0)
    assert.equal(e.stones.length, 0)
    assert.equal(typeof louhija.debugState(e), 'string')
  })
})

describe('Rumpali', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const T = () => tuningOf('rumpali')
  // the drummer five tiles north of the hero, a Lump beside him, another far off
  function band() {
    const s = world()
    const d = spawn(s, 'rumpali', 20, 15, { damageCooldown: 0 })
    const near = spawn(s, 'mohkale', 22, 15, { damageCooldown: 0 })
    const far = spawn(s, 'mohkale', 20 + T().reach + 2, 15, { damageCooldown: 0 })
    return { s, d, near, far }
  }

  it('beats his drum while the hero is in sight and in earshot, a beat every so often', () => {
    const { s, d } = band()
    runAll(s, T().beat * 4 + 0.1)
    const n = count(s, 'drum')
    assert.ok(n === 4 || n === 5, `${n} beats`)
    assert.ok(d.channels.drum > 0)
    assert.ok(s.sfx.cues.find(c => c.name === 'drum').px === d.px)
  })

  it('stirs every other troll in reach: haste, and a little off the swing\'s recovery', () => {
    const { s, d, near, far } = band()
    near.damageCooldown = 5; far.damageCooldown = 5
    runAll(s, T().beat + 0.1)
    assert.equal(hasteMul(near), T().haste)
    assert.ok(near.hasteTimer <= T().stir && near.hasteTimer > T().stir - 0.7)
    assert.equal(near.channels.stirred, 1)
    assert.equal(hasteMul(far), 1)
    assert.equal(hasteMul(d), 1, 'not himself')
    const spent = T().beat + 0.1
    assert.ok(Math.abs(near.damageCooldown - (5 - spent - T().quicken)) < 0.05, `near ${near.damageCooldown}`)
    assert.ok(Math.abs(far.damageCooldown - (5 - spent)) < 0.05, `far ${far.damageCooldown}`)
  })

  it('every sixth beat mends the stirred by one: never above whole, never the King', () => {
    const { s, near, far } = band()
    const k = spawn(s, 'vuorenkuningas', 18, 14, { damageCooldown: 0 })
    k.king = { ...king.ensure(k), boulderCd: 99, stompCd: 99 }
    near.hp = 5; far.hp = 5; k.hp = 30
    runAll(s, T().beat * (T().mendEvery - 1) + 0.2)
    assert.equal(near.hp, 5, 'not before the sixth')
    runAll(s, T().beat)
    assert.equal(near.hp, 5 + T().mend)
    assert.equal(far.hp, 5)
    assert.equal(k.hp, 30)
    assert.ok(hasteMul(k) > 1, 'the King is stirred all the same')
    near.hp = 8
    runAll(s, T().beat * T().mendEvery)
    assert.equal(near.hp, 8)
  })

  it('a blow silences him for a while', () => {
    const { s, d, near } = band()
    runAll(s, T().beat + 0.1)
    const r = strikeCreature(d, s, 1, BLADE)
    assert.equal(r.absorbed, false)
    assert.equal(d.hp, 4)
    s.sfx.cues.length = 0
    runAll(s, T().silence - 0.2)
    assert.equal(count(s, 'drum'), 0)
    assert.equal(d.channels.drum, 0)
    assert.equal(hasteMul(near), 1, 'the stir has run out')
    runAll(s, T().beat + 0.4)
    assert.ok(count(s, 'drum') >= 1)
  })

  it('is quiet with nobody to drum for, and drums for a troll that fights near him', () => {
    const { s, d, near } = band()
    moveHero(s, 20, 15 + T().hear + 2)
    runAll(s, 2)
    assert.equal(count(s, 'drum'), 0)
    assert.equal(d.channels.drum, 0)
    near.ai = { mode: 'chase' }                // (the brain's: he has the hero in sight)
    runAll(s, T().beat + 0.1)
    assert.ok(count(s, 'drum') >= 1)
    // nobody drums over a dead hero
    s.sfx.cues.length = 0
    s.player.hp = 0
    runAll(s, 2)
    assert.equal(count(s, 'drum'), 0)
  })

  it('draws his notes while he drums, and nothing when silent', () => {
    const { s, d } = band()
    const silent = recordingCtx()
    rumpali.drawFx(silent, d, 32)
    assert.equal(fills(silent).length, 0)
    runAll(s, T().beat + 0.15)
    const ctx = recordingCtx()
    rumpali.drawFx(ctx, d, 32)
    assert.ok(fills(ctx).length >= 2)
    assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
    assert.equal(typeof rumpali.debugState(d), 'string')
  })
})

describe('Vuorenkuningas', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const T = () => tuningOf('vuorenkuningas')
  // the King six tiles north of the hero
  const hall = (x = 20, y = 14) => { const s = world(), e = spawn(s, 'vuorenkuningas', x, y, { damageCooldown: 0, lootDepth: 3 }); return { s, e } }
  const lift = ({ s, e }) => { runAll(s, T().first + 0.1); assert.equal(e.king.state, 'lift'); return e }

  it('lifts a boulder, pinned and with his fists stilled, then rolls it along the line to the hero', () => {
    const h = hall(), { s } = h, e = lift(h)
    assert.ok(e.pose.eyeGlow > 0)
    assert.ok(e.channels.lift > 0)
    const px = e.px
    runAll(s, T().lift - 0.3, () => { e.px += 2 })
    assert.equal(e.px, px, 'pinned')
    assert.ok(e.damageCooldown > 0, 'no fist while he holds a boulder')
    assert.equal(e.boulder, null)
    moveHero(s, 30, 30)                      // the hero steps well aside as it leaves his hands
    runAll(s, 0.3)
    assert.equal(e.king.state, 'walk')
    assert.equal(count(s, 'boulder'), 1)
    const b = e.boulder
    assert.ok(b, 'rolling')
    assert.ok(Math.abs(b.dx) < 0.05 && b.dy > 0.99, 'south, to where the hero stood')
    const y0 = b.py
    runAll(s, 0.5)
    assert.ok(Math.abs((e.boulder.py - y0) - T().boulderSpeed * 0.5) < 6, `${(e.boulder.py - y0).toFixed(0)} px in half a second`)
    assert.equal(s.player.hp, 10)
    const ctx = recordingCtx()
    king.drawFx(ctx, e, 32)
    assert.ok(fills(ctx).length >= 4, 'the boulder is drawn')
    // it is gone after its run
    runAll(s, T().boulderRange * S / T().boulderSpeed)
    assert.equal(e.boulder, null)
  })

  it('the boulder takes three off the hero and throws him, once', () => {
    const h = hall(), { s } = h, e = lift(h)
    runAll(s, T().lift + 6 * S / T().boulderSpeed + 0.3, () => { s.player.knockback = null })
    assert.equal(s.player.hp, 10 - T().boulderDmg)
    // still rolling, and over him again does nothing
    s.player.invulnTimer = 0
    if (e.boulder) moveHero(s, (e.boulder.px - S / 2) / S, (e.boulder.py - S / 2) / S)
    runAll(s, 0.2)
    assert.equal(s.player.hp, 10 - T().boulderDmg)
  })

  it('throws the hero along its way, and a shield that faces it takes it', () => {
    const h = hall(), { s } = h; lift(h)
    runAll(s, T().lift + 6 * S / T().boulderSpeed + 0.3)
    assert.equal(s.player.hp, 10 - T().boulderDmg)
    assert.ok(s.player.knockback.vy > 0 && Math.abs(s.player.knockback.vx) < 1, 'thrown south, the way it rolls')
    const g = hall(); raiseShield(g.s, 'north'); lift(g)
    runAll(g.s, T().lift + 6 * S / T().boulderSpeed + 0.3)
    assert.equal(g.s.player.hp, 10)
    assert.ok(count(g.s, 'shield-block') >= 1)
  })

  it('the boulder stops at a wall', () => {
    const h = hall(), { s } = h
    for (let x = 0; x < 40; x++) s.map[24][x] = { tile: TILE.WALL }
    const e = lift(h)
    runAll(s, T().lift + 0.1)
    moveHero(s, 30, 21)
    let maxY = 0
    runAll(s, 4, () => { if (e.boulder) maxY = Math.max(maxY, e.boulder.py) })
    assert.ok(maxY > 22 * S && maxY < 24 * S, `it got to ${(maxY / S).toFixed(1)}`)
    assert.equal(e.boulder, null)
  })

  it('the boulder rolls over a troll in its way: three to him, once, slab or no slab', () => {
    const h = hall(), { s } = h
    const l = spawn(s, 'mohkale', 20, 17, { damageCooldown: 0 })
    const beside = spawn(s, 'mohkale', 23, 17, { damageCooldown: 0 })
    const e = lift(h)
    runAll(s, T().lift + 0.1)
    moveHero(s, 30, 30)
    runAll(s, 3)
    assert.equal(l.hp, 8 - T().boulderDmg)
    assert.equal(beside.hp, 8)
    assert.equal(e.hp, 40, 'never himself')
  })

  it('no boulder at a hero too far, out of sight or on the coach', () => {
    for (const set of [s => moveHero(s, 20, 14 + T().boulderMax + 2), s => { for (let x = 0; x < 40; x++) s.map[17][x] = { tile: TILE.WALL } }, s => { s.player.riding = true }]) {
      const h = hall(); set(h.s)
      runAll(h.s, T().first + 1.5)
      assert.equal(h.e.king.state, 'walk')
      assert.equal(h.e.boulder ?? null, null)
    }
  })

  it('rears and stomps at a hero close by: two and a throw from the ground, and four marks round him', () => {
    const { s, e } = hall(20, 18)
    raiseShield(s, 'north')
    runAll(s, T().first + 0.1)
    assert.equal(e.king.state, 'rear')
    assert.ok(e.channels.rear > 0)
    const px = e.px
    runAll(s, T().rear - 0.2, () => { e.px += 2 })
    assert.equal(e.px, px, 'pinned')
    assert.equal(s.player.hp, 10)
    runAll(s, 0.2)
    assert.equal(s.player.hp, 10 - T().stompDmg, 'no shield stops it')
    assert.ok(s.player.knockback.vy > 0, 'thrown away from him')
    assert.equal(count(s, 'stomp'), 1)
    assert.equal(e.stones.length, 4)
    for (const m of e.stones) {
      const d = Math.hypot(m.px - s.player.px, m.py - s.player.py) / S
      assert.ok(d > 0.5 && d < 3.5, `a mark ${d.toFixed(1)} tiles from him`)
    }
    const ctx = recordingCtx()
    king.drawFx(ctx, e, 32)
    assert.ok(fills(ctx).length >= 12, 'the ring and the shadows')
    assert.equal(e.king.state, 'walk')
    // and not again at once
    s.player.knockback = null
    runAll(s, 1)
    assert.equal(e.king.state, 'walk')
  })

  it('the stomp misses a hero who got out of the ring; a dead or riding hero ends any wind-up', () => {
    const { s, e } = hall(20, 18)
    runAll(s, T().first + 0.1)
    assert.equal(e.king.state, 'rear')
    moveHero(s, 20, 18 + T().stompReach + 1)
    runAll(s, T().rear + 0.1)
    assert.equal(s.player.hp, 10)

    for (const [x, y, state] of [[20, 18, 'rear'], [20, 14, 'lift']]) for (const over of [{ hp: 0 }, { riding: true }]) {
      const h = hall(x, y)
      runAll(h.s, T().first + 0.2)
      assert.equal(h.e.king.state, state)
      Object.assign(h.s.player, over)
      runAll(h.s, 0.1)
      assert.equal(h.e.king.state, 'walk', `${state} ${JSON.stringify(over)}`)
      assert.equal(h.e.pose.eyeGlow, 0)
      const px = h.e.px
      runAll(h.s, 1.5, () => { h.e.px += 1 })
      assert.ok(h.e.px > px, 'not pinned for ever')
      assert.equal(h.e.boulder ?? null, null)
    }
  })

  it('the hall answers once, at half health: a bellow, then two Lumps and a drummer out of the rock', () => {
    const { s, e } = hall()
    e.king = { ...king.ensure(e), boulderCd: 99, stompCd: 99 }
    runAll(s, 0.5)
    assert.equal(s.entities.length, 1)
    e.hp = 20
    runAll(s, 0.1)
    assert.equal(e.king.state, 'bellow')
    assert.equal(count(s, 'troll-bellow'), 1)
    assert.ok(e.channels.bellow > 0)
    const px = e.px
    runAll(s, T().bellow - 0.3, () => { e.px += 2 })
    assert.equal(e.px, px, 'pinned')
    assert.equal(s.entities.length, 1, 'nobody yet')
    runAll(s, 0.4)
    const came = s.entities.filter(o => o !== e)
    assert.deepEqual(came.map(o => o.type).sort(), ['mohkale', 'mohkale', 'rumpali'])
    for (const o of came) {
      assert.equal(o.summoned, true)
      const d = tilesApart(o, e)
      assert.ok(d >= 4.9 && d <= 7.1, `${o.type} at ${d.toFixed(1)}`)
      assert.equal(o.lootDepth, 3)
      assert.equal(s.map[o.y][o.x].tile, TILE.FLOOR)
    }
    assert.equal(new Set(came.map(o => `${o.x},${o.y}`)).size, 3, 'each on a cell of its own')
    // never again
    e.hp = 5
    runAll(s, 3)
    assert.equal(s.entities.filter(o => o !== e && o.summoned).length, 3)
    assert.equal(count(s, 'troll-bellow'), 1)
  })

  it('a hero who dies in the bellow is not answered; the hall still answers the next one', () => {
    const { s, e } = hall()
    e.king = { ...king.ensure(e), boulderCd: 99, stompCd: 99 }
    e.hp = 20
    runAll(s, 0.3)
    assert.equal(e.king.state, 'bellow')
    s.player.hp = 0
    runAll(s, 2)
    assert.equal(e.king.state, 'walk')
    assert.equal(s.entities.length, 1)
    s.player.hp = 10
    runAll(s, T().bellow + 0.3)
    assert.equal(s.entities.length, 4)
  })

  it('his moves come round faster as he weakens', () => {
    const whole = { hp: 40, maxHp: 40 }, half = { hp: 20, maxHp: 40 }, spent = { hp: 0, maxHp: 40 }
    assert.equal(king.pace(whole, T()), 1)
    assert.ok(Math.abs(king.pace(spent, T()) - T().frenzy) < 1e-9)
    assert.ok(king.pace(half, T()) < 1 && king.pace(half, T()) > T().frenzy)
    // as played: the rest after a boulder, whole and nearly spent
    const rest = hp => {
      const h = hall(); h.e.king = { ...king.ensure(h.e), called: true }; h.e.hp = hp
      runAll(h.s, T().first + T().lift + 0.2, () => moveHero(h.s, 20, 20))
      return h.e.king.boulderCd
    }
    assert.ok(rest(4) < rest(40) * 0.7, `${rest(4).toFixed(1)} against ${rest(40).toFixed(1)}`)
  })

  it('takes blows whole and is not shoved; the blow that fells him grants Kivinahka, once', () => {
    const { s, e } = hall()
    runAll(s, 0.1)
    const r = strikeCreature(e, s, 3, { ...BLADE, knockback: 40 })
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 37)
    assert.ok(!e.knockback)
    assert.equal(s.player.talents?.includes('kivinahka') ?? false, false)
    e.boulder = { px: e.px, py: e.py, dx: 0, dy: 1, left: 99, over: [] }
    hurtCreature(s, e, 50, ARROW)
    assert.ok(e.hp <= 0)
    assert.equal(s.player.talents.includes('kivinahka'), true)
    assert.equal(e.boulder, null, 'what he had rolling is gone with him')
    const d = deathDrop(e, getMonsterDef('vuorenkuningas'), depth => ({ depth }))
    assert.equal(d.kind, 'floating_pickup')
    assert.equal(d.contents.depth, 3)
    // a second King
    const k2 = spawn(s, 'vuorenkuningas', 10, 10)
    hurtCreature(s, k2, 50, BLADE)
    assert.equal(s.player.talents.filter(t => t === 'kivinahka').length, 1)
    assert.equal(typeof king.debugState(e), 'string')
  })

  it('copes with a first frame before any pose', () => {
    const { s, e } = hall(20, 18)
    assert.equal(e.pose, undefined)
    e.king = { ...king.ensure(e), stompCd: 0, boulderCd: 0 }
    king.update(e, s, DT)
    king.update(e, s, DT)
    assert.equal(e.king.state, 'rear')
    const ctx = recordingCtx()
    king.drawFx(ctx, e, 32)
    assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
  })
})
