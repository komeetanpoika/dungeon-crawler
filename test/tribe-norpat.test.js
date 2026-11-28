// The seal folk (Norppaväki): the trader, the singer, the guard, Mursu-ukko
// the walrus and his gong, each run the way game.js runs it (frame() below:
// the tribes' tick, the enemy loop's three paths, the projectiles, the hero's
// throw), on the real defs and rigs.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as kauppias from '../renderer/systems/monsters/norppakauppias.js'
import * as laulaja from '../renderer/systems/monsters/norppalaulaja.js'
import * as vahti from '../renderer/systems/monsters/norppavahti.js'
import * as mursu from '../renderer/systems/monsters/mursu.js'
import * as kumistin from '../renderer/systems/monsters/kumistin.js'
import { tuningOf, isStoryCreature, getMonsterDef, updateMonsterPose, entityPose } from '../renderer/systems/monsters.js'
import { CREATURE_HIT, CREATURE_UPDATE, hurtCreature } from '../renderer/systems/creatures.js'
import { tickTribes, noteBlow, wrathOf, clearWrath, angerTribe, atPeace, tribeOf, roleOf } from '../renderer/systems/tribes.js'
import { isEnemy, isHittable, isSpellTarget } from '../renderer/systems/factions.js'
import { stepProjectiles } from '../renderer/systems/projectiles.js'
import { stepKnockback } from '../renderer/systems/knockback.js'
import { damagePlayer } from '../renderer/systems/player-damage.js'
import { poisonPlayer, isPoisoned } from '../renderer/systems/poison.js'
import { hasTalent } from '../renderer/systems/talents.js'
import { deathDrop } from '../renderer/systems/drops.js'
import { tickStatus } from '../renderer/systems/status.js'
import { updateBrain } from '../renderer/systems/brain.js'
import { act } from '../renderer/systems/act.js'
import { canMoveTo } from '../renderer/systems/movement.js'
import { TILE, makeShieldContents } from '../renderer/systems/entities.js'
import { register, world, spawn, moveHero, cues, tilesApart, S } from './helpers/desert-bench.js'
import { recordingCtx } from './helpers/rig-contract.js'

const NAMES = ['norppakauppias', 'norppalaulaja', 'norppavahti', 'mursu', 'kumistin']
const HOOKS = { norppakauppias: kauppias, norppalaulaja: laulaja, norppavahti: vahti, mursu, kumistin }
const T = name => tuningOf(name)
const DT = 1 / 60

// One of the seals, built as game.js builds a tribe's member (at peace when its tribe is).
function seal(s, name, x, y, over = {}) {
  const e = spawn(s, name, x, y, { lootDepth: 2, damageCooldown: 0, ...over })
  e.peaceful = atPeace(s, e)
  return e
}
// Something with teeth that is no seal.
function wolf(s, x, y, hp = 3) {
  const e = { type: 'monster', variant: 'weak', x, y, px: x * S + S / 2, py: y * S + S / 2, hp, maxHp: hp, damageCooldown: 0 }
  s.entities.push(e)
  return e
}
const projectileHooks = s => ({
  isHittable,
  hurt: (e, dmg, p) => {
    if (p?.friendly && !p.tribe) noteBlow(s, e)
    if (CREATURE_HIT[e.type] && getMonsterDef(e.type)) hurtCreature(s, e, dmg, { source: p?.source ?? 'player' })
    else { e.hp -= dmg; e.inCombat = true }
    return e
  },
  detonate() {},
  damagePlayer: (dmg, from) => damagePlayer(s, dmg, 'hit', from),
  cull: list => list.filter(e => !(e.maxHp !== undefined && e.hp <= 0)),
})
// A frame of the game, as far as the seals can tell.
function frame(s, dt = DT) {
  const p = s.player
  p.invulnTimer = Math.max(0, (p.invulnTimer ?? 0) - dt)
  tickTribes(s, dt)
  for (const e of [...s.entities]) {
    if (!getMonsterDef(e.type)) continue
    tickStatus(e, dt)
    if (isStoryCreature(e) || e.peaceful) { CREATURE_UPDATE[e.type]?.(e, s, dt); updateMonsterPose(e, dt); continue }
    if (!isEnemy(e)) continue
    if (e.stunTimer > 0) { e.stunTimer -= dt; continue }
    act(e, s, dt, updateBrain(e, s, dt))
    updateMonsterPose(e, dt)
    CREATURE_UPDATE[e.type]?.(e, s, dt)
  }
  stepProjectiles(s, dt, projectileHooks(s))
  stepKnockback(p, dt, (px, py) => canMoveTo(s.map, px, py))
}
function run(s, seconds, each = null) {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) { if (each?.(i) === false) return i; frame(s) }
  return n
}
// The player's own blade (or shot) on `e`, as game.js lands it.
function blow(s, e, dmg = 1, via = 'melee') {
  noteBlow(s, e)
  if (CREATURE_HIT[e.type]) return hurtCreature(s, e, dmg, { source: 'player', via })
  e.hp -= dmg; e.inCombat = true
  return { absorbed: false }
}
const said = s => s.feedback.bubble?.text ?? null
const raiseShield = (s, facing) => {
  const { type, ...buckler } = makeShieldContents('buckler')
  s.player.gear.melee.off = { kind: 'shield', ...buckler }
  Object.assign(s.player, { facing, blocking: true })
}
const fxOps = (hooks, e) => { const ctx = recordingCtx(); hooks.drawFx(ctx, e, 32); return ctx.ops }

beforeEach(() => register(NAMES, HOOKS))

describe('the seal folk: defs', () => {
  it('are of the tribe, dealt by the Wilds only, hook-driven, every tuning key present', () => {
    const roles = { norppakauppias: 'vendor', norppalaulaja: 'healer', norppavahti: 'fighter', mursu: 'boss', kumistin: 'gong' }
    for (const name of NAMES) {
      const d = getMonsterDef(name)
      assert.equal(d.behavior.tribe, 'norpat', name)
      assert.equal(d.behavior.role, roles[name], name)
      assert.equal(d.behavior.driver, 'hook', name)
      assert.equal(d.spawn, null, name)
      assert.deepEqual(d.warnings, [], name)
      assert.ok(Array.isArray(HOOKS[name].TUNING_SCHEMA) && HOOKS[name].TUNING_SCHEMA.length, name)
      for (const p of HOOKS[name].TUNING_SCHEMA) assert.ok(p.key in T(name), `${name}.${p.key}`)
      assert.equal(typeof CREATURE_UPDATE[name], 'function', name)
      assert.equal(d.behavior.weapon, undefined, name)
    }
    assert.equal(getMonsterDef('norppakauppias').rigId, 'seal')
    assert.equal(getMonsterDef('kumistin').rigId, 'gong')
    assert.equal(getMonsterDef('kumistin').behavior.calm, true)
    assert.equal(getMonsterDef('kumistin').behavior.passive, true)
    assert.deepEqual([6, 5, 9, 30].map((_, i) => getMonsterDef(NAMES[i]).stats.hp), [6, 5, 9, 30])
    assert.equal(getMonsterDef('mursu').behavior.drops, 'chest')
    assert.ok(getMonsterDef('mursu').stats.half < 16, 'the walrus fits the ring\'s mouth')
  })

  it('hold the spec\'s numbers', () => {
    const L = T('norppalaulaja'), V = T('norppavahti'), M = T('mursu')
    assert.deepEqual([L.reach, L.wait, L.beat, L.most, L.doze], [2.2, 1.5, 1.2, 8, 45])
    assert.deepEqual([V.watch, V.dmg, V.every, V.arm, V.far], [6, 2, 1.8, 0.4, 6])
    // (the flop starts from 1.5 tiles, not the spec's 2: where the bellow's reach ends)
    assert.deepEqual([M.rear, M.leap, M.flopDmg, M.flopR, M.flopMin, M.flopMax], [0.8, 0.5, 2, 2.2, 1.5, 6])
    assert.ok(M.flopMin <= M.bellowR, 'no ring of safety between the bellow and the flop')
    assert.deepEqual([M.aim, M.aimLock, M.rushSpeed, M.rushTime, M.chargeDmg, M.winded], [1, 0.7, 320, 1.3, 3, 1.8])
    assert.deepEqual([M.bellowR, M.bellowEvery, M.bellowWind, M.shove], [1.5, 6, 0.4, 3])
    assert.deepEqual([M.forfeit, M.rematch], [3, 60])
  })
})

describe('norppakauppias, the trader', () => {
  it('sits where it was dealt, at peace: no enemy, no spell target, nothing happens for a long while', () => {
    const s = world(), e = seal(s, 'norppakauppias', 20, 16)
    run(s, 5)
    assert.deepEqual([e.x, e.y], [20, 16])
    assert.equal(e.peaceful, true)
    assert.equal(isEnemy(e), false)
    assert.equal(isSpellTarget(e), false)
    assert.equal(!!e.brainDriven, false)
    assert.equal(s.projectiles.length, 0)
    assert.equal(s.player.hp, 10)
    assert.equal(typeof kauppias.debugState(e), 'string')
  })

  it('is drawn facing the side its heading leans to, and keeps that side going straight up or down', () => {
    const s = world(), e = seal(s, 'norppakauppias', 20, 16)
    moveHero(s, 18, 16); run(s, 0.2)
    assert.equal(entityPose(e).side, -1)
    for (const facing of [-Math.PI / 2, Math.PI / 2, -Math.PI / 2 + 0.1]) {
      e.pose.facing = facing
      moveHero(s, 30, 30); run(s, 0.05)
      assert.equal(entityPose(e).side, -1, `heading ${facing}`)
    }
    e.pose.facing = -0.8; run(s, 0.05)
    assert.equal(entityPose(e).side, 1)
    for (const name of ['norppalaulaja', 'norppavahti', 'mursu']) {
      const o = seal(s, name, 24, 24); run(s, 0.05)
      assert.equal(Math.abs(entityPose(o).side), 1, name)
    }
  })

  it('turns to the hero who comes by', () => {
    const s = world(), e = seal(s, 'norppakauppias', 20, 16)
    moveHero(s, 22, 16); run(s, 0.2)
    assert.ok(Math.cos(e.pose.facing) > 0)
    moveHero(s, 18, 16); run(s, 0.2)
    assert.ok(Math.cos(e.pose.facing) < 0)
  })

  it('wronged, it runs from the hero; at peace again it comes back to its mat', () => {
    const s = world(), e = seal(s, 'norppakauppias', 20, 16)
    moveHero(s, 20, 18); run(s, 0.5)
    blow(s, e)
    assert.ok(wrathOf(s, 'norpat') > 0)
    const d0 = tilesApart(e, s.player)
    run(s, 3)
    assert.equal(e.peaceful, false)
    assert.equal(e.brainDriven, true)
    assert.ok(tilesApart(e, s.player) > d0 + 2, `it ran ${tilesApart(e, s.player).toFixed(1)} tiles off`)
    assert.equal(s.player.hp, 10)
    clearWrath(s)
    moveHero(s, 30, 30)
    run(s, 12)
    assert.equal(e.peaceful, true)
    assert.equal(e.brainDriven, false)
    assert.ok(Math.hypot(e.px - (20 * S + 16), e.py - (16 * S + 16)) < S, 'home again')
  })

  it('copes with a first frame without a pose', () => {
    const s = world(), e = seal(s, 'norppakauppias', 20, 16)
    kauppias.update(e, s, DT)
    angerTribe(s, 'norpat')
    const f = seal(s, 'norppakauppias', 22, 16)
    kauppias.update(f, s, DT)
    assert.equal(f.brainDriven, true)
  })
})

describe('norppalaulaja, the singer', () => {
  const stage = (hp = 10, maxHp = 10) => {
    const s = world(), e = seal(s, 'norppalaulaja', 20, 16)
    moveHero(s, 20, 17)
    Object.assign(s.player, { hp, maxHp })
    return { s, e }
  }

  it('does not sing to a whole hero, nor to one who does not stay', () => {
    const { s, e } = stage()
    run(s, 4)
    assert.equal(e.song.state, 'listen')
    s.player.hp = 4
    run(s, T('norppalaulaja').wait - 0.3)
    moveHero(s, 20, 16 + T('norppalaulaja').reach + 1.5); run(s, 0.3)
    moveHero(s, 20, 17); run(s, T('norppalaulaja').wait - 0.3)
    assert.equal(e.song.state, 'listen')
    assert.equal(s.player.hp, 4)
    assert.deepEqual(fxOps(laulaja, e), [])
  })

  it('sings to a hurt hero who stays: 1 hp a beat, up to her limit, then she dozes', () => {
    const { s, e } = stage(1, 12), L = T('norppalaulaja')
    run(s, L.wait + 0.1)
    assert.equal(e.song.state, 'sing')
    assert.ok(e.channels.sing > 0)
    assert.ok(entityPose(e).sing > 0)
    assert.ok(cues(s).includes('seal-song'))
    assert.ok(fxOps(laulaja, e).length > 0, 'notes in the air')
    run(s, L.beat * 3)
    assert.equal(s.player.hp, 4)
    assert.ok(s.feedback.floats.some(f => f.kind === 'heal'))
    run(s, L.beat * 5 + 0.5)
    assert.equal(s.player.hp, 1 + L.most)
    assert.equal(e.song.state, 'doze')
    assert.ok(e.channels.doze > 0)
    assert.equal(e.quiet, true)
    run(s, 10)
    assert.equal(s.player.hp, 1 + L.most, 'asleep she mends nothing')
    assert.equal(e.channels.sing ?? 0, 0)
    moveHero(s, 20, 16 + L.reach + 2)
    run(s, L.doze - 9)
    assert.equal(e.song.state, 'listen')
    assert.equal(e.channels.doze ?? 0, 0)
    moveHero(s, 20, 17)
    run(s, L.wait + L.beat + 0.2)
    assert.equal(s.player.hp, 2 + L.most, 'awake she sings again')
  })

  it('stops when he is whole, never mending past his health', () => {
    const { s, e } = stage(8, 10), L = T('norppalaulaja')
    run(s, L.wait + L.beat * 4)
    assert.equal(s.player.hp, 10)
    assert.equal(e.song.state, 'doze')
  })

  it('takes poison away at once, from a whole hero too', () => {
    const { s, e } = stage(), L = T('norppalaulaja')
    poisonPlayer(s.player, 5)
    assert.equal(isPoisoned(s.player), true)
    run(s, L.wait + 0.1)
    assert.equal(isPoisoned(s.player), false)
    run(s, L.beat + 0.2)
    assert.equal(s.player.hp, 10)
    assert.equal(e.song.state, 'doze')
  })

  it('the song ends when he walks off', () => {
    const { s, e } = stage(2), L = T('norppalaulaja')
    run(s, L.wait + L.beat + 0.2)
    assert.equal(s.player.hp, 3)
    moveHero(s, 20, 16 + L.reach + 2)
    run(s, L.beat * 3)
    assert.equal(s.player.hp, 3)
    assert.equal(e.song.state, 'doze')
  })

  it('a hero who dies ends the song with nothing left hanging; one riding by is not sung to', () => {
    const { s, e } = stage(3), L = T('norppalaulaja')
    run(s, L.wait + 0.2)
    assert.equal(e.song.state, 'sing')
    s.player.hp = 0
    run(s, 0.5)
    assert.equal(e.song.state, 'listen')
    assert.equal(e.channels.sing ?? 0, 0)
    assert.equal(s.player.hp, 0)
    assert.deepEqual(fxOps(laulaja, e), [])
    Object.assign(s.player, { hp: 3, riding: true })
    run(s, L.wait + L.beat * 2)
    assert.equal(s.player.hp, 3)
    assert.equal(e.song.state, 'listen')
  })

  it('wronged in the middle of a song, she stops and runs; her sleep is over too', () => {
    const { s, e } = stage(3), L = T('norppalaulaja')
    run(s, L.wait + 0.2)
    blow(s, e)
    const hp = s.player.hp, d0 = tilesApart(e, s.player)
    run(s, 3)
    assert.equal(s.player.hp, hp)
    assert.equal(e.brainDriven, true)
    assert.equal(e.channels.sing ?? 0, 0)
    assert.equal(e.channels.doze ?? 0, 0)
    assert.ok(tilesApart(e, s.player) > d0 + 2)
    assert.deepEqual(fxOps(laulaja, e), [])
  })

  it('copes with a first frame without a pose', () => {
    const { s, e } = stage(3)
    laulaja.update(e, s, DT)
    assert.equal(e.song.state, 'listen')
    assert.deepEqual(fxOps(laulaja, e), [])
    assert.equal(typeof laulaja.debugState(e), 'string')
  })
})

describe('norppavahti, the guard', () => {
  it('at peace throws at an enemy in reach: his tribe\'s own shot, two a harpoon, and the pack is skewered', () => {
    const s = world({ hero: [26, 26] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    const w = wolf(s, 24, 20, 4)
    let arm = 0
    run(s, V.arm + 0.3, () => { arm = Math.max(arm, e.pose?.eyeGlow ?? 0); return !s.projectiles.length })
    assert.ok(arm > 0.3, 'his arm went back first')
    const p = s.projectiles[0]
    assert.ok(p, 'a harpoon in the air')
    assert.equal(p.friendly, true)
    assert.equal(p.tribe, 'norpat')
    assert.equal(p.source, 'harpoon')
    assert.equal(p.damage, V.dmg)
    assert.ok(p.dx > 0 && Math.abs(p.dy) < Math.abs(p.dx) * 0.2)
    assert.ok(cues(s).includes('harpoon'))
    run(s, 0.6)
    assert.equal(w.hp, 4 - V.dmg)
    assert.equal(wrathOf(s, 'norpat'), 0)
    run(s, V.every + V.arm + 0.6)
    assert.ok(!s.entities.includes(w), 'the second one finished it')
    assert.equal(e.peaceful, true)
    assert.deepEqual([e.x, e.y], [20, 20], 'and he never left his post')
    assert.equal(s.player.hp, 10)
  })

  it('throws no faster than his pace', () => {
    const s = world({ hero: [26, 26] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    wolf(s, 24, 20, 99)
    let thrown = 0, had = 0
    run(s, 6, () => { if (s.projectiles.length > had) thrown++; had = s.projectiles.length })
    assert.ok(thrown >= 2 && thrown <= Math.ceil(6 / V.every), `${thrown} in 6 s`)
    assert.equal(typeof vahti.debugState(e), 'string')
  })

  it('never throws at the hero, at a seal, at the walrus in a bout, beyond his reach or through a wall', () => {
    const s = world({ hero: [21, 20] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    seal(s, 'norppakauppias', 22, 20)
    const m = seal(s, 'mursu', 20, 23)
    assert.equal(mursu.startDuel(m, s), true)
    wolf(s, 20 + V.watch + 2, 20)
    const hidden = wolf(s, 20, 15)
    for (let x = 15; x <= 25; x++) s.map[17][x] = { tile: TILE.WALL }
    run(s, 4, () => { only(m, 'none') })
    assert.equal(s.projectiles.length, 0)
    assert.equal(s.player.hp, 10)
    assert.equal(hidden.hp, 3)
    assert.equal(isEnemy(m), true, '(the walrus in a bout is an enemy to everything else)')
  })

  it('a harpoon passes over the hero and the seals on its way', () => {
    const s = world({ hero: [22, 20] }), e = seal(s, 'norppavahti', 20, 20)
    const trader = seal(s, 'norppakauppias', 23, 20)
    const w = wolf(s, 25, 20, 5)
    run(s, 2)
    assert.ok(w.hp < 5)
    assert.equal(s.player.hp, 10)
    assert.equal(trader.hp, getMonsterDef('norppakauppias').stats.hp)
    assert.equal(wrathOf(s, 'norpat'), 0)
  })

  it('wronged, the brain drives him and he throws at the hero: a shot that hurts', () => {
    const s = world({ hero: [20, 24] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    run(s, 0.2)
    blow(s, e)
    run(s, 0.1)
    assert.equal(e.peaceful, false)
    assert.equal(e.brainDriven, true)
    assert.equal(isStoryCreature(e), false)
    run(s, V.arm + 0.5, () => !s.projectiles.length)
    const p = s.projectiles[0]
    assert.ok(p, 'a harpoon at the hero')
    assert.equal(!!p.friendly, false)
    assert.equal(p.tribe, undefined)
    assert.equal(p.damage, V.dmg)
    assert.ok(p.dy > 0)
    run(s, 1)
    assert.equal(s.player.hp, 10 - V.dmg)
  })

  it('a raised shield takes a wronged guard\'s harpoon', () => {
    const s = world({ hero: [20, 24] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    raiseShield(s, 'north')
    run(s, 0.2); blow(s, e)
    run(s, V.arm + 1.5)
    assert.equal(s.player.hp, 10)
    assert.ok(cues(s).includes('shield-block'))
  })

  it('a hero who dies or rides off ends the wind-up; when the grudge ends he walks back to his post', () => {
    const s = world({ hero: [20, 24] }), e = seal(s, 'norppavahti', 20, 20), V = T('norppavahti')
    run(s, 0.2); blow(s, e)
    run(s, 2, () => e.guard?.state !== 'arm')
    assert.equal(e.guard.state, 'arm')
    s.player.riding = true
    const before = s.projectiles.length
    run(s, V.arm + 0.3)
    assert.equal(s.projectiles.length, before)
    assert.notEqual(e.guard.state, 'arm')
    assert.equal(e.pose.eyeGlow, 0)
    s.player.riding = false
    s.projectiles = []
    clearWrath(s)
    moveHero(s, 32, 32)
    run(s, 12)
    assert.equal(e.peaceful, true)
    assert.equal(e.brainDriven, false)
    assert.ok(Math.hypot(e.px - (20 * S + 16), e.py - (20 * S + 16)) < S, 'back at his post')
    assert.equal(s.projectiles.length, 0)
  })

  it('copes with a first frame without a pose, at peace and wronged', () => {
    const s = world(), e = seal(s, 'norppavahti', 20, 16)
    wolf(s, 22, 16)
    vahti.update(e, s, DT)
    angerTribe(s, 'norpat')
    const f = seal(s, 'norppavahti', 24, 20)
    vahti.update(f, s, DT)
    assert.equal(f.brainDriven, true)
  })
})

// The court: the ring's middle at (20, 22), five tiles wide; the walrus on
// his seat north of its mouth, the gong beside him.
function court({ hero = [20, 22], hp = 10 } = {}) {
  const s = world({ w: 44, h: 44, hero })
  s.player.hp = hp
  const home = { x: 20, y: 22 }
  const e = seal(s, 'mursu', 20, 16, { home: { ...home }, ring: 5 })
  const g = seal(s, 'kumistin', 24, 17, { home: { ...home } })
  run(s, 0.1)
  return { s, e, g, home }
}
const ring = (s, g) => blow(s, g, 1)
// Strike the gong and let him come into the ring.
function bout(opts) {
  const c = court(opts)
  ring(c.s, c.g)
  run(c.s, 10, () => c.e.walrus.state === 'enter')
  assert.equal(c.e.duel, true)
  return c
}
// Hold every move back but one (or all of them).
const only = (e, move) => { for (const k of ['flop', 'charge', 'bellow']) e.walrus.cd[k] = k === move ? 0 : 999; e.walrus.gap = 0 }
const fromHome = (c, who) => Math.hypot(who.px - (c.home.x * S + 16), who.py - (c.home.y * S + 16)) / S

describe('kumistin, the gong', () => {
  it('struck, it rings, takes no harm, angers nobody and calls the walrus to a bout', () => {
    const { s, e, g } = court()
    assert.equal(g.peaceful, true)
    const r = ring(s, g)
    assert.equal(r.absorbed, true)
    assert.equal(r.cue, 'gong')
    assert.equal(g.hp, getMonsterDef('kumistin').stats.hp)
    assert.equal(wrathOf(s, 'norpat'), 0)
    assert.ok(g.flicker > 0)
    assert.equal(e.duel, true)
    assert.ok(said(s), 'he answers')
    run(s, 0.1)
    assert.equal(e.peaceful, false)
    assert.equal(g.peaceful, true)
    assert.equal(isEnemy(g), false)
    run(s, 3)
    assert.ok(g.flicker === 0, 'and it comes to rest')
    assert.equal(typeof kumistin.debugState(g), 'string')
  })

  it('an arrow rings it too; fire and lightning ring it but call nobody', () => {
    const a = court()
    blow(a.s, a.g, 2, 'shot')
    assert.equal(a.e.duel, true)
    const b = court()
    for (const source of ['fire', 'lightning', 'slam']) {
      const r = hurtCreature(b.s, b.g, 3, { source })
      assert.equal(r.absorbed, true)
    }
    assert.ok(b.g.flicker > 0)
    assert.equal(!!b.e.duel, false)
    assert.equal(b.g.hp, getMonsterDef('kumistin').stats.hp)
  })

  it('calls no bout while the tribe holds a grudge, nor without a walrus; on the bench it finds the one beside it', () => {
    const { s, e, g } = court()
    angerTribe(s, 'norpat')
    run(s, 0.1)
    assert.equal(ring(s, g).absorbed, true)
    assert.equal(!!e.duel, false)
    const lone = world(), g2 = seal(lone, 'kumistin', 20, 20)
    assert.equal(ring(lone, g2).absorbed, true)
    run(lone, 1)
    const bench = world(), g3 = seal(bench, 'kumistin', 20, 20), m3 = seal(bench, 'mursu', 22, 20)
    ring(bench, g3)
    assert.equal(m3.duel, true)
  })

  it('stands where it stands whatever is done to it, and copes without a pose', () => {
    const { s, g } = court()
    g.knockback = { vx: 500, vy: 0 }
    kumistin.update(g, s, DT)
    assert.deepEqual([g.x, g.y], [24, 17])
    const bare = seal(s, 'kumistin', 30, 30)
    kumistin.update(bare, s, DT)
    assert.equal(isHittable(bare), true)
  })
})

describe('mursu, the walrus: at peace', () => {
  it('sits by his ring: no enemy, no move, no harm; a blow on him angers the tribe', () => {
    const { s, e } = court({ hero: [20, 18] })
    run(s, 8)
    assert.deepEqual([e.x, e.y], [20, 16])
    assert.equal(e.peaceful, true)
    assert.equal(e.walrus.state, 'sit')
    assert.equal(s.player.hp, 10)
    assert.deepEqual(fxOps(mursu, e), [])
    assert.equal(typeof mursu.debugState(e), 'string')
    blow(s, e, 4)
    assert.ok(wrathOf(s, 'norpat') > 0)
    assert.equal(e.hp, 29, 'blubber')
  })

  it('refuses a hero who can hardly stand, and one who has just fought him', () => {
    const a = court({ hp: 1 })
    ring(a.s, a.g)
    assert.equal(!!a.e.duel, false)
    assert.ok(said(a.s))
    const b = court()
    b.e.walrus.rest = 20
    ring(b.s, b.g)
    assert.equal(!!b.e.duel, false)
    assert.ok(said(b.s))
    assert.equal(mursu.startDuel(b.e, b.s), false)
    b.e.walrus.rest = 0
    assert.equal(mursu.startDuel(b.e, b.s), true)
    assert.equal(mursu.startDuel(b.e, b.s), false, 'one bout at a time')
  })
})

describe('mursu, the walrus: the bout', () => {
  it('he comes into the ring, and from then on fights: in the ring, never out of it', () => {
    const c = bout()
    const { s, e } = c
    assert.ok(fromHome(c, e) < 5, 'in the ring')
    assert.equal(e.peaceful, false)
    assert.equal(!!e.brainDriven, false, 'the bout is his hook\'s own')
    assert.equal(e.spellOpen, true)
    let far = 0
    run(s, 25, () => { far = Math.max(far, fromHome(c, e)); if (s.player.hp < 6) s.player.hp = 10; return mursu.inBout(e) })
    assert.ok(far <= 5, `he kept to the ring (${far.toFixed(2)})`)
  })

  it('the belly flop: a shadow where the hero stands, a leap, 2 and a throw that no shield stops', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    moveHero(s, 20, 24)
    raiseShield(s, 'north')
    only(e, 'flop')
    run(s, 2, () => e.walrus.state !== 'rear')
    assert.equal(e.walrus.state, 'rear')
    assert.ok(cues(s).includes('walrus-snort'))
    run(s, M.rear * 0.5)
    assert.ok(e.pose.eyeGlow > 0.3)
    assert.ok(fxOps(mursu, e).length > 0, 'the shadow')
    const at = { px: e.px, py: e.py }
    run(s, M.rear * 0.5 + M.leap * 0.5)
    assert.equal(e.walrus.state, 'leap')
    assert.ok(e.channels.air > 0.5)
    assert.ok(Math.hypot(e.px - at.px, e.py - at.py) > 8, 'he is on his way')
    run(s, M.leap * 0.5 + 0.1)
    assert.equal(s.player.hp, 10 - M.flopDmg)
    assert.ok(cues(s).includes('flop'))
    assert.ok(s.player.knockback || tilesApart(e, s.player) > 0.5, 'thrown')
    assert.equal(e.channels.air ?? 0, 0)
    assert.equal(e.pose.eyeGlow, 0)
  })

  it('the flop misses a hero who gets clear of where the shadow stopped', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    moveHero(s, 20, 24)
    only(e, 'flop')
    run(s, 2, () => e.walrus.state !== 'rear')
    run(s, M.flopLock + 0.05)
    moveHero(s, 20 + M.flopR + 1, 24)
    run(s, M.rear + M.leap)
    assert.equal(s.player.hp, 10)
    assert.ok(Math.hypot(e.px - (20 * S + 16), e.py - (24 * S + 16)) < S, 'he came down where the shadow was')
  })

  it('the tusk charge: head down, the line fixed before he goes, 3 and a throw; a shield can take it', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    moveHero(s, 20, 25)
    Object.assign(e, { px: 20 * S + 16, py: 20 * S + 16, x: 20, y: 20 })
    only(e, 'charge')
    run(s, 2, () => e.walrus.state !== 'aim')
    assert.equal(e.walrus.state, 'aim')
    run(s, M.aim * 0.5)
    assert.ok(e.channels.charge > 0)
    assert.ok(fxOps(mursu, e).length > 0, 'the aim line')
    const at = { px: e.px, py: e.py }
    run(s, M.aim * 0.5 - 0.05)
    assert.ok(Math.hypot(e.px - at.px, e.py - at.py) < 1, 'pinned while he aims')
    run(s, 0.6)
    assert.equal(s.player.hp, 10 - M.chargeDmg)
    assert.ok(s.player.knockback || s.player.py > 25 * S + 16)
    const d = bout()
    moveHero(d.s, 20, 25)
    Object.assign(d.e, { px: 20 * S + 16, py: 20 * S + 16, x: 20, y: 20 })
    raiseShield(d.s, 'north')
    only(d.e, 'charge')
    run(d.s, M.aim + 1)
    assert.equal(d.s.player.hp, 10)
  })

  it('a hero who steps off the line is missed, and the charge ends winded at the ring\'s edge', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    moveHero(s, 20, 24)
    Object.assign(e, { px: 20 * S + 16, py: 20 * S + 16, x: 20, y: 20 })
    only(e, 'charge')
    run(s, 2, () => e.walrus.state !== 'aim')
    run(s, M.aimLock + 0.05)
    moveHero(s, 23, 22)
    run(s, 3, () => e.walrus.state !== 'winded')
    assert.equal(e.walrus.state, 'winded')
    assert.equal(s.player.hp, 10)
    assert.ok(e.py > 23 * S, 'he went down the line he fixed')
    assert.ok(fromHome(c, e) <= 5, 'and stopped inside the ring')
    assert.ok(e.channels.winded > 0)
    const at = { px: e.px, py: e.py }
    only(e, 'none')
    run(s, M.winded - 0.2)
    assert.equal(e.walrus.state, 'winded')
    assert.ok(Math.hypot(e.px - at.px, e.py - at.py) < 1)
    run(s, 0.4)
    assert.notEqual(e.walrus.state, 'winded')
    assert.equal(e.channels.winded ?? 0, 0)
  })

  it('blubber: a blow takes 1 from him whatever it is, except while he is winded', () => {
    const c = bout(), { s, e } = c
    only(e, 'none')
    blow(s, e, 5)
    assert.equal(e.hp, 29)
    blow(s, e, 3, 'shot')
    assert.equal(e.hp, 28)
    hurtCreature(s, e, 4, { source: 'lightning' })
    assert.equal(e.hp, 27)
    e.walrus.state = 'winded'; e.walrus.t = 0
    blow(s, e, 5)
    assert.equal(e.hp, 22)
    assert.equal(wrathOf(s, 'norpat'), 0, 'a bout wrongs nobody')
  })

  it('the bellow shoves a hero who stands too near, and does not hurt', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    only(e, 'bellow')
    moveHero(s, e.px / S - 0.5, e.py / S - 0.5 + 1.2)
    const d0 = tilesApart(e, s.player)
    run(s, 2, () => e.walrus.state !== 'bellow')
    assert.equal(e.walrus.state, 'bellow')
    run(s, M.bellowWind + 0.6)
    assert.equal(s.player.hp, 10)
    assert.ok(tilesApart(e, s.player) > d0 + M.shove * 0.6, `shoved ${(tilesApart(e, s.player) - d0).toFixed(1)} tiles`)
    assert.ok(cues(s).includes('seal-bark'))
  })

  it('a bellow is followed at once by a flop at the hero it shoved off', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    Object.assign(e.walrus.cd, { flop: 0, charge: 999, bellow: 0 }); e.walrus.gap = 0
    moveHero(s, e.px / S - 0.5, e.py / S - 0.5 + 1.2)
    run(s, 2, () => e.walrus.state !== 'roar')
    assert.equal(e.walrus.state, 'roar')
    run(s, 0.35 + M.follow + 0.3, () => e.walrus.state !== 'rear')
    assert.equal(e.walrus.state, 'rear')
    assert.ok(tilesApart(e, s.player) >= M.flopMin)
  })

  it('a stun holds him in a bout, and runs out', () => {
    const c = bout(), { s, e } = c
    only(e, 'none')
    run(s, 0.1)
    e.stunTimer = 0.5
    const t0 = e.walrus.t, at = { px: e.px, py: e.py }
    run(s, 0.4)
    assert.equal(e.walrus.t, t0)
    assert.ok(Math.hypot(e.px - at.px, e.py - at.py) < 0.01)
    run(s, 0.3)
    assert.ok(!(e.stunTimer > 0) && e.walrus.t > t0)
  })

  it('no blow of his takes the last hp: a hero at 1 is thrown out of the ring and the bout is over', () => {
    for (const move of ['flop', 'charge']) for (const hp of [2, 3, 4]) {
      const c = bout({ hp }), { s, e } = c
      blow(s, e, 1); blow(s, e, 1)
      let least = hp
      run(s, 40, () => { only(e, move); least = Math.min(least, s.player.hp); return mursu.inBout(e) })
      assert.equal(mursu.inBout(e), false, `${move} from ${hp}`)
      assert.ok(least >= 1, `never under 1 (${least})`)
      assert.equal(s.player.hp, 1, `${move} from ${hp} hp left him ${s.player.hp}`)
      assert.ok(said(s))
      run(s, 1)
      assert.ok(fromHome(c, s.player) > 5, `thrown clear (${fromHome(c, s.player).toFixed(1)})`)
      assert.equal(e.hp, e.maxHp, 'he mends')
      assert.ok(e.walrus.rest > T('mursu').rematch - 2)
      assert.equal(wrathOf(s, 'norpat'), 0)
      assert.equal(e.inCombat, false)
      run(s, T('mursu').grace)
      assert.equal(e.duel, false)
      assert.equal(e.peaceful, true)
    }
  })

  it('a blow already on its way when the bout ends does nothing, and wrongs nobody', () => {
    for (const how of ['lost', 'won', 'forfeit']) {
      const c = bout({ hp: how === 'lost' ? 2 : 10 }), { s, e } = c, M = T('mursu')
      if (how === 'lost') run(s, 20, () => { only(e, 'flop'); return mursu.inBout(e) })
      if (how === 'won') { only(e, 'none'); for (let i = 0; i < 40 && mursu.inBout(e); i++) blow(s, e, 2) }
      if (how === 'forfeit') { only(e, 'none'); moveHero(s, 20, 30); run(s, M.forfeit + 0.2) }
      assert.equal(mursu.inBout(e), false, how)
      for (const after of [0, 0.3, 0.9]) {
        run(s, after ? 0.3 + (after > 0.5 ? 0.3 : 0) : 0)
        const r = blow(s, e, 3)
        assert.equal(r.absorbed, true, `${how} +${after}`)
        assert.equal(e.hp, e.maxHp)
        assert.equal(wrathOf(s, 'norpat'), 0, `${how} +${after}`)
      }
      assert.equal(mursu.startDuel(e, s), false)
      run(s, Math.max(M.grace, M.laugh) + 0.2)
      assert.equal(e.duel, false)
      assert.equal(e.peaceful, true)
      blow(s, e, 1)
      assert.ok(wrathOf(s, 'norpat') > 0, 'at peace again a blow is a blow')
    }
  })

  it('over a long bout with everything he has, the hero never drops below 1', () => {
    const c = bout(), { s, e } = c
    let least = 10, bouts = 0
    run(s, 90, i => {
      least = Math.min(least, s.player.hp)
      if (!e.duel) { bouts++; e.walrus.rest = 0; s.player.hp = 2 + (bouts % 5); moveHero(s, 20, 22); mursu.startDuel(e, s) }
      else if (i % 240 === 0) moveHero(s, 18 + (i / 240) % 5, 21 + (i / 480) % 3)
    })
    assert.ok(bouts >= 2, `${bouts} bouts`)
    assert.ok(least >= 1, `least ${least}`)
  })

  it('a hero who stays outside the ring forfeits', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    only(e, 'none')
    moveHero(s, 20, 22 + 5 + 2.5)
    run(s, M.forfeit - 0.3)
    assert.equal(e.duel, true)
    moveHero(s, 20, 23); run(s, 0.2)
    moveHero(s, 20, 22 + 5 + 2.5)
    run(s, M.forfeit - 0.3)
    assert.equal(e.duel, true, 'the count starts again when he comes back')
    run(s, 0.5)
    assert.equal(mursu.inBout(e), false)
    assert.ok(said(s))
    assert.equal(e.hp, e.maxHp)
    assert.equal(s.player.hp, 10)
    run(s, 12)
    assert.equal(e.duel, false)
    assert.equal(e.walrus.state, 'sit')
    assert.ok(Math.hypot(e.px - (20 * S + 16), e.py - (16 * S + 16)) < S, 'back on his seat')
  })

  it('brought to nothing he yields and does not die: the talent the first time, a chest\'s roll the next, then nothing', () => {
    const c = bout(), { s, e } = c
    const floats = () => s.entities.filter(o => o.type === 'floating_item')
    const beat = () => {
      only(e, 'none')
      for (let i = 0; i < 40 && mursu.inBout(e); i++) blow(s, e, 3)
      assert.equal(mursu.inBout(e), false)
      assert.ok(e.hp >= 1, `alive at ${e.hp}`)
      assert.ok(said(s))
      run(s, 1)
      assert.ok(e.channels.laugh > 0, 'he laughs')
      run(s, T('mursu').laugh - 0.8)
      assert.equal(e.duel, false)
    }
    beat()
    assert.equal(hasTalent(s.player, 'mursun_sydan'), true)
    assert.equal(s.player.maxHp, 12)
    assert.equal(floats().length, 0)
    assert.ok(s.entities.includes(e))
    assert.equal(e.peaceful, true)
    assert.equal(wrathOf(s, 'norpat'), 0)
    for (const want of [1, 1]) {
      run(s, 8)
      assert.equal(e.hp, e.maxHp)
      e.walrus.rest = 0
      moveHero(s, 20, 22)
      assert.equal(mursu.startDuel(e, s), true)
      run(s, 10, () => e.walrus.state === 'enter')
      beat()
      assert.equal(floats().length, want)
    }
    const item = floats()[0]
    assert.ok(item.contents?.type, 'something from a chest')
    assert.ok(Number.isFinite(item.targetPx) && item.progress < 1.01)
    assert.equal(s.player.talents.filter(t => t === 'mursun_sydan').length, 1)
  })

  it('a hero who dies of something else ends the bout cleanly', () => {
    const c = bout(), { s, e } = c
    only(e, 'flop')
    run(s, 2, () => e.walrus.state !== 'rear')
    s.player.hp = 0
    run(s, 0.3)
    assert.equal(e.duel, false)
    assert.equal(e.hp, e.maxHp)
    assert.equal(e.pose.eyeGlow, 0)
    assert.deepEqual(fxOps(mursu, e), [])
    s.player.hp = 10
    run(s, 12)
    assert.equal(e.peaceful, true)
    assert.equal(e.walrus.state, 'sit')
    assert.equal(s.player.hp, 10)
  })

  it('nothing of his reaches a hero on the coach, and the bout is forfeit', () => {
    const c = bout(), { s, e } = c
    s.player.riding = true
    run(s, 12)
    assert.equal(s.player.hp, 10)
    assert.equal(s.player.knockback ?? null, null)
    assert.equal(e.duel, false)
  })

  it('the tribe wronged in the middle of a bout: it becomes the real fight, with no mercy and no mending', () => {
    const c = bout({ hp: 3 }), { s, e } = c
    const guard = seal(s, 'norppavahti', 30, 30)
    blow(s, e, 1); blow(s, e, 1)
    blow(s, guard, 1)
    assert.ok(wrathOf(s, 'norpat') > 0)
    run(s, 0.1)
    assert.equal(e.duel, false)
    assert.equal(e.brainDriven, true)
    assert.equal(e.peaceful, false)
    assert.equal(e.hp, 28)
    guard.hp = 0; s.entities = s.entities.filter(o => o !== guard)
    run(s, 40, () => s.player.hp > 0)
    assert.ok(s.player.hp <= 0, 'he can kill')
  })

  it('a save loaded in the middle of a bout (the flag without his state) is no bout', () => {
    const s = world(), e = seal(s, 'mursu', 20, 16, { duel: true })
    run(s, 0.2)
    assert.equal(e.duel, false)
    assert.equal(e.peaceful, true)
  })

  it('on the bench, with no home and no ring, the ring is five tiles round where he stood', () => {
    const s = world({ hero: [20, 23] }), e = seal(s, 'mursu', 20, 20)
    run(s, 0.2)
    assert.equal(mursu.startDuel(e, s), true)
    let far = 0
    run(s, 15, () => { far = Math.max(far, Math.hypot(e.px - (20 * S + 16), e.py - (20 * S + 16)) / S); if (s.player.hp < 6) s.player.hp = 10 })
    assert.ok(far <= 5 && far > 0)
  })

  it('draws his tells over the hero: shadow, aim line, dust and the bellow\'s rings', () => {
    const c = bout(), { s, e } = c, M = T('mursu')
    moveHero(s, 20, 24)
    Object.assign(e, { px: 20 * S + 16, py: 19 * S + 16, x: 20, y: 19 })
    only(e, 'charge')
    run(s, 2, () => e.walrus.state !== 'aim')
    run(s, M.aim + 0.15)
    assert.equal(e.walrus.state, 'rush')
    assert.ok(fxOps(mursu, e).some(o => o[0] === 'fillRect'), 'dust')
    const d = bout()
    only(d.e, 'bellow')
    moveHero(d.s, d.e.px / S - 0.5, d.e.py / S - 0.5 + 1.2)
    run(d.s, 2, () => d.e.walrus.state !== 'bellow')
    run(d.s, M.bellowWind + 0.1)
    assert.ok(fxOps(mursu, d.e).some(o => o[0] === 'fillRect'), 'rings')
    const ctx = recordingCtx()
    mursu.debugDraw(ctx, d.e, 32)
    assert.ok(ctx.ops.length > 0)
  })
})

describe('mursu, the walrus: wronged', () => {
  const wronged = (hp = 10) => {
    const c = court({ hero: [20, 20], hp })
    blow(c.s, c.e, 1)
    run(c.s, 0.2)
    return c
  }

  it('the brain drives him, he fights the same way, and he can kill', () => {
    const { s, e } = wronged(4)
    assert.equal(e.brainDriven, true)
    assert.equal(isStoryCreature(e), false)
    assert.equal(!!e.duel, false)
    const seen = new Set()
    run(s, 40, () => { seen.add(e.walrus.state); return s.player.hp > 0 })
    assert.ok(s.player.hp <= 0, 'no mercy')
    assert.ok(seen.has('rear') || seen.has('aim'), [...seen].join(' '))
  })

  it('the charge ends winded at a rock, and winded he takes blows whole and can die, leaving a chest\'s worth', () => {
    const { s, e } = wronged()
    for (let x = 10; x <= 30; x++) s.map[26][x] = { tile: TILE.WALL }
    Object.assign(e, { px: 20 * S + 16, py: 19 * S + 16, x: 20, y: 19 })
    moveHero(s, 20, 23)
    run(s, 0.05)
    only(e, 'charge')
    run(s, 3, () => { if (e.walrus.state === 'stalk') only(e, 'charge'); return e.walrus.state !== 'aim' })
    run(s, T('mursu').aimLock + 0.05)
    moveHero(s, 26, 21)
    run(s, 3, () => e.walrus.state !== 'winded')
    assert.equal(e.walrus.state, 'winded')
    assert.ok(e.y === 25 || e.y === 24, `stopped at the rock (row ${e.y})`)
    assert.ok(cues(s).includes('wall-slam'))
    assert.equal(s.player.hp, 10)
    const hp = e.hp
    blow(s, e, 6)
    assert.equal(e.hp, hp - 6)
    const r = blow(s, e, 99)
    assert.ok(e.hp <= 0)
    assert.equal(r.absorbed, false)
    assert.equal(r.cue, 'enemy-death')
    assert.ok(deathDrop(e, getMonsterDef('mursu'), depth => ({ depth })))
    assert.equal(hasTalent(s.player, 'mursun_sydan'), false)
  })

  it('the gong calls no bout; when the grudge ends he is at peace, whole, and walks back to his seat', () => {
    const { s, e, g } = wronged()
    ring(s, g)
    assert.equal(!!e.duel, false)
    blow(s, e, 1)
    run(s, 2)
    clearWrath(s)
    moveHero(s, 34, 34)
    run(s, 15)
    assert.equal(e.peaceful, true)
    assert.equal(e.brainDriven, false)
    assert.equal(e.hp, e.maxHp)
    assert.equal(e.walrus.state, 'sit')
    assert.equal(e.pose.eyeGlow, 0)
    assert.ok(Math.hypot(e.px - (20 * S + 16), e.py - (16 * S + 16)) < S)
  })

  it('the grudge ending in the middle of any move leaves nothing glowing, aimed or driven', () => {
    const seen = new Set()
    for (let t0 = 0.6; t0 < 14; t0 += 0.45) {
      const { s, e } = wronged()
      s.player.hp = s.player.maxHp = 99
      run(s, t0, i => { if (i % 90 === 0) moveHero(s, 17 + (i / 90) % 7, 19 + (i / 45) % 5) })
      seen.add(e.walrus.state)
      clearWrath(s)
      run(s, 0.1)
      assert.equal(e.peaceful, true, `after ${t0}`)
      assert.equal(e.brainDriven, false)
      assert.ok(['home', 'sit'].includes(e.walrus.state), e.walrus.state)
      assert.equal(e.pose.eyeGlow, 0)
      assert.deepEqual(Object.keys(e.channels), ['side'])
      assert.equal(e.hp, e.maxHp)
      assert.deepEqual(fxOps(mursu, e), [])
      const hp = s.player.hp
      run(s, 3)
      assert.equal(s.player.hp, hp, 'and he strikes nobody')
    }
    assert.ok(seen.size >= 4, `moves seen: ${[...seen].join(' ')}`)
  })

  it('the tribe wronged in the middle of any move of a bout: no mercy from that frame, nothing thrown', () => {
    for (let t0 = 0.3; t0 < 12; t0 += 0.55) {
      const c = bout(), { s, e } = c
      const guard = seal(s, 'norppavahti', 36, 36)
      s.player.hp = s.player.maxHp = 99
      run(s, t0, i => { if (i % 90 === 0) moveHero(s, 18 + (i / 90) % 5, 20 + (i / 45) % 4) })
      assert.equal(mursu.inBout(e), true, `still at it after ${t0}`)
      blow(s, guard, 1)
      run(s, 0.1)
      assert.equal(e.duel, false)
      assert.equal(mursu.inBout(e), false)
      assert.equal(e.brainDriven, true)
      assert.equal(isEnemy(e), true)
      run(s, 4)
      assert.ok(Number.isFinite(e.px) && Number.isFinite(e.py))
    }
  })

  it('copes with a first frame without a pose, at peace, in a bout and wronged', () => {
    const s = world(), a = seal(s, 'mursu', 20, 16)
    mursu.update(a, s, DT)
    assert.equal(mursu.startDuel(a, s), true)
    mursu.update(a, s, DT)
    const b = seal(s, 'mursu', 28, 16)
    assert.equal(mursu.startDuel(b, s), true, 'called before his first frame')
    mursu.update(b, s, DT)
    assert.equal(b.duel, true)
    angerTribe(s, 'norpat')
    const c = seal(s, 'mursu', 20, 28)
    mursu.update(c, s, DT)
    assert.equal(c.brainDriven, true)
    assert.equal(roleOf(c), 'boss')
    assert.equal(tribeOf(c), 'norpat')
  })
})
