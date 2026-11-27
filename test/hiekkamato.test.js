import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as hooks from '../renderer/systems/monsters/hiekkamato.js'
import { tuningOf, isStoryCreature, spellSpares, getMonsterDef, entityPose } from '../renderer/systems/monsters.js'
import { strikeCreature } from '../renderer/systems/creatures.js'
import { makeShieldContents } from '../renderer/systems/entities.js'
import { stepKnockback } from '../renderer/systems/knockback.js'
import { register, world, spawn, moveHero, run, cues, cell, tilesApart, S } from './helpers/desert-bench.js'

const { update, routeUnder } = hooks
const T = () => tuningOf('hiekkamato')
const worm = (s, x = 20, y = 12) => spawn(s, 'hiekkamato', x, y)
// the hero walks at `speed` px/s along (dx, dy), one frame per call
const walker = (s, dx, dy, speed = 120) => () => {
  const p = s.player, n = Math.hypot(dx, dy)
  p.px += dx / n * speed / 60; p.py += dy / n * speed / 60
  p.x = Math.floor(p.px / S); p.y = Math.floor(p.py / S)
}
const hard = (s, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.map[y][x] = cell('ow_road_sand_0') }
// run until the worm is in `st` (at most `max` seconds); returns whether it got there
function until(s, e, st, max, each = null) {
  for (let i = 0; i < max * 60; i++) { run(s, e, update, 1 / 60, each); if (e.worm.state === st) return true }
  return false
}

describe('hiekkamato', () => {
  beforeEach(() => register(['hiekkamato'], hooks))

  it('takes its tuning from the def; a story creature the Wilds places', () => {
    for (const p of hooks.TUNING_SCHEMA) assert.ok(p.key in T(), p.key)
    const d = getMonsterDef('hiekkamato')
    assert.equal(d.spawn, null)
    assert.equal(d.behavior.driver, 'hook')
    assert.ok(T().speed > 186, 'faster than any sprint')
  })

  it('prowls under the sand near home: sunk, untouchable, spared by spells', () => {
    const s = world(), e = worm(s)
    moveHero(s, 20, 35)
    run(s, e, update, 6)
    assert.equal(e.worm.state, 'prowl')
    assert.equal(e.sink, 1)
    assert.ok(Math.hypot(e.x - 20, e.y - 12) <= 6)
    assert.equal(isStoryCreature(e), true)
    assert.equal(spellSpares(e), true)
    const r = strikeCreature(e, s, 3)
    assert.equal(r.absorbed, true)
    assert.equal(e.hp, getMonsterDef('hiekkamato').stats.hp)
    assert.equal(typeof hooks.debugState(e), 'string')
  })

  it('feels a walking hero, not a still one at the same distance; a sprint from further', () => {
    const still = world(), a = worm(still)
    moveHero(still, 20, 12 + 5)
    run(still, a, update, 2)
    assert.equal(a.worm.state, 'prowl')
    const walking = world(), b = worm(walking)
    moveHero(walking, 14, 12 + 5)
    run(walking, b, update, 0.5, walker(walking, 1, 0))
    assert.notEqual(b.worm.state, 'prowl')
    const far = world({ w: 60 }), c = worm(far)
    moveHero(far, 20, 12 + 10.5)
    run(far, c, update, 0.5, walker(far, 1, 0))
    assert.equal(c.worm.state, 'prowl')
    const sprint = world({ w: 60 }), d = worm(sprint)
    moveHero(sprint, 16, 12 + 10.5)
    run(sprint, d, update, 0.5, walker(sprint, 1, 0, 186))
    assert.notEqual(d.worm.state, 'prowl')
  })

  it('hunts a walking hero down, tells, and erupts under one who keeps going', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    const walk = walker(s, 1, 0)
    assert.ok(until(s, e, 'tell', 8, walk), 'it reaches the tell')
    assert.ok(cues(s).includes('burrow'))
    const spot = { ...e.worm.spot }
    assert.ok(entityPose(e).flicker >= 0)
    assert.ok(until(s, e, 'up', 2, walk), 'it comes up')
    assert.deepEqual([e.x, e.y], [spot.x, spot.y])
    assert.equal(s.player.hp, 10 - T().burstDmg)
    assert.ok(s.player.knockback, 'and throws him')
    assert.ok(cues(s).includes('worm-erupt'))
  })

  it('misses a hero who turns aside at the tell', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    let dir = [1, 0]
    const walk = () => walker(s, dir[0], dir[1])()
    assert.ok(until(s, e, 'tell', 8, walk))
    dir = [0, 1]
    // he must already be near the spot for the swerve to matter
    assert.ok(until(s, e, 'up', 2, walk))
    assert.equal(s.player.hp, 10)
  })

  it('a shield is no help against what comes from below', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    const { type, ...buckler } = makeShieldContents('buckler')
    s.player.gear.melee.off = { kind: 'shield', ...buckler }
    Object.assign(s.player, { facing: 'east', blocking: true })
    assert.ok(until(s, e, 'up', 10, walker(s, 1, 0)))
    assert.equal(s.player.hp, 10 - T().burstDmg)
  })

  // a worm brought up beside a hero who stands still
  function risen(s) {
    const e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    until(s, e, 'up', 10, walker(s, 1, 0))
    s.player.knockback = null
    return e
  }

  it('up, it can be struck and is open to spells; enough in one surfacing sends it down', () => {
    const s = world({ w: 80 }), e = risen(s)
    run(s, e, update, 0.4)
    assert.equal(e.sink, 0)
    assert.equal(spellSpares(e), false)
    const hp = e.hp
    assert.equal(strikeCreature(e, s, 1).absorbed, false)
    assert.equal(e.hp, hp - 1)
    strikeCreature(e, s, T().diveAt - 1)
    run(s, e, update, 0.1)
    assert.equal(e.worm.state, 'dive')
    run(s, e, update, 1)
    assert.equal(e.sink, 1)
    assert.equal(strikeCreature(e, s, 1).absorbed, true)
  })

  it('up, it bites a hero beside it (a shield stops that), stays put, and dives when its time is up', () => {
    const s = world({ w: 80 }), e = risen(s)
    moveHero(s, e.x + 1, e.y)
    const hp = s.player.hp, at = [e.px, e.py]
    e.knockback = { vx: 300, vy: 0 }
    run(s, e, update, T().biteEvery + 0.3)
    assert.equal(s.player.hp, hp - T().biteDmg)
    assert.deepEqual([e.px, e.py], at)
    assert.equal(e.knockback, null)
    const { type, ...buckler } = makeShieldContents('buckler')
    s.player.gear.melee.off = { kind: 'shield', ...buckler }
    Object.assign(s.player, { facing: 'west', blocking: true })
    const hp2 = s.player.hp
    run(s, e, update, T().biteEvery + 0.2)
    assert.equal(s.player.hp, hp2)
    run(s, e, update, T().up)
    assert.notEqual(e.worm.state, 'up')
  })

  it('cannot reach a hero on hard ground: no eruption in reach, and it goes home after a wait', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    hard(s, 0, 16, 79, 18)                           // a road three wide
    moveHero(s, 16, 17)                              // its middle lane
    let came = false
    run(s, e, update, T().waitEdge + 6, () => { walker(s, 1, 0, 60)(); if (e.worm?.state === 'up' || e.worm?.state === 'tell') came = true })
    assert.equal(came, false)
    assert.equal(s.player.hp, 10)
    assert.equal(e.worm.state, 'prowl')
  })

  it('a hero in the edge lane of a road is safe too', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    hard(s, 0, 16, 79, 18)
    moveHero(s, 12, 16)                              // the lane next to the sand
    run(s, e, update, 12, walker(s, 1, 0, 120))
    assert.equal(s.player.hp, 10)
  })

  it('does not follow beyond its leash', () => {
    const s = world({ w: 80, h: 80 }), e = worm(s, 20, 12)
    moveHero(s, 20, 12 + T().leash + 6)
    run(s, e, update, 6, walker(s, 1, 0, 186))
    assert.ok(Math.hypot(e.x - 20, e.y - 12) <= T().leash + 1)
    assert.equal(s.player.hp, 10)
  })

  it('walled in by hard ground it stays where it is, quietly', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    hard(s, 18, 10, 22, 14)
    s.map[12][20] = cell()
    moveHero(s, 16, 17)
    assert.doesNotThrow(() => run(s, e, update, 5, walker(s, 1, 0)))
    assert.deepEqual([e.x, e.y], [20, 12])
    assert.equal(s.player.hp, 10)
  })

  it('leaves a hero on the coach alone', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    s.player.riding = true
    run(s, e, update, 6, walker(s, 1, 0))
    assert.equal(e.worm.state, 'prowl')
    assert.equal(s.player.hp, 10)
  })

  it('two worms after one hero do not come up on top of each other', () => {
    const s = world({ w: 80 }), a = worm(s, 20, 12), b = worm(s, 22, 13)
    moveHero(s, 16, 17)
    const walk = walker(s, 1, 0)
    let both = 0, close = 0
    for (let i = 0; i < 60 * 8; i++) {
      walk()
      s.player.invulnTimer = Math.max(0, (s.player.invulnTimer ?? 0) - 1 / 60)
      s.player.knockback = null
      update(a, s, 1 / 60); update(b, s, 1 / 60)
      const out = w => w.worm.state === 'tell' || w.worm.state === 'up'
      if (out(a) && out(b)) { both++; if (Math.hypot(a.worm.spot.x - b.worm.spot.x, a.worm.spot.y - b.worm.spot.y) < 2) close++ }
    }
    assert.equal(close, 0, `${close} of ${both} frames with both out had them within two tiles`)
    assert.ok(a.worm.spot && b.worm.spot, 'and both did come up')
  })

  it('a worm that finds itself on hard ground (dealt there, or shoved) swims off it and hunts', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    s.map[12][20] = cell('ow_hardpan_cracked_0_0')
    moveHero(s, 16, 17)
    assert.ok(until(s, e, 'up', 10, walker(s, 1, 0)), 'it still comes up')
  })

  it('wounded and gone under again, it shows no health bar over its mound', () => {
    const s = world({ w: 80 }), e = risen(s)
    run(s, e, update, 0.4)
    strikeCreature(e, s, 1)
    assert.equal(e.inCombat, true)
    strikeCreature(e, s, T().diveAt)
    run(s, e, update, 1)
    assert.equal(e.sink, 1)
    assert.equal(e.inCombat, false)
  })

  it('leaves a furrow behind it as it travels', () => {
    const s = world({ w: 80 }), e = worm(s, 20, 12)
    moveHero(s, 16, 17)
    run(s, e, update, 0.6, walker(s, 1, 0))
    assert.ok(e.trail.length > 0)
    const t = entityPose(e).trail
    assert.ok(t.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.a > 0 && p.a <= 1))
  })

  describe('routeUnder', () => {
    it('finds the way round hard ground', () => {
      const s = world()
      hard(s, 10, 5, 10, 15)
      const path = routeUnder(s.map, { x: 8, y: 10 }, { x: 12, y: 10 })
      assert.deepEqual(path.at(-1), { x: 12, y: 10 })
      assert.ok(path.every(c => c.x !== 10 || c.y < 5 || c.y > 15))
      assert.ok(path.length > 4)
    })
    it('with no way through, ends at the reachable cell nearest the goal', () => {
      const s = world()
      hard(s, 10, 0, 10, 39)
      const path = routeUnder(s.map, { x: 8, y: 10 }, { x: 14, y: 10 })
      assert.deepEqual(path.at(-1), { x: 9, y: 10 })
    })
    it('from a cell of hard ground it finds its way back into the sand', () => {
      const s = world()
      hard(s, 8, 10, 8, 10)
      const path = routeUnder(s.map, { x: 8, y: 10 }, { x: 12, y: 10 })
      assert.deepEqual(path.at(-1), { x: 12, y: 10 })
      assert.ok(path.every(c => !(c.x === 8 && c.y === 10)))
    })
    it('deep in hard ground there is no way at all', () => {
      const s = world()
      hard(s, 6, 8, 10, 12)
      assert.deepEqual(routeUnder(s.map, { x: 8, y: 10 }, { x: 14, y: 10 }), [])
    })
  })
})
