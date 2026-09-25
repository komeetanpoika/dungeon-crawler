// Abuse limits for the public server (4a spec §2): token buckets with an
// injected clock, the per-IP gate (open sockets, hello rate), the per-socket
// message and class budgets, and the caller's address. Pure — no sockets, no
// timers; server/pvp-server.js calls in with `t` = its clock in ms.
//
// Privacy: IP addresses live only in gate.ips, only for these counters, and
// sweepGate drops an entry once it has no sockets and a full hello bucket.
// Nothing in this module logs, and sweepGate hands back counts, never keys.
import { NET } from '../renderer/data/net.js'
import { ERR } from '../renderer/net/protocol.js'

export const makeBucket = (capacity, perMs, t) => ({ capacity, perMs, tokens: capacity, at: t })

// A clock that steps back refills nothing (and never drains a token).
function refill(b, t) {
  if (t <= b.at) return
  b.tokens = Math.min(b.capacity, b.tokens + (t - b.at) * b.perMs)
  b.at = t
}

export function take(b, t) {
  refill(b, t)
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

export function bucketFull(b, t) {
  refill(b, t)
  return b.tokens >= b.capacity
}

const noRefusals = () => ({ rate_limited: 0, server_full: 0, flood: 0 })
const helloBucket = t => makeBucket(NET.helloBurst, NET.helloPerMin / 60000, t)

export const makeGate = () => ({ ips: new Map(), total: 0, refused: noRefusals() })

// A new socket: null when admitted (and counted), else the error code to
// send before closing it. A refused socket is not counted, so its close must
// not release().
export function admit(gate, ip, t) {
  if (gate.total >= NET.maxSockets) { gate.refused.server_full++; return ERR.SERVER_FULL }
  let e = gate.ips.get(ip)
  if (e && e.sockets >= NET.perIpSockets) { gate.refused.rate_limited++; return ERR.RATE_LIMITED }
  if (!e) gate.ips.set(ip, e = { sockets: 0, hello: helloBucket(t) })
  e.sockets++
  gate.total++
  return null
}

export function release(gate, ip) {
  const e = gate.ips.get(ip)
  if (!e || e.sockets === 0) return
  e.sockets--
  gate.total--
}

// Every hello message spends one, before it is validated.
export function takeHello(gate, ip, t) {
  const e = gate.ips.get(ip)
  if (e && take(e.hello, t)) return true
  gate.refused.rate_limited++
  return false
}

export function noteFlood(gate) { gate.refused.flood++ }

export function sweepGate(gate, t) {
  for (const [ip, e] of gate.ips) if (e.sockets === 0 && bucketFull(e.hello, t)) gate.ips.delete(ip)
  const counts = gate.refused
  gate.refused = noRefusals()
  return counts
}

export const makeConnLimits = t => ({
  msg: makeBucket(NET.msgBurst, NET.msgPerSec / 1000, t),
  cls: makeBucket(NET.classPerSec, NET.classPerSec / 1000, t),
})
export const allowMessage = (conn, t) => take(conn.msg, t)
export const allowClass = (conn, t) => take(conn.cls, t)

// Behind Cloud Run the caller is the last X-Forwarded-For entry (Google's
// front end appends the address it saw); anything earlier is client-supplied
// and spoofable. Without the header — or with trustProxy off — the socket's
// own address.
export function clientIp(req, trustProxy = NET.trustProxy) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for']
    const last = typeof xff === 'string' ? xff.split(',').at(-1).trim() : ''
    if (last) return last
  }
  return req.socket?.remoteAddress ?? 'unknown'
}
