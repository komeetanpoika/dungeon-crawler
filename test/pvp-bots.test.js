import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { botInput, nextStep, lightningTier } from '../renderer/pvp/bots.js'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { placeHero, tickHero, NEUTRAL_INPUT } from '../renderer/pvp/hero.js'
import { grantRune, makePickups } from '../renderer/pvp/pickups.js'
import { PVP_ARENAS } from '../renderer/data/pvp-arenas.js'
import { openMap } from './pvp-helpers.js'
import { TILE } from '../renderer/systems/entities.js'
import { DOUBLE_SHOT, PVP, BOTS } from '../renderer/data/pvp.js'
import { GUST_CHARGE } from '../renderer/systems/magic.js'

const roster = (...cls) => cls.map((c, i) => ({ id: `b${i}`, name: `B${i}`, cls: c }))
const valid = inp => ['x', 'y'].every(k => [-1, 0, 1].includes(inp.move[k])) &&
  (inp.facing === null || ['north', 'south', 'east', 'west'].includes(inp.facing)) &&
  typeof inp.attack === 'boolean' && typeof inp.alt === 'boolean'

describe('nextStep', () => {
  it('following it walks the shortest way around a wall', () => {
    const map = openMap(7, 7)
    for (let y = 1; y <= 4; y++) map[y][3].tile = TILE.WALL
    const goal = { x: 5, y: 1 }
    let pos = { x: 1, y: 1 }, steps = 0
    while (!(pos.x === goal.x && pos.y === goal.y) && steps < 50) {
      const next = nextStep(map, pos, goal)
      assert.ok(Math.abs(next.x - pos.x) + Math.abs(next.y - pos.y) === 1, 'one orthogonal step')
      assert.notEqual(map[next.y][next.x].tile, TILE.WALL)
      pos = next; steps++
    }
    assert.equal(steps, 12)
  })
  it('returns null when the goal is walled off', () => {
    const map = openMap(7, 7)
    for (let y = 1; y <= 5; y++) map[y][3].tile = TILE.WALL
    assert.equal(nextStep(map, { x: 1, y: 1 }, { x: 5, y: 1 }), null)
  })
})

describe('botInput', () => {
  it('produces a valid input for every class', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer', 'mage') })
    for (const h of m.heroes) assert.ok(valid(botInput(m, h)), h.cls)
  })
  it('a warrior next to a foe faces it and attacks', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    placeHero(m.heroes[0], { x: 10, y: 2 }); placeHero(m.heroes[1], { x: 11, y: 2 })
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east'); assert.equal(inp.attack, true)
  })
  it('an archer aligned with a foe in the open shoots along the line', () => {
    const m = makeMatch({ roster: roster('archer', 'warrior') })
    placeHero(m.heroes[0], { x: 2, y: 2 }); placeHero(m.heroes[1], { x: 6, y: 2 })   // 4 tiles: inside the double shot's 5
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east'); assert.equal(inp.attack, true)
  })
  it('a dead bot idles', () => {
    const m = makeMatch({ roster: roster('mage', 'archer') })
    m.heroes[0].dead = true
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.attack, false); assert.deepEqual(inp.move, { x: 0, y: 0 })
  })
  it('a hurt bot heads for a flask', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const b = m.heroes[0]
    placeHero(b, { x: 7, y: 14 }); b.hp = 2          // flask at (7,12)
    placeHero(m.heroes[1], { x: 29, y: 21 })
    assert.deepEqual(botInput(m, b).move, { x: 0, y: -1 })
  })
})

describe('the warrior bot taps the sword (2a: it swings on release)', () => {
  it('presses, lets go, and the swing lands', () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const [w, a] = m.heroes
    placeHero(w, { x: 10, y: 2 }); placeHero(a, { x: 11, y: 2 }); a.spawnProtect = 0; w.spawnProtect = 0
    const first = botInput(m, w)
    assert.equal(first.attack, true)
    tickHero(m, w, first, 1 / 30)
    assert.ok(w.combo)
    const second = botInput(m, w)
    assert.equal(second.attack, false)
    tickHero(m, w, second, 1 / 30)
    assert.ok(a.hp < a.maxHp)
  })
})

describe('a cancelled hold does not stall the warrior bot forever (fix round 1)', () => {
  const setup = () => {
    const m = makeMatch({ roster: roster('warrior', 'archer') })
    const [w, a] = m.heroes
    placeHero(w, { x: 10, y: 2 }); placeHero(a, { x: 11, y: 2 }); a.spawnProtect = 0; w.spawnProtect = 0
    return { m, w, a }
  }
  // The bot itself only ever asks to hold with the key already up going in
  // (it taps); the cancel below stands in for whatever forced the drop
  // (a shield raised by an incoming shot, a stun from being hit) landing on
  // a tick the key was still down — the bug case, since bots.js used to
  // send `!hero.combo` with no regard for needRelease.
  // beforeCancel/afterCancel mutate hero state directly around the cancel
  // tick (this test drives tickHero by hand, without tickHeroStatus, so a
  // stunTimer set here never decays on its own — it is cleared explicitly).
  const recovers = (m, w, beforeCancel, cancelledInput, afterCancel = () => {}) => {
    tickHero(m, w, botInput(m, w), 1 / 30)          // press: the bot begins a hold
    assert.ok(w.combo)
    beforeCancel(w)
    tickHero(m, w, cancelledInput, 1 / 30)          // cancelled with the key still down
    assert.equal(w.combo, null)
    afterCancel(w)
    let held = false
    for (let i = 0; i < 3 && !held; i++) { tickHero(m, w, botInput(m, w), 1 / 30); held = !!w.combo }
    assert.ok(held, 'the bot lets go and holds again within 3 ticks')
  }
  it('cancelled by a shield', () => {
    const { m, w } = setup()
    recovers(m, w, () => {}, { ...NEUTRAL_INPUT, attack: true, alt: true, facing: 'east' })
  })
  it('cancelled by a stun', () => {
    const { m, w } = setup()
    recovers(m, w, w => { w.stunTimer = 0.1 }, { ...NEUTRAL_INPUT, attack: true, facing: 'east' }, w => { w.stunTimer = 0 })
  })
  it('a hammer-rune bot keeps swinging over a few seconds (no stall after an auto-release)', () => {
    const { m, w, a } = setup()
    grantRune(m, w)
    a.hp = a.maxHp = 1000                            // never dies mid-run
    let swings = 0, wasSwinging = false
    for (let i = 0; i < 300; i++) {                  // 10 s at 30 Hz
      tickHero(m, w, botInput(m, w), 1 / 30)
      const swinging = w.attackTimer > 0
      if (swinging && !wasSwinging) swings++
      wasSwinging = swinging
    }
    assert.ok(swings >= 3, `expected several hammer swings over 10s, got ${swings}`)
  })
})

describe('bots use the signature moves (2a)', () => {
  // Bot `id` plays against foes that stand still; returns every tick's value
  // of `watch(bot)`.
  const run = (m, id, ticks, watch) => {
    const bot = m.heroes.find(h => h.id === id)
    const seen = []
    for (let i = 0; i < ticks; i++) {
      stepMatch(m, { [id]: botInput(m, bot) }, 1 / 30)
      seen.push(watch(bot))
    }
    return seen
  }
  const setup = (cls, botCell, foes) => {
    const m = makeMatch({ roster: roster(cls, ...foes.map(f => f.cls)) })
    placeHero(m.heroes[0], botCell)
    foes.forEach((f, i) => { placeHero(m.heroes[i + 1], f.cell); if (f.facing) m.heroes[i + 1].facing = f.facing })
    for (const h of m.heroes) h.spawnProtect = 0
    return m
  }
  it('a warrior lunges at a foe lined up 2-3 tiles away', () => {
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 13, y: 2 } }])
    const kinds = run(m, 'b0', 20, h => h.move?.kind ?? null)
    assert.ok(kinds.includes('lunge'), kinds.join(','))
    assert.equal(m.heroes[1].hp, m.heroes[1].maxHp - 3)
  })
  it('a warrior with a full tank whirls between two close foes', () => {
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 11, y: 2 } }, { cls: 'archer', cell: { x: 9, y: 2 } }])
    const kinds = run(m, 'b0', 20, h => h.move?.kind ?? null)
    assert.ok(kinds.includes('whirl'), kinds.join(','))
    assert.ok(m.heroes[1].hp < m.heroes[1].maxHp && m.heroes[2].hp < m.heroes[2].maxHp)
  })
  it('at the widened whirlRange (2 tiles), a warrior with a full tank still opts to whirl rather than lunge (m5)', () => {
    // Two tiles is also within lungeMin/lungeMax — before m5's widening, a
    // warrior bot here would lunge instead, since `close` counted neither
    // foe (whirlRange was 1.5). BOTS.whirlFoes (a full tank) is unchanged.
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 12, y: 2 } }, { cls: 'archer', cell: { x: 8, y: 2 } }])
    const kinds = run(m, 'b0', 20, h => h.move?.kind ?? null)
    assert.ok(kinds.includes('whirl'), kinds.join(','))
  })
  it('an archer draws the double shot to full at a lined-up foe 5+ tiles off that is not closing', () => {
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 9, y: 2 }, facing: 'east' }])
    const draws = run(m, 'b0', 45, h => h.charging?.kind === 'double' ? h.charging.t : null)
    assert.ok(draws.some(t => t === DOUBLE_SHOT.full), 'drew to full')
    const shots = m.projectiles.filter(p => p.owner === 'b0')
    assert.equal(shots.length, 2)
    assert.ok(shots.every(p => p.damage === 5))
  })
  it('an archer streams at a foe walking toward it', () => {
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 9, y: 2 }, facing: 'west' }])
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.alt, false); assert.equal(inp.attack, true)
  })
  it('lightningTier: the tier whose strike lands nearest the foe, ties to the cheaper', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(lightningTier), ['tap', 'tap', 'tap', 'over', 'full', 'full', 'full', 'over', 'over'])
  })
  it('a mage charges to the full tier for a foe 6 tiles off, then lets go', () => {
    const m = setup('mage', { x: 2, y: 2 }, [{ cls: 'archer', cell: { x: 8, y: 2 } }])
    const held = run(m, 'b0', 25, h => h.charging?.t ?? null)
    const peak = Math.max(...held.filter(t => t !== null))
    assert.ok(peak >= GUST_CHARGE.full - 1e-9 && peak < GUST_CHARGE.over, `peak ${peak}`)
    assert.ok(m.lightning.length + m.strikes.length > 0 || m.heroes[1].hp < m.heroes[1].maxHp)
  })
})

describe('fix round 1: bots keep acting against a stationary foe, not just once', () => {
  // A rising edge on a cooldown field means an action just fired (cooldowns
  // only ever count down otherwise).
  const countRises = (m, id, ticks, field) => {
    const bot = m.heroes.find(h => h.id === id)
    let prev = bot[field], count = 0, maxDraw = 0
    for (let i = 0; i < ticks; i++) {
      stepMatch(m, { [id]: botInput(m, bot) }, 1 / 30)
      if (bot[field] > prev) count++
      prev = bot[field]
      if (bot.charging?.kind === 'double') maxDraw = Math.max(maxDraw, bot.charging.t)
    }
    return { count, maxDraw }
  }
  const setup = (cls, botCell, foes) => {
    const m = makeMatch({ roster: roster(cls, ...foes.map(f => f.cls)) })
    placeHero(m.heroes[0], botCell)
    foes.forEach((f, i) => {
      const h = m.heroes[i + 1]
      placeHero(h, f.cell)
      if (f.facing) h.facing = f.facing
      h.hp = h.maxHp = 1000                 // never dies mid-run
    })
    for (const h of m.heroes) h.spawnProtect = 0
    return m
  }
  it('a mage keeps casting Call Lightning (needRelease must not stick after a cast)', () => {
    const m = setup('mage', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 8, y: 2 } }])
    const { count } = countRises(m, 'b0', 180, 'magicCooldown')   // 6 s at 30 Hz
    assert.ok(count >= 3, `expected at least 3 casts in 6s, got ${count}`)
  })
  it('a warrior keeps swinging/lunging at a foe lined up 2-3 tiles away', () => {
    const m = setup('warrior', { x: 10, y: 2 }, [{ cls: 'archer', cell: { x: 13, y: 2 } }])
    const { count } = countRises(m, 'b0', 120, 'meleeCooldown')   // 4 s at 30 Hz
    assert.ok(count > 1, `expected more than one swing/lunge, got ${count}`)
  })
  it('an archer keeps firing the double shot, never holding the draw past full + a tick', () => {
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 9, y: 2 }, facing: 'east' }])
    const { count, maxDraw } = countRises(m, 'b0', 150, 'rangedCooldown')   // 5 s at 30 Hz
    assert.ok(count > 1, `expected more than one double shot, got ${count}`)
    assert.ok(maxDraw <= DOUBLE_SHOT.full + 1 / 30 + 1e-9, `draw held past full: ${maxDraw}`)
  })
  it('an archer bot that respawns already lined up with a close foe still looses arrows (m2)', () => {
    // tickRespawns forces needRelease true on every respawn (a real player's
    // key is known released on death; a bot's input is not) — the
    // plain-attack input must be gated on it like the other two bots, or a
    // bot that stays lined up never sends attack:false and never clears it.
    const m = setup('archer', { x: 2, y: 2 }, [{ cls: 'warrior', cell: { x: 4, y: 2 }, facing: 'east' }])
    const bot = m.heroes[0]
    bot.needRelease = true
    for (let i = 0; i < 30 && m.projectiles.filter(p => p.owner === 'b0').length === 0; i++) {
      stepMatch(m, { b0: botInput(m, bot) }, 1 / 30)
    }
    assert.ok(m.projectiles.some(p => p.owner === 'b0'), 'the bot loosed an arrow after the respawn latch')
  })
})

describe('bots and buff spots (2b)', () => {
  // A match on pillars whose only pickups are `list` (up unless said), the
  // bot b0 at `at` and a foe b1 at `foeAt`.
  const setup = (list, at, foeAt, cls = 'archer') => {
    const m = makeMatch({ roster: roster(cls, 'warrior'), seed: 4 })
    m.pickups = makePickups({ pickups: list }, m.rng)
    for (const p of m.pickups) if (p.kind === 'buff') { p.up = true; p.t = 0; p.buff = 'haste'; p.next = null }
    placeHero(m.heroes[0], at); placeHero(m.heroes[1], foeAt)
    return m
  }
  const minor = (x, y) => ({ kind: 'buff', tier: 'minor', x, y })
  const major = (x, y) => ({ kind: 'buff', tier: 'major', x, y })
  // Steps only the bot (the foe stands still) until it takes a pickup.
  const takes = (m, ticks = 200) => {
    for (let i = 0; i < ticks; i++) {
      for (const e of stepMatch(m, { b0: botInput(m, m.heroes[0]) }, PVP.tick))
        if (e.type === 'pickup') return e
    }
    return null
  }
  it('with no foe within 4 tiles, a bot detours to an up minor spot within 6 and takes it', () => {
    const m = setup([minor(4, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })     // the spot away from the foe
    assert.deepEqual(botInput(m, m.heroes[0]).move, { x: -1, y: 0 })
    assert.deepEqual(takes(m), { type: 'pickup', kind: 'buff', hero: 'b0', buff: 'haste', tier: 'minor' })
    assert.equal(m.heroes[0].buffs.haste.tier, 'minor')
  })
  it('a minor spot farther than 6 tiles, or down, draws no detour', () => {
    const far = setup([minor(2, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })
    assert.equal(tileDist(far), 7)
    assert.notDeepEqual(botInput(far, far.heroes[0]).move, { x: -1, y: 0 })
    assert.equal(takes(far, 20), null)
    const down = setup([minor(5, 2)], { x: 9, y: 2 }, { x: 29, y: 21 })
    down.pickups[0].up = false; down.pickups[0].t = 99
    assert.equal(takes(down, 30), null)
  })
  it('a foe within 4 tiles: the bot fights instead of detouring to a minor spot', () => {
    const m = setup([minor(2, 5)], { x: 2, y: 2 }, { x: 5, y: 2 })
    const inp = botInput(m, m.heroes[0])
    assert.equal(inp.facing, 'east')
    assert.equal(inp.attack, true)
  })
  it('a major spot within 10 tiles draws the bot even with a foe beside it', () => {
    const m = setup([major(11, 2)], { x: 2, y: 2 }, { x: 3, y: 2 }, 'warrior')
    const inp = botInput(m, m.heroes[0])
    assert.deepEqual(inp.move, { x: 1, y: 0 })
    assert.equal(inp.attack, false)
    const out = setup([major(13, 2)], { x: 2, y: 2 }, { x: 3, y: 2 }, 'warrior')
    assert.equal(botInput(out, out.heroes[0]).attack, true, 'at 11 tiles it fights')
  })
  it('a hurt bot still goes for a flask first', () => {
    const m = setup([major(2, 8), { kind: 'flask', x: 8, y: 2 }], { x: 2, y: 2 }, { x: 29, y: 21 })
    m.heroes[0].hp = 1
    assert.deepEqual(botInput(m, m.heroes[0]).move, { x: 1, y: 0 })
  })
  const tileDist = m => Math.hypot(m.heroes[0].x - m.pickups[0].x, m.heroes[0].y - m.pickups[0].y)

  for (const id of ['keep', 'wilds']) {
    it(`six bots on ${id} for 60 s take buffs of both tiers, never latch the attack, never stand idle`, () => {
      const m = makeMatch({ roster: roster('warrior', 'archer', 'mage', 'warrior', 'archer', 'mage'), arena: PVP_ARENAS[id], seed: 3 })
      const taken = new Set(), latch = {}, idle = {}, last = {}
      let worstLatch = 0, worstIdle = 0
      for (let i = 0; i < 60 / PVP.tick; i++) {
        const inputs = Object.fromEntries(m.heroes.map(h => [h.id, botInput(m, h)]))
        for (const h of m.heroes) {
          const inp = inputs[h.id]
          latch[h.id] = !h.dead && h.needRelease && inp.attack ? (latch[h.id] ?? 0) + PVP.tick : 0
          const moved = last[h.id] && (last[h.id].px !== h.px || last[h.id].py !== h.py)
          idle[h.id] = !h.dead && !moved && !inp.attack && !inp.alt ? (idle[h.id] ?? 0) + PVP.tick : 0
          worstLatch = Math.max(worstLatch, latch[h.id]); worstIdle = Math.max(worstIdle, idle[h.id])
          last[h.id] = { px: h.px, py: h.py }
        }
        for (const e of stepMatch(m, inputs, PVP.tick)) if (e.type === 'pickup' && e.kind === 'buff') taken.add(e.tier)
      }
      assert.deepEqual([...taken].sort(), ['major', 'minor'])
      assert.ok(worstLatch < 1, `attack held against needRelease for ${worstLatch.toFixed(2)} s`)
      assert.ok(worstIdle < 5, `a bot stood idle ${worstIdle.toFixed(2)} s`)
    })
  }
})
