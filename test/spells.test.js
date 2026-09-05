import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SPELLS, spellFor, affordableTier, tryCast, CHAIN_RANGE } from '../renderer/systems/spells.js'
import { GUST_COSTS } from '../renderer/systems/stamina.js'
import { GUST_TIERS } from '../renderer/systems/magic.js'
import { FIREBALL_RANGE_TILES } from '../renderer/systems/fire.js'
import { TILE } from '../renderer/systems/entities.js'

const T = 32
const SPELL_IDS = ['gust', 'spark', 'rime', 'fireball', 'bramble', 'blink', 'lightning']
const TIERS = ['tap', 'full', 'over']

// 20x20 of floor; callers punch walls in by tile coords.
const mkMap = (w = 20, h = 20) =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => ({ tile: TILE.FLOOR })))

const mkPlayer = (over = {}) => ({
  type: 'player', px: 5 * T + 16, py: 5 * T + 16, x: 5, y: 5, facing: 'east',
  attackMode: 'magic', talents: ['magic_stance'], magicCooldown: 0,
  stamina: 100, maxStamina: 100, staminaRegenT: 99, wand: null, ...over,
})
const mkState = (playerOver = {}, entities = []) => {
  const player = mkPlayer(playerOver)
  return { player, entities: [player, ...entities], map: mkMap(), zones: [], projectiles: [] }
}
// dx/dy in pixels from the player's centre.
const guardAt = (dx, dy) => ({ type: 'guard', hp: 4, maxHp: 4,
  px: 5 * T + 16 + dx, py: 5 * T + 16 + dy, x: 5, y: 5 })

describe('SPELLS table', () => {
  it('has a row per spell with three costs and three tiers', () => {
    assert.deepEqual(Object.keys(SPELLS).sort(), [...SPELL_IDS].sort())
    for (const id of SPELL_IDS) {
      const s = SPELLS[id]
      assert.equal(s.id, id)
      assert.ok(s.name, `${id} names itself`)
      assert.ok(s.primitive, `${id} has a primitive`)
      assert.equal(typeof s.cooldown, 'number')
      for (const t of TIERS) {
        assert.equal(typeof s.cost[t], 'number', `${id}.cost.${t}`)
        assert.ok(s.tiers[t], `${id}.tiers.${t}`)
      }
    }
  })

  it('prices and cooldowns match the spec table', () => {
    assert.deepEqual(SPELLS.spark.cost, { tap: 8, full: 14, over: 22 })
    assert.deepEqual(SPELLS.rime.cost, { tap: 12, full: 18, over: 30 })
    assert.deepEqual(SPELLS.fireball.cost, { tap: 18, full: 26, over: 40 })
    assert.deepEqual(SPELLS.bramble.cost, { tap: 14, full: 20, over: 32 })
    assert.deepEqual(SPELLS.blink.cost, { tap: 12, full: 18, over: 30 })
    assert.deepEqual(SPELLS.lightning.cost, { tap: 20, full: 30, over: 50 })
    assert.deepEqual(
      SPELL_IDS.map(id => SPELLS[id].cooldown), [3, 0.5, 3, 1.0, 4, 2.5, 4])
    assert.deepEqual(
      SPELL_IDS.map(id => SPELLS[id].primitive),
      ['cone', 'bolt', 'cone', 'bolt', 'zone', 'self', 'module'])
  })

  it('gust keeps the stamina table and cone tiers it already had', () => {
    assert.equal(SPELLS.gust.cost, GUST_COSTS)
    assert.equal(SPELLS.gust.tiers, GUST_TIERS)
  })
})

describe('spellFor', () => {
  it('falls back to gust when no wand is held', () => {
    assert.equal(spellFor(mkPlayer()), SPELLS.gust)
    assert.equal(spellFor(mkPlayer({ wand: undefined })), SPELLS.gust)
  })
  it('reads the spell off the held wand type', () => {
    assert.equal(spellFor(mkPlayer({ wand: { weaponType: 'sparkwand' } })), SPELLS.spark)
    assert.equal(spellFor(mkPlayer({ wand: { weaponType: 'stormwand' } })), SPELLS.lightning)
  })
  it('falls back to gust for a wand type the table does not know', () => {
    assert.equal(spellFor(mkPlayer({ wand: { weaponType: 'twig' } })), SPELLS.gust)
  })
})

describe('affordableTier', () => {
  const cost = { tap: 8, full: 14, over: 22 }
  it('keeps the reached tier when the tank covers it', () => {
    assert.equal(affordableTier(100, cost, 'over'), 'over')
    assert.equal(affordableTier(14, cost, 'full'), 'full')
  })
  it('degrades to the highest affordable tier', () => {
    assert.equal(affordableTier(20, cost, 'over'), 'full')
    assert.equal(affordableTier(10, cost, 'over'), 'tap')
  })
  it('returns null when even tap is out of reach', () => {
    assert.equal(affordableTier(7, cost, 'over'), null)
  })
})

describe('tryCast gating', () => {
  it('refuses without the magic_stance talent, spending nothing', () => {
    const s = mkState({ talents: [] })
    assert.deepEqual(tryCast(s, 'spark'), { ok: false, reason: 'not_learned' })
    assert.equal(s.player.stamina, 100)
  })

  it('refuses while the cooldown runs', () => {
    const s = mkState({ magicCooldown: 0.2 })
    assert.deepEqual(tryCast(s, 'spark'), { ok: false, reason: 'cooldown' })
    assert.equal(s.player.stamina, 100)
  })

  it('spends the tier cost and starts the spell cooldown', () => {
    const s = mkState()
    const r = tryCast(s, 'spark', 'full')
    assert.equal(r.ok, true)
    assert.equal(r.tier, 'full')
    assert.equal(r.spell, SPELLS.spark)
    assert.equal(s.player.stamina, 100 - 14)
    assert.equal(s.player.magicCooldown, SPELLS.spark.cooldown)
  })

  it('degrades over to full when the tank is short, spending the lower cost', () => {
    const s = mkState({ stamina: 20 })
    const r = tryCast(s, 'spark', 'over')
    assert.equal(r.tier, 'full')
    assert.equal(s.player.stamina, 20 - 14)
  })

  it('refuses with reason stamina when even tap is unaffordable', () => {
    const s = mkState({ stamina: 7 })
    assert.deepEqual(tryCast(s, 'spark', 'over'), { ok: false, reason: 'stamina' })
    assert.equal(s.player.stamina, 7)
    assert.equal(s.player.magicCooldown, 0)
  })

  it('an unknown spell id casts the wandless gust', () => {
    const s = mkState()
    const r = tryCast(s, 'nosuchspell')
    assert.equal(r.spell, SPELLS.gust)
  })
})

describe('bolt primitive', () => {
  it('spark tap fires one projectile along the facing, with no chain', () => {
    const s = mkState()
    const r = tryCast(s, 'spark')
    assert.equal(r.projectiles.length, 1)
    const [p] = r.projectiles
    assert.equal(p.px, s.player.px)
    assert.equal(p.py, s.player.py)
    assert.equal(p.dx, 340)
    assert.equal(p.dy, 0)
    assert.equal(p.damage, 2)
    assert.equal(p.shape, 'spark')
    assert.equal(p.friendly, true)
    assert.equal(p.chain, undefined)
  })

  it('aims the bolt at the facing', () => {
    const north = tryCast(mkState({ facing: 'north' }), 'spark').projectiles[0]
    assert.deepEqual([north.dx, north.dy], [0, -340])
    const west = tryCast(mkState({ facing: 'west' }), 'spark').projectiles[0]
    assert.deepEqual([west.dx, west.dy], [-340, 0])
  })

  it('spark full arcs to 2 more enemies, over to 4', () => {
    assert.deepEqual(tryCast(mkState(), 'spark', 'full').projectiles[0].chain,
      { left: 2, range: CHAIN_RANGE })
    assert.deepEqual(tryCast(mkState(), 'spark', 'over').projectiles[0].chain,
      { left: 4, range: CHAIN_RANGE })
    assert.equal(CHAIN_RANGE, 96)     // 3 tiles
  })

  it('fireball carries the detonation fields and grows its blast per tier', () => {
    const s = mkState()
    const [p] = tryCast(s, 'fireball').projectiles
    assert.equal(p.explodes, true)
    assert.equal(p.blastTiles, 16)
    assert.equal(p.maxDist, FIREBALL_RANGE_TILES * T)
    assert.equal(p.distTraveled, 0)
    assert.equal(p.lastPx, s.player.px)
    assert.equal(p.lastPy, s.player.py)
    assert.equal(p.shape, 'bolt')
    assert.equal(p.damage, 4)
    assert.equal(tryCast(mkState(), 'fireball', 'full').projectiles[0].blastTiles, 24)
    assert.equal(tryCast(mkState(), 'fireball', 'over').projectiles[0].blastTiles, 32)
  })
})

describe('cone primitive (rime)', () => {
  it('tap slows a caught enemy without stunning it', () => {
    const g = guardAt(T, 0)
    const s = mkState({}, [g])
    const r = tryCast(s, 'rime')
    assert.equal(r.caught, 1)
    assert.equal(g.slowMul, 0.4)
    assert.equal(g.slowTimer, 3)
    assert.ok(!g.frozen)
  })

  it('full holds the chill longer', () => {
    const g = guardAt(T, 0)
    tryCast(mkState({}, [g]), 'rime', 'full')
    assert.equal(g.slowTimer, 4)
  })

  it('over freezes: a 2s stun plus the frozen flag', () => {
    const g = guardAt(T, 0)
    tryCast(mkState({}, [g]), 'rime', 'over')
    assert.equal(g.frozen, true)
    assert.equal(g.stunTimer, 2)
  })

  it('over reaches further than tap', () => {
    const far = guardAt(100, 0)   // past the 80px tap reach, inside the 120px over reach
    assert.equal(tryCast(mkState({}, [far]), 'rime').caught, 0)
    assert.equal(tryCast(mkState({}, [{ ...far }]), 'rime', 'over').caught, 1)
  })

  it('leaves the player and enemies behind the caster alone', () => {
    const behind = guardAt(-T, 0)
    const s = mkState({}, [behind])
    assert.equal(tryCast(s, 'rime').caught, 0)
    assert.equal(behind.slowTimer, undefined)
    assert.equal(s.player.slowTimer, undefined)
  })
})

describe('zone primitive (bramble)', () => {
  it('drops a patch 3 tiles ahead and pushes it onto state.zones', () => {
    const s = mkState()
    const r = tryCast(s, 'bramble')
    assert.equal(s.zones.length, 1)
    assert.equal(s.zones[0], r.zone)
    assert.equal(r.zone.kind, 'bramble')
    assert.equal(r.zone.dur, 6)
    assert.equal(r.zone.root, 2)
    assert.equal(r.zone.dps, 1)
    // radius 1 around (8,5): the 3x3 block centred 3 tiles east of the caster
    assert.equal(r.zone.tiles.length, 9)
    assert.ok(r.zone.tiles.some(t => t.x === 8 && t.y === 5))
    assert.ok(r.zone.tiles.every(t => Math.abs(t.x - 8) <= 1 && Math.abs(t.y - 5) <= 1))
  })

  it('over spreads to radius 2 and lasts 10s', () => {
    const s = mkState()
    const r = tryCast(s, 'bramble', 'over')
    assert.equal(r.zone.tiles.length, 25)
    assert.equal(r.zone.dur, 10)
    assert.equal(r.zone.root, 3)
  })

  it('never lays thorns on a wall', () => {
    const s = mkState()
    s.map[5][8] = { tile: TILE.WALL }
    const r = tryCast(s, 'bramble')
    assert.equal(r.zone.tiles.length, 8)
    assert.ok(!r.zone.tiles.some(t => t.x === 8 && t.y === 5))
  })
})

describe('self primitive (blink)', () => {
  it('teleports 4 tiles along the facing and reports the trail', () => {
    const s = mkState()
    const from = { px: s.player.px, py: s.player.py }
    const r = tryCast(s, 'blink')
    assert.deepEqual(r.from, from)
    assert.equal(s.player.x, 9)
    assert.equal(s.player.y, 5)
    assert.deepEqual(r.to, { px: s.player.px, py: s.player.py })
  })

  it('stops at the last walkable cell before a wall', () => {
    const s = mkState()
    s.map[5][8] = { tile: TILE.WALL }
    tryCast(s, 'blink')
    assert.equal(s.player.x, 7)
    assert.equal(s.player.y, 5)
  })

  it('passes over an enemy standing in the way', () => {
    const blocker = guardAt(2 * T, 0)
    const s = mkState({}, [blocker])
    tryCast(s, 'blink')
    assert.equal(s.player.x, 9)
  })

  it('stays put when the very next cell is a wall', () => {
    const s = mkState()
    s.map[5][6] = { tile: TILE.WALL }
    const r = tryCast(s, 'blink')
    assert.equal(s.player.x, 5)
    assert.deepEqual(r.from, r.to)
  })

  it('full grants a moment of invulnerability, tap does not', () => {
    const tap = mkState()
    tryCast(tap, 'blink')
    assert.ok(!tap.player.invulnTimer)
    const full = mkState()
    tryCast(full, 'blink', 'full')
    assert.equal(full.player.invulnTimer, 0.5)
  })

  it('over asks game.js for the backwards gust', () => {
    const s = mkState()
    const r = tryCast(s, 'blink', 'over')
    assert.equal(r.gustBack, true)
    assert.equal(s.player.invulnTimer, 0.5)
    assert.equal(tryCast(mkState(), 'blink', 'full').gustBack, undefined)
  })
})

describe('module primitive (lightning)', () => {
  it('dispatches to the injected module and merges its result', () => {
    const s = mkState()
    const calls = []
    const lightning = (state, tier) => { calls.push([state, tier]); return { marks: [3, 6, 8] } }
    const r = tryCast(s, 'lightning', 'over', { modules: { lightning } })
    assert.equal(r.ok, true)
    assert.deepEqual(r.marks, [3, 6, 8])
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], s)
    assert.equal(calls[0][1], 'over')
    assert.equal(s.player.stamina, 100 - 50)
  })

  it('refuses without a module rather than burning the tank', () => {
    const s = mkState()
    assert.deepEqual(tryCast(s, 'lightning'), { ok: false, reason: 'not_learned' })
    assert.equal(s.player.stamina, 100)
  })
})
