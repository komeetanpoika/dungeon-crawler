// tools/monster-lab/server.mjs
// Zero-dependency dev server for the monster lab. Serves the repo root (so
// the lab page imports the game's own renderer modules), a small monsters/
// rigs API, and an SSE endpoint that fires when rig or monster files change.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readMonsters, writeMonster, NAME_RE } = require('./monster-files.cjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  root: path.resolve(HERE, '../..'),
  monstersDir: path.resolve(HERE, '../../renderer/data/monsters'),
  rigsDir: path.resolve(HERE, '../../renderer/render/monster-rigs'),
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
               '.svg': 'image/svg+xml', '.wav': 'audio/wav' }

export function createLabServer(opts = {}) {
  const { root, monstersDir, rigsDir } = { ...DEFAULTS, ...opts }
  const sseClients = new Set()
  const watchers = []
  const notify = (dir, file) => {
    const msg = `data: ${JSON.stringify({ dir, file })}\n\n`
    for (const res of sseClients) res.write(msg)
  }
  for (const [label, watched] of [['rigs', rigsDir], ['monsters', monstersDir]]) {
    try { watchers.push(fs.watch(watched, (_ev, file) => notify(label, file))) } catch { /* dir may not exist yet */ }
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) }

    if (u.pathname === '/api/monsters' && req.method === 'GET')
      return send(200, JSON.stringify(readMonsters(monstersDir)))
    if (u.pathname.startsWith('/api/monsters/') && req.method === 'PUT') {
      const name = decodeURIComponent(u.pathname.slice('/api/monsters/'.length))
      if (!NAME_RE.test(name)) return send(400, JSON.stringify({ error: 'invalid name' }))
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        try { send(200, JSON.stringify(writeMonster(monstersDir, name, JSON.parse(body)))) }
        catch (err) { send(400, JSON.stringify({ error: err.message })) }
      })
      return
    }
    if (u.pathname === '/api/rigs' && req.method === 'GET') {
      const rigs = fs.readdirSync(rigsDir).filter(f => f.endsWith('.js') && f !== 'schema.js').map(f => f.slice(0, -3))
      return send(200, JSON.stringify(rigs))
    }
    if (u.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(':ok\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    // static: repo-root files, '/' -> the lab page; refuse anything escaping root
    const rel = u.pathname === '/' ? '/tools/monster-lab/index.html' : u.pathname
    const file = path.normalize(path.join(root, decodeURIComponent(rel)))
    if (!file.startsWith(root + path.sep)) return send(404, 'not found', 'text/plain')
    fs.readFile(file, (err, data) => {
      if (err) return send(404, 'not found', 'text/plain')
      send(200, data, MIME[path.extname(file)] ?? 'application/octet-stream')
    })
  })
  const close = server.close.bind(server)
  server.close = (cb) => {
    for (const w of watchers) w.close()
    return close(cb)
  }
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 5180
  // Bind to loopback only: this server serves the whole repo root and accepts
  // PUT writes to renderer/data/monsters/ — it must never be reachable off-host.
  createLabServer().listen(port, '127.0.0.1', () => console.log(`monster lab: http://localhost:${port}`))
}
