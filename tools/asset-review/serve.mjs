// Asset review server: renders multi-tile composite samples (current vs
// candidate assemblies) so a human can review them. Any number of options can
// be marked correct, and clicking a tile inside a picture flags that specific
// cell as wrong. Verdicts are saved to review.json next to this script.
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
        const { itemId, ...verdict } = JSON.parse(body)
        const all = readVerdicts()
        all[itemId] = { ...verdict, at: new Date().toISOString() }
        fs.writeFileSync(REVIEW, JSON.stringify(all, null, 2))
        send(200, '{"ok":true}')
      })
      return
    }
    const tile = /^\/tiles\/((?:ow|tile|road|custom)_[a-z0-9_]+)\.png$/.exec(u.pathname)
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
  header { padding: 14px 22px; border-bottom: 1px solid #2b333a; display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 19px; }
  header .hint { color: #98a196; font-size: 13px; }
  #progress { color: #98a196; font: 13px ui-monospace, monospace; margin-left: auto; }
  .item { padding: 18px 22px; border-bottom: 1px solid #2b333a; }
  .item h2 { margin: 0 0 2px; font-size: 16px; }
  .item.done h2::after { content: ' ✓'; color: #58b7c6; }
  .note { color: #98a196; font-size: 13px; max-width: 72ch; margin: 0 0 10px; }
  .options { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
  .opt { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .opt canvas { image-rendering: pixelated; border-radius: 4px; cursor: crosshair; }
  .opt .flags { color: #e5484d; font: 11px ui-monospace, monospace; min-height: 15px; }
  .opt button { font: 12px ui-monospace, monospace; max-width: 220px; text-align: left; padding: 5px 9px;
    background: #1b2025; color: #e6e8e3; border: 1px solid #2b333a; border-radius: 5px; cursor: pointer; }
  .opt button:hover { border-color: #58b7c6; }
  .opt button.picked { background: #58b7c6; color: #0d1417; border-color: #58b7c6; }
  .opt button.picked::before { content: '✓ '; }
  .extra { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .extra input { background: #1b2025; color: #e6e8e3; border: 1px solid #2b333a; border-radius: 5px;
    padding: 5px 9px; font: 13px system-ui; width: 340px; }
  .extra button { font: 12px ui-monospace, monospace; padding: 5px 9px; background: #1b2025; color: #e6e8e3;
    border: 1px solid #2b333a; border-radius: 5px; cursor: pointer; }
  .extra button.picked { background: #e5484d; color: #fff; border-color: #e5484d; }
</style>
<header><h1>Overworld asset review</h1>
  <span class="hint">toggle every option that looks right · click a tile inside a picture to flag that tile as wrong</span>
  <span id="progress"></span></header>
<div id="items"></div>
<script>
const SCALE = 5, T = 16, PAD = 1
const CELL = T * SCALE
const imgCache = {}
function loadImg(name) {
  imgCache[name] ??= new Promise((resolve) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => resolve(null) // missing tile (e.g. tt: pack gone) -> placeholder
    i.src = name.startsWith('tt:') ? '/tt/' + name.slice(3) + '.png' : '/tiles/' + name + '.png'
  })
  return imgCache[name]
}
async function drawCell(g, name, px, py) {
  const img = await loadImg(name)
  if (img) return g.drawImage(img, px, py, CELL, CELL)
  g.fillStyle = '#c633c6'
  g.fillRect(px, py, CELL, CELL)
  g.fillStyle = '#fff'
  g.font = '11px ui-monospace'
  g.fillText(name, px + 4, py + 14, CELL - 8)
}
async function draw(canvas, grid, ground, flagged) {
  const rows = grid.length, cols = Math.max(...grid.map(r => r.length))
  canvas.width = (cols + PAD * 2) * CELL
  canvas.height = (rows + PAD * 2) * CELL
  const g = canvas.getContext('2d')
  g.imageSmoothingEnabled = false
  const groundImg = await loadImg(ground)
  for (let y = 0; y < rows + PAD * 2; y++) for (let x = 0; x < cols + PAD * 2; x++)
    g.drawImage(groundImg, x * CELL, y * CELL, CELL, CELL)
  // a cell is null (ground only), a tile name, or an array of layers drawn bottom-up
  for (let y = 0; y < rows; y++) for (let x = 0; x < grid[y].length; x++) {
    const cell = grid[y][x]
    if (!cell) continue
    for (const layer of Array.isArray(cell) ? cell : [cell])
      await drawCell(g, layer, (x + PAD) * CELL, (y + PAD) * CELL)
  }
  for (const key of flagged) {
    const [x, y] = key.split(',').map(Number)
    const px = (x + PAD) * CELL, py = (y + PAD) * CELL
    g.fillStyle = 'rgba(229,72,77,0.25)'
    g.fillRect(px, py, CELL, CELL)
    g.strokeStyle = '#e5484d'
    g.lineWidth = 3
    g.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3)
    g.beginPath()
    g.moveTo(px + 8, py + 8); g.lineTo(px + CELL - 8, py + CELL - 8)
    g.moveTo(px + CELL - 8, py + 8); g.lineTo(px + 8, py + CELL - 8)
    g.stroke()
  }
}
// old single-choice verdicts from the first version of this page
function migrate(v) {
  if (!v || v.good || v.badCells) return v ?? null
  return { good: v.choice === 'none' ? [] : [v.choice], none: v.choice === 'none', badCells: {}, note: v.note ?? '' }
}
async function main() {
  const [items, raw] = await Promise.all([
    fetch('/api/items').then(r => r.json()),
    fetch('/api/verdicts').then(r => r.json()),
  ])
  const verdicts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, migrate(v)]))
  const root = document.getElementById('items')
  const reviewed = v => v && (v.good.length > 0 || v.none || Object.values(v.badCells).some(c => c.length))
  const updateProgress = () =>
    document.getElementById('progress').textContent =
      Object.values(verdicts).filter(reviewed).length + '/' + items.length + ' reviewed'
  for (const item of items) {
    const v = verdicts[item.id] ??= { good: [], none: false, badCells: {}, note: '' }
    const sec = document.createElement('section')
    sec.className = 'item'
    sec.innerHTML = '<h2>' + item.title + '</h2>' + (item.note ? '<p class="note">' + item.note + '</p>' : '')
    const opts = document.createElement('div')
    opts.className = 'options'
    const refreshDone = () => { sec.classList.toggle('done', reviewed(v)); updateProgress() }
    const save = async () => {
      await fetch('/api/verdict', { method: 'POST', body: JSON.stringify({ itemId: item.id, ...v }) })
      refreshDone()
    }
    const noneBtn = document.createElement('button')
    item.options.forEach(opt => {
      const box = document.createElement('div')
      box.className = 'opt'
      const c = document.createElement('canvas')
      const flagged = new Set(v.badCells[opt.label] ?? [])
      const flagsLine = document.createElement('span')
      flagsLine.className = 'flags'
      const refresh = () => {
        draw(c, opt.grid, item.ground || 'ow_grass_0', flagged)
        flagsLine.textContent = flagged.size ? '✕ flagged: ' + [...flagged].join('  ') : ''
      }
      c.title = 'click a tile to flag/unflag it'
      c.addEventListener('click', e => {
        const r = c.getBoundingClientRect()
        const x = Math.floor((e.clientX - r.left) / CELL) - PAD
        const y = Math.floor((e.clientY - r.top) / CELL) - PAD
        if (!opt.grid[y] || !opt.grid[y][x]) return
        const key = x + ',' + y
        flagged.has(key) ? flagged.delete(key) : flagged.add(key)
        v.badCells[opt.label] = [...flagged]
        if (!flagged.size) delete v.badCells[opt.label]
        refresh(); save()
      })
      const b = document.createElement('button')
      b.textContent = opt.label
      b.classList.toggle('picked', v.good.includes(opt.label))
      b.onclick = () => {
        const i = v.good.indexOf(opt.label)
        i >= 0 ? v.good.splice(i, 1) : v.good.push(opt.label)
        if (v.good.length) { v.none = false; noneBtn.classList.remove('picked') }
        b.classList.toggle('picked', i < 0)
        save()
      }
      refresh()
      box.append(c, b, flagsLine)
      opts.appendChild(box)
    })
    const extra = document.createElement('div')
    extra.className = 'extra'
    noneBtn.textContent = 'none of these look right'
    noneBtn.classList.toggle('picked', v.none)
    noneBtn.onclick = () => {
      v.none = !v.none
      if (v.none) {
        v.good = []
        opts.querySelectorAll('.opt button').forEach(b => b.classList.remove('picked'))
      }
      noneBtn.classList.toggle('picked', v.none)
      save()
    }
    const noteInput = document.createElement('input')
    noteInput.placeholder = 'optional note (what looks wrong / what you want instead)'
    noteInput.value = v.note
    noteInput.onchange = () => { v.note = noteInput.value; save() }
    extra.append(noneBtn, noteInput)
    sec.append(opts, extra)
    root.appendChild(sec)
    refreshDone()
  }
  updateProgress()
}
main()
</script>`

server.listen(PORT, '127.0.0.1', () => console.log(`asset review: http://127.0.0.1:${PORT} (verdicts -> ${REVIEW})`))
