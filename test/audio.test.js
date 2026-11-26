import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, falloffGain, panFor, NEAR_PX, FAR_PX, PAN_MAX } from '../renderer/render/audio.js'
import { CUE_NAMES } from '../renderer/systems/sfx.js'
import { HOOF_EVERY } from '../renderer/wilds/coach-ride.js'

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
    const basic = (name, r) => {
      assert.ok(['blip', 'burst', 'swoosh', 'rumble'].includes(r.kind), `${name}: bad kind`)
      assert.ok(r.dur > 0, `${name}: dur must be positive`)
      assert.ok(r.vol > 0 && r.vol <= 1, `${name}: vol out of range`)
    }
    for (const [name, r] of Object.entries(RECIPES)) {
      if (r.kind !== 'seq') { basic(name, r); continue }
      // a train of the basic sounds, each starting `at` seconds in, all within dur
      assert.ok(r.dur > 0 && r.vol > 0 && r.vol <= 1, `${name}: dur or vol out of range`)
      assert.ok(Array.isArray(r.parts) && r.parts.length > 0, `${name}: no parts`)
      r.parts.forEach((p, i) => {
        basic(`${name}[${i}]`, p)
        assert.ok(p.at >= 0 && p.at + p.dur <= r.dur + 1e-9, `${name}[${i}]: outside the cue's ${r.dur} s`)
      })
    }
  })

  // the coach (game.js, wilds/coach-ride.js): a whip and hooves setting off,
  // a clip-clop while it rolls, hooves slowing and a creak on arriving;
  // quieter than a blow, and the clip-clop quieter still and over before the next
  it('the coach has a cue to set off, one to roll by and one to arrive, quieter than a blow', () => {
    const loudest = r => (r.kind === 'seq' ? r.vol * Math.max(...r.parts.map(p => p.vol)) : r.vol)
    assert.ok(loudest(RECIPES['coach-hoof']) < loudest(RECIPES['coach-go']), 'the clip-clop is as loud as setting off')
    assert.ok(RECIPES['coach-hoof'].dur < HOOF_EVERY, 'one clip-clop runs into the next')
    for (const name of ['coach-go', 'coach-hoof', 'coach-arrive']) {
      assert.ok(CUE_NAMES.includes(name), `${name} missing from CUE_NAMES`)
      assert.ok(RECIPES[name], `no recipe for cue "${name}"`)
      assert.ok(loudest(RECIPES[name]) < loudest(RECIPES['melee-hit']) / 2, `${name} is as loud as a blow`)
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
