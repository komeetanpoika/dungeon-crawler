import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { startServer as bootServer, laggy, drive, waitFor, sleep } from './net-helpers.js'
import { connect, frame, sessionView, leave, drainEvents } from '../renderer/net/client.js'
import { placeHero } from '../renderer/pvp/hero.js'
import { NEUTRAL_INPUT } from '../renderer/pvp/hero.js'

// Everything a test opens is closed after it, pass or fail — a failed
// assertion must not leave sockets or room loops holding the runner open.
const opened = { servers: [], sessions: [] }
const startServer = async opts => { const s = await bootServer(opts); opened.servers.push(s); return s }
const track = s => { opened.sessions.push(s); return s }
afterEach(async () => {
  for (const s of opened.sessions.splice(0)) if (s.status === 'open' || s.status === 'connecting') leave(s)
  for (const s of opened.servers.splice(0)) await s.close()
})

const idle = () => NEUTRAL_INPUT
const east = () => ({ ...NEUTRAL_INPUT, move: { x: 1, y: 0 }, facing: 'east' })
const open = async s => { await waitFor(() => s.status === 'open' && s.pred, 3000); return s }
const host = (url, W, cls = 'archer') => open(track(connect({ url, WebSocketImpl: W, now: () => performance.now(), hello: { name: 'Host', cls, create: true } })))
const join = (url, W, room, cls = 'archer') => open(track(connect({ url, WebSocketImpl: W, now: () => performance.now(), hello: { name: 'Guest', cls, room } })))
const serverHero = (srv, s) => srv.pvp.lobby.rooms.get(s.room).match.heroes.find(h => h.id === s.heroId)

describe('play under lag', () => {
  // The hero walks 2 px a frame; the rest of the 5 px budget is the 100 ms
  // blend of corrections. Those come from the spec's starved-queue rule (a
  // stalled uplink makes the server repeat the last input without acking it,
  // so the replay briefly runs ahead): measured up to 4.4 px over 70 runs.
  it('walk: prediction ends within 2 px of the server and never jumps more than 5 px per 16 ms frame', async () => {
    const srv = await startServer()
    const W = laggy({ up: 60, down: 60, jitter: 60, stallChance: 0.02, stallMs: 300 })
    const a = await host(srv.url, W)
    // Normalised to a 16 ms frame: a slow test-runner frame may cover more
    // ground, but never faster than the hero walks plus a small correction.
    let lastX = null, lastT = null, maxJump = 0
    const track = (v, t) => {
      if (!v) return
      if (lastX !== null) maxJump = Math.max(maxJump, Math.abs(v.me.px - lastX) * 16 / Math.max(16, t - lastT))
      lastX = v.me.px; lastT = t
    }
    await drive(a, t => t < 1000 ? east() : idle(), 1800, track)
    const v = sessionView(a, performance.now())
    assert.ok(Math.abs(v.me.px - serverHero(srv, a).px) < 2, `${v.me.px} vs ${serverHero(srv, a).px}`)
    assert.ok(maxJump <= 5, `max jump ${maxJump}`)
    leave(a); await srv.close()
  })

  it("interpolation: B's view of A never steps more than a tile per frame", async () => {
    const srv = await startServer()
    const W = laggy({ up: 80, down: 80, jitter: 40 })
    const a = await host(srv.url, W)
    const b = await join(srv.url, W, a.room)
    let last = null, maxStep = 0
    const bFrames = drive(b, idle, 1600, v => {
      const other = v?.others.find(h => h.id === a.heroId)
      if (!other) return
      if (last) maxStep = Math.max(maxStep, Math.hypot(other.px - last.px, other.py - last.py))
      last = { px: other.px, py: other.py }
    })
    await drive(a, t => t < 1200 ? east() : idle(), 1600)
    await bFrames
    assert.ok(last, 'B saw A')
    assert.ok(maxStep <= 32, `max step ${maxStep}`)
    leave(a); leave(b); await srv.close()
  })

  for (const rewind of [true, false]) {
    it(`melee under 100 ms lag ${rewind ? 'hits with rewind' : 'misses without rewind'}`, async () => {
      const srv = await startServer({ rewind })
      const W = laggy({ up: 100, down: 100 })
      const a = await host(srv.url, W, 'warrior')
      const b = await join(srv.url, W, a.room, 'archer')
      const [wa, hb] = [serverHero(srv, a), serverHero(srv, b)]
      placeHero(wa, { x: 9, y: 7 }); placeHero(hb, { x: 10, y: 7 })
      wa.spawnProtect = 0; hb.spawnProtect = 0; wa.facing = 'east'
      await sleep(400)                                      // both views settle on the new places
      // A swings the moment it sees B step just out of point-blank (36 px,
      // within the sword's 58 px centre reach). At 100 ms each way A's view
      // is ~10 ticks old, past the 6-tick rewind cap, so the server tests B
      // 4 ticks (16 px) beyond where A saw it: ~52 px with rewind (a hit),
      // ~72 px without (a miss). 36 leaves one tick of slack under the reach.
      let swung = false, serverSwung = false
      const bWalk = drive(b, east, 1500)
      await drive(a, () => {
        const v = sessionView(a, performance.now())
        const seen = v?.others.find(h => h.id === b.heroId)
        const go = !swung && seen && Math.hypot(seen.px - v.me.px, seen.py - v.me.py) >= 36
        if (go) swung = true
        return { ...NEUTRAL_INPUT, facing: 'east', attack: go }
      }, 1500, () => { if (wa.attackTimer > 0) serverSwung = true })
      await bWalk
      assert.ok(swung, 'A swung')
      assert.ok(serverSwung, 'the server ran the swing')   // a lost press must not pass as a miss
      assert.equal(hb.hp < 10, rewind, `B hp ${hb.hp}`)
      leave(a); leave(b); await srv.close()
    })
  }

  it('lifecycle: matchEnd then matchStart; leaving empties the room', async () => {
    const srv = await startServer({ matchLength: 1.5, resultsDelay: 0.5 })
    const a = await host(srv.url, WebSocketNoLag())
    const b = await join(srv.url, WebSocketNoLag(), a.room)
    const seen = []
    await drive(a, idle, 2800, () => seen.push(...drainEvents(a).map(e => e.type)))
    assert.ok(seen.includes('matchEnd'), seen.join(','))
    assert.ok(seen.includes('matchStart'), seen.join(','))
    leave(b)
    await waitFor(() => sessionView(a, performance.now())?.others.length === 0 && sessionView(a, performance.now()).waiting)
    leave(a)
    await waitFor(() => srv.pvp.lobby.rooms.size === 0)
    await srv.close()
  })

  it('server close marks the session lost and frame() is a no-op', async () => {
    const srv = await startServer()
    const a = await host(srv.url, WebSocketNoLag())
    await srv.close()
    await waitFor(() => a.status === 'lost')
    assert.doesNotThrow(() => frame(a, idle(), performance.now()))
    assert.ok(drainEvents(a).some(e => e.type === 'closed' && e.status === 'lost'))
  })

  it('a one-frame press between two input sends is carried by the next input', () => {
    const sent = []
    class FakeWS { constructor() { queueMicrotask(() => this.onopen?.()) } send(t) { sent.push(JSON.parse(t)) } close() {} }
    const a = connect({ url: 'ws://x', WebSocketImpl: FakeWS, now: () => 0, hello: { name: 'A', cls: 'warrior', create: true } })
    a.ws.onmessage({ data: JSON.stringify({ type: 'welcome', room: 'ABCD', heroId: 1 }) })
    frame(a, idle(), 0)
    frame(a, { ...NEUTRAL_INPUT, attack: true }, 16)     // 16 ms: no input is due yet
    frame(a, idle(), 34)                                  // the next input goes out here
    frame(a, idle(), 68)
    const inputs = sent.filter(m => m.type === 'input')
    assert.deepEqual(inputs.map(m => m.attack), [true, false])
  })

  it('a 10 s frame gap sends at most maxFrame worth of inputs', async () => {
    const srv = await startServer()
    const a = await host(srv.url, WebSocketNoLag())
    const t = performance.now()
    frame(a, idle(), t)
    const before = a.seq
    frame(a, idle(), t + 10_000)
    assert.ok(a.seq - before <= 8, `${a.seq - before} inputs`)
    leave(a); await srv.close()
  })
})

function WebSocketNoLag() { return laggy({}) }
