import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { schemaErrors, defaultParams } from '../renderer/render/monster-rigs/schema.js'
import { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf } from '../renderer/render/monster-rigs/lurker.js'

function recordingCtx() {
  const target = { ops: [], createLinearGradient: () => ({ addColorStop: () => {} }),
                   createRadialGradient: () => ({ addColorStop: () => {} }) }
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { t.ops.push([k, ...a]) } },
    set(t, k, v) { t[k] = v; return true },
  })
}
const pose = (state, over = {}) => ({ t: 1.25, state, stateT: 0.1, facing: 0, speed01: 0, seed: 3, sink: 0, burn: 0, flicker: 0, ...over })
const extremes = which => Object.fromEntries(PARAM_SCHEMA.map(p => [p.key, p.type === 'range' ? p[which] : p.default]))

describe('lurker rig', () => {
  it('has a valid schema and id', () => {
    assert.deepEqual(schemaErrors(PARAM_SCHEMA), [])
    assert.equal(RIG_ID, 'lurker')
  })
  for (const state of ['idle', 'hit', 'walk', 'attack', 'death']) {
    it(`draws in state ${state} at defaults, min and max`, () => {
      for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
        const ctx = recordingCtx()
        assert.doesNotThrow(() => drawMonster(ctx, params, pose(state), 32))
        assert.ok(ctx.ops.length > 10)
        assert.equal(ctx.ops.filter(o => o[0] === 'save').length, ctx.ops.filter(o => o[0] === 'restore').length)
      }
    })
  }
  it('sinking clips: fully sunk draws fewer fill ops than surfaced', () => {
    const up = recordingCtx(), down = recordingCtx()
    drawMonster(up, defaultParams(PARAM_SCHEMA), pose('idle'), 32)
    drawMonster(down, defaultParams(PARAM_SCHEMA), pose('idle', { sink: 1 }), 32)
    const fills = ops => ops.filter(o => o[0] === 'fillRect').length
    assert.ok(fills(down.ops) < fills(up.ops))
    assert.ok(down.ops.some(o => o[0] === 'clip'))
    const translates = ops => ops.filter(o => o[0] === 'translate')
    assert.ok(translates(up.ops).every(o => !o[2]), 'surfaced pose should not translate the waterline downward')
    const sunkTranslate = translates(down.ops).find(o => o[2] > 0)
    assert.ok(sunkTranslate, 'expected a translate with positive y when fully sunk')
    assert.ok(sunkTranslate[2] >= 7, String(sunkTranslate[2]))
  })
  it('flips when facing west', () => {
    const ctx = recordingCtx()
    drawMonster(ctx, defaultParams(PARAM_SCHEMA), pose('idle', { facing: Math.PI }), 32)
    assert.ok(ctx.ops.some(o => o[0] === 'scale' && o[1] === -1))
  })
  it('hitHalf stays within the nav-supported range', () => {
    for (const params of [defaultParams(PARAM_SCHEMA), extremes('min'), extremes('max')]) {
      const h = hitHalf(params)
      assert.ok(h >= 8 && h <= 28, String(h))
    }
  })
})
