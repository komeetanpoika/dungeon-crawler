import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { meleeDamageToDragon, coreBlocks } from '../renderer/systems/capsules.js'

const T = 32
function mkBoss(px, py, facing = 0) { return { px, py, facing, neckRear: 0, headAim: 0, tailSwing: 0 } }
// Swing proxy: covers world points within `reach` px of the player — a stand-in for the
// real forward arc, enough to prove which capsule SURFACE the swing lands on.
const near = (player, reach = 14) => (cx, cy) => Math.hypot(cx - player.px, cy - player.py) < reach

// Geometry reminder (boss at 320,320 facing 0 → whole body lies along y=320):
//   tail  x∈[217.6, 281.6] r≈21   core x∈[281.6, 340.48] r=48   neck x∈[355.84, 399.36] r≈27
describe('meleeDamageToDragon', () => {
  it('returns 0 when the swing reaches no capsule', () => {
    const boss = mkBoss(320, 320, 0)
    assert.equal(meleeDamageToDragon({ px: 0, py: 0 }, boss, () => false), 0)
  })
  it('returns 1.0 for a swing beside the core flank only', () => {
    const boss = mkBoss(320, 320, 0)
    // ~55px south of the core midpoint: just off the 48px core surface, clear of neck/tail.
    const player = { px: 311, py: 320 + 55 }
    assert.equal(meleeDamageToDragon(player, boss, near(player)), 1.0)
  })
  it('returns 1.5 for a swing beside the neck (facing 0 = +x)', () => {
    const boss = mkBoss(320, 320, 0)
    // ~34px south of the neck midpoint (x≈377): within reach of the ~27px neck surface.
    const player = { px: 377, py: 320 + 34 }
    assert.equal(meleeDamageToDragon(player, boss, near(player)), 1.5)
  })
  it('weak-spot wins where the swing reaches both neck and core', () => {
    const boss = mkBoss(320, 320, 0)
    // Near the neck/core seam (x≈350): both surfaces within reach → neck (1.5) beats core.
    const player = { px: 350, py: 320 + 30 }
    assert.equal(meleeDamageToDragon(player, boss, near(player, 24)), 1.5)
  })
})

describe('coreBlocks', () => {
  it('blocks a player at the body centre', () => {
    assert.equal(coreBlocks(320, 320, 6, mkBoss(320, 320, 0)), true)
  })
  it('does not block a player two tiles clear of the body', () => {
    assert.equal(coreBlocks(320 + 6 * T, 320, 6, mkBoss(320, 320, 0)), false)
  })
})
