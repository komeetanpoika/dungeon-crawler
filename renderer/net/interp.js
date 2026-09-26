// Snapshot interpolation for everything that is not your own hero (spec §2):
// drawn NET.interpDelayTicks behind the estimated server tick, lerped
// between the two snapshots around that moment; a dry buffer extrapolates
// briefly, then holds. The estimate runs on a smoothed, monotonic clock
// (4b spec §3), so jittery arrivals no longer drag other heroes backwards.
// Pure.
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

const TICK_MS = PVP.tick * 1000

// clock: the estimate is tick0 + (now - at0) / TICK_MS + adj — the spec's
// `now / tickMs + offset`, with offset = tick0 - at0 / TICK_MS + adj, kept as
// an anchor so the first snapshot's estimate is exact. Each newer arrival
// sets `target`, the adj it says is right; slew() walks adj toward it by at
// most NET.clockSlew ticks per tick of local time, applied every call rather
// than as a step on arrival, so the drawn clock runs at most 10 % fast or
// slow on every frame. An error past NET.clockSnapTicks re-anchors instead.
// lastRt / snapped: renderTick never goes back, except right after a snap.
export function makeInterp() { return { snaps: [], clock: null, lastRt: null, snapped: false } }

function anchor(buf, tick, nowMs) {
  buf.clock = { tick0: tick, at0: nowMs, adj: 0, target: 0, slewAt: nowMs, lastTick: tick }
  buf.snapped = true
}

function slew(c, nowMs) {
  if (nowMs <= c.slewAt) return
  const max = NET.clockSlew * (nowMs - c.slewAt) / TICK_MS
  c.adj += Math.max(-max, Math.min(max, c.target - c.adj))
  c.slewAt = nowMs
}

function arrive(buf, tick, nowMs) {
  const c = buf.clock
  if (!c) { anchor(buf, tick, nowMs); return }
  // The results screen repeats one tick; it says nothing new about the clock.
  if (tick <= c.lastTick) return
  slew(c, nowMs)
  const target = tick - c.tick0 - (nowMs - c.at0) / TICK_MS
  // A stall, a hidden tab, the next match after the results: snap.
  if (Math.abs(target - c.adj) > NET.clockSnapTicks) { anchor(buf, tick, nowMs); return }
  c.target = target
  c.lastTick = tick
}

export function pushSnap(buf, snap, nowMs) {
  buf.snaps.push(snap)
  arrive(buf, snap.tick, nowMs)
  const oldest = snap.tick - NET.bufferTicks
  // A results screen freezes match.tick, so consecutive snapshots can share
  // one tick forever — the tick-age trim below never fires on its own, so a
  // raw count cap backs it up.
  while (buf.snaps.length > 2 && (buf.snaps[0].tick < oldest || buf.snaps.length > NET.bufferTicks + 2)) buf.snaps.shift()
}

export const newest = buf => buf.snaps.at(-1) ?? null

export function estServerTick(buf, nowMs) {
  const last = newest(buf)
  if (!last || !buf.clock) return 0
  const c = buf.clock
  slew(c, nowMs)
  const est = c.tick0 + (nowMs - c.at0) / TICK_MS + c.adj
  return Math.min(est, last.tick + NET.extrapolateTicks + NET.interpDelayTicks)
}

export function renderTick(buf, nowMs) {
  let rt = estServerTick(buf, nowMs) - NET.interpDelayTicks
  if (buf.lastRt !== null && !buf.snapped) rt = Math.max(rt, buf.lastRt)
  buf.snapped = false
  buf.lastRt = rt
  return rt
}

// a: the newest snapshot at or before rt; b: the first one after it (null on
// a dry buffer); f: how far between them.
export function sample(buf, rt) {
  const s = buf.snaps
  if (!s.length) return { a: null, b: null, f: 0 }
  let i = s.length - 1
  while (i > 0 && s[i].tick > rt) i--
  const a = s[i]
  const b = s.slice(i + 1).find(x => x.tick > a.tick) ?? null
  if (a.tick > rt) return { a, b: null, f: 0 }
  const f = b ? Math.min(1, (rt - a.tick) / (b.tick - a.tick)) : 0
  return { a, b, f }
}

function previousOf(buf, snap) {
  const i = buf.snaps.indexOf(snap)
  for (let j = i - 1; j >= 0; j--) if (buf.snaps[j].tick < snap.tick) return buf.snaps[j]
  return null
}

export function heroPoses(buf, rt) {
  const out = new Map()
  const { a, b, f } = sample(buf, rt)
  if (!a) return out
  if (b) {
    for (const hb of b.heroes) {
      const ha = a.heroes.find(h => h.id === hb.id)
      const jump = ha ? Math.hypot(hb.px - ha.px, hb.py - ha.py) : Infinity
      if (!ha || ha.dead || hb.dead || jump > NET.bigSnapPx) out.set(hb.id, { snap: hb, px: hb.px, py: hb.py })
      else out.set(hb.id, { snap: hb, px: ha.px + (hb.px - ha.px) * f, py: ha.py + (hb.py - ha.py) * f })
    }
    return out
  }
  const prev = previousOf(buf, a)
  const ext = Math.min(Math.max(0, rt - a.tick), NET.extrapolateTicks)
  for (const ha of a.heroes) {
    const hp = prev?.heroes.find(h => h.id === ha.id)
    const span = prev ? a.tick - prev.tick : 0
    const vx = hp && span && !ha.dead ? (ha.px - hp.px) / span : 0
    const vy = hp && span && !ha.dead ? (ha.py - hp.py) / span : 0
    const fast = Math.hypot(vx, vy) * NET.extrapolateTicks > NET.bigSnapPx
    out.set(ha.id, { snap: ha, px: fast ? ha.px : ha.px + vx * ext, py: fast ? ha.py : ha.py + vy * ext })
  }
  return out
}

export function projectilesAt(buf, rt) {
  const { a } = sample(buf, rt)
  if (!a) return []
  const dt = Math.max(0, rt - a.tick) * PVP.tick
  return a.projectiles.map(p => ({ ...p, px: p.px + p.dx * dt, py: p.py + p.dy * dt }))
}
