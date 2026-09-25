// Shared fixtures for the net tests (not itself a test file).
import http from 'node:http'
import WebSocket from 'ws'
import { attachPvp } from '../server/pvp-server.js'
import { encode, decode } from '../renderer/net/protocol.js'

export async function startServer(opts = {}) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
  const pvp = attachPvp(server, opts)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `ws://127.0.0.1:${server.address().port}/pvp`
  return { url, pvp, close: () => new Promise(r => { pvp.close(); server.close(r) }) }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function waitFor(fn, ms = 2000, step = 10) {
  const end = performance.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (performance.now() > end) throw new Error('waitFor timed out')
    await sleep(step)
  }
}

// Each raw client comes from its own made-up address, via X-Forwarded-For,
// which the server trusts by default, so a test file's many sockets never
// trip the per-IP limits. Pass { ip } to pin one, or { ip: null } for none.
let ipSeq = 0
const nextIp = () => { const n = ipSeq++; return `10.9.${(n >> 8) & 255}.${n & 255}` }

// A bare socket speaking the protocol by hand — for the server tests.
export async function rawClient(url, { ip = nextIp() } = {}) {
  const ws = new WebSocket(url, ip ? { headers: { 'x-forwarded-for': ip } } : undefined)
  const messages = []
  let closed = null
  ws.on('message', d => { const m = decode(d.toString()); if (m) messages.push(m) })
  ws.on('close', code => { closed = code })
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  return {
    ws, messages,
    get closed() { return closed },
    send: obj => ws.send(typeof obj === 'string' ? obj : encode(obj)),
    next: (type, ms = 2000) => waitFor(() => messages.find(m => m.type === type), ms),
    last: type => messages.filter(m => m.type === type).at(-1),
  }
}

// A WebSocket that behaves like a laggy link: every message waits `up`/`down`
// ms (+ jitter, + an occasional stall) and order is kept — a TCP link never
// drops, it stalls.
export function laggy({ up = 0, down = 0, jitter = 0, stallChance = 0, stallMs = 0, seed = 1 } = {}) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const delay = base => base + jitter * rnd() + (rnd() < stallChance ? stallMs : 0)
  return class LaggyWebSocket {
    constructor(url) {
      this.inner = new WebSocket(url)
      this.upAt = 0; this.downAt = 0
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null
      this.inner.on('open', () => this.onopen?.())
      this.inner.on('error', e => this.onerror?.(e))
      this.inner.on('message', data => {
        const at = this.downAt = Math.max(this.downAt, performance.now() + delay(down))
        const text = data.toString()
        setTimeout(() => this.onmessage?.({ data: text }), at - performance.now())
      })
      this.inner.on('close', () => {
        const at = Math.max(this.downAt, performance.now()) + 1
        setTimeout(() => this.onclose?.(), at - performance.now())
      })
    }
    get readyState() { return this.inner.readyState }
    send(text) {
      const at = this.upAt = Math.max(this.upAt, performance.now() + delay(up))
      setTimeout(() => { if (this.inner.readyState === 1) this.inner.send(text) }, at - performance.now())
    }
    close() { this.inner.close() }
  }
}

// Run a client like the game loop would: a frame every 16 ms for `ms`.
export async function drive(session, inputAt, ms, onFrame = () => {}) {
  const { frame, sessionView } = await import('../renderer/net/client.js')
  const start = performance.now()
  while (performance.now() - start < ms) {
    const t = performance.now()
    frame(session, inputAt(t - start), t)
    onFrame(sessionView(session, t), t - start)
    await sleep(16)
  }
}
