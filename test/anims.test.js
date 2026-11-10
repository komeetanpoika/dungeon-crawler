// test/anims.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ANIM_NAMES, LIMITS, BLEND_TIME, ease, cleanAnims, isActive, hasSequences, loopLength,
  attackTiming, samplePose, attackTime, animOf, lerpPose } from '../renderer/render/monster-rigs/anims.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`)
const STRIKE = { phases: [
  { time: 0.30, pose: {} },
  { time: 0.35, pose: { a: { turn: -25 } } },
  { time: 0.08, hit: true, pose: { a: { turn: 120, stretch: 1.35 } } },
] }

describe('anims constants', () => {
  it('names, limits and blend time are the spec values', () => {
    assert.deepEqual(ANIM_NAMES, ['idle', 'walk', 'attack'])
    assert.deepEqual(LIMITS, { turn: [-360, 360], stretch: [0.5, 2], time: [0.03, 2] })
    assert.equal(BLEND_TIME, 0.1)
    near(ease(0), 0); near(ease(0.5), 0.5); near(ease(1), 1); near(ease(-1), 0); near(ease(2), 1)
  })
})

describe('samplePose and timing', () => {
  it('reaches each card at the end of its move, eased between', () => {
    near(samplePose(STRIKE, 0).a.turn, 0)
    near(samplePose(STRIKE, 0.35).a.turn, -25)
    near(samplePose(STRIKE, 0.175).a.turn, -12.5)
    near(samplePose(STRIKE, 0.43).a.turn, 120)
    near(samplePose(STRIKE, 0.43).a.stretch, 1.35)
    near(samplePose(STRIKE, 0.73).a.turn, 0)
    near(samplePose(STRIKE, 99).a.turn, 0)           // clamped to the loop end
    near(samplePose(STRIKE, 0).a.stretch, 1)
  })
  it('every piece named in any phase is in the result', () => {
    const anim = { phases: [{ time: 0.2, pose: { a: { turn: 10 } } }, { time: 0.2, pose: {} }, { time: 0.2, pose: { b: { turn: 30 } } }] }
    const s = samplePose(anim, 0.1)
    near(s.b.turn, 0); near(s.b.stretch, 1)
    assert.deepEqual(Object.keys(samplePose(anim, 99)).sort(), ['a', 'b'])
  })
  it('loop length and attack timing', () => {
    near(loopLength(STRIKE), 0.73)
    const tm = attackTiming(STRIKE)
    near(tm.windup, 0.43); near(tm.followThrough, 0.30)
    assert.equal(attackTiming({ phases: [STRIKE.phases[0]] }), null)
    assert.equal(attackTiming({ phases: STRIKE.phases.map(({ hit, ...p }) => p) }), null)
  })
  it('the attack clock maps onto the sequence', () => {
    near(attackTime(STRIKE, { phase: 'windup', t: 0.2 }), 0.2)
    near(attackTime(STRIKE, { phase: 'windup', t: 5 }), 0.43)
    near(attackTime(STRIKE, { phase: 'swing', t: 0.1 }), 0.53)
    near(attackTime(STRIKE, { phase: 'swing', t: 9 }), 0.73)
  })
  it('isActive, hasSequences', () => {
    assert.equal(isActive(STRIKE), true)
    assert.equal(isActive({ phases: [STRIKE.phases[0]] }), false)
    assert.equal(isActive(undefined), false)
    assert.equal(hasSequences({}), false)
    assert.equal(hasSequences(undefined), false)
    assert.equal(hasSequences({ idle: { phases: [STRIKE.phases[0]] } }), false)
    assert.equal(hasSequences({ attack: STRIKE }), true)
  })
  it('animOf', () => {
    assert.equal(animOf({ state: 'idle', speed01: 0, attack: null }), 'idle')
    assert.equal(animOf({ state: 'walk', speed01: 1 }), 'walk')
    assert.equal(animOf({ state: 'hit', speed01: 0.5 }), 'walk')
    assert.equal(animOf({ state: 'hit', attack: { phase: 'windup', t: 0 } }), 'attack')
    assert.equal(animOf({ state: 'death', attack: { phase: 'swing', t: 0 } }), 'idle')
  })
  it('lerpPose blends the union of pieces, missing = rest', () => {
    const m = lerpPose({ a: { turn: 10, stretch: 1 } }, { b: { turn: 20, stretch: 2 } }, 0.5)
    near(m.a.turn, 5); near(m.a.stretch, 1); near(m.b.turn, 10); near(m.b.stretch, 1.5)
  })
})

describe('cleanAnims', () => {
  it('keeps good data and does not mutate it', () => {
    const raw = structuredClone({ attack: STRIKE })
    assert.deepEqual(cleanAnims(raw), { attack: STRIKE })
    assert.deepEqual(raw, { attack: STRIKE })
  })
  it('survives junk, warning instead of throwing', () => {
    const warns = []
    const out = cleanAnims({
      dance: STRIKE,
      walk: { phases: [{ time: 'x', pose: {} }, 7, { time: -1, pose: { a: { turn: 999, stretch: 9 } } }, { time: 5, pose: { a: 'no', b: { turn: NaN, stretch: 0.1 } } }] },
      idle: { phases: [] },
    }, m => warns.push(m))
    assert.deepEqual(Object.keys(out), ['walk'])
    assert.deepEqual(out.walk.phases, [
      { time: 0.03, pose: { a: { turn: 360, stretch: 2 } } },
      { time: 2, pose: { b: { stretch: 0.5 } } },
    ])
    assert.ok(warns.some(w => w.includes('dance')))
    assert.deepEqual(cleanAnims('nope'), {})
    assert.deepEqual(cleanAnims(null), {})
  })
  it('one hit, never on the first card, only on the attack; a missing hit lands on the last card', () => {
    const p = (hit, name) => ({ time: 0.2, pose: {}, ...(hit ? { hit: true } : {}), ...(name ? { name } : {}) })
    const out = cleanAnims({
      attack: { phases: [p(true), p(true), p(true)] },
      walk: { phases: [p(false), p(true, '  a very long name that goes past the limit  ')] },
    })
    assert.deepEqual(out.attack.phases.map(x => !!x.hit), [false, true, false])
    assert.equal(out.walk.phases[1].hit, undefined)
    assert.equal(out.walk.phases[1].name, 'a very long name that go')
    const warns = []
    const fixed = cleanAnims({ attack: { phases: [p(false), p(false), p(false)] } }, m => warns.push(m))
    assert.deepEqual(fixed.attack.phases.map(x => !!x.hit), [false, false, true])
    assert.equal(warns.length, 1)
  })
})
