import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeBucket, take, bucketFull, makeGate, admit, release, takeHello, noteFlood, sweepGate,
  makeConnLimits, allowMessage, allowClass, clientIp, canCreateRoom, noteRoomCreated, noteRoomClosed } from '../server/limits.js'
import { ERR } from '../renderer/net/protocol.js'
import { NET } from '../renderer/data/net.js'

describe('token bucket', () => {
  it('spends up to capacity at once, then refills at its rate, never above capacity', () => {
    const b = makeBucket(3, 1 / 1000, 0)                 // 3 tokens, one a second
    for (let i = 0; i < 3; i++) assert.equal(take(b, 0), true)
    assert.equal(take(b, 0), false)
    assert.equal(take(b, 500), false)
    assert.equal(take(b, 1500), true)
    assert.equal(bucketFull(b, 1_000_000), true)
    assert.equal(b.tokens, 3)
  })
  it('a clock that steps back refills nothing', () => {
    const b = makeBucket(1, 1, 100)
    assert.equal(take(b, 100), true)
    assert.equal(take(b, 50), false)
  })
})

describe('the per-IP gate', () => {
  it('8 open sockets per IP; the 9th is rate_limited; another IP is unaffected; a release frees a slot', () => {
    const g = makeGate()
    for (let i = 0; i < NET.perIpSockets; i++) assert.equal(admit(g, 'A', 0), null)
    assert.equal(admit(g, 'A', 0), ERR.RATE_LIMITED)
    assert.equal(admit(g, 'B', 0), null)
    release(g, 'A')
    assert.equal(admit(g, 'A', 0), null)
    assert.equal(g.total, NET.perIpSockets + 1)
  })
  it('600 sockets in total, then server_full', () => {
    const g = makeGate()
    for (let i = 0; i < NET.maxSockets; i++) assert.equal(admit(g, `ip${i}`, 0), null)
    assert.equal(admit(g, 'late', 0), ERR.SERVER_FULL)
    assert.equal(g.total, NET.maxSockets)
  })
  it('release of an unknown or empty IP changes nothing', () => {
    const g = makeGate()
    release(g, 'nobody')
    admit(g, 'A', 0); release(g, 'A'); release(g, 'A')
    assert.equal(g.total, 0)
  })
  it('10 hellos per IP at once, then one more every 6 s', () => {
    const g = makeGate()
    admit(g, 'A', 0)
    for (let i = 0; i < NET.helloBurst; i++) assert.equal(takeHello(g, 'A', 0), true)
    assert.equal(takeHello(g, 'A', 0), false)
    assert.equal(takeHello(g, 'A', 5999), false)
    assert.equal(takeHello(g, 'A', 6001), true)
    assert.equal(takeHello(g, 'never-admitted', 0), false)
  })
  it('a household behind one IP: four players join, each rejoins once, within a minute', () => {
    const g = makeGate()
    for (let i = 0; i < 4; i++) { assert.equal(admit(g, 'home', 0), null); assert.equal(takeHello(g, 'home', 0), true) }
    for (let i = 0; i < 4; i++) {
      release(g, 'home')
      assert.equal(admit(g, 'home', 30000), null)
      assert.equal(takeHello(g, 'home', 30000), true)
    }
    assert.equal(g.ips.get('home').sockets, 4)
  })
  it('sweepGate forgets an IP once it has no sockets and a full hello bucket, and hands back only counts', () => {
    const g = makeGate()
    admit(g, '203.0.113.9', 0); takeHello(g, '203.0.113.9', 0)
    for (let i = 0; i < NET.perIpSockets + 1; i++) admit(g, 'X', 0)   // the last one is refused
    noteFlood(g)
    release(g, '203.0.113.9')
    assert.deepEqual(sweepGate(g, 1000), { rate_limited: 1, server_full: 0, flood: 1 })
    assert.equal(g.ips.has('203.0.113.9'), true)     // its hello bucket is not full again yet
    sweepGate(g, 7000)
    assert.equal(g.ips.has('203.0.113.9'), false)
    assert.equal(g.ips.has('X'), true)               // still has sockets
    assert.deepEqual(sweepGate(g, 8000), { rate_limited: 0, server_full: 0, flood: 0 })
  })
})

describe('per-connection budgets', () => {
  it('NET.msgBurst (320) messages at once, then about 60 a second', () => {
    const c = makeConnLimits(0)
    for (let i = 0; i < NET.msgBurst; i++) assert.equal(allowMessage(c, 0), true)
    assert.equal(allowMessage(c, 0), false)
    let ok = 0
    for (let i = 0; i < 100; i++) if (allowMessage(c, 1000)) ok++
    assert.ok(Math.abs(ok - NET.msgPerSec) <= 1, `${ok}`)   // ±1 for float rounding in the refill
  })
  // Item 3: msgBurst was raised from 90 to 320 (~10 s of backlog at ~31
  // msg/s) so a mobile stall isn't closed as a flood; msgPerSec (60) is
  // unchanged, so a genuine sustained flood is still caught once the burst
  // is spent.
  it('a phone whose link stalled 5 s delivers its ~155-message backlog at once and is not refused', () => {
    const c = makeConnLimits(0)
    for (let t = 0; t < 1000; t += 1000 / 30) assert.equal(allowMessage(c, t), true)   // a second of normal play
    for (let i = 0; i < 155; i++) assert.equal(allowMessage(c, 5000), true)           // ~5 s at ~31 msg/s, all at once
  })
  it('a sustained 200 msg/s flood still exhausts the bucket and gets refused', () => {
    const c = makeConnLimits(0)
    let t = 0, refused = false
    for (let i = 0; i < 1000 && !refused; i++) {
      t += 1000 / 200
      if (!allowMessage(c, t)) refused = true
    }
    assert.equal(refused, true)
  })
  it('class: 2 at once, extras refused until the bucket refills', () => {
    const c = makeConnLimits(0)
    assert.equal(allowClass(c, 0), true)
    assert.equal(allowClass(c, 0), true)
    assert.equal(allowClass(c, 0), false)
    assert.equal(allowClass(c, 600), true)
  })
})

describe('clientIp', () => {
  const req = (xff, addr = '10.0.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: addr } })
  it('behind the proxy: the last X-Forwarded-For entry', () => {
    assert.equal(clientIp(req('1.2.3.4, 198.51.100.7'), true), '198.51.100.7')
    assert.equal(clientIp(req(' 198.51.100.7 '), true), '198.51.100.7')
  })
  it('without the header, with an empty last entry, or with trustProxy off: the socket address', () => {
    assert.equal(clientIp(req(undefined), true), '10.0.0.5')
    assert.equal(clientIp(req(''), true), '10.0.0.5')
    assert.equal(clientIp(req('1.2.3.4, '), true), '10.0.0.5')
    assert.equal(clientIp(req('1.2.3.4'), false), '10.0.0.5')
  })
  it('defaults to NET.trustProxy', () => {
    assert.equal(clientIp(req('198.51.100.7')), '198.51.100.7')
  })
  // Item 2a: a household (or a phone rotating its low bits) shares an IPv6
  // /64, so the gate keys on that prefix, not the full address — otherwise
  // one /64 could open as many sockets/rooms as it has addresses to spare.
  it('keys a plain IPv6 address by its /64 prefix', () => {
    assert.equal(clientIp(req('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd')), '2001:db8:1234:5678')
    assert.equal(clientIp(req('2001:db8:1234:5678:1111::2')), '2001:db8:1234:5678')
    assert.equal(clientIp(req('2001:db8:1234:5679::1')), '2001:db8:1234:5679')
  })
  it('normalises an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to the plain IPv4 address', () => {
    assert.equal(clientIp(req('::ffff:203.0.113.9')), '203.0.113.9')
    assert.equal(clientIp(req('::FFFF:203.0.113.9')), '203.0.113.9')
  })
  it('leaves a plain IPv4 address unchanged', () => {
    assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9')
  })
})

describe('rooms per IP (item 2b)', () => {
  it('allows up to NET.roomsPerIp rooms, then refuses; a release frees a slot', () => {
    const g = makeGate()
    admit(g, 'A', 0)
    for (let i = 0; i < NET.roomsPerIp; i++) {
      assert.equal(canCreateRoom(g, 'A'), true)
      noteRoomCreated(g, 'A')
    }
    assert.equal(canCreateRoom(g, 'A'), false)
    noteRoomClosed(g, 'A')
    assert.equal(canCreateRoom(g, 'A'), true)
  })
  it('an IP with no gate entry (never admitted) is never over the cap', () => {
    const g = makeGate()
    assert.equal(canCreateRoom(g, 'never-admitted'), true)
  })
  it('a second IP is unaffected, and noteRoomClosed on an empty/unknown IP is harmless', () => {
    const g = makeGate()
    admit(g, 'A', 0)
    for (let i = 0; i < NET.roomsPerIp; i++) noteRoomCreated(g, 'A')
    admit(g, 'B', 0)
    assert.equal(canCreateRoom(g, 'B'), true)
    noteRoomClosed(g, 'B')
    noteRoomClosed(g, 'nobody')
    assert.equal(canCreateRoom(g, 'B'), true)
  })
})
