import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf } from '../renderer/render/monster-rigs/quadruped.js'

// Recording 2D-context stand-in: every method call is logged, every property
// set is accepted, gradients are inert. Lets us assert "drew something" and
// "states differ" without a real canvas.
function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      return (...a) => { t.ops.push([k, ...a]) }
    },
    set(t, k, v) { t[k] = v; return true },
  })
}

const STATES = ['idle', 'walk', 'attack', 'hit', 'death']
const pose = (state, over = {}) =>
  ({ t: 1.25, state, stateT: 0.1, facing: 0.3, speed01: state === 'walk' ? 1 : 0, seed: 7, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p =>
  [p.key, p.type === 'range' ? p[which] : p.default]))

describe('quadruped schema', () => {
  it('is a valid PARAM_SCHEMA', () => assert.deepEqual(schemaErrors(PARAM_SCHEMA), []))
  it('exports its rig id', () => assert.equal(RIG_ID, 'quadruped'))
})

describe('quadruped drawMonster', () => {
  for (const state of STATES) {
    it(`draws ops in state "${state}" at defaults, all-min and all-max`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10, `state ${state}: only ${ctx.ops.length} ops`)
      }
    })
  }
  it('is balanced save/restore', () => {
    const ctx = recordingCtx()
    drawMonster(ctx, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    const saves = ctx.ops.filter(o => o[0] === 'save').length
    const restores = ctx.ops.filter(o => o[0] === 'restore').length
    assert.equal(saves, restores)
  })
  it('renders states distinctly (idle vs death op streams differ)', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('death', { stateT: 0.4 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
  it('is deterministic for identical inputs', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk'), 32)
    assert.deepEqual(a.ops, b.ops)
  })
})

// v2: 16-bit pixel discipline. The rig draws rect-only art on an integer
// art-px grid, snaps facing to 8 directions, and steps animation in frames.
describe('quadruped pixel discipline', () => {
  const CURVES = new Set(['ellipse', 'arc', 'quadraticCurveTo', 'bezierCurveTo'])
  it('draws rects only — no curve primitives', () => {
    for (const state of STATES) {
      const ctx = recordingCtx()
      drawMonster(ctx, defaultParams(PARAM_SCHEMA), pose(state), 32)
      assert.ok(!ctx.ops.some(o => CURVES.has(o[0])), `state ${state} used a curve primitive`)
    }
  })
  it('every fillRect lands on integer art-px coordinates', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const ctx = recordingCtx()
      drawMonster(ctx, params, pose('walk'), 32)
      for (const op of ctx.ops) {
        if (op[0] !== 'fillRect') continue
        for (const v of op.slice(1)) assert.equal(v, Math.round(v), `non-integer fillRect arg ${v}`)
      }
    }
  })
  it('facing snaps: two angles in the same 45° bucket draw identically', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk', { facing: 0.05 }), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk', { facing: -0.05 }), 32)
    assert.deepEqual(a.ops, b.ops)
  })
  it('facing snaps: adjacent buckets draw differently', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk', { facing: 0 }), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk', { facing: Math.PI / 4 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
  it('animation is frame-stepped: nearby times in one frame draw identically', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk', { t: 0.301 }), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk', { t: 0.302 }), 32)
    assert.deepEqual(a.ops, b.ops)
  })
  it('animation advances across frame boundaries', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('walk', { t: 0.30 }), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('walk', { t: 0.45 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
})

// hitHalf: collision half-size derived from the drawn body + head, so the
// hitbox tracks the visuals instead of a hand-typed stat.
describe('quadruped hitHalf', () => {
  it('returns an integer within the supported clearance range [8, 28]', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const h = hitHalf(params)
      assert.equal(h, Math.round(h))
      assert.ok(h >= 8 && h <= 28, `hitHalf ${h} out of range`)
    }
  })
  it('grows with body length', () => {
    const small = hitHalf({ ...defaultParams(PARAM_SCHEMA), bodyLength: 0.8 })
    const big = hitHalf({ ...defaultParams(PARAM_SCHEMA), bodyLength: 3.0 })
    assert.ok(big > small, `${big} !> ${small}`)
  })
  it('caps at 28 for maxed-out params', () => {
    assert.equal(hitHalf(extremes('max')), 28)
  })
  it('floors at 8 for minimal params', () => {
    assert.equal(hitHalf(extremes('min')), 8)
  })
})
