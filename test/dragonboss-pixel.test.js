import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeDragonBoss } from '../renderer/systems/dragonboss.js'
import { dragonCapsules } from '../renderer/systems/capsules.js'
import { buildArena } from '../renderer/systems/map.js'
import { TEMPLATE_LEGEND } from '../renderer/data/levels.js'

const T = 32
const quiet = () => {}

describe('makeDragonBoss skin option', () => {
  it('defaults to no skin', () => {
    const e = makeDragonBoss(4, 5)
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.skin, undefined)
  })

  it('carries an explicit skin without changing the type', () => {
    const e = makeDragonBoss(4, 5, { skin: 'pixel' })
    assert.equal(e.type, 'dragon_boss')
    assert.equal(e.skin, 'pixel')
  })
})

describe('hitbox parity', () => {
  const poses = [
    { neckRear: 0,   headAim: 0,    tailSwing: 0,    facing: 0 },
    { neckRear: 1,   headAim: 0.7,  tailSwing: -0.6, facing: Math.PI / 3 },
    { neckRear: 0.4, headAim: -0.7, tailSwing: 1.0,  facing: -2.1 },
  ]

  it('capsules are identical with and without the pixel skin', () => {
    for (const pose of poses) {
      const plain = { ...makeDragonBoss(10, 10), px: 10 * T, py: 10 * T, ...pose }
      const pixel = { ...makeDragonBoss(10, 10, { skin: 'pixel' }), px: 10 * T, py: 10 * T, ...pose }
      assert.deepEqual(dragonCapsules(pixel), dragonCapsules(plain))
    }
  })
})

describe('arena spawns the pixel boss', () => {
  it('accepts dragon_boss_pixel as an enemy kind', () => {
    const { entitySpawns } = buildArena({ enemies: [{ kind: 'dragon_boss_pixel', x: 5, y: 5 }] }, quiet)
    const spawns = entitySpawns.filter(s => s.kind === 'dragon_boss_pixel')
    assert.equal(spawns.length, 1)
    assert.equal(spawns[0].x, 5)
    assert.equal(spawns[0].y, 5)
  })

  it('still warns on a genuinely unknown kind', () => {
    const warnings = []
    buildArena({ enemies: [{ kind: 'not_a_thing' }] }, m => warnings.push(m))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /not_a_thing/)
  })
})

describe('template legend', () => {
  it("'Q' spawns the pixel boss and 'B' still spawns the original", () => {
    assert.equal(TEMPLATE_LEGEND.Q.spawn, 'dragon_boss_pixel')
    assert.equal(TEMPLATE_LEGEND.Q.single, true)
    assert.equal(TEMPLATE_LEGEND.B.spawn, 'dragon_boss')
  })
})
