import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TRANCE_DURATION, RITE_DURATION, RITE_APPEAR_END, RITE_ASCEND_START, RITE_LIFT_MAX,
  WIZARD_COUNT, startTrance, tickTrance, riteConditionMet, riteVisuals }
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
    assert.deepEqual(v, { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0, lift: 0, wizards: [], glyphs: [] })
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

// The seven-wizard ceremony: apparition → incantation with beams igniting
// one at a time → all beams on → the player rises.
const riteAt = t => riteVisuals({ player: { px: 999, py: 999 }, rite: { t, dur: RITE_DURATION, cx: 160, cy: 160 } })

describe('rite wizards', () => {
  it('the ceremony lasts long enough for the full choreography', () => {
    assert.ok(RITE_DURATION >= RITE_ASCEND_START + 2)
    assert.ok(RITE_APPEAR_END < RITE_ASCEND_START)
  })

  it('seven wizards stand on a ring around the rite anchor, not the player', () => {
    const { wizards } = riteAt(RITE_APPEAR_END)
    assert.equal(wizards.length, WIZARD_COUNT)
    const dists = wizards.map(w => Math.hypot(w.px - 160, w.py - 160))
    for (const d of dists) {
      assert.ok(d > 32, 'wizard sits off the anchor tile')
      assert.ok(Math.abs(d - dists[0]) < 1e-6, 'ring is round')
    }
    const uniq = new Set(wizards.map(w => `${w.px.toFixed(3)},${w.py.toFixed(3)}`))
    assert.equal(uniq.size, WIZARD_COUNT, 'wizards do not overlap')
  })

  it('wizards fade in during the apparition window', () => {
    assert.ok(riteAt(0.01).wizards[0].alpha < 0.1)
    assert.ok(riteAt(RITE_APPEAR_END / 2).wizards[0].alpha > 0.2)
    for (const w of riteAt(RITE_APPEAR_END).wizards) assert.equal(w.alpha, 1)
  })

  it('beams ignite one at a time in wizard order', () => {
    const early = riteAt(RITE_APPEAR_END + 0.5).wizards
    assert.ok(early[0].beam > 0, 'first beam is on')
    assert.equal(early[WIZARD_COUNT - 1].beam, 0, 'last beam still off')
    const mid = riteAt((RITE_APPEAR_END + RITE_ASCEND_START) / 2).wizards
    const on = mid.filter(w => w.beam > 0).length
    assert.ok(on > 0 && on < WIZARD_COUNT, 'mid-incantation only some beams are on')
    for (let i = 1; i < WIZARD_COUNT; i++) assert.ok(mid[i].beam <= mid[i - 1].beam, 'ignition follows wizard order')
  })

  it('all beams are fully on by the ascension', () => {
    for (const w of riteAt(RITE_ASCEND_START).wizards) assert.ok(w.beam > 0.999)
  })
})

describe('rite levitation', () => {
  it('the player stays grounded until every beam is on', () => {
    assert.equal(riteAt(0.5).lift, 0)
    assert.equal(riteAt(RITE_ASCEND_START - 0.1).lift, 0)
  })

  it('rises after ascension starts and caps at RITE_LIFT_MAX', () => {
    const a = riteAt(RITE_ASCEND_START + 0.5).lift
    const b = riteAt(RITE_ASCEND_START + 1.0).lift
    assert.ok(a > 0, 'lift has begun')
    assert.ok(b > a, 'still rising')
    assert.equal(riteAt(RITE_DURATION - 0.1).lift, RITE_LIFT_MAX)
  })
})

describe('rite glyphs', () => {
  it('no glyphs before the incantation begins', () => {
    assert.equal(riteAt(0.2).glyphs.length, 0)
  })

  it('glyphs drift up from the wizards during the incantation', () => {
    const t = (RITE_APPEAR_END + RITE_ASCEND_START) / 2
    const { glyphs, wizards } = riteAt(t)
    assert.ok(glyphs.length > 0)
    for (const g of glyphs) {
      assert.ok(Number.isFinite(g.px) && Number.isFinite(g.py))
      assert.ok(g.alpha > 0 && g.alpha <= 1)
      assert.equal(typeof g.char, 'string')
      const nearest = Math.min(...wizards.map(w => Math.hypot(g.px - w.px, g.py - w.py)))
      assert.ok(nearest < 64, 'glyph hovers near its wizard')
    }
    const later = riteVisuals({ player: {}, rite: { t: t + 0.2, dur: RITE_DURATION, cx: 160, cy: 160 } })
    const risen = later.glyphs.some(g2 => glyphs.some(g => g.char === g2.char && g2.py < g.py))
    assert.ok(risen, 'some glyph rose between frames')
  })

  it('is deterministic — same t gives the same glyphs', () => {
    assert.deepEqual(riteAt(3).glyphs, riteAt(3).glyphs)
  })
})
