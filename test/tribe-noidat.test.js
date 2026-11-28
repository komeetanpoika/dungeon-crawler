import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as para from '../renderer/systems/monsters/para.js'
import * as noita from '../renderer/systems/monsters/noita.js'
import * as kuppari from '../renderer/systems/monsters/kuppari.js'
import * as kyy from '../renderer/systems/monsters/kyy.js'
import * as syojatar from '../renderer/systems/monsters/syojatar.js'
import { castWisp, tickWisps, drawWisps } from '../renderer/systems/tribes/wisps.js'
import { tuningOf, getMonsterDef, isStoryCreature, spellSpares, updateMonsterPose } from '../renderer/systems/monsters.js'
import { hurtCreature, CREATURE_HIT, CREATURE_UPDATE } from '../renderer/systems/creatures.js'
import { tribeOf, roleOf } from '../renderer/systems/tribes.js'
import { isFrog, hexPlayer, tickHex } from '../renderer/systems/hex.js'
import { isPoisoned, tickPoison } from '../renderer/systems/poison.js'
import { hasTalent } from '../renderer/systems/talents.js'
import { makeItem, addItem, itemFromContents } from '../renderer/systems/inventory.js'
import { carriedDrop, deathDrop } from '../renderer/systems/drops.js'
import { TILE, makeShieldContents, weaponContents } from '../renderer/systems/entities.js'
import { MEMBERS } from '../renderer/data/tribes.js'
import { register, world, spawn, moveHero, run, cues, tilesApart, S } from './helpers/desert-bench.js'
import { recordingCtx } from './helpers/rig-contract.js'

const HOOKS = { para, noita, kuppari, kyy, syojatar }
const NAMES = Object.keys(HOOKS)
const T = name => tuningOf(name)
const wall = (s, x, y) => { s.map[y][x] = { tile: TILE.WALL } }
const count = (player, kind) => player.inventory.filter(i => i.kind === kind).reduce((n, i) => n + (i.count ?? 1), 0)
const give = (player, kind, n = 1) => addItem(player, makeItem(kind, n))
const sword = () => itemFromContents({ type: 'weapon', ...weaponContents('sword') })
const shield = (player, facing) => {
  const { type, ...buckler } = makeShieldContents('buckler')
  player.gear.melee.off = { kind: 'shield', ...buckler }
  Object.assign(player, { facing, blocking: true })
}
const fxOps = (hook, e) => { const c = recordingCtx(); hook.drawFx(c, e, 32); return c.ops }
const fills = ops => ops.filter(o => o[0] === 'fillRect').length
// Run several creatures a frame at a time, each by its own hook, as game.js does.
function runAll(s, seconds, each = null) {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) {
    each?.(i)
    s.player.invulnTimer = Math.max(0, (s.player.invulnTimer ?? 0) - 1 / 60)
    for (const e of [...s.entities]) {
      if (!(e.hp > 0) || !HOOKS[e.type]) continue
      HOOKS[e.type].update(e, s, 1 / 60)
      updateMonsterPose(e, 1 / 60)
    }
  }
}

describe('the coven', () => {
  beforeEach(() => register(NAMES, HOOKS))

  it('five members of the marsh tribe, each with its role, its numbers and its tuning', () => {
    assert.deepEqual(MEMBERS.noidat, NAMES)
    const want = { para: ['thief', 2, 135], noita: ['warlock', 5, 68], kuppari: ['healer', 6, 60], kyy: ['fighter', 1, 105], syojatar: ['boss', 36, 55] }
    for (const name of NAMES) {
      const d = getMonsterDef(name)
      assert.equal(d.spawn, null, name)
      assert.equal(d.behavior.tribe, 'noidat', name)
      assert.deepEqual([d.behavior.role, d.stats.hp, d.stats.speed], want[name], name)
      assert.equal(d.behavior.weapon, undefined, `${name} swings nothing`)
      for (const p of HOOKS[name].TUNING_SCHEMA) assert.ok(p.key in T(name), `${name}.${p.key}`)
      assert.equal(CREATURE_UPDATE[name], HOOKS[name].update, name)
      assert.equal(typeof HOOKS[name].debugState({ type: name }), 'string')
    }
    const s = world(), e = spawn(s, 'noita', 5, 5)
    assert.equal(tribeOf(e), 'noidat'); assert.equal(roleOf(e), 'warlock')
    assert.equal(getMonsterDef('para').behavior.driver, 'hook')
    assert.equal(getMonsterDef('syojatar').behavior.drops, 'chest')
    for (const name of ['noita', 'kuppari', 'syojatar']) assert.ok(Array.isArray(getMonsterDef(name).behavior.kiteBand), `${name} keeps off`)
  })

  it('no hook minds a first frame without a pose, a dead hero or one on the coach', () => {
    for (const over of [{}, { hp: 0 }, { riding: true }]) for (const name of NAMES) {
      const s = world(), e = spawn(s, name, 20, 17)
      Object.assign(s.player, over)
      give(s.player, 'meat', 2)
      for (let i = 0; i < 600; i++) HOOKS[name].update(e, s, 1 / 60)      // ten seconds, never a pose
      // (only Syöjätär's spit wounds a hero who just stands there)
      if (name !== 'syojatar' || over.hp === 0 || over.riding) assert.equal(s.player.hp, over.hp ?? 10, `${name} ${JSON.stringify(over)}`)
      assert.equal(count(s.player, 'meat'), over.hp === 0 || over.riding ? 2 : name === 'para' ? 1 : 2, `${name} ${JSON.stringify(over)}`)
      if (over.hp === 0 || over.riding) { assert.equal(isFrog(s.player), false, name); assert.equal(s.player.poison, undefined, name) }
    }
  })
})

describe('para', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const P = () => T('para')
  const thing = (s, x = 20, y = 12, over = {}) => spawn(s, 'para', x, y, over)

  it('owns its movement and is open to spells all the while', () => {
    const s = world(), e = thing(s)
    run(s, e, para.update, 0.1)
    assert.equal(isStoryCreature(e), true)
    assert.equal(spellSpares(e), false)
  })

  it('runs at the hero in a zigzag, snatches one unit and runs home to cower with the bundle', () => {
    const s = world(), e = thing(s)
    give(s.player, 'meat', 3)
    let side = 0, sides = new Set()
    run(s, e, para.update, 0.2)
    assert.equal(e.para.state, 'come')
    run(s, e, para.update, 4, () => {
      if (e.para.state !== 'come') return
      side = Math.sign(Math.round((e.px - (20 * S + S / 2)) / 3)); if (side) sides.add(side)
    })
    assert.equal(sides.size, 2, 'it strayed to both sides of the straight line')
    assert.equal(count(s.player, 'meat'), 2)
    assert.equal(e.loot.type, 'meat'); assert.equal(e.loot.count, 1)
    assert.equal(e.channels.carry, 1)
    assert.ok(cues(s).includes('para-skitter'))
    run(s, e, para.update, 4)
    assert.equal(e.para.state, 'cower')
    assert.equal(e.channels.cower, 1)
    assert.ok(Math.hypot(e.x - 20, e.y - 12) <= P().homeR + 0.5, `home again (${e.x},${e.y})`)
    // it has its one thing: the hero may stand beside it all day
    moveHero(s, 20, 13)
    run(s, e, para.update, 10)
    assert.equal(count(s.player, 'meat'), 2)
    assert.equal(s.player.hp, 10, 'it never wounds')
  })

  it('takes the first kind in its order of preference, and only what it may', () => {
    const order = ['cooked_meat', 'potion', 'meat', 'herring', 'mushroom', 'lumber']
    assert.deepEqual(para.WANTS, order)
    for (let i = 0; i < order.length; i++) {
      const s = world(), e = thing(s, 20, 18)
      // things it may never take, then everything from its ith wish on, least wanted first
      give(s.player, 'tar', 2); give(s.player, 'deadwood', 2); give(s.player, 'sampo')
      addItem(s.player, sword())
      for (const kind of order.slice(i).reverse()) give(s.player, kind, 2)
      const sack = s.player.inventory.length
      run(s, e, para.update, 2)
      assert.equal(e.loot?.type, order[i])
      assert.equal(count(s.player, order[i]), 1)
      for (const kind of order.slice(i + 1)) assert.equal(count(s.player, kind), 2, kind)
      assert.equal(count(s.player, 'tar'), 2); assert.equal(count(s.player, 'deadwood'), 2); assert.equal(count(s.player, 'sampo'), 1)
      assert.equal(s.player.inventory.length, sack)
      // what it carries is a floating item's contents the sack takes back whole
      assert.equal(itemFromContents(e.loot).kind, order[i])
      assert.equal(itemFromContents(e.loot).count, 1)
    }
  })

  it('takes the last of a stack, slot and all', () => {
    const s = world(), e = thing(s, 20, 18)
    give(s.player, 'potion', 1)
    run(s, e, para.update, 2)
    assert.equal(e.loot.type, 'potion')
    assert.equal(s.player.inventory.length, 0)
  })

  it('from a sack with nothing it wants it takes nothing, blows a raspberry and runs all the same', () => {
    const s = world(), e = thing(s)
    give(s.player, 'tar', 1); give(s.player, 'deadwood', 3)
    addItem(s.player, sword())
    run(s, e, para.update, 2.4)
    assert.equal(e.loot ?? null, null)
    assert.ok(cues(s).includes('raspberry'))
    assert.equal(s.player.inventory.length, 3)
    assert.equal(count(s.player, 'deadwood'), 3)
    assert.equal(e.para.state, 'go')
    run(s, e, para.update, 0.2)
    assert.ok(tilesApart(e, s.player) > 0.8, 'off it goes')
    assert.equal(carriedDrop({ ...e, hp: 0 }), null)
  })

  it('killed anywhere it leaves what it carries, by the game\'s own drop and only once', () => {
    const s = world(), e = thing(s, 20, 18)
    give(s.player, 'cooked_meat', 1)
    run(s, e, para.update, 1.5)
    assert.equal(e.loot.type, 'cooked_meat')
    const before = s.entities.length
    e.hp = 0
    const drop = carriedDrop(e)
    assert.equal(drop.contents.type, 'cooked_meat'); assert.equal(drop.contents.count, 1)
    assert.equal(carriedDrop(e), null)
    assert.equal(s.entities.length, before, 'the hook pushed no drop of its own')
  })

  it('robs a frog from further off', () => {
    const near = (frog) => {
      const s = world(), e = thing(s, 20, 17)
      give(s.player, 'meat', 1)
      if (frog) hexPlayer(s.player, 30)
      let from = null
      run(s, e, para.update, 2, () => { if (!from && e.loot) from = tilesApart(e, s.player) })
      return from
    }
    const man = near(false), frog = near(true)
    assert.ok(man <= P().snatch + 0.1 && man > 0.3, `a man from ${man}`)
    assert.ok(frog > P().snatch + 0.3 && frog <= P().snatchFrog + 0.1, `a frog from ${frog}`)
  })

  it('goes round a wall, never through it', () => {
    const s = world(), e = thing(s, 20, 12)
    for (let x = 12; x <= 28; x++) if (x !== 14) wall(s, x, 16)
    give(s.player, 'meat', 1)
    e.inCombat = true                              // it knows he is there
    run(s, e, para.update, 8, () => assert.notEqual(s.map[e.y][e.x].tile, TILE.WALL))
    assert.equal(e.loot?.type, 'meat', 'it found the gap')
    run(s, e, para.update, 8, () => assert.notEqual(s.map[e.y][e.x].tile, TILE.WALL))
    assert.equal(e.para.state, 'cower')
    assert.ok(e.y < 16, 'and went home through it')
  })

  it('a knitted one runs home to its witch, wherever she is by then', () => {
    const s = world(), w = spawn(s, 'noita', 30, 10, { id: 'w1' })
    const e = thing(s, 20, 18, { madeBy: 'w1', home: { x: 30, y: 10 } })
    give(s.player, 'meat', 1)
    run(s, e, para.update, 1.5)
    assert.ok(e.loot)
    Object.assign(w, { x: 26, y: 26, px: 26 * S + S / 2, py: 26 * S + S / 2 })
    run(s, e, para.update, 5)
    assert.equal(e.para.state, 'cower')
    assert.ok(tilesApart(e, w) <= P().homeR + 0.5)
    // with its witch dead, home is where she made it
    w.hp = 0
    run(s, e, para.update, 6)
    assert.ok(Math.hypot(e.x - 30, e.y - 10) <= P().homeR + 0.5)
  })

  it('does not come for a hero on the coach, and gives up one who rides off or dies', () => {
    const s = world(), e = thing(s, 20, 17)
    give(s.player, 'meat', 1)
    s.player.riding = true
    run(s, e, para.update, 3)
    assert.equal(e.para.state, 'wait')
    assert.equal(count(s.player, 'meat'), 1)
    const d = world(), f = thing(d, 20, 14)
    give(d.player, 'meat', 1)
    run(d, f, para.update, 0.3)
    assert.equal(f.para.state, 'come')
    d.player.hp = 0
    run(d, f, para.update, 3)
    assert.equal(count(d.player, 'meat'), 1)
    assert.ok(['go', 'cower', 'wait'].includes(f.para.state))
    assert.ok(Math.hypot(f.x - 20, f.y - 14) <= P().homeR + 0.5)
  })

  it('empty-handed it tries again after a while', () => {
    const s = world(), e = thing(s, 20, 17)
    run(s, e, para.update, 3)
    assert.ok(cues(s).includes('raspberry'))
    give(s.player, 'mushroom', 2)
    run(s, e, para.update, P().retry + 6)
    assert.equal(e.loot?.type, 'mushroom')
    assert.equal(count(s.player, 'mushroom'), 1)
  })
})

describe('the hex in flight', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const W = () => T('noita')
  const flight = (s, owner, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) tickWisps(s, owner, 1 / 60, W()) }

  it('flies straight at its speed and makes a frog of the hero it touches, without a wound', () => {
    const s = world(), owner = spawn(s, 'noita', 20, 15)
    castWisp(owner, owner.px, owner.py, Math.PI / 2, W())
    flight(s, owner, 0.5)
    assert.equal(owner.wisps.length, 1)
    assert.ok(Math.abs(owner.wisps[0].py - owner.py - W().wispSpeed * 0.5) < 1)
    assert.equal(isFrog(s.player), false)
    flight(s, owner, 1)
    assert.equal(isFrog(s.player), true)
    assert.equal(s.player.hex.t, W().frog)
    assert.equal(s.player.hp, 10)
    assert.equal(owner.wisps.length, 0)
    assert.ok(cues(s).includes('hex-hit'))
  })

  it('is stopped by a raised shield that faces it, and not by one that does not', () => {
    const s = world(), owner = spawn(s, 'noita', 20, 15)
    shield(s.player, 'north')
    castWisp(owner, owner.px, owner.py, Math.PI / 2, W())
    flight(s, owner, 2)
    assert.equal(isFrog(s.player), false)
    assert.equal(owner.wisps.length, 0)
    assert.ok(cues(s).includes('shield-block'))
    const b = world(), o2 = spawn(b, 'noita', 20, 15)
    shield(b.player, 'south')
    castWisp(o2, o2.px, o2.py, Math.PI / 2, W())
    flight(b, o2, 2)
    assert.equal(isFrog(b.player), true)
  })

  it('dies at a wall and when its time is up', () => {
    const s = world(), owner = spawn(s, 'noita', 20, 15)
    wall(s, 20, 18)
    castWisp(owner, owner.px, owner.py, Math.PI / 2, W())
    flight(s, owner, 2)
    assert.equal(owner.wisps.length, 0)
    assert.equal(isFrog(s.player), false)
    castWisp(owner, owner.px, owner.py, -Math.PI / 2, W())
    flight(s, owner, W().wispLife - 0.1)
    assert.equal(owner.wisps.length, 1)
    flight(s, owner, 0.2)
    assert.equal(owner.wisps.length, 0)
  })

  it('a sidestep dodges it; the coach, death and the ward after a hex are proof against it', () => {
    const s = world(), owner = spawn(s, 'noita', 20, 15)
    castWisp(owner, owner.px, owner.py, Math.PI / 2, W())
    moveHero(s, 21.5, 20)
    flight(s, owner, W().wispLife + 0.1)
    assert.equal(isFrog(s.player), false)
    for (const over of [{ riding: true }, { hp: 0 }]) {
      const c = world(), o = spawn(c, 'noita', 20, 15)
      Object.assign(c.player, over)
      castWisp(o, o.px, o.py, Math.PI / 2, W())
      flight(c, o, 2)
      assert.equal(isFrog(c.player), false, JSON.stringify(over))
    }
    const w = world(), o = spawn(w, 'noita', 20, 15)
    hexPlayer(w.player, 0.1); tickHex(w.player, 0.2)
    assert.ok(w.player.hexWard > 0)
    castWisp(o, o.px, o.py, Math.PI / 2, W())
    flight(w, o, 2)
    assert.equal(isFrog(w.player), false)
  })

  it('is drawn where it flies, and not at all once its witch is dead', () => {
    const s = world(), owner = spawn(s, 'noita', 20, 15)
    const none = recordingCtx(); drawWisps(none, owner, 32)
    assert.equal(fills(none.ops), 0)
    castWisp(owner, owner.px, owner.py, Math.PI / 2, W())
    flight(s, owner, 0.5)
    const c = recordingCtx(); drawWisps(c, owner, 32)
    assert.ok(fills(c.ops) >= 3)
    const below = c.ops.filter(o => o[0] === 'fillRect').every(o => o[2] > 30)
    assert.ok(below, 'south of its owner, where it has flown')
    assert.equal(c.ops.filter(o => o[0] === 'save').length, c.ops.filter(o => o[0] === 'restore').length)
    owner.hp = 0
    const d = recordingCtx(); drawWisps(d, owner, 32)
    assert.equal(fills(d.ops), 0)
  })
})

describe('noita', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const N = () => T('noita')
  const witch = (s, x = 20, y = 15) => spawn(s, 'noita', x, y)
  const hers = (s, e) => s.entities.filter(o => o.type === 'para' && o.madeBy === e.id && o.hp > 0)

  it('with the hero in sight she points, pinned, then lets a wisp fly at him: a frog', () => {
    const s = world(), e = witch(s)
    run(s, e, noita.update, N().hexFirst - 0.2)
    assert.equal(e.noita.state, 'idle')
    run(s, e, noita.update, 0.3)
    assert.equal(e.noita.state, 'point')
    const at = [e.px, e.py]
    e.px += 20; e.py -= 9                           // the brain's step this frame is undone
    run(s, e, noita.update, 0.1)
    assert.deepEqual([e.px, e.py], at)
    assert.ok(e.pose.eyeGlow > 0 && e.pose.eyeGlow < 1)
    assert.equal(e.wisps?.length ?? 0, 0)
    run(s, e, noita.update, N().point)
    assert.equal(e.wisps.length, 1)
    assert.ok(e.wisps[0].dy > 0 && Math.abs(e.wisps[0].dx) < 40, 'towards him')
    assert.equal(e.pose.eyeGlow, 0)
    assert.ok(cues(s).includes('hex-cast'))
    assert.ok(fills(fxOps(noita, e)) > 0, 'the wisp is drawn')
    run(s, e, noita.update, 2)
    assert.equal(isFrog(s.player), true)
    assert.equal(s.player.hp, 10)
  })

  it('hexes again only every so often, and not a hero out of sight or out of reach', () => {
    const s = world(), e = witch(s)
    const cast = () => cues(s).filter(c => c === 'hex-cast').length
    run(s, e, noita.update, N().hexFirst + N().point + 0.2)
    assert.equal(cast(), 1)
    run(s, e, noita.update, N().hexEvery - 0.5)
    assert.equal(cast(), 1)
    run(s, e, noita.update, 1.5)
    assert.equal(cast(), 2)
    const far = world(), f = witch(far, 20, 20 - N().hexRange - 1.5)
    run(far, f, noita.update, 12)
    assert.equal(cues(far).includes('hex-cast'), false)
    const blind = world(), b = witch(blind)
    for (let x = 10; x <= 30; x++) wall(blind, x, 17)
    run(blind, b, noita.update, 12)
    assert.equal(cues(blind).includes('hex-cast'), false)
  })

  it('knits a para in a fight, pinned at her needles, and never keeps more than two of her own', () => {
    const s = world(), e = witch(s)
    let knitting = 0, most = 0
    run(s, e, noita.update, 60, () => {
      if (e.noita?.state === 'knit') { knitting++; assert.equal(e.channels.knit, 1) }
      most = Math.max(most, hers(s, e).length)
    })
    assert.ok(knitting > 60, 'she sat at her needles')
    assert.equal(most, N().maxParas)
    assert.equal(hers(s, e).length, 2)
    assert.ok(cues(s).includes('knit'))
    for (const p of hers(s, e)) {
      assert.equal(p.summoned, true)
      assert.ok(tilesApart(p, e) <= 3 && s.map[p.y][p.x].tile === TILE.FLOOR)
      assert.ok(p.home && Number.isFinite(p.home.x), 'it knows where home is')
    }
    // one dies: she makes another, and stops at two again
    hers(s, e)[0].hp = 0
    run(s, e, noita.update, 30)
    assert.equal(hers(s, e).length, 2)
    assert.equal(e.channels.knit, 0)
  })

  it('knits nothing with nobody to fight', () => {
    const s = world(), e = witch(s, 20, 2)
    run(s, e, noita.update, 40)
    assert.equal(s.entities.length, 1)
  })

  it('a hero who dies or rides off while she points ends it: nothing is cast, nothing stays pinned', () => {
    for (const over of [{ hp: 0 }, { riding: true }]) {
      const s = world(), e = witch(s)
      run(s, e, noita.update, N().hexFirst + 0.2)
      assert.equal(e.noita.state, 'point')
      Object.assign(s.player, over)
      run(s, e, noita.update, 0.1)
      assert.equal(e.noita.state, 'idle')
      assert.equal(e.pose.eyeGlow, 0)
      e.px += 12
      const at = e.px
      run(s, e, noita.update, 3)
      assert.equal(e.px, at, 'free to walk')
      assert.equal(e.wisps?.length ?? 0, 0)
      assert.equal(s.entities.length, 1, 'and no knitting for a dead man')
    }
  })
})

describe('kuppari', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const K = () => T('kuppari')
  const setup = (hurt = 'noita', hp = 1) => {
    const s = world(), e = spawn(s, 'kuppari', 20, 10), sister = spawn(s, hurt, 22, 10)
    sister.hp = hp
    return { s, e, sister }
  }

  it('cups a hurt witch within reach: a red line for her channel, pinned, then three mended', () => {
    const { s, e, sister } = setup()
    assert.equal(fills(fxOps(kuppari, e)), 0)
    run(s, e, kuppari.update, 1.2)
    assert.equal(e.kup.state, 'cup')
    assert.equal(e.channels.cup, 1)
    assert.ok(cues(s).includes('cup'))
    const line = fxOps(kuppari, e)
    assert.ok(fills(line) >= 4, 'the line is drawn')
    assert.ok(line.filter(o => o[0] === 'fillRect').some(o => o[1] > 40), 'out to her sister, east of her')
    const at = e.px
    e.px -= 15
    run(s, e, kuppari.update, 0.1)
    assert.equal(e.px, at)
    assert.equal(sister.hp, 1)
    run(s, e, kuppari.update, K().channel)
    assert.equal(sister.hp, 1 + K().mend)
    assert.equal(e.kup.state, 'idle')
    assert.equal(e.channels.cup, 0)
    assert.equal(fills(fxOps(kuppari, e)), 0)
    // and again only after her rest
    run(s, e, kuppari.update, K().every - 0.5)
    assert.equal(sister.hp, 1 + K().mend)
    run(s, e, kuppari.update, K().channel + 1)
    assert.equal(sister.hp, 5, 'never above her full health')
  })

  it('a blow breaks it off: nothing mended, and she is two seconds longer about the next', () => {
    const { s, e, sister } = setup()
    run(s, e, kuppari.update, 1.2 + K().channel / 2)
    assert.equal(e.kup.state, 'cup')
    const r = hurtCreature(s, e, 1, { source: 'player', via: 'melee', knockback: 10 })
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 5)
    assert.equal(e.kup.state, 'idle')
    assert.equal(e.channels.cup, 0)
    e.knockback = null
    run(s, e, kuppari.update, K().every + K().struck - 0.3)
    assert.equal(sister.hp, 1)
    assert.equal(e.kup.state, 'idle')
    run(s, e, kuppari.update, 0.5 + K().channel)
    assert.equal(sister.hp, 1 + K().mend)
  })

  it('mends Syöjätär less, the worst hurt first, and neither paras, vipers, the whole, the far nor herself', () => {
    const boss = setup('syojatar', 10)
    run(boss.s, boss.e, kuppari.update, 1.2 + K().channel)
    assert.equal(boss.sister.hp, 10 + K().mendBoss)
    for (const [name, hp, x] of [['para', 1, 22], ['kyy', 0.5, 22], ['noita', 5, 22], ['noita', 1, 20 + K().reach + 1]]) {
      const s = world(), e = spawn(s, 'kuppari', 20, 10), o = spawn(s, name, x, 10)
      o.hp = hp; e.hp = 2
      run(s, e, kuppari.update, 8)
      assert.equal(o.hp, hp, `${name} at ${x}`)
      assert.equal(e.hp, 2)
      assert.equal(cues(s).includes('cup'), false)
    }
    const s = world(), e = spawn(s, 'kuppari', 20, 10), a = spawn(s, 'noita', 22, 10), b = spawn(s, 'kuppari', 18, 10)
    a.hp = 3; b.hp = 1
    run(s, e, kuppari.update, 1.2 + K().channel)
    assert.equal(b.hp, 1 + K().mend); assert.equal(a.hp, 3)
  })

  it('a sister who dies or is carried off mid-channel ends it', () => {
    const { s, e, sister } = setup()
    run(s, e, kuppari.update, 1.5)
    assert.equal(e.kup.state, 'cup')
    sister.hp = 0
    run(s, e, kuppari.update, 0.1)
    assert.equal(e.kup.state, 'idle')
    assert.equal(sister.hp, 0)
  })

  it('still finds her sister after a blade has made a new object of her', () => {
    const { s, e, sister } = setup()
    run(s, e, kuppari.update, 1.5)
    const copy = { ...sister }                      // game.js's melee maps a struck enemy to a copy
    s.entities[s.entities.indexOf(sister)] = copy
    run(s, e, kuppari.update, K().channel)
    assert.equal(copy.hp, 1 + K().mend)
  })
})

describe('kyy', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const V = () => T('kyy')
  const snake = (s, d = 0.6) => spawn(s, 'kyy', 20, 19, { py: (20 - d) * S + S / 2 })

  it('coils with the hero in reach, pinned, then bites: one heart and two bites of poison', () => {
    const s = world(), e = snake(s)
    run(s, e, kyy.update, 0.05)
    assert.equal(e.kyy.state, 'coil')
    assert.ok(cues(s).includes('hiss'))
    const at = e.py
    e.py += 6
    run(s, e, kyy.update, 0.05)
    assert.equal(e.py, at)
    assert.ok(e.pose.eyeGlow > 0 && e.pose.eyeGlow < 1)
    assert.equal(s.player.hp, 10)
    run(s, e, kyy.update, V().coil + 0.05)
    assert.equal(s.player.hp, 10 - V().biteDmg)
    assert.equal(s.player.poison.left, V().poisonTicks)
    assert.equal(V().biteDmg, 1); assert.equal(V().poisonTicks, 2)
    // and not again inside its cooldown
    s.player.invulnTimer = 0
    run(s, e, kyy.update, V().cooldown - 0.5)
    assert.equal(s.player.hp, 9)
    assert.equal(e.pose.eyeGlow, 0)
  })

  it('its bite poisons only when it lands', () => {
    const blocked = world(), a = snake(blocked)
    shield(blocked.player, 'north')
    run(blocked, a, kyy.update, 1)
    assert.equal(blocked.player.hp, 10); assert.equal(isPoisoned(blocked.player), false)
    const grace = world(), b = snake(grace)
    run(grace, b, kyy.update, 1, () => { grace.player.invulnTimer = 1 })
    assert.equal(grace.player.hp, 10); assert.equal(isPoisoned(grace.player), false)
    const gone = world(), c = snake(gone)
    run(gone, c, kyy.update, 0.05)
    moveHero(gone, 20, 20 + V().strike + 0.6)
    run(gone, c, kyy.update, 1)
    assert.equal(gone.player.hp, 10); assert.equal(isPoisoned(gone.player), false)
    assert.equal(c.kyy.state, 'slither')
  })

  it('does not stay coiled over a dead hero', () => {
    const s = world(), e = snake(s)
    run(s, e, kyy.update, 0.05)
    s.player.hp = 0
    run(s, e, kyy.update, 0.1)
    assert.equal(e.kyy.state, 'slither')
    assert.equal(e.pose.eyeGlow, 0)
  })
})

describe('syojatar', () => {
  beforeEach(() => register(NAMES, HOOKS))
  const Y = () => T('syojatar')
  const boss = (s, x = 20, y = 15) => spawn(s, 'syojatar', x, y)
  const vipers = s => s.entities.filter(o => o.type === 'kyy')

  it('spits: head back, pinned, then a gob flies to where the hero stood and wounds him there', () => {
    const s = world(), e = boss(s)
    run(s, e, syojatar.update, Y().spitFirst + 0.1)
    assert.equal(e.syo.state, 'spit')
    const at = e.px
    e.px += 14
    run(s, e, syojatar.update, 0.1)
    assert.equal(e.px, at)
    assert.ok(e.pose.eyeGlow > 0)
    run(s, e, syojatar.update, Y().spitWind)
    assert.ok(e.syo.gob, 'in the air')
    assert.ok(cues(s).includes('spit'))
    assert.ok(fills(fxOps(syojatar, e)) > 0, 'the gob is drawn')
    assert.equal(s.player.hp, 10)
    run(s, e, syojatar.update, Y().spitFlight + 0.05)
    assert.equal(e.syo.gob, null)
    assert.equal(s.player.hp, 10 - Y().spitDmg)
    assert.equal(e.pools.length, 1)
    assert.ok(Math.hypot(e.pools[0].px - s.player.px, e.pools[0].py - s.player.py) < 2)
    assert.equal(s.player.poison.left, Y().poolTicks, 'and he stands in the pool it left')
  })

  it('a hero who has walked on is missed, and the pool poisons him only when he steps in it', () => {
    const s = world(), e = boss(s)
    run(s, e, syojatar.update, Y().spitFirst + Y().spitWind + 0.1)
    const spot = { px: e.syo.gob.x1, py: e.syo.gob.y1 }
    moveHero(s, 24, 20)
    run(s, e, syojatar.update, Y().spitFlight + 0.1)
    assert.equal(s.player.hp, 10)
    assert.equal(isPoisoned(s.player), false)
    assert.equal(e.pools.length, 1)
    assert.ok(fills(fxOps(syojatar, e)) > 0, 'the pool is drawn')
    Object.assign(s.player, { px: spot.px + Y().poolR * S + 6, py: spot.py })
    run(s, e, syojatar.update, 0.05)
    assert.equal(isPoisoned(s.player), false, 'beside it')
    Object.assign(s.player, { px: spot.px + Y().poolR * S - 4, py: spot.py })
    run(s, e, syojatar.update, 0.05)
    assert.equal(s.player.poison.left, Y().poolTicks)
    assert.equal(s.player.hp, 10, 'the pool itself wounds nothing')
    // standing there does not hold the poison's clock still
    const next = s.player.poison.next
    run(s, e, syojatar.update, 0.5, () => tickPoison(s, 1 / 60))
    assert.ok(s.player.poison.next < next - 0.4)
  })

  it('a pool dries up, there are never more than four, and none poisons a hero on the coach', () => {
    const s = world(), e = boss(s)
    Y().spitEvery = 1                                     // (at her own pace two pools is all there ever are)
    let most = 0
    run(s, e, syojatar.update, 40, i => {
      s.player.hp = 10
      moveHero(s, 14 + (Math.floor(i / 60) % 12), 21)     // he keeps moving: a pool wherever he was
      most = Math.max(most, e.pools?.length ?? 0)
      for (const p of e.pools ?? []) assert.ok(p.t <= Y().poolLife)
    })
    assert.equal(most, Y().poolMax)
    assert.equal(Y().poolMax, 4)
    const c = world(), f = boss(c)
    f.pools = [{ px: c.player.px, py: c.player.py, t: 0 }]
    c.player.riding = true
    run(c, f, syojatar.update, 1)
    assert.equal(isPoisoned(c.player), false)
    c.player.riding = false
    f.syo.spitT = 99
    run(c, f, syojatar.update, Y().poolLife)
    assert.equal(f.pools.length, 0)
  })

  it('broods at two thirds and at one third of her health, three vipers each time, and never again', () => {
    const s = world(), e = boss(s)
    moveHero(s, 20, 35)
    run(s, e, syojatar.update, 1)
    assert.equal(vipers(s).length, 0)
    e.hp = 24
    run(s, e, syojatar.update, 0.1)
    assert.equal(e.syo.state, 'scream')
    assert.equal(e.channels.scream, 1)
    assert.ok(cues(s).includes('hiss'))
    const at = e.py
    e.py += 9
    run(s, e, syojatar.update, 0.1)
    assert.equal(e.py, at, 'pinned')
    assert.equal(vipers(s).length, 0)
    run(s, e, syojatar.update, Y().broodWind)
    assert.equal(vipers(s).length, 3)
    assert.equal(e.channels.scream, 0)
    for (const v of vipers(s)) { assert.equal(v.summoned, true); assert.ok(tilesApart(v, e) <= 3.2); assert.equal(s.map[v.y][v.x].tile, TILE.FLOOR) }
    run(s, e, syojatar.update, 5)
    assert.equal(vipers(s).length, 3)
    e.hp = 12
    run(s, e, syojatar.update, Y().broodWind + 0.3)
    assert.equal(vipers(s).length, 6)
    e.hp = 1
    run(s, e, syojatar.update, 10)
    assert.equal(vipers(s).length, 6)
    assert.equal(e.syo.broods, 2)
  })

  it('one great blow through both marks still brings two broods, and a dead one brings none', () => {
    const s = world(), e = boss(s)
    moveHero(s, 20, 35)
    e.hp = 5
    run(s, e, syojatar.update, 2 * Y().broodWind + 0.5)
    assert.equal(vipers(s).length, 6)
    const d = world(), f = boss(d)
    moveHero(d, 20, 35)
    f.hp = 20
    run(d, f, syojatar.update, 0.2)
    assert.equal(f.syo.state, 'scream')
    hurtCreature(d, f, 99, { source: 'player' })
    assert.ok(f.hp <= 0)
    assert.equal(vipers(d).length, 0)
  })

  it('from two thirds down she casts three hexes in a fan, and none while she is whole', () => {
    const s = world(), e = boss(s)
    e.syo = undefined
    run(s, e, syojatar.update, 14, () => { s.player.invulnTimer = 0 })
    assert.equal(cues(s).includes('hex-cast'), false)
    const h = world(), f = boss(h)
    run(h, f, syojatar.update, 0.1)
    f.hp = 20; f.syo.broods = 2; f.syo.spitT = 99       // (the brood and the spit out of the way)
    let most = 0, pointed = 0
    run(h, f, syojatar.update, Y().fanFirst + Y().fanWind + 0.2, () => {
      most = Math.max(most, f.wisps?.length ?? 0)
      if (f.syo.state === 'fan') { pointed++; assert.equal(f.channels.point > 0, true) }
    })
    assert.ok(pointed > 10)
    assert.equal(most, 3)
    assert.ok(cues(h).includes('hex-cast'))
    const angles = f.wisps.map(w => Math.atan2(w.dy, w.dx)).sort((a, b) => a - b)
    const mid = f.wisps.find(w => Math.atan2(w.dy, w.dx) === angles[1])
    const miss = Math.abs((h.player.px - mid.px) * mid.dy - (h.player.py - mid.py) * mid.dx) / Math.hypot(mid.dx, mid.dy)
    assert.ok(miss < 4, `the middle one flies at him (passes ${miss.toFixed(1)} px off)`)
    assert.ok(Math.abs(angles[2] - angles[1] - Y().fanArc) < 1e-6 && Math.abs(angles[1] - angles[0] - Y().fanArc) < 1e-6)
    assert.ok(fills(fxOps(syojatar, f)) > 0)
    run(h, f, syojatar.update, 2)
    assert.equal(isFrog(h.player), true)
  })

  it('a dead hero ends her spit; nothing stays pinned', () => {
    const s = world(), e = boss(s)
    run(s, e, syojatar.update, Y().spitFirst + 0.1)
    assert.equal(e.syo.state, 'spit')
    s.player.hp = 0
    run(s, e, syojatar.update, 0.1)
    assert.equal(e.syo.state, 'idle')
    assert.equal(e.pose.eyeGlow, 0)
    assert.equal(e.syo.gob, null)
    e.px += 10
    const at = e.px
    run(s, e, syojatar.update, 6)
    assert.equal(e.px, at)
  })

  it('takes blows whole and, dying, teaches Käärmeenkieli once; her chest is the def\'s', () => {
    const s = world(), e = boss(s)
    run(s, e, syojatar.update, 0.1)
    assert.equal(CREATURE_HIT.syojatar, syojatar.hit)
    const r = hurtCreature(s, e, 4, { source: 'player', via: 'melee', knockback: 12 })
    assert.equal(r.absorbed, false)
    assert.equal(e.hp, 32)
    assert.equal(hasTalent(s.player, 'kaarmeenkieli'), false)
    hurtCreature(s, e, 99, { source: 'player', via: 'shot' })
    assert.equal(hasTalent(s.player, 'kaarmeenkieli'), true)
    assert.equal(s.feedback.toasts.length, 1)
    const again = boss(s, 24, 15)
    hurtCreature(s, again, 99, { source: 'player' })
    assert.equal(s.player.talents.filter(t => t === 'kaarmeenkieli').length, 1)
    const drop = deathDrop(e, getMonsterDef('syojatar'), depth => ({ depth }))
    assert.equal(drop.kind, 'floating_pickup')
    // with the talent her pools are nothing to him
    const t = world(), f = boss(t)
    t.player.talents = ['kaarmeenkieli']
    f.pools = [{ px: t.player.px, py: t.player.py, t: 0 }]
    run(t, f, syojatar.update, 0.5)
    assert.equal(isPoisoned(t.player), false)
  })
})
