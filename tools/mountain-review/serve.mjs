// Mountain rim review: draws ten generated mountain masses with the real
// ow_mtn_ tiles and the current rim rules, in a few rim/interior variants,
// so a human can click the cells that look wrong and say why. Marks are
// saved to review.json next to this script with each marked cell's tile,
// shape and neighbour mask.
//
//   node tools/mountain-review/serve.mjs   -> http://127.0.0.1:8878
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSamples, VARIANTS } from './samples.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')
const REVIEW = path.join(HERE, 'review.json')
const PORT = 8878
const SAMPLES = buildSamples()

const readReview = () => fs.existsSync(REVIEW) ? JSON.parse(fs.readFileSync(REVIEW, 'utf8')) : {}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  try {
    if (u.pathname === '/') return send(200, PAGE, 'text/html; charset=utf-8')
    if (u.pathname === '/api/samples') return send(200, JSON.stringify({ variants: VARIANTS, samples: SAMPLES }))
    if (u.pathname === '/api/review') return send(200, JSON.stringify(readReview()))
    if (u.pathname === '/api/mark' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const { id, marks, notes, best } = JSON.parse(body)
        const all = readReview()
        all[id] = { marks, notes, best, at: new Date().toISOString() }
        fs.writeFileSync(REVIEW, JSON.stringify(all, null, 2))
        send(200, '{"ok":true}')
      })
      return
    }
    const tile = /^\/tiles\/(ow_mtn_[a-z0-9_]+)\.png$/.exec(u.pathname)
    if (tile) return send(200, fs.readFileSync(path.join(TILES, tile[1] + '.png')), 'image/png')
    send(404, '{"error":"not found"}')
  } catch (e) { send(500, JSON.stringify({ error: String(e) })) }
}).listen(PORT, '127.0.0.1', () => console.log(`mountain review -> http://127.0.0.1:${PORT}`))

const PAGE = `<!doctype html><meta charset="utf-8">
<title>Mountain rim review</title>
<style>
  body { margin: 0; background: #14171a; color: #e6e8e3; font: 15px/1.5 system-ui, sans-serif; }
  header { padding: 14px 20px; border-bottom: 1px solid #2b333a; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #98a196; font-size: 13px; }
  .sample { padding: 18px 20px; border-bottom: 1px solid #2b333a; }
  .sample h2 { margin: 0 0 8px; font-size: 15px; }
  .sample h2 span { color: #98a196; font-weight: normal; margin-left: 8px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
  .variant label { display: block; font-size: 13px; color: #98a196; margin-bottom: 4px; cursor: pointer; }
  .variant label b { color: #e6e8e3; }
  .variant.best label b { color: #34d399; }
  canvas { image-rendering: pixelated; display: block; cursor: crosshair; border: 1px solid #2b333a; }
  .side { display: flex; gap: 14px; margin-top: 10px; align-items: flex-start; }
  textarea { width: 560px; min-height: 70px; box-sizing: border-box; background: #1b2025; color: #e6e8e3; border: 1px solid #2b333a; border-radius: 4px; padding: 8px; font: inherit; }
  .hint { font-family: ui-monospace, monospace; font-size: 12px; color: #98a196; min-height: 48px; white-space: pre; }
  .marks { font-family: ui-monospace, monospace; font-size: 12px; color: #f5a524; }
  .saved { color: #34d399; font-size: 12px; }
</style>
<header>
  <h1>Mountain rim review</h1>
  <p>Ten masses, each drawn three ways with the new sheet. <b>Click a cell</b> to mark it wrong (click again to unmark). <b>Click a variant's title</b> to pick the one that looks best. Hover shows the cell's tile, the shape the rule chose and which neighbours are floor. Notes per sample. Everything autosaves.</p>
</header>
<div id="list"></div>
<script>
const Z = 2, T = 16
const imgs = {}
const img = n => imgs[n] ??= Object.assign(new Image(), { src: '/tiles/' + n + '.png' })
const load = n => new Promise(r => { const i = img(n); i.complete && i.naturalWidth ? r() : (i.onload = r, i.onerror = r) })
const maskText = c => c.f ? 'floor sides: ' + (['N','E','S','W'].filter(k => c.f[k]).join(' ') || '-') + '   floor diagonals: ' + (['NE','NW','SE','SW'].filter(k => c.d[k]).join(' ') || '-') + '\\nshape: ' + c.shape : 'ground'

async function main() {
  const [{ samples }, review] = await Promise.all([fetch('/api/samples').then(r => r.json()), fetch('/api/review').then(r => r.json())])
  const names = new Set(samples.flatMap(s => s.variants.flatMap(v => v.cells.flat().flatMap(c => [c.ground, c.prop].filter(Boolean)))))
  await Promise.all([...names].map(load))
  const list = document.getElementById('list')
  for (const s of samples) {
    const state = { marks: (review[s.id]?.marks ?? []).map(m => m.variant + ':' + m.x + ',' + m.y), notes: review[s.id]?.notes ?? '', best: review[s.id]?.best ?? null }
    const el = document.createElement('div'); el.className = 'sample'
    el.innerHTML = '<h2>#' + s.id + '<span>' + s.title + '</span></h2><div class="row"></div>' +
      '<div class="side"><textarea placeholder="What is wrong / what should be there?"></textarea><div><div class="hint">hover a cell</div><div class="marks"></div><div class="saved"></div></div></div>'
    const row = el.querySelector('.row'), hint = el.querySelector('.hint'), marksEl = el.querySelector('.marks'), ta = el.querySelector('textarea'), saved = el.querySelector('.saved')
    ta.value = state.notes
    const draws = []
    let timer = null
    const save = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const marks = state.marks.map(k => { const [variant, xy] = k.split(':'); const [x, y] = xy.split(',').map(Number); return { variant, x, y, ...s.variants.find(v => v.key === variant).cells[y][x] } })
        await fetch('/api/mark', { method: 'POST', body: JSON.stringify({ id: s.id, marks, notes: ta.value, best: state.best }) })
        saved.textContent = 'saved ' + new Date().toLocaleTimeString()
      }, 300)
    }
    for (const v of s.variants) {
      const box = document.createElement('div'); box.className = 'variant' + (state.best === v.key ? ' best' : '')
      box.innerHTML = '<label><b>' + v.label + '</b>' + (state.best === v.key ? ' ✓ best' : '') + '</label><canvas width="' + s.w * T * Z + '" height="' + s.h * T * Z + '"></canvas>'
      const cv = box.querySelector('canvas'), g = cv.getContext('2d')
      const draw = () => {
        g.imageSmoothingEnabled = false
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = v.cells[y][x]; g.drawImage(img(c.ground), x * T * Z, y * T * Z, T * Z, T * Z); if (c.prop) g.drawImage(img(c.prop), x * T * Z, y * T * Z, T * Z, T * Z) }
        g.lineWidth = 2; g.strokeStyle = '#e5484d'
        for (const k of state.marks) { if (!k.startsWith(v.key + ':')) continue; const [x, y] = k.split(':')[1].split(',').map(Number); g.strokeRect(x * T * Z + 1, y * T * Z + 1, T * Z - 2, T * Z - 2) }
        g.lineWidth = 1
        marksEl.textContent = state.marks.length ? 'marked: ' + state.marks.join(' ') : ''
      }
      draws.push(draw)
      const cellAt = e => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / (T * Z)), Math.floor((e.clientY - r.top) / (T * Z))] }
      cv.addEventListener('mousemove', e => { const [x, y] = cellAt(e); const c = v.cells[y]?.[x]; if (c) hint.textContent = v.key + ' (' + x + ',' + y + ') ' + c.ground + (c.prop ? ' + ' + c.prop : '') + '\\n' + maskText(c) })
      cv.addEventListener('click', e => { const k = v.key + ':' + cellAt(e).join(','); const i = state.marks.indexOf(k); i >= 0 ? state.marks.splice(i, 1) : state.marks.push(k); draw(); save() })
      box.querySelector('label').addEventListener('click', () => {
        state.best = state.best === v.key ? null : v.key
        for (const b of row.children) { const key = b.dataset.key; b.classList.toggle('best', state.best === key); b.querySelector('label').innerHTML = '<b>' + s.variants.find(x => x.key === key).label + '</b>' + (state.best === key ? ' ✓ best' : '') }
        save()
      })
      box.dataset.key = v.key
      row.appendChild(box)
    }
    ta.addEventListener('input', save)
    list.appendChild(el)
    draws.forEach(d => d())
  }
}
main()
</script>`
