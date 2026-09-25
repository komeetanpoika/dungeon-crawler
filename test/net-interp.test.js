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
})
