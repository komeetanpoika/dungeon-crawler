import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TRANCE_DURATION, RITE_DURATION, startTrance, tickTrance, riteConditionMet, riteVisuals }
  from '../renderer/systems/rites.js'

describe('trance', () => {
  it('lasts TRANCE_DURATION seconds and then fades', () => {
    const p = {}
    startTrance(p)
    assert.equal(p.trance, TRANCE_DURATION)
    tickTrance(p, TRANCE_DURATION - 1)
    assert.ok(p.trance > 0)
    tickTrance(p, 2)
    assert.equal(p.trance, 0)
  })

  it('eating again refreshes the timer', () => {
    const p = {}
    startTrance(p); tickTrance(p, 50); startTrance(p)
    assert.equal(p.trance, TRANCE_DURATION)
  })
})

describe('mushroom_circle condition', () => {
  it('is met only while entranced', () => {
    assert.equal(riteConditionMet('mushroom_circle', { player: { trance: 10 } }), true)
    assert.equal(riteConditionMet('mushroom_circle', { player: { trance: 0 } }), false)
    assert.equal(riteConditionMet('mushroom_circle', { player: {} }), false)
  })

  it('unknown rites are never met', () => {
    assert.equal(riteConditionMet('moon_dance', { player: { trance: 10 } }), false)
  })
})

describe('riteVisuals', () => {
  it('is inert with no trance and no rite', () => {
    const v = riteVisuals({ player: {} })
    assert.deepEqual(v, { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0 })
  })

  it('trance wobbles subtly without blur', () => {
    const v = riteVisuals({ player: { trance: 30, tranceT: 1.3 } })
    assert.ok(Math.abs(v.wobbleX) <= 2)
    assert.equal(v.blur, 0)
    assert.equal(v.greenAlpha, 0)
  })

  it('the ceremony ramps blur and green up and back down', () => {
    const mk = t => riteVisuals({ player: {}, rite: { t, dur: RITE_DURATION } })
    assert.ok(mk(RITE_DURATION / 2).blur > mk(0.1).blur)
    assert.ok(mk(RITE_DURATION / 2).greenAlpha > 0)
    assert.ok(mk(RITE_DURATION - 0.05).blur < mk(RITE_DURATION / 2).blur)
  })
})
