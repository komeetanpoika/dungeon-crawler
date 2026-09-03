import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { updateEcho, echoTarget, activeSpot, ECHO_RANGE } from '../renderer/systems/echo.js'
import { makeSfx } from '../renderer/systems/sfx.js'

const S = 32
const mapData = { pois: [{ label: 'runestone', x: 10, y: 10 }, { label: 'bell', x: 30, y: 10 }] }
const episode = { echoSpots: [
  { fromPoi: 'runestone', lines: [{ when: f => f.done, text: 'Done.' }, { when: () => true, text: 'Start.' }] },
  { fromPoi: 'bell', lines: [{ when: () => true, text: 'Bell.' }] },
] }
const player = (x, y, facing = 'east') => ({ x, y, px: x * S + 16, py: y * S + 16, facing })
const echo = () => ({ type: 'echo', id: 'echo', x: 0, y: 0, px: 16, py: 16, fadeA: 0, t: 0, trail: [], said: null })
const stateWith = p => ({ player: p, entities: [], log: [], sfx: makeSfx(), feedback: { bubble: null } })
const ep = flags => ({ episode, mapData, flags, ctx: {} })

describe('echo follow', () => {
  it('targets one tile behind the player, six px up', () => {
    assert.deepEqual(echoTarget(player(5, 5, 'east')), { px: 5 * S + 16 - S, py: 5 * S + 16 - 6 })
    assert.deepEqual(echoTarget(player(5, 5, 'north')), { px: 5 * S + 16, py: 5 * S + 16 + S - 6 })
  })
  it('eases toward the target and keeps a trail', () => {
    const e = echo(), st = stateWith(player(5, 5))
    updateEcho(e, st, ep({}), 0.1)
    const t = echoTarget(st.player)
    assert.ok(e.px > 16 && e.px < t.px)
    for (let i = 0; i < 30; i++) updateEcho(e, st, ep({}), 0.1)
    assert.ok(Math.abs(e.px - t.px) < 1 && Math.abs(e.py - t.py) < 1)
    assert.equal(e.trail.length, 3)
    assert.equal(e.x, Math.floor(e.px / S))
  })
})

describe('echo visibility and speech', () => {
  it('is invisible with no spot in range', () => {
    const e = echo(), st = stateWith(player(50, 50))
    updateEcho(e, st, ep({}), 1)
    assert.equal(e.fadeA, 0)
    assert.equal(st.feedback.bubble, null)
  })
  it('fades in near a spot and speaks that spot line once', () => {
    const e = echo(), st = stateWith(player(11, 10))
    updateEcho(e, st, ep({}), 0.1)
    assert.ok(e.fadeA > 0 && e.fadeA < 1)
    assert.equal(st.feedback.bubble.text, 'Start.')
    assert.equal(st.sfx.cues.filter(c => c.name === 'echo').length, 1)
    st.feedback.bubble = null
    updateEcho(e, st, ep({}), 0.1)
    assert.equal(st.feedback.bubble, null)
  })
  it('re-speaks when the line changes while in range, and again after leaving and returning', () => {
    const e = echo(), st = stateWith(player(11, 10))
    const flags = {}
    updateEcho(e, st, ep(flags), 0.1)
    flags.done = true
    updateEcho(e, st, ep(flags), 0.1)
    assert.equal(st.feedback.bubble.text, 'Done.')
    st.player = player(50, 50)
    updateEcho(e, st, ep(flags), 2)
    assert.equal(e.fadeA, 0)
    st.feedback.bubble = null
    st.player = player(11, 10)
    updateEcho(e, st, ep(flags), 0.1)
    assert.equal(st.feedback.bubble.text, 'Done.')
  })
  it('activeSpot picks the nearest spot within range that has a line', () => {
    assert.equal(activeSpot(episode, mapData, {}, {}, 10 * S, 10 * S).i, 0)
    assert.equal(activeSpot(episode, mapData, {}, {}, 20 * S, 10 * S), null)
    assert.equal(ECHO_RANGE, 5 * S)
  })
})
