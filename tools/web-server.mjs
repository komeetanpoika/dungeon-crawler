// Static server for the web release: serves renderer/ as the web root.
//   npm run web   ->  http://localhost:8080
// Any static host works equally well (the game is plain files + web-shim.js);
// this exists so "set up a server" is one command.
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = path.normalize(path.join(ROOT, rel))
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('forbidden'); return
  }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  })
}).listen(PORT, () => console.log(`dungeon-crawler web: http://localhost:${PORT}`))
