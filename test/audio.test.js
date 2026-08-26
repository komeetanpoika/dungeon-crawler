import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, falloffGain, panFor, NEAR_PX, FAR_PX, PAN_MAX } from '../renderer/render/audio.js'
import { CUE_NAMES } from '../renderer/systems/sfx.js'

describe('recipe registry', () => {
  it('every cue name has a recipe', () => {
    for (const name of CUE_NAMES)
      assert.ok(RECIPES[name], `no recipe for cue "${name}"`)
  })

  it('every recipe key is a known cue name', () => {
    for (const name of Object.keys(RECIPES))
      assert.ok(CUE_NAMES.includes(name), `orphaned recipe "${name}"`)
  })

  it('every recipe is well-formed', () => {
    for (const [name, r] of Object.entries(RECIPES)) {
      assert.ok(['blip', 'burst', 'swoosh', 'rumble'].includes(r.kind), `${name}: bad kind`)
      assert.ok(r.dur > 0, `${name}: dur must be positive`)
      assert.ok(r.vol > 0 && r.vol <= 1, `${name}: vol out of range`)
    }
  })
})

describe('spatial math', () => {
  it('full volume inside the near radius', () => {
    assert.equal(falloffGain(0), 1)
    assert.equal(falloffGain(NEAR_PX), 1)
  })

  it('silent at and beyond the far radius', () => {
    assert.equal(falloffGain(FAR_PX), 0)
    assert.equal(falloffGain(FAR_PX * 2), 0)
  })

  it('linear falloff between near and far', () => {
    const mid = (NEAR_PX + FAR_PX) / 2
    assert.ok(Math.abs(falloffGain(mid) - 0.5) < 1e-9)
  })

  it('pan is centered at zero offset and clamps to ±PAN_MAX', () => {
    assert.equal(panFor(0), 0)
    assert.equal(panFor(10000), PAN_MAX)
    assert.equal(panFor(-10000), -PAN_MAX)
  })
})
