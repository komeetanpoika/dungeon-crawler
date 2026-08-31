import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster } from '../renderer/render/monster-rigs/quadruped.js'

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
