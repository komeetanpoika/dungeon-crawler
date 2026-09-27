// Sub-project 2b §1: Might, Ward and the elemental edges in the damage path,
// and the damage-over-time they leave (renderer/pvp/combat.js, dots.js and
// the sim's tickDots).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeHero, placeHero } from '../renderer/pvp/hero.js'
import { hurtHero } from '../renderer/pvp/combat.js'
import { swing, startCombo, stepCombo } from '../renderer/pvp/attacks.js'
import { grantBuff } from '../renderer/pvp/buffs.js'
import { setDot } from '../renderer/pvp/dots.js'
import { makeMatch, stepMatch, removeHero, detonateFireball, tickFireZones, tickDots } from '../renderer/pvp/sim.js'
import { damagePlayer, INVULN_DURATION } from '../renderer/systems/player-damage.js'
import { resolveCharge } from '../renderer/systems/melee.js'
import { applyShock } from '../renderer/systems/hammer.js'
import { makeFeedback } from '../renderer/systems/feedback.js'
import { makePlayer } from '../renderer/systems/entities.js'
import { PVP } from '../renderer/data/pvp.js'
import { testMatch } from './pvp-helpers.js'

const dt = PVP.tick
const hero = (id, cls, cell) => { const h = makeHero({ id, name: id, cls }); placeHero(h, cell); return h }
// An attacker at 5,5 facing east and a foe one tile east, in a test match.
const pair = (cls = 'warrior', foeCls = 'archer') => {
  const a = hero('a', cls, { x: 5, y: 5 }), f = hero('f', foeCls, { x: 6, y: 5 })
  a.facing = 'east'
  return { a, f, m: testMatch([a, f]) }
}
const blow = (m, a) => swing(m, a, resolveCharge('sword', 0))
// A real match (so CC scaling and the tick order apply) with two heroes placed.
const duel = (cls = 'archer', foeCls = 'mage', at = { x: 3, y: 8 }, foeAt = { x: 6, y: 8 }) => {
  const m = makeMatch({ roster: [{ id: 'a', name: 'a', cls }, { id: 'f', name: 'f', cls: foeCls }] })
  const [a, f] = m.heroes
  placeHero(a, at); placeHero(f, foeAt)
  a.spawnProtect = 0; f.spawnProtect = 0; a.facing = 'east'
  return { m, a, f }
}
const ticks = (m, n, inputs = () => ({})) => { for (let i = 0; i < n; i++) stepMatch(m, inputs(i), dt) }
const shoot = i => ({ a: { move: { x: 0, y: 0 }, facing: 'east', attack: i === 0, alt: false, sprint: false } })

describe('Might', () => {
  it('adds its bonus to a sword blow (2 → 3 minor, 4 major)', () => {
    for (const [tier, dealt] of [[null, 2], ['minor', 3], ['major', 4]]) {
      const { a, f, m } = pair()
      if (tier) grantBuff(a, 'might', tier)
      blow(m, a)
      assert.equal(PVP.hp - f.hp, dealt, `${tier}`)
    }
  })
  it('adds to a direct hit of every kind hurtHero is told is direct, and to none of the rest', () => {
    const dealt = opts => {
      const { a, f, m } = pair()
      grantBuff(a, 'might', 'minor')
      hurtHero(m, f, 1, { by: a, ...opts })
      return PVP.hp - f.hp
    }
    assert.equal(dealt({ direct: true }), 2, 'a projectile or a combo hit')
    assert.equal(dealt({ kind: 'lightning', direct: true }), 2, 'a lightning strike')
    assert.equal(dealt({ kind: 'fire', direct: true }), 2, "the fireball's burst")
    assert.equal(dealt({ kind: 'dot' }), 1, 'a burn or poison tick')
    assert.equal(dealt({ kind: 'fire' }), 1, 'a fire-patch tick')
    assert.equal(dealt({ kind: 'lightning' }), 1, "a shock tick or the hammer's chain")
  })
  it("the Warrior's combos carry it: the lunge's 3, each fence thrust's 1, the whirlwind's 2", () => {
    for (const [kind, dealt] of [['lunge', 3 + 1], ['fence', 3 * (1 + 1)], ['whirl', 2 + 1]]) {
      const { a, f, m } = pair()
      grantBuff(a, 'might', 'minor')
      startCombo(m, a, { kind, dir: 'e' })
      for (let i = 0; i < 12; i++) stepCombo(m, a, dt)
      assert.equal(PVP.hp - f.hp, dealt, kind)
    }
  })
  it("a lightning strike in a match carries it; a hammer shock's tick does not", () => {
    const { m, a, f } = duel('mage', 'archer')
    grantBuff(a, 'might', 'minor')
    m.lightning.push({ x: f.x, y: f.y, t: 0, delay: 0, owner: 'a', damage: 3, stun: 0 })
    ticks(m, 1)
    assert.equal(PVP.hp - f.hp, 3 + 1)
    applyShock(f); f.shock.owner = 'a'
    ticks(m, 31)                                  // the first stroke at 1 s
    assert.equal(PVP.hp - f.hp, 3 + 1 + 1)
  })
  it("an arrow in a match carries the archer's Might when it lands", () => {
    const { m, a, f } = duel('archer', 'mage')
    grantBuff(a, 'might', 'major')
    ticks(m, 20, shoot)
    assert.equal(PVP.hp - f.hp, 2 + 2)            // the shortbow's 2 + 2
  })
  it("the fireball's burst carries it; the patch it lays does not", () => {
    const { a, f, m } = pair('mage', 'archer')
    grantBuff(a, 'might', 'minor')
    detonateFireball(m, f.px, f.py, 3, {}, { owner: 'a', struck: null })
    assert.equal(PVP.hp - f.hp, 2 + 1)
    for (let i = 0; i < 30; i++) tickFireZones(m, dt)
    assert.equal(PVP.hp - f.hp, 2 + 1 + 1, 'the first patch tick is a plain 1')
  })
  it('comes from the attacker: a Might on the victim adds nothing', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'might', 'major')
    blow(m, a)
    assert.equal(PVP.hp - f.hp, 2)
  })
})

describe('Ward', () => {
  it('soaks a whole hit: no hp lost, yet the hit lands — i-frames and credit — and the pool is spent', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'minor')
    assert.equal(hurtHero(m, f, 2, { by: a, direct: true }), true)
    assert.equal(f.hp, PVP.hp)
    assert.equal(f.invulnTimer, INVULN_DURATION)
    assert.equal(f.lastHitBy.id, 'a')
    assert.equal(f.buffs.ward, null, 'a pool at 0 breaks the ward')
  })
  it('a major pool of 4 soaks 3 and keeps 1; the next hit spills over', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'major')
    hurtHero(m, f, 3, { by: a })
    assert.equal(f.hp, PVP.hp); assert.equal(f.buffs.ward.pool, 1)
    f.invulnTimer = 0
    hurtHero(m, f, 3, { by: a })
    assert.equal(f.hp, PVP.hp - 2); assert.equal(f.buffs.ward, null)
  })
  it('soaks every kind: a burn tick and a fire-patch tick too', () => {
    const { a, f, m } = pair()
    grantBuff(f, 'ward', 'minor')
    hurtHero(m, f, 1, { kind: 'dot', by: a })
    hurtHero(m, f, 1, { kind: 'fire', by: a })
    assert.equal(f.hp, PVP.hp); assert.equal(f.buffs.ward, null)
  })
  it("a buckler's block comes first: a blocked blow leaves the pool alone", () => {
    const { a, f, m } = pair('warrior', 'warrior')
    grantBuff(f, 'ward', 'minor')
    f.facing = 'west'; f.blocking = true
    blow(m, a)
    assert.equal(f.hp, PVP.hp)
    assert.equal(f.buffs.ward.pool, 2)
  })
  it("Might is added before the ward: a 2 blow + 1 against a pool of 2 takes 1 hp", () => {
    const { a, f, m } = pair()
    grantBuff(a, 'might', 'minor'); grantBuff(f, 'ward', 'minor')
    blow(m, a)
    assert.equal(PVP.hp - f.hp, 1)
  })
  it("damagePlayer's soak is optional: single-player's damage is untouched", () => {
    const p = makePlayer(0, 0)
    p.hp = 10
    damagePlayer({ player: p, feedback: makeFeedback() }, 3, 'dot')
    assert.equal(p.hp, 7)
  })
})

describe('the edges', () => {
  it('Ember: a landed direct hit burns the victim for 2 s (minor), credited to the attacker', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'minor')
    blow(m, a)
    assert.deepEqual(f.burn, { owner: 'a', t: 2, next: 1 })
    assert.equal(m.fireZones.length, 0, 'a minor lays no patch')
  })
  it('Ember major: a 3 s burn and a 5-tile fire patch under the victim, credited to the attacker', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'major')
    blow(m, a)
    assert.equal(f.burn.t, 3)
    assert.equal(m.fireZones.length, 1)
    assert.equal(m.fireZones[0].owner, 'a')
    assert.equal(m.fireZones[0].tiles.length, 5)
    assert.ok(m.fireZones[0].tiles.some(t => t.x === f.x && t.y === f.y))
  })
  it('a major Ember hit on a hero in a corner lays its patch only on floor', () => {
    const a = hero('a', 'warrior', { x: 2, y: 1 }), f = hero('f', 'archer', { x: 1, y: 1 })
    a.facing = 'west'
    const m = testMatch([a, f])
    grantBuff(a, 'ember', 'major')
    blow(m, a)
    const tiles = m.fireZones[0].tiles
    assert.equal(tiles.length, 5)
    for (const t of tiles) assert.ok(t.x >= 1 && t.y >= 1, `${t.x},${t.y} is a wall`)
  })
  it("a newer Ember patch replaces the same attacker's older one; another's stays", () => {
    const { a, f, m } = pair()
    grantBuff(a, 'ember', 'major')
    m.fireZones.push({ tiles: [{ x: 1, y: 1 }], age: 0, tickTimer: 1, owner: 'z' })
    blow(m, a); f.invulnTimer = 0; a.meleeCooldown = 0
    blow(m, a)
    assert.deepEqual(m.fireZones.map(z => z.owner), ['z', 'a'])
  })
  it('Venom: a poison for 3 s and a 20 % slow (minor); 4.5 s and 35 % (major)', () => {
    for (const [tier, t, mul] of [['minor', 3, 0.8], ['major', 4.5, 0.65]]) {
      const { a, f, m } = pair()
      grantBuff(a, 'venom', tier)
      blow(m, a)
      assert.deepEqual(f.poison, { owner: 'a', t, next: 1.5 }, tier)
      assert.ok(Math.abs(f.slowMul - mul) < 1e-9); assert.equal(f.slowTimer, t)
    }
  })
  it('a stronger slow already running stays', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'venom', 'minor')
    f.slowTimer = 1; f.slowMul = 0.4
    blow(m, a)
    assert.equal(f.slowMul, 0.4); assert.equal(f.slowTimer, 1)
  })
  it('no edge on a blocked hit, nor on one a Ward soaks whole; a hit the Ward only dents does coat', () => {
    const blocked = pair('warrior', 'warrior')
    grantBuff(blocked.a, 'ember', 'minor')
    blocked.f.facing = 'west'; blocked.f.blocking = true
    blow(blocked.m, blocked.a)
    assert.equal(blocked.f.burn, null)

    const soaked = pair()
    grantBuff(soaked.a, 'venom', 'minor'); grantBuff(soaked.f, 'ward', 'major')
    blow(soaked.m, soaked.a)
    assert.equal(soaked.f.poison, null); assert.equal(soaked.f.slowTimer, 0)

    const dented = pair()
    grantBuff(dented.a, 'venom', 'minor'); grantBuff(dented.f, 'ward', 'minor')
    grantBuff(dented.a, 'might', 'minor')
    blow(dented.m, dented.a)
    assert.equal(PVP.hp - dented.f.hp, 1)
    assert.equal(dented.f.poison.owner, 'a')
  })
  it('no edge from a damage-over-time or patch tick', () => {
    const { a, f, m } = pair()
    grantBuff(a, 'venom', 'major')
    hurtHero(m, f, 1, { kind: 'dot', by: a })
    hurtHero(m, f, 1, { kind: 'fire', by: a })
    assert.equal(f.poison, null)
  })
  it('re-applying refreshes the time, takes the new owner and keeps the tick clock', () => {
    const f = hero('f', 'mage', { x: 5, y: 5 })
    setDot(f, 'burn', 'a', 2)
    f.burn.t = 0.5; f.burn.next = 0.5
    setDot(f, 'burn', 'b', 2)
    assert.deepEqual(f.burn, { owner: 'b', t: 2, next: 0.5 })
    setDot(f, 'burn', 'b', 2); f.burn.t = 3
    setDot(f, 'burn', 'a', 2)
    assert.equal(f.burn.t, 3, 'never shortened')
  })
  it("Venom's slow in a match lasts PVP.ccMul of its 3 s", () => {
    const { m, a, f } = duel('archer', 'mage')
    grantBuff(a, 'venom', 'minor')
    for (let i = 0; i < 20 && !f.poison; i++) stepMatch(m, shoot(i), dt)
    assert.ok(f.poison, 'the arrow landed')
    assert.ok(Math.abs(f.slowTimer - 3 * PVP.ccMul) < 1e-9, `slowTimer ${f.slowTimer}`)
    assert.ok(Math.abs(f.slowMul - 0.8) < 1e-9)
  })
})

describe('tickDots', () => {
  const burning = (kind, dur) => {
    const { m, a, f } = duel('warrior', 'mage', { x: 3, y: 8 }, { x: 12, y: 8 })
    setDot(f, kind, 'a', dur)
    return { m, a, f }
  }
  it('a minor burn deals 1 a second for 2 s — 2 in all — then ends', () => {
    const { m, f } = burning('burn', 2)
    ticks(m, 29); assert.equal(f.hp, PVP.hp)
    ticks(m, 1); assert.equal(f.hp, PVP.hp - 1)
    ticks(m, 30); assert.equal(f.hp, PVP.hp - 2); assert.equal(f.burn, null)
    ticks(m, 60); assert.equal(f.hp, PVP.hp - 2)
  })
  it('a 3 s burn deals 3; poison deals 1 every 1.5 s: 2 over 3 s, 3 over 4.5 s', () => {
    for (const [kind, dur, total] of [['burn', 3, 3], ['poison', 3, 2], ['poison', 4.5, 3]]) {
      const { m, f } = burning(kind, dur)
      ticks(m, Math.round(dur / dt) + 30)
      assert.equal(PVP.hp - f.hp, total, `${kind} ${dur}`)
      assert.equal(f[kind], null)
    }
  })
  it("ticks are unblockable 'dot' damage credited to the owner, and do not reset i-frames", () => {
    const { m, f } = burning('burn', 2)
    f.blocking = true; f.invulnTimer = 5
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.equal(f.hp, PVP.hp - 1)
    assert.deepEqual(ev.filter(e => e.type === 'hit').map(e => [e.target, e.by, e.amount]), [['f', 'a', 1]])
    assert.equal(f.lastHitBy.id, 'a')
  })
  it('a damage-over-time kill counts for the owner', () => {
    const { m, a, f } = burning('poison', 3)
    f.hp = 1
    const ev = []
    for (let i = 0; i < 50; i++) ev.push(...stepMatch(m, {}, dt))
    assert.deepEqual(ev.filter(e => e.type === 'kill'), [{ type: 'kill', victim: 'f', killer: 'a' }])
    assert.equal(a.kills, 1)
    assert.equal(f.poison, null, 'the death cleared it')
  })
  it('an owner who has died (not left) still gets the kill', () => {
    const { m, a, f } = burning('burn', 2)
    a.hp = 0; stepMatch(m, {}, dt)                 // the owner dies first
    assert.equal(a.dead, true)
    f.hp = 1
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.deepEqual(ev.filter(e => e.type === 'kill' && e.victim === 'f'), [{ type: 'kill', victim: 'f', killer: 'a' }])
  })
  it('an owner who has left credits nobody, and the burn still burns', () => {
    const { m, f } = burning('burn', 2)
    m.heroes.push(makeHero({ id: 'x', name: 'x', cls: 'mage' }))   // a third hero, so the match keeps two
    placeHero(m.heroes[2], { x: 20, y: 20 })
    removeHero(m, 'a')
    const ev = []
    for (let i = 0; i < 30; i++) ev.push(...stepMatch(m, {}, dt))
    assert.equal(f.hp, PVP.hp - 1)
    assert.deepEqual(ev.filter(e => e.type === 'hit').map(e => e.by), [null])
    assert.equal(f.lastHitBy, null)
  })
  it('a spawn-protected hero takes no tick, and the dot runs on', () => {
    const { m, f } = burning('burn', 2)
    f.spawnProtect = 5
    tickDots(m, 1)
    assert.equal(f.hp, PVP.hp)
    assert.ok(Math.abs(f.burn.t - 1) < 1e-9)
  })
  it('a dead hero is skipped', () => {
    const { m, f } = burning('burn', 2)
    f.dead = true
    tickDots(m, 1)
    assert.equal(f.burn.t, 2)
  })
})
