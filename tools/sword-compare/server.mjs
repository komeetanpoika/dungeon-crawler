// Tiny comparison server for sword pixel-art variants.
// Serves the pixelizer page, the source drawing, reference game tiles, and
// accepts POST /save to write chosen variants to tools/sword-compare/out/.
//   node tools/sword-compare/server.mjs   ->  http://localhost:8123
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.join(__dirname, 'out')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8123

const ROUTES = {
  '/': () => ({ type: 'text/html', body: fs.readFileSync(path.join(__dirname, 'index.html')) }),
  '/miekka.png': () => ({ type: 'image/png', body: fs.readFileSync(path.join(ROOT, 'miekka_croppedcleaned.png')) }),
  '/ref/dagger.png': () => ({ type: 'image/png', body: fs.readFileSync(path.join(ROOT, 'renderer/assets/tiles/tile_0103.png')) }),
  '/ref/sword.png': () => ({ type: 'image/png', body: fs.readFileSync(path.join(ROOT, 'renderer/assets/tiles/tile_0104.png')) }),
  '/ref/longsword.png': () => ({ type: 'image/png', body: fs.readFileSync(path.join(ROOT, 'renderer/assets/tiles/tile_0106.png')) }),
  '/ref/axe.png': () => ({ type: 'image/png', body: fs.readFileSync(path.join(ROOT, 'renderer/assets/tiles/tile_0118.png')) }),
}

http.createServer((req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/save') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        try {
          const { name, dataURL } = JSON.parse(body)
          const safe = String(name).replace(/[^a-z0-9_-]/gi, '_')
          const b64 = String(dataURL).replace(/^data:image\/png;base64,/, '')
          fs.mkdirSync(OUT, { recursive: true })
          const file = path.join(OUT, `${safe}.png`)
          fs.writeFileSync(file, Buffer.from(b64, 'base64'))
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ saved: file }))
          console.log('saved', file)
        } catch (e) {
          res.writeHead(400); res.end(String(e))
        }
      })
      return
    }
    const route = ROUTES[req.url]
    if (!route) { res.writeHead(404); res.end('not found'); return }
    const { type, body } = route()
    res.writeHead(200, { 'content-type': type })
    res.end(body)
  } catch (e) {
    res.writeHead(500); res.end(String(e))
  }
}).listen(PORT, () => console.log(`sword-compare: http://localhost:${PORT}`))
