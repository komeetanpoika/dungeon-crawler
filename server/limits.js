// Abuse limits for the public server (4a spec §2): token buckets with an
// injected clock, the per-IP gate (open sockets, hello rate), the per-socket
// message and class budgets, and the caller's address. Pure — no sockets, no
// timers; server/pvp-server.js calls in with `t` = its clock in ms.
//
// Privacy: IP addresses live only in gate.ips, only for these counters, and
// sweepGate drops an entry once it has no sockets, no open rooms and a full
// hello bucket. Nothing in this module logs, and sweepGate hands back
// counts, never keys.
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
  if (!e) gate.ips.set(ip, e = { sockets: 0, hello: helloBucket(t), rooms: 0 })
  e.sockets++
  gate.total++
  return null
}

// Rooms created (not joined) per IP key, at once (spec 4a §2b): a fixed
// count, not a refilling bucket — incremented when a hello actually makes a
// NEW room (server/pvp-server.js's seat(), which alone knows that), and
// decremented when that room closes. An IP with no gate entry (never
// admitted) is never over the cap.
export function canCreateRoom(gate, ip) {
  const e = gate.ips.get(ip)
  return !e || e.rooms < NET.roomsPerIp
}

export function noteRoomCreated(gate, ip) {
  const e = gate.ips.get(ip)
  if (e) e.rooms++
}

export function noteRoomClosed(gate, ip) {
  const e = gate.ips.get(ip)
  if (e && e.rooms > 0) e.rooms--
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
  // A gate entry with rooms > 0 is never dropped, even with no open sockets
  // and a full hello bucket — otherwise disconnecting and waiting out the
  // sweep would reset the per-IP room cap (NET.roomsPerIp) for free. Memory
  // still stays bounded: every counted room is capped by NET.maxRooms.
  for (const [ip, e] of gate.ips) if (e.sockets === 0 && e.rooms === 0 && bucketFull(e.hello, t)) gate.ips.delete(ip)
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

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i

// The first 4 of an IPv6 address's 8 groups (its /64 prefix, joined with
// ':'), handling a '::' run. A whole household (or a phone that rotates its
// low bits) shares a /64, so keying the gate by the full address would let
// one /64 open as many sockets/rooms as it has addresses to spare.
function ipv6Prefix64(ip) {
  let groups
  if (ip.includes('::')) {
    const [head, tail] = ip.split('::')
    const headParts = head ? head.split(':') : []
    const tailParts = tail ? tail.split(':') : []
    const missing = Math.max(0, 8 - headParts.length - tailParts.length)
    groups = [...headParts, ...Array(missing).fill('0'), ...tailParts]
  } else {
    groups = ip.split(':')
  }
  return groups.slice(0, 4).join(':')
}

// The gate's key for a raw address: an IPv4-mapped IPv6 address
// (`::ffff:a.b.c.d`, as some proxies write it) becomes the plain IPv4
// address; any other IPv6 address becomes its /64 prefix; an IPv4 address is
// unchanged.
function ipKey(addr) {
  const mapped = addr.match(IPV4_MAPPED)
  if (mapped) return mapped[1]
  return addr.includes(':') ? ipv6Prefix64(addr) : addr
}

// Behind Cloud Run the caller is the last X-Forwarded-For entry (Google's
// front end appends the address it saw); anything earlier is client-supplied
// and spoofable. Without the header — or with trustProxy off — the socket's
// own address.
export function clientIp(req, trustProxy = NET.trustProxy) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for']
    const last = typeof xff === 'string' ? xff.split(',').at(-1).trim() : ''
    if (last) return ipKey(last)
  }
  return ipKey(req.socket?.remoteAddress ?? 'unknown')
}
