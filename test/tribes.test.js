import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WRATH_TIME, tribeOf, roleOf, isMember, alliesOf, healAlly, wrathOf, angerTribe, clearWrath,
  noteBlow, tickTribes, summonNear, atPeace,
} from '../renderer/systems/tribes.js'
import { isEnemy, isHittable, isSpellTarget } from '../renderer/systems/factions.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef, spellSpares } from '../renderer/systems/monsters.js'
import { stepProjectiles } from '../renderer/systems/projectiles.js'
import { carriedDrop } from '../renderer/systems/drops.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makeSfx } from '../renderer/systems/sfx.js'
import { TILE, makePlayer } from '../renderer/systems/entities.js'
import { TRIBES } from '../renderer/data/tribes.js'

const S = 32
const FAKE_RIG = {
  RIG_ID: 'fakerig',
  PARAM_SCHEMA: [{ key: 'size', label: 'Size', group: 'body', type: 'range', min: 0, max: 2, step: 0.1, default: 1 }],
  drawMonster: () => {},
}
// Throwaway members: two seals (one of them the trader, who has lines), a
// calm gong, a troll and a beast of no tribe.
const DEFS = [
  { name: 'norppavahti', behavior: { tribe: 'norpat', role: 'fighter' } },
  { name: 'norppakauppias', behavior: { tribe: 'norpat', role: 'vendor' } },
  { name: 'kumistin', behavior: { tribe: 'norpat', role: 'gong', calm: true, passive: true } },
  { name: 'mohkale', behavior: { tribe: 'peikot', role: 'fighter' } },
  { name: 'testboar', behavior: {} },
]
const register = () => registerMonsters(
  DEFS.map(d => ({ rig: 'fakerig', stats: { hp: 6, dmg: 1, speed: 70, half: 8 }, ...d })),
  { loadRig: async () => FAKE_RIG, loadHooks: async () => {}, warn: () => {} })

const cell = () => ({ tile: TILE.FLOOR, visible: true, explored: true })
function world({ w = 30, h = 30, hero = [15, 15] } = {}) {
  const map = Array.from({ length: h }, () => Array.from({ length: w }, cell))
  const player = { ...makePlayer(hero[0], hero[1]), px: hero[0] * S + S / 2, py: hero[1] * S + S / 2, facing: 'south' }
  return { map, player, entities: [], feedback: makeFeedback(), sfx: makeSfx(), projectiles: [] }
}
function spawn(state, name, x, y, over = {}) {
  const e = { ...makeMonsterFromDef(name, x, y), px: x * S + S / 2, py: y * S + S / 2, ...over }
  e.peaceful = atPeace(state, e)
  state.entities.push(e)
  return e
}

describe('tribes', () => {
  beforeEach(register)
  afterEach(clearMonsters)

  it('reads tribe and role off the def', () => {
    const s = world()
    const guard = spawn(s, 'norppavahti', 5, 5), boar = spawn(s, 'testboar', 6, 6)
    assert.equal(tribeOf(guard), 'norpat')
    assert.equal(roleOf(guard), 'fighter')
    assert.equal(isMember(guard, 'norpat'), true)
    assert.equal(isMember(guard, 'peikot'), false)
    assert.equal(tribeOf(boar), null)
    assert.equal(roleOf(boar), null)
    assert.equal(tribeOf({ type: 'guard' }), null)
    assert.equal(tribeOf(null), null)
  })

  it('a friendly tribe is built at peace, a hostile one never is', () => {
    const s = world()
    assert.equal(spawn(s, 'norppavahti', 5, 5).peaceful, true)
    assert.equal(spawn(s, 'mohkale', 6, 6).peaceful, false)
    assert.equal(atPeace(s, { type: 'testboar' }), false)
  })

  it('a peaceful member is no enemy and no spell target, but can be hit; spells pass it over', () => {
    const s = world()
    const guard = spawn(s, 'norppavahti', 5, 5)
    assert.equal(isEnemy(guard), false)
    assert.equal(isSpellTarget(guard), false)
    assert.equal(isHittable(guard), true)
    assert.equal(spellSpares(guard), true)
    guard.peaceful = false
    assert.equal(isEnemy(guard), true)
    assert.equal(isSpellTarget(guard), true)
    assert.equal(spellSpares(guard), false)
  })

  it('a blow on a peaceful member angers the whole tribe at once, and says so', () => {
    const s = world()
    const guard = spawn(s, 'norppavahti', 5, 5), trader = spawn(s, 'norppakauppias', 7, 5), troll = spawn(s, 'mohkale', 20, 20)
    assert.equal(wrathOf(s, 'norpat'), 0)
    assert.equal(noteBlow(s, trader), true)
    assert.equal(wrathOf(s, 'norpat'), WRATH_TIME)
    assert.equal(WRATH_TIME, 240)
    assert.equal(guard.peaceful, false)
    assert.equal(trader.peaceful, false)
    assert.equal(isEnemy(guard), true)
    assert.equal(troll.peaceful, false)
    assert.ok(s.feedback.banner?.text.includes(TRIBES.norpat.name))
    assert.ok(s.sfx.cues.some(c => c.name === 'npc-wrath'))
    // a second blow, now that they fight, starts nothing new
    s.tribeWrath.norpat = 100
    assert.equal(noteBlow(s, trader), false)
    assert.equal(wrathOf(s, 'norpat'), 100)
  })

  it('a blow on a calm def, on a hostile tribe or on a beast of no tribe angers nobody', () => {
    const s = world()
    const gong = spawn(s, 'kumistin', 5, 5), guard = spawn(s, 'norppavahti', 6, 5)
    assert.equal(gong.peaceful, true)
    assert.equal(noteBlow(s, gong), false)
    assert.equal(noteBlow(s, spawn(s, 'mohkale', 9, 9)), false)
    assert.equal(noteBlow(s, spawn(s, 'testboar', 10, 9)), false)
    assert.equal(noteBlow(s, { type: 'npc' }), false)
    assert.equal(wrathOf(s, 'norpat'), 0)
    assert.equal(guard.peaceful, true)
    assert.equal(s.feedback.banner, null)
  })

  it('wrath runs out on time, and the fight is dropped with it', () => {
    const s = world()
    const guard = spawn(s, 'norppavahti', 5, 5)
    angerTribe(s, 'norpat', 2)
    guard.inCombat = true
    guard.attack = { phase: 'windup', timer: 0.2 }
    guard.stunTimer = 5
    guard.ai = { mode: 'chase', lastSeen: { x: 1, y: 1 } }
    for (let i = 0; i < 60; i++) tickTribes(s, 1 / 60)
    assert.ok(wrathOf(s, 'norpat') > 0.9 && wrathOf(s, 'norpat') < 1.1)
    assert.equal(guard.peaceful, false)
    assert.ok(guard.attack)
    for (let i = 0; i < 70; i++) tickTribes(s, 1 / 60)
    assert.equal(wrathOf(s, 'norpat'), 0)
    assert.equal(guard.peaceful, true)
    assert.equal(guard.attack, null)
    assert.equal(guard.inCombat, false)
    assert.equal(guard.stunTimer, 0)
    assert.equal(guard.ai.mode, undefined)
    assert.equal(isEnemy(guard), false)
  })

  it('a greeting one of them was in the middle of is cut short by the blow; another\'s bubble is left', () => {
    const s = world({ hero: [15, 12] })
    const trader = spawn(s, 'norppakauppias', 15, 10)
    tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble.anchorId, trader.id)
    noteBlow(s, trader)
    assert.equal(s.feedback.bubble, null)
    clearWrath(s)
    s.feedback.bubble = { text: 'Hm.', kind: 'thought', t: 0 }
    noteBlow(s, trader)
    assert.equal(s.feedback.bubble.text, 'Hm.')
  })

  it('clearWrath ends every grudge in place (the object is shared with a cave\'s state)', () => {
    const s = world()
    const guard = spawn(s, 'norppavahti', 5, 5)
    angerTribe(s, 'norpat')
    const held = s.tribeWrath
    const below = { ...s, entities: [] }   // as buildCaveState spreads the surface
    clearWrath(below)
    assert.ok(s.tribeWrath === held)
    assert.equal(wrathOf(s, 'norpat'), 0)
    clearWrath(s)
    assert.equal(guard.peaceful, true)
    clearWrath({ entities: [] })   // nothing to clear: no throw
  })

  it('a member in a duel is not at peace, whatever the tribe feels', () => {
    const s = world()
    const walrus = spawn(s, 'norppavahti', 5, 5), other = spawn(s, 'norppakauppias', 8, 5)
    walrus.duel = true
    tickTribes(s, 1 / 60)
    assert.equal(walrus.peaceful, false)
    assert.equal(other.peaceful, true)
    assert.equal(noteBlow(s, walrus), false)   // a blow in the ring is the sport
    assert.equal(wrathOf(s, 'norpat'), 0)
    walrus.duel = false
    tickTribes(s, 1 / 60)
    assert.equal(walrus.peaceful, true)
  })

  it('alliesOf: the living of the same tribe within reach, itself only when asked', () => {
    const s = world()
    const a = spawn(s, 'norppavahti', 5, 5)
    const near = spawn(s, 'norppakauppias', 8, 5)        // 3 tiles
    const far = spawn(s, 'norppavahti', 5, 12)           // 7 tiles
    const dead = spawn(s, 'norppavahti', 6, 5, { hp: 0 })
    const dying = spawn(s, 'norppavahti', 5, 6, { dying: 0.3 })
    const troll = spawn(s, 'mohkale', 6, 6)
    const got = alliesOf(a, s, 4)
    assert.equal(got.length, 1)
    assert.ok(got[0] === near)
    const withSelf = alliesOf(a, s, 4, { self: true })
    assert.equal(withSelf.length, 2)
    assert.ok(withSelf.includes(a))
    assert.equal(alliesOf(a, s, 8).length, 2)
    assert.ok(alliesOf(a, s, 8).includes(far))
    assert.ok(!alliesOf(a, s, 8).includes(dead) && !alliesOf(a, s, 8).includes(dying) && !alliesOf(a, s, 8).includes(troll))
    assert.equal(alliesOf({ type: 'testboar', px: 0, py: 0 }, s, 99).length, 0)
  })

  it('healAlly mends up to maxHp and no further, with a float, and never the dead', () => {
    const s = world()
    const e = spawn(s, 'mohkale', 5, 5, { hp: 2 })
    assert.equal(healAlly(s, e, 3), 3)
    assert.equal(e.hp, 5)
    assert.equal(s.feedback.floats.at(-1).text, '+3')
    assert.equal(s.feedback.floats.at(-1).kind, 'heal')
    assert.equal(healAlly(s, e, 3), 1)
    assert.equal(e.hp, e.maxHp)
    const n = s.feedback.floats.length
    assert.equal(healAlly(s, e, 3), 0)
    assert.equal(s.feedback.floats.length, n)
    assert.equal(healAlly(s, spawn(s, 'mohkale', 6, 5, { hp: 0 }), 3), 0)
    assert.equal(healAlly(s, spawn(s, 'mohkale', 7, 5, { hp: 1, dying: 0.2 }), 3), 0)
  })

  it('a peaceful member with lines greets the hero who comes near: once per approach, eight seconds apart', () => {
    const s = world({ hero: [15, 15] })
    const trader = spawn(s, 'norppakauppias', 15, 10)   // 5 tiles off
    const lines = TRIBES.norpat.lines.norppakauppias
    tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble, null)
    const walkTo = y => Object.assign(s.player, { y, py: y * S + S / 2 })
    walkTo(12)                                          // 2 tiles
    tickTribes(s, 1 / 60)
    assert.ok(lines.includes(s.feedback.bubble.text))
    assert.equal(s.feedback.bubble.kind, 'speech')
    assert.ok(trader.id !== undefined)
    assert.equal(s.feedback.bubble.anchorId, trader.id)
    const first = s.feedback.bubble.text
    // standing there: nothing more
    s.feedback.bubble = null
    for (let i = 0; i < 60 * 10; i++) tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble, null)
    // off and straight back within the eight seconds: silent; later: the next line
    walkTo(20); tickTribes(s, 1 / 60)
    walkTo(12); tickTribes(s, 1 / 60)
    assert.ok(s.feedback.bubble)
    assert.notEqual(s.feedback.bubble.text, first)
    s.feedback.bubble = null
    walkTo(20); tickTribes(s, 1 / 60)
    walkTo(12); tickTribes(s, 1)
    assert.equal(s.feedback.bubble, null)
    for (let i = 0; i < 8; i++) tickTribes(s, 1)
    assert.equal(s.feedback.bubble, null)   // he never left: this approach is spent
  })

  it('never speaks over a bubble that is still up, when wronged, or when its hook asks for quiet', () => {
    const s = world({ hero: [15, 12] })
    const trader = spawn(s, 'norppakauppias', 15, 10)
    s.feedback.bubble = { text: 'Hm.', kind: 'thought', t: 0 }
    tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble.text, 'Hm.')
    s.feedback.bubble = null
    trader.quiet = true
    tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble, null)
    trader.quiet = false
    angerTribe(s, 'norpat')
    tickTribes(s, 1 / 60)
    assert.equal(s.feedback.bubble, null)
    // a guard of a tribe without lines for it says nothing either
    const s2 = world({ hero: [15, 12] })
    spawn(s2, 'mohkale', 15, 10)
    tickTribes(s2, 1 / 60)
    assert.equal(s2.feedback.bubble, null)
  })

  it('summonNear builds a registry monster on a free walkable cell in the band', () => {
    const s = world({ w: 12, h: 12, hero: [1, 1] })
    const witch = spawn(s, 'mohkale', 6, 6, { lootDepth: 3 })
    for (let i = 0; i < 30; i++) {
      const m = summonNear(s, witch, 'testboar', { min: 2, max: 3, extra: { home: { x: 6, y: 6 } } })
      if (!m) break
      const d = Math.hypot(m.x - 6, m.y - 6)
      assert.ok(d >= 2 && d <= 3, `distance ${d}`)
      assert.equal(m.type, 'testboar')
      assert.equal(m.summoned, true)
      assert.equal(m.lootDepth, 3)
      assert.equal(m.damageCooldown, 0)
      assert.equal(m.hp, 6)
      assert.equal(m.px, m.x * S + S / 2)
      assert.equal(m.home.x, 6)
      assert.ok(s.entities.includes(m))
      assert.equal(s.entities.filter(o => o.x === m.x && o.y === m.y).length, 1, 'one to a cell')
    }
    assert.ok(s.entities.length > 10)
  })

  it('summonNear keeps off walls, the hero and the taken; null with no cell or no such monster', () => {
    const s = world({ w: 5, h: 5, hero: [3, 2] })
    for (const row of s.map) for (const c of row) c.tile = TILE.WALL
    for (const [x, y] of [[2, 2], [3, 2], [1, 2], [2, 1]]) s.map[y][x].tile = TILE.FLOOR
    const e = spawn(s, 'mohkale', 2, 2)
    spawn(s, 'mohkale', 1, 2)
    const m = summonNear(s, e, 'testboar', { min: 1, max: 1 })
    assert.deepEqual([m.x, m.y], [2, 1])
    assert.equal(summonNear(s, e, 'testboar', { min: 1, max: 1 }), null)
    assert.equal(summonNear(s, e, 'nosuchthing'), null)
  })

  it('a summoned seal is built at peace, a summoned troll is not', () => {
    const s = world()
    const e = spawn(s, 'mohkale', 6, 6)
    assert.equal(summonNear(s, e, 'norppavahti').peaceful, true)
    assert.equal(summonNear(s, e, 'mohkale').peaceful, false)
  })
})

// game.js cannot be loaded outside a browser: its seams are read off its text
// (as test/wilds-game.test.js does).
describe('game.js wires the kit', () => {
  const SRC = readFileSync(new URL('../renderer/game.js', import.meta.url), 'utf8')
  const order = (...marks) => marks.map(m => { const i = SRC.indexOf(m); assert.ok(i >= 0, `missing: ${m}`); return i })
    .every((at, i, all) => i === 0 || all[i - 1] < at)

  it('ticks the tribes once a frame, before the enemy loop', () => {
    assert.ok(order('  tickTribes(state, delta)', 'Enemy AI — iterate a snapshot'))
    assert.equal(SRC.split('tickTribes(state, delta)').length, 2)
  })
  it('a peaceful registry monster gets its hook and its pose and nothing else, asleep or frozen like the rest', () => {
    assert.match(SRC, /if \(e\.peaceful && getMonsterDef\(e\.type\)\) \{ CREATURE_UPDATE\[e\.type\]\?\.\(e, state, delta\); updateMonsterPose\(e, delta\); continue \}\n\s*if \(!isEnemy\(e\)\) continue/)
    assert.ok(order('asleep(e, player)) continue', 'bench?.isFrozen(e)) continue', 'if (e.peaceful && getMonsterDef(e.type))'))
  })
  it('the blade notes its blow before the damage, and so does the player\'s own shot, never a tribe\'s', () => {
    assert.ok(order('if (!bodyHit(e)) return e', '        noteBlow(state, e)', "hurtCreature(state, e, dmg, { source: 'player', via: 'melee'"))
    assert.match(SRC, /function hurtEntity\(e, damage, meta\) \{\n\s*const source = meta\?\.source \?\? 'player'\n\s*if \(meta\?\.friendly && !meta\.tribe\) noteBlow\(state, e\)/)
    assert.equal(SRC.split('noteBlow(state, e)').length, 3, 'two call sites: the blade, the shot')
  })
  it('tells a creature\'s hook how the player\'s blow came', () => {
    assert.match(SRC, /cast\.projectiles\.map\(p => \(\{ \.\.\.p, via: 'spell' \}\)\)/)
    assert.match(SRC, /friendly: true, via: 'shot' \}/)
    assert.match(SRC, /tickZones\(state, delta, \{ hurt: \(e, dmg\) => hurtEntity\(e, dmg, \{ via: 'spell' \}\) \}\)/)
  })
  it('the hero\'s death ends the hex and every grudge before he wakes', () => {
    assert.ok(order('if (player.hp <= 0) {', 'clearHex(player)', 'clearWrath(state)', 'adventureRespawn(state,'))
  })
  it('everything that takes hands is gated on the frog too', () => {
    assert.match(SRC, /const handsFree = player => !playerBound\(player\) && hasHands\(player\)/)
    assert.match(SRC, /if \(handsFree\(state\.player\)\) openInventory\(\)/)
    assert.match(SRC, /handsFree\(state\.player\)\) openMap\(\)/)
    assert.match(SRC, /!handsFree\(state\.player\)\) return\n\s*useOffhand\(\)/)
    assert.match(SRC, /!handsFree\(state\.player\)\) return\n[^\n]*\n[^\n]*\n[^\n]*\n\s*const target = startStanceSwitch/)
    assert.match(SRC, /tickShield\(player, !bound && !frog && /)
    assert.match(SRC, /if \(blocking \|\| bound \|\| frog\) player\.charging = null/)
    assert.match(SRC, /const attacking = keys\[' '\] && !player\.stanceSwitch && !player\.blocking && !bound && !frog/)
    assert.match(SRC, /sandSlowMul\(player\) \* frogSpeedMul\(player\)/)
    // nothing else opens the sack or the map, uses the offhand or switches stance
    for (const call of ['openInventory()', 'openMap()', 'useOffhand()', 'startStanceSwitch(state.player)'])
      assert.equal(SRC.split(call).length - 1, call === 'startStanceSwitch(state.player)' ? 1 : 2, call)
  })
  it('a ware is bought, not picked up; a registry monster is built with its home, its ring and its peace', () => {
    assert.match(SRC, /item\.price \? tryBuy\(state, item, grantContents\) === 'bought' : grantContents\(item\.contents\)/)
    assert.match(SRC, /case 'ware': \{/)
    assert.match(SRC, /e\.home = \{ x: s\.home\.x, y: s\.home\.y \}/)
    assert.match(SRC, /if \(Number\.isFinite\(s\.ring\)\) e\.ring = s\.ring/)
    assert.match(SRC, /if \(atPeace\(state, e\)\) e\.peaceful = true/)
  })
  it('a loaded or new body is settled with its talents, and the run has one grudge book', () => {
    assert.ok(order('applyLoadout(player, episodeFor(OPEN_MAPS[depth])?.kit)', '  applyTalents(player)', '  state = {', '    tribeWrath: {},'))
  })
})

// What a member carried (a para's stolen bundle) falls where it dies.
describe('carriedDrop', () => {
  it('leaves what it carried on its cell, once, and only when it is dead', () => {
    const loot = { type: 'cooked_meat', count: 1 }
    const e = { type: 'para', x: 4, y: 7, hp: 1, loot }
    assert.equal(carriedDrop(e), null)
    e.hp = 0
    const drop = carriedDrop(e)
    assert.equal(drop.kind, 'floating_pickup')
    assert.ok(drop.contents === loot)
    assert.equal(drop.x, 4)
    assert.equal(drop.y, 7)
    assert.equal(carriedDrop(e), null)
  })
  it('one that carried nothing leaves nothing', () => {
    assert.equal(carriedDrop({ type: 'para', x: 1, y: 1, hp: 0 }), null)
    assert.equal(carriedDrop({ type: 'para', x: 1, y: 1, hp: 0, loot: null }), null)
    assert.equal(carriedDrop(null), null)
  })
})

// A tribe's own shot (a guard's harpoon: `tribe` on a friendly projectile)
// seeks enemies only: never its own people, never a beast at peace.
describe('a tribe\'s friendly projectile', () => {
  beforeEach(register)
  afterEach(clearMonsters)

  const hooks = hurt => ({
    isHittable, hurt: (e, dmg, p) => { hurt.push([e, dmg, p]); e.hp -= dmg; return e },
    detonate: () => {}, damagePlayer: () => { throw new Error('the hero was hit') },
  })
  const shot = (x, y, over = {}) => ({ px: x * S + S / 2 - 20, py: y * S + S / 2, dx: 300, dy: 0, damage: 2, friendly: true, ...over })

  it('flies through its own tribe and through the peaceful, and lands on an enemy', () => {
    const s = world({ hero: [1, 1] })
    const seal = spawn(s, 'norppavahti', 6, 5)
    const deer = { type: 'npc', species: 'deer', hostile: false, hp: 3, maxHp: 3, x: 8, y: 5, px: 8 * S + S / 2, py: 5 * S + S / 2 }
    s.entities.push(deer)
    const boar = spawn(s, 'testboar', 10, 5)
    const hurt = []
    s.projectiles.push(shot(6, 5, { tribe: 'norpat' }))
    for (let i = 0; i < 60 && s.projectiles.length; i++) stepProjectiles(s, 1 / 60, hooks(hurt))
    assert.equal(hurt.length, 1)
    assert.ok(hurt[0][0] === boar)
    assert.equal(seal.hp, 6)
    assert.equal(deer.hp, 3)
  })

  it('still passes over its own once they are wronged', () => {
    const s = world({ hero: [1, 1] })
    const seal = spawn(s, 'norppavahti', 6, 5)
    angerTribe(s, 'norpat')
    const hurt = []
    s.projectiles.push(shot(6, 5, { tribe: 'norpat', maxDist: 200, distTraveled: 0 }))
    for (let i = 0; i < 60 && s.projectiles.length; i++) stepProjectiles(s, 1 / 60, hooks(hurt))
    assert.equal(hurt.length, 0)
    assert.equal(seal.hp, 6)
  })

  it('the hero\'s own shot lands on a peaceful seal as it always did', () => {
    const s = world({ hero: [1, 1] })
    const seal = spawn(s, 'norppavahti', 6, 5)
    const hurt = []
    s.projectiles.push(shot(6, 5))
    for (let i = 0; i < 60 && s.projectiles.length; i++) stepProjectiles(s, 1 / 60, hooks(hurt))
    assert.equal(hurt.length, 1)
    assert.ok(hurt[0][0] === seal)
  })
})
