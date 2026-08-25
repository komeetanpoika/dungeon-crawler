// Audition server: node tools/sfx-audition/serve.mjs  → http://localhost:8123
// Serves the repo root so the page can import renderer/ modules directly.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.cwd()
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }

createServer(async (req, res) => {
  const path = req.url === '/' ? '/tools/sfx-audition/index.html' : decodeURIComponent(req.url.split('?')[0])
  const file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}).listen(8123, () => console.log('sfx audition → http://localhost:8123'))
