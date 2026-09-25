// Static file handler for the web release server (tools/web-server.mjs).
// Factored out so it can be unit-tested with a fake req/res — this process
// now also hosts live PvP rooms, so a malformed request path must never
// throw inside the handler.
import * as fs from 'node:fs'
import * as path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export function makeStaticHandler(root) {
  return function staticHandler(req, res) {
    let urlPath
    // `new URL` throws on an absolute-form request target it can't parse
    // (e.g. `http://[`), and decodeURIComponent throws on a bad %-escape
    // (e.g. `/%E0`); either is untrusted input from the request line.
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname) }
    catch { res.writeHead(400); res.end('bad request'); return }
    // A decoded NUL byte (e.g. `/%00`) makes fs.readFile throw synchronously
    // (ERR_INVALID_ARG_VALUE) rather than erroring async into its callback.
    if (urlPath.includes('\0')) { res.writeHead(400); res.end('bad request'); return }
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
    const file = path.normalize(path.join(root, rel))
    if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
      res.writeHead(403); res.end('forbidden'); return
    }
    try {
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
        res.end(body)
      })
    } catch { res.writeHead(400); res.end('bad request') } // belt-and-braces: any other path that makes readFile throw synchronously
  }
}
