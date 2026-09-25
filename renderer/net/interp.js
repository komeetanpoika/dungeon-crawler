// Snapshot interpolation for everything that is not your own hero (spec §2):
// drawn NET.interpDelayTicks behind the estimated server tick, lerped
// between the two snapshots around that moment; a dry buffer extrapolates
// briefly, then holds. Pure.
import { PVP } from '../data/pvp.js'
import { NET } from '../data/net.js'

export function makeInterp() { return { snaps: [], lastArrival: 0 } }

export function pushSnap(buf, snap, nowMs) {
  buf.snaps.push(snap)
  buf.lastArrival = nowMs
  const oldest = snap.tick - NET.bufferTicks
  // A results screen freezes match.tick, so consecutive snapshots can share
  // one tick forever — the tick-age trim below never fires on its own, so a
  // raw count cap backs it up.
  while (buf.snaps.length > 2 && (buf.snaps[0].tick < oldest || buf.snaps.length > NET.bufferTicks + 2)) buf.snaps.shift()
}

export const newest = buf => buf.snaps.at(-1) ?? null

export function estServerTick(buf, nowMs) {
  const last = newest(buf)
  if (!last) return 0
  const ahead = (nowMs - buf.lastArrival) / 1000 / PVP.tick
  return last.tick + Math.min(ahead, NET.extrapolateTicks + NET.interpDelayTicks)
}

export const renderTick = (buf, nowMs) => estServerTick(buf, nowMs) - NET.interpDelayTicks

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
