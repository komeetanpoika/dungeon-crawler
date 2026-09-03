import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf } from '../renderer/render/monster-rigs/wraith.js'

function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
const pose = (state, over = {}) => ({ t: 0.9, state, stateT: 0.3, facing: 0, speed01: 0, seed: 11, sink: 0, burn: 0, flicker: 0, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))
const fills = ops => ops.filter(o => o[0] === 'fillRect').length
// 1x1 fillRect ops: at default params only the eyes (eyeSize -> eye=1) and
// the death-only ember-scatter loop ever emit a 1x1 rect (body/cowl rows and
// tatters are always wider). Used below to prove the ember loop specifically
// — not just the death-state translate/scale wrapper — is what runs.
const tinyFills = ops => ops.filter(o => o[0] === 'fillRect' && o[3] === 1 && o[4] === 1).length

describe('wraith rig', () => {
  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'wraith')
  })
  for (const state of ['idle', 'walk', 'hit', 'attack', 'death']) {
    it(`draws in state ${state} at defaults, min and max, balanced`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
      }
    })
  }
  it('burn shortens the body (fewer fills at burn 1 than 0)', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('idle', { burn: 1 }), 32)
    assert.ok(fills(b.ops) < fills(a.ops))
  })
  it('death scatters embers: the op stream differs from idle', () => {
    const a = recordingCtx(), b = recordingCtx()
    drawMonster(a, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(b, defaultParams(PARAM_SCHEMA), pose('death', { stateT: 0.4 }), 32)
    assert.notDeepEqual(a.ops, b.ops)
  })
  it('death ember loop specifically adds tatterCount+2 extra 1x1 fills over idle', () => {
    const a = recordingCtx(), b = recordingCtx()
    const params = defaultParams(PARAM_SCHEMA)
    drawMonster(a, params, pose('idle'), 32)
    drawMonster(b, params, pose('death', { stateT: 0.4 }), 32)
    const tatterCount = PARAM_SCHEMA.find(p => p.key === 'tatterCount').default
    assert.equal(tinyFills(b.ops) - tinyFills(a.ops), tatterCount + 2)
  })
  it('hitHalf stays within the nav-supported range', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const h = hitHalf(params)
      assert.ok(h >= 8 && h <= 28, String(h))
    }
  })
})
