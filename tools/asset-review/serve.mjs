// Asset review server: renders multi-tile composite samples (current vs
// candidate assemblies) so a human can pick the right one per item.
// Verdicts are saved to review.json next to this script.
//
//   node tools/asset-review/serve.mjs        -> http://127.0.0.1:8877
//
// Candidate cells reference Tiny Town source tiles ('tt:N') served from the
// downloaded pack; point TT_DIR at <pack>/Tiles if the default is gone.
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ITEMS } from './composites.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')
const TT_DIR = process.env.TT_DIR ??
  '/tmp/claude-1000/-home-lappemikb-projects-dungeon-crawler/41619199-0c12-42ea-9079-2ab910443468/scratchpad/tiny-town-x/Tiles'
const REVIEW = path.join(HERE, 'review.json')
const PORT = 8877

const readVerdicts = () => fs.existsSync(REVIEW) ? JSON.parse(fs.readFileSync(REVIEW, 'utf8')) : {}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  try {
    if (u.pathname === '/') return send(200, PAGE, 'text/html; charset=utf-8')
    if (u.pathname === '/api/items') return send(200, JSON.stringify(ITEMS))
    if (u.pathname === '/api/verdicts') return send(200, JSON.stringify(readVerdicts()))
    if (u.pathname === '/api/verdict' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const v = JSON.parse(body)
        const all = readVerdicts()
        all[v.itemId] = { choice: v.choice, note: v.note ?? '', at: new Date().toISOString() }
        fs.writeFileSync(REVIEW, JSON.stringify(all, null, 2))
        send(200, '{"ok":true}')
      })
      return
    }
    const tile = /^\/tiles\/(ow_[a-z0-9_]+)\.png$/.exec(u.pathname)
    if (tile) return send(200, fs.readFileSync(path.join(TILES, tile[1] + '.png')), 'image/png')
    const tt = /^\/tt\/(\d+)\.png$/.exec(u.pathname)
    if (tt) return send(200, fs.readFileSync(path.join(TT_DIR, `tile_${String(tt[1]).padStart(4, '0')}.png`)), 'image/png')
    send(404, '{"error":"not found"}')
  } catch (e) {
    send(500, JSON.stringify({ error: String(e) }))
  }
})

const PAGE = `<!doctype html><meta charset="utf-8">
<title>Asset review</title>
<style>
  body { margin: 0; background: #14171a; color: #e6e8e3; font: 15px/1.5 system-ui, sans-serif; }
  header { padding: 14px 22px; border-bottom: 1px solid #2b333a; display: flex; align-items: baseline; gap: 14px; }
  h1 { margin: 0; font-size: 19px; }
  #progress { color: #98a196; font: 13px ui-monospace, monospace; margin-left: auto; }
  .item { padding: 18px 22px; border-bottom: 1px solid #2b333a; }
  .item h2 { margin: 0 0 2px; font-size: 16px; }
  .item.done h2::after { content: ' ✓'; color: #58b7c6; }
  .note { color: #98a196; font-size: 13px; max-width: 72ch; margin: 0 0 10px; }
  .options { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
  .opt { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .opt canvas { image-rendering: pixelated; border-radius: 4px; }
  .opt button { font: 12px ui-monospace, monospace; max-width: 220px; text-align: left; padding: 5px 9px;
    background: #1b2025; color: #e6e8e3; border: 1px solid #2b333a; border-radius: 5px; cursor: pointer; }
  .opt button:hover { border-color: #58b7c6; }
  .opt button.picked { background: #58b7c6; color: #0d1417; border-color: #58b7c6; }
  .extra { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .extra input { background: #1b2025; color: #e6e8e3; border: 1px solid #2b333a; border-radius: 5px;
    padding: 5px 9px; font: 13px system-ui; width: 340px; }
  .extra button { font: 12px ui-monospace, monospace; padding: 5px 9px; background: #1b2025; color: #e6e8e3;
    border: 1px solid #2b333a; border-radius: 5px; cursor: pointer; }
  .extra button.picked { background: #e5484d; color: #fff; border-color: #e5484d; }
</style>
<header><h1>Overworld asset review</h1>
  <span style="color:#98a196;font-size:13px">pick the assembly that looks right — verdicts save instantly</span>
  <span id="progress"></span></header>
<div id="items"></div>
<script>
const SCALE = 5, T = 16
const imgCache = {}
function loadImg(name) {
  imgCache[name] ??= new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('missing tile ' + name))
    i.src = name.startsWith('tt:') ? '/tt/' + name.slice(3) + '.png' : '/tiles/' + name + '.png'
  })
  return imgCache[name]
}
async function draw(canvas, grid, ground) {
  const rows = grid.length, cols = Math.max(...grid.map(r => r.length))
  const padX = 1, padY = 1
  canvas.width = (cols + padX * 2) * T * SCALE
  canvas.height = (rows + padY * 2) * T * SCALE
  const g = canvas.getContext('2d')
  g.imageSmoothingEnabled = false
  const groundImg = await loadImg(ground)
  for (let y = 0; y < rows + padY * 2; y++) for (let x = 0; x < cols + padX * 2; x++)
    g.drawImage(groundImg, x * T * SCALE, y * T * SCALE, T * SCALE, T * SCALE)
  for (let y = 0; y < rows; y++) for (let x = 0; x < grid[y].length; x++)
    if (grid[y][x]) g.drawImage(await loadImg(grid[y][x]), (x + padX) * T * SCALE, (y + padY) * T * SCALE, T * SCALE, T * SCALE)
}
async function main() {
  const [items, verdicts] = await Promise.all([
    fetch('/api/items').then(r => r.json()),
    fetch('/api/verdicts').then(r => r.json()),
  ])
  const root = document.getElementById('items')
  const updateProgress = () =>
    document.getElementById('progress').textContent = Object.keys(verdicts).length + '/' + items.length + ' reviewed'
  for (const item of items) {
    const sec = document.createElement('section')
    sec.className = 'item' + (verdicts[item.id] ? ' done' : '')
    sec.innerHTML = '<h2>' + item.title + '</h2>' + (item.note ? '<p class="note">' + item.note + '</p>' : '')
    const opts = document.createElement('div')
    opts.className = 'options'
    const buttons = []
    const save = async (choice, note) => {
      await fetch('/api/verdict', { method: 'POST', body: JSON.stringify({ itemId: item.id, choice, note }) })
      verdicts[item.id] = { choice }
      sec.classList.add('done')
      buttons.forEach(b => b.classList.toggle('picked', b.dataset.choice === choice))
      updateProgress()
    }
    item.options.forEach(opt => {
      const box = document.createElement('div')
      box.className = 'opt'
      const c = document.createElement('canvas')
      draw(c, opt.grid, item.ground || 'ow_grass_0')
      const b = document.createElement('button')
      b.textContent = opt.label
      b.dataset.choice = opt.label
      if (verdicts[item.id]?.choice === opt.label) b.classList.add('picked')
      b.onclick = () => save(opt.label, noteInput.value)
      buttons.push(b)
      box.append(c, b)
      opts.appendChild(box)
    })
    const extra = document.createElement('div')
    extra.className = 'extra'
    const noneBtn = document.createElement('button')
    noneBtn.textContent = 'none of these — see note'
    noneBtn.dataset.choice = 'none'
    if (verdicts[item.id]?.choice === 'none') noneBtn.classList.add('picked')
    buttons.push(noneBtn)
    const noteInput = document.createElement('input')
    noteInput.placeholder = 'optional note (what looks wrong / what you want instead)'
    noteInput.onchange = () => { if (verdicts[item.id]) save(verdicts[item.id].choice, noteInput.value) }
    noneBtn.onclick = () => save('none', noteInput.value)
    extra.append(noneBtn, noteInput)
    sec.append(opts, extra)
    root.appendChild(sec)
  }
  updateProgress()
}
main()
</script>`

server.listen(PORT, '127.0.0.1', () => console.log(`asset review: http://127.0.0.1:${PORT} (verdicts -> ${REVIEW})`))
