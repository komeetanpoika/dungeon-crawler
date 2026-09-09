import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TRANCE_DURATION, TRANCE_FADE, RITE_DURATION, RITE_APPEAR_END, RITE_ASCEND_START,
  RITE_LIFT_MAX, WIZARD_COUNT, PULL_DURATION, PULL_TELEPORT_AT,
  startTrance, tickTrance, tranceLevel, tranceColour, riteConditionMet, riteVisuals,
  spriteHue, pullTarget, pullWash }
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
    assert.deepEqual(v, { wobbleX: 0, wobbleY: 0, blur: 0, greenAlpha: 0, tintAlpha: 0, wash: 0,
      level: 0, colour: 0, rainbow: { alpha: 0, blobs: [] }, lift: 0, wizards: [], glyphs: [] })
  })

  it('the first seconds of a trance wobble subtly without blur', () => {
    const v = riteVisuals({ player: { trance: TRANCE_DURATION - 2, tranceT: 1.3 } })
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

// ── The escalating trip ────────────────────────────────────────────────────
// Eating a mushroom starts a minute-long ramp. The sway, the colour drift and
// the rainbow all grow with it; at the minute mark the rite calls, and either
// pulls the player to the ring or fades away unanswered.

const tripAt = elapsed => ({ trance: TRANCE_DURATION - elapsed, tranceT: elapsed })

describe('trance ramp', () => {
  it('grows from nothing at ingestion to full at the minute mark', () => {
    assert.ok(tranceLevel(tripAt(0)) < 0.01)
    assert.ok(tranceLevel(tripAt(TRANCE_DURATION - 0.01)) > 0.98)
  })

  it('rises slowly at first — the first half is barely a shimmer', () => {
    assert.ok(tranceLevel(tripAt(TRANCE_DURATION / 2)) < 0.3)
  })

  it('never goes backwards, from the first bite through the call', () => {
    const p = {}
    startTrance(p)
    let prev = -1
    for (let t = 0; t <= TRANCE_DURATION; t += 1) {
      const level = tranceLevel(p)
      assert.ok(level >= prev, `level fell at t=${t}`)
      prev = level
      tickTrance(p, 1)
    }
    assert.ok(prev > 0.98, 'the call lands at the peak')
  })

  it('is inert with no trance at all', () => {
    assert.equal(tranceLevel({}), 0)
  })

  it('restarts when a second mushroom is eaten mid-trip', () => {
    const p = {}
    startTrance(p); tickTrance(p, 50)
    assert.ok(tranceLevel(p) > 0.5)
    startTrance(p)
    assert.ok(tranceLevel(p) < 0.01)
  })

  it('a second mushroom during the fade puts the climb back on', () => {
    const p = {}
    startTrance(p); tickTrance(p, TRANCE_DURATION)
    startTrance(p)
    assert.equal(tranceLevel(p), 0)
    tickTrance(p, 30)
    assert.ok(tranceLevel(p) > 0.2, 'the minute is running again')
  })
})

// Colour arrives late. The sway is what creeps in first — you feel woozy well
// before the world starts changing colour — so the two ride separate curves.
describe('colour ramp', () => {
  it('is far behind the sway for most of the minute', () => {
    for (const at of [10, 20, 30]) {
      const p = tripAt(at)
      assert.ok(tranceColour(p) < tranceLevel(p) / 3, `colour caught the sway up at ${at}s`)
    }
  })

  it('is imperceptible through the first half', () => {
    assert.ok(tranceColour(tripAt(TRANCE_DURATION / 2)) < 0.07)
  })

  it('arrives in full by the call', () => {
    assert.ok(tranceColour(tripAt(TRANCE_DURATION - 0.01)) > 0.95)
  })

  it('drives the wash and the rainbow, while the sway keeps its own curve', () => {
    const early = riteVisuals({ player: tripAt(20) })
    assert.ok(early.tintAlpha < 0.02, 'barely any wash a third of the way in')
    assert.ok(early.rainbow.alpha < 0.07, 'and barely any rainbow')
    assert.ok(Math.abs(early.wobbleX) + Math.abs(early.wobbleY) > 0, 'but the world is already moving')
  })
})

describe('the hue clock', () => {
  it('hardly turns at all until the trip is well under way', () => {
    const clockAt = secs => {
      const p = {}
      startTrance(p)
      for (let i = 0; i < secs * 10; i++) tickTrance(p, 0.1)
      return p.tranceHue
    }
    const full = clockAt(TRANCE_DURATION)
    assert.ok(clockAt(20) < full * 0.02, 'a third of the way in, colours have not moved')
    assert.ok(clockAt(TRANCE_DURATION) - clockAt(45) > clockAt(45), 'the last quarter outruns all of it')
  })

  it('crawls while the trip is shallow and races once it is deep', () => {
    const p = {}
    startTrance(p)
    tickTrance(p, 15)
    const early = p.tranceHue
    tickTrance(p, 15)
    const mid = p.tranceHue - early
    tickTrance(p, 15)
    tickTrance(p, 15)
    const late = p.tranceHue - early - mid
    assert.ok(early > 0, 'it does move from the first bite')
    assert.ok(late > early * 5, `the last half-minute outruns the first (${early} then ${late})`)
  })

  it('starts from the sprites\' own colours with every fresh mushroom', () => {
    const p = {}
    startTrance(p); tickTrance(p, 40)
    assert.ok(p.tranceHue > 0)
    startTrance(p)
    assert.equal(p.tranceHue, 0)
  })
})

describe('the call', () => {
  it('fires exactly once, on the tick the minute elapses', () => {
    const p = {}
    startTrance(p)
    assert.equal(tickTrance(p, TRANCE_DURATION - 1), null, 'silent before the minute')
    assert.equal(tickTrance(p, 2), 'call', 'calls as the minute elapses')
    assert.equal(tickTrance(p, 1), null, 'does not call twice')
  })

  it('stays silent when there is no trance', () => {
    assert.equal(tickTrance({}, 1), null)
  })
})

describe('unanswered call', () => {
  it('decays from full to nothing over TRANCE_FADE seconds', () => {
    const p = {}
    startTrance(p)
    assert.equal(tickTrance(p, TRANCE_DURATION), 'call')
    assert.ok(tranceLevel(p) > 0.98, 'the peak holds as the call lands')
    tickTrance(p, TRANCE_FADE / 2)
    const half = tranceLevel(p)
    assert.ok(half > 0.2 && half < 0.8, `mid-fade, got ${half}`)
    tickTrance(p, TRANCE_FADE)
    assert.equal(tranceLevel(p), 0)
  })
})

describe('trip visuals', () => {
  const sway = elapsed => {
    const p = tripAt(elapsed)
    let max = 0
    for (let i = 0; i < 200; i++) {
      const v = riteVisuals({ player: { ...p, tranceT: elapsed + i * 0.05 } })
      max = Math.max(max, Math.abs(v.wobbleX), Math.abs(v.wobbleY))
    }
    return max
  }

  it('the sway grows drunker as the minute runs out', () => {
    assert.ok(sway(55) > sway(5) * 2, 'late sway is far wider than early')
    assert.ok(sway(55) > 5, 'peak sway is a real stagger')
  })

  it('reports how far gone the player is, for the renderer to scale by', () => {
    assert.equal(riteVisuals({ player: tripAt(0) }).level, 0)
    assert.ok(riteVisuals({ player: tripAt(TRANCE_DURATION - 0.01) }).level > 0.98)
  })

  it('the colour drift creeps in over the minute', () => {
    assert.equal(riteVisuals({ player: tripAt(0) }).tintAlpha, 0)
    const late = riteVisuals({ player: tripAt(TRANCE_DURATION - 0.01) }).tintAlpha
    assert.ok(late > 0.1 && late < 0.4, `peak tint ${late} is a wash, not a blackout`)
  })

  it('the rainbow fades in and its blobs stay on screen', () => {
    assert.equal(riteVisuals({ player: tripAt(0) }).rainbow.alpha, 0)
    const { rainbow } = riteVisuals({ player: tripAt(TRANCE_DURATION - 0.01) })
    assert.ok(rainbow.alpha > 0)
    assert.ok(rainbow.blobs.length >= 3, 'several colours at once')
    for (const b of rainbow.blobs) {
      assert.ok(b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1, 'blob is in view')
      assert.ok(b.r > 0 && b.hue >= 0 && b.hue < 360)
    }
  })

  it('the blobs drift at different speeds', () => {
    const a = riteVisuals({ player: tripAt(40) }).rainbow.blobs
    const b = riteVisuals({ player: { ...tripAt(40), tranceT: 41 } }).rainbow.blobs
    const moved = a.map((p, i) => Math.hypot(b[i].x - p.x, b[i].y - p.y))
    assert.ok(moved.every(d => d > 0), 'every blob moves')
    assert.ok(Math.max(...moved) > Math.min(...moved) * 1.2, 'they move at different rates')
  })

  it('is deterministic — the same clock gives the same frame', () => {
    assert.deepEqual(riteVisuals({ player: tripAt(33) }), riteVisuals({ player: tripAt(33) }))
  })
})

describe('spriteHue', () => {
  it('starts everything in its own colours', () => {
    for (const seed of ['crab', 'villager', 'world']) assert.equal(spriteHue(seed, 0), 0)
  })

  it('gives two objects different colours at the same moment', () => {
    assert.notEqual(spriteHue('crab', 10), spriteHue('villager', 10))
  })

  it('cycles each object through the rainbow at its own speed', () => {
    const step = seed => Math.abs(spriteHue(seed, 1) - spriteHue(seed, 0))
    assert.ok(step('crab') > 0 && step('villager') > 0, 'both cycle')
    assert.notEqual(step('crab'), step('villager'))
  })

  it('always lands inside the hue wheel', () => {
    for (const seed of ['crab', 'wolf', 7, 'prop_campfire']) {
      for (const t of [0, 3.7, 59]) {
        const h = spriteHue(seed, t)
        assert.ok(h >= 0 && h < 360, `${seed}@${t} → ${h}`)
      }
    }
  })

  it('is deterministic for a given seed and moment', () => {
    assert.equal(spriteHue('crab', 12.5), spriteHue('crab', 12.5))
  })

  it('never snaps as it comes round the wheel', () => {
    let prev = spriteHue('crab', 0)
    for (let t = 0.05; t < 40; t += 0.05) {
      const h = spriteHue('crab', t)
      const step = Math.abs(h - prev)
      assert.ok(step < 20 || step > 340, `jumped ${step.toFixed(0)} deg at t=${t.toFixed(2)}`)
      prev = h
    }
  })
})

describe('the pull', () => {
  const ring = { type: 'talent_trigger', x: 66, y: 62, talent: 'magic_stance', rite: 'mushroom_circle' }
  const player = { talents: [] }

  it('finds the ring anywhere on the map, not just underfoot', () => {
    const target = pullTarget({ player, entities: [{ type: 'crab', x: 3, y: 3 }, ring] })
    assert.deepEqual({ x: target.x, y: target.y }, { x: 66, y: 62 })
  })

  it('has nowhere to pull to in a cave', () => {
    assert.equal(pullTarget({ player, entities: [{ type: 'crab', x: 3, y: 3 }] }), null)
  })

  it('will not pull a player who already learned the talent', () => {
    assert.equal(pullTarget({ player: { talents: ['magic_stance'] }, entities: [ring] }), null)
  })

  it('still pulls to a ring that grants nothing — the marsh ring replays', () => {
    const marsh = { ...ring, talent: null }
    assert.ok(pullTarget({ player: { talents: ['magic_stance'] }, entities: [marsh] }))
  })

  it('washes the screen out at the moment the player is carried across', () => {
    assert.equal(pullWash(0, PULL_DURATION), 0)
    assert.equal(pullWash(PULL_DURATION * PULL_TELEPORT_AT, PULL_DURATION), 1)
    assert.equal(pullWash(PULL_DURATION, PULL_DURATION), 0)
  })

  it('the wash reaches the renderer while the pull runs', () => {
    const v = riteVisuals({ player: {}, tripPull: { t: PULL_DURATION * PULL_TELEPORT_AT, dur: PULL_DURATION } })
    assert.equal(v.wash, 1)
    assert.equal(riteVisuals({ player: {} }).wash, 0)
  })
})
