import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES } from '../renderer/data/levels.js'

describe('LEVEL_CONFIG (5-level run)', () => {
  it('has 5 playable levels (depths 1..5) plus the depth-0 debug arena', () => {
    const playable = LEVEL_CONFIG.filter(c => c.depth >= 1)
    assert.equal(playable.length, 5)
    assert.deepEqual(playable.map(c => c.depth), [1, 2, 3, 4, 5])
    assert.ok(LEVEL_CONFIG.some(c => c.depth === 0), 'depth-0 debug arena present')
  })

  it('L1 is 50x32 and L2 is 64x40, L3-5 are 80x50', () => {
    const byDepth = Object.fromEntries(LEVEL_CONFIG.map(c => [c.depth, c]))
    assert.deepEqual([byDepth[1].mapW, byDepth[1].mapH], [50, 32])
    assert.deepEqual([byDepth[2].mapW, byDepth[2].mapH], [64, 40])
    for (const d of [3, 4, 5]) assert.deepEqual([byDepth[d].mapW, byDepth[d].mapH], [80, 50])
  })

  it('maps each level to its boss lair / arena', () => {
    const byDepth = Object.fromEntries(LEVEL_CONFIG.map(c => [c.depth, c]))
    assert.equal(byDepth[1].landmark, 'CRAB_LAIR')
    assert.equal(byDepth[2].landmark, 'WIZARD_SANCTUM')
    assert.equal(byDepth[3].cyclopsArena, true)
    assert.equal(byDepth[4].landmark, 'DRAGON_LAIR')
    assert.equal(byDepth[5].landmark, 'GREAT_LAIR')
  })

  it('no scattered crab/wizard counts remain', () => {
    for (const c of LEVEL_CONFIG) {
      assert.equal(c.crabCount, undefined)
      assert.equal(c.wizardCount, undefined)
    }
  })

  it('FINAL_DEPTH is 5', () => assert.equal(FINAL_DEPTH, 5))

  it('DEPTH_THEMES covers depths 1..5', () => {
    for (let d = 1; d <= 5; d++)
      assert.ok(DEPTH_THEMES.some(t => t.depths.includes(d)), `no theme for depth ${d}`)
  })
})

describe('boss test arena (depth 0)', () => {
  it('has a depth-0 config sized 26x18 with no enemies', () => {
    const cfg = LEVEL_CONFIG.find(c => c.depth === 0)
    assert.ok(cfg, 'depth-0 config exists')
    assert.equal(cfg.mapW, 26)
    assert.equal(cfg.mapH, 18)
    assert.equal(cfg.guardCount, 0)
    assert.equal(cfg.monsterDensity, 0)
  })

  it('resolves a theme for depth 0', () => {
    const theme = DEPTH_THEMES.find(t => t.depths.includes(0))
    assert.ok(theme, 'a theme includes depth 0')
  })
})
