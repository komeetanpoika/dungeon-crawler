import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeInterp, pushSnap, estServerTick, renderTick, sample, heroPoses, projectilesAt, newest } from '../renderer/net/interp.js'
import { PVP } from '../renderer/data/pvp.js'
import { NET } from '../renderer/data/net.js'

const snap = (tick, px, extra = {}) => ({ tick, heroes: [{ id: 'b', px, py: 100, dead: false }], projectiles: [], pickups: [], ...extra })
const tickMs = PVP.tick * 1000

describe('interpolation', () => {
  it('estimates the server tick from the last arrival, capped', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(30, 0), 1000)
    assert.equal(estServerTick(buf, 1000), 30)
    assert.ok(Math.abs(estServerTick(buf, 1000 + 2 * tickMs) - 32) < 1e-9)
    assert.equal(estServerTick(buf, 1000 + 999 * tickMs), 30 + NET.extrapolateTicks + NET.interpDelayTicks)
    assert.equal(renderTick(buf, 1000), 30 - NET.interpDelayTicks)
  })
  it('lerps a hero between the snapshots around renderTick', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 64), 0)
    const { a, b, f } = sample(buf, 11)
    assert.equal(a.tick, 10); assert.equal(b.tick, 12); assert.equal(f, 0.5)
    assert.equal(heroPoses(buf, 11).get('b').px, 32)
  })
  it('extrapolates on its last velocity for at most extrapolateTicks, then holds', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 20), 0)   // 10 px/tick
    assert.equal(heroPoses(buf, 13).get('b').px, 30)
    assert.equal(heroPoses(buf, 12 + NET.extrapolateTicks + 5).get('b').px, 20 + 10 * NET.extrapolateTicks)
  })
  it('does not lerp across a teleport (respawn)', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0), 0); pushSnap(buf, snap(12, 800), 0)
    assert.equal(heroPoses(buf, 11).get('b').px, 800)
  })
  it('advances projectiles from the older snapshot along their velocity', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(10, 0, { projectiles: [{ px: 100, py: 0, dx: 300, dy: 0 }] }), 0)
    pushSnap(buf, snap(12, 0, { projectiles: [] }), 0)
    assert.equal(projectilesAt(buf, 11)[0].px, 100 + 300 * PVP.tick)
  })
  it('keeps about a second of snapshots and hands back the newest', () => {
    const buf = makeInterp()
    for (let t = 0; t < 100; t++) pushSnap(buf, snap(t, t), 0)
    assert.ok(buf.snaps.length <= NET.bufferTicks + 1)
    assert.equal(newest(buf).tick, 99)
  })
  it('equal ticks (a frozen match during results) never divide by zero', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(50, 5), 0); pushSnap(buf, snap(50, 5), 0)
    assert.equal(heroPoses(buf, 50).get('b').px, 5)
  })
  it('caps the buffer even during a frozen tick (results screen)', () => {
    const buf = makeInterp()
    for (let i = 0; i < 100; i++) pushSnap(buf, snap(50, 5), 0)
    assert.ok(buf.snaps.length <= NET.bufferTicks + 2)
  })
})

// A server stepping 30 ticks a second and sending a snapshot whenever its
// 20 Hz schedule says so (server/rooms.js stepRoom), over a link whose delay
// is `base` ms plus up to `jitter` ms, order kept (TCP stalls, never
// reorders). Returns [{ tick, at }] sorted by arrival.
function link({ seconds, base, jitter, seed = 7 }) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const out = []
  let at = 0
  for (let tick = 1; tick <= seconds * 30; tick++) {
    const due = Math.floor(tick * NET.snapshotHz * PVP.tick) !== Math.floor((tick - 1) * NET.snapshotHz * PVP.tick)
    if (!due) continue
    at = Math.max(at, tick * tickMs + base + jitter * rnd())
    out.push({ tick, at })
  }
  return out
}

describe('the smoothed clock', () => {
  it('carries the spec numbers', () => {
    assert.equal(NET.clockSlew, 0.1)
    assert.equal(NET.clockSnapTicks, 15)
  })
  it('jittered arrivals: renderTick never goes back, and each 60 Hz frame advances it within ±10 % of the nominal rate once settled', () => {
    const buf = makeInterp()
    const arrivals = link({ seconds: 6, base: 80, jitter: 60 })
    const frameMs = 1000 / 60, nominal = frameMs / tickMs
    let next = 0, last = null, worst = 0
    for (let t = 0; t < 6000; t += frameMs) {
      while (next < arrivals.length && arrivals[next].at <= t) { pushSnap(buf, snap(arrivals[next].tick, 0), arrivals[next].at); next++ }
      if (!newest(buf)) continue
      const rt = renderTick(buf, t)
      if (last !== null) {
        assert.ok(rt >= last, `went back at ${t.toFixed(0)} ms: ${last} → ${rt}`)
        if (t > 1000) worst = Math.max(worst, Math.abs((rt - last) / nominal - 1))
      }
      last = rt
    }
    assert.ok(worst <= 0.1 + 1e-9, `worst frame off the nominal rate by ${(worst * 100).toFixed(1)} %`)
  })
  it('a 1 s stall snaps the clock, which may then step back', () => {
    const buf = makeInterp()
    for (let tick = 0; tick <= 60; tick++) pushSnap(buf, snap(tick, 0), tick * tickMs)
    const before = renderTick(buf, 60 * tickMs)
    assert.ok(Math.abs(before - 57) < 1e-6, `${before}`)
    const during = renderTick(buf, 61 * tickMs + 1000)          // nothing for a second: extrapolation cap
    assert.equal(during, 60 + NET.extrapolateTicks)
    pushSnap(buf, snap(61, 0), 61 * tickMs + 1000)               // tick 61 arrives a second late
    assert.equal(buf.clock.tick0, 61, 're-anchored')
    assert.equal(renderTick(buf, 61 * tickMs + 1000), 61 - NET.interpDelayTicks)
  })
  it('equal-tick snapshots (the results screen) leave the clock alone', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(50, 5), 0)
    const clock = { ...buf.clock }
    let last = renderTick(buf, 0)
    for (let i = 1; i <= 40; i++) {
      pushSnap(buf, snap(50, 5), i * 50)
      const rt = renderTick(buf, i * 50)
      assert.ok(rt >= last)
      last = rt
    }
    assert.deepEqual({ ...buf.clock, slewAt: 0 }, { ...clock, slewAt: 0 })
  })
  it('a small error is walked off, not jumped: a snapshot 3 ticks early moves the clock by at most 10 % of the time since', () => {
    const buf = makeInterp()
    pushSnap(buf, snap(30, 0), 1000)
    pushSnap(buf, snap(36, 0), 1000 + 3 * tickMs)                // 3 ticks ahead of the clock
    const a = estServerTick(buf, 1000 + 3 * tickMs)
    const b = estServerTick(buf, 1000 + 8 * tickMs)              // 5 ticks later
    assert.ok(Math.abs(a - 33) < 1e-9, `${a}`)                  // no jump on arrival
    assert.ok(Math.abs(b - 38.5) < 1e-9, `${b}`)                // 5 ticks, plus 10 % of 5 caught up
  })
})
