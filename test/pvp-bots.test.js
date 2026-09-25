import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { botInput, nextStep } from '../renderer/pvp/bots.js'
import { makeMatch } from '../renderer/pvp/sim.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { openMap } from './pvp-helpers.js'
import { TILE } from '../renderer/systems/entities.js'

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
    placeHero(m.heroes[0], { x: 2, y: 2 }); placeHero(m.heroes[1], { x: 8, y: 2 })
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
