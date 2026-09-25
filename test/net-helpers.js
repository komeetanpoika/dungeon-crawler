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
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out')
    await sleep(step)
  }
}

// A bare socket speaking the protocol by hand — for the server tests.
export async function rawClient(url) {
  const ws = new WebSocket(url)
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
