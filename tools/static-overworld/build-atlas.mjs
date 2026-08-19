// Build the Overworld Atlas page: embeds the nine map PNGs as data URIs and
// pulls name/technique/notes/POIs from the map JSONs.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL = '/home/lappemikb/projects/dungeon-crawler/tools/static-overworld'
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'overworld-atlas.html')

const POI_COLORS = {
  dungeon_entrance: '#e5484d', village: '#f5a524', ruin: '#c084fc',
  camp: '#34d399', chest: '#facc15', landmark: '#38bdf8',
}
const POI_NAMES = {
  dungeon_entrance: 'dungeon entrance', village: 'village', ruin: 'ruin',
  camp: 'camp', chest: 'cache', landmark: 'landmark',
}
const BIOME = { forest: 'forest', desert: 'desert', seaside: 'sea' }
const TITLES = {
  'forest-1-clearings': 'Clearings', 'forest-2-river': 'River Split', 'forest-3-autumn': 'Autumn Highland',
  'desert-1-dunes': 'Open Erg', 'desert-2-canyon': 'Wadi Canyon', 'desert-3-lost-city': 'Lost City',
  'sea-1-suomenlinna': 'Suomenlinna', 'sea-2-fishing-village': 'Seagrave Coast', 'sea-3-archipelago': 'Archipelago',
}

const maps = []
for (const file of fs.readdirSync(path.join(TOOL, 'out/maps')).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(TOOL, 'out/maps', file), 'utf8'))
  const png = fs.readFileSync(path.join(TOOL, 'out/png', m.name + '.png'))
  const kinds = {}
  for (const p of m.pois) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1
  maps.push({
    id: m.name,
    title: TITLES[m.name] ?? m.name,
    biome: BIOME[m.biome] ?? m.biome,
    technique: m.technique,
    notes: m.notes,
    w: m.w, h: m.h,
    pois: Object.entries(kinds).map(([kind, count]) => ({ kind, count, color: POI_COLORS[kind] ?? '#fff', label: POI_NAMES[kind] ?? kind })),
    src: 'data:image/png;base64,' + png.toString('base64'),
  })
}
const order = ['forest', 'desert', 'sea']
maps.sort((a, b) => order.indexOf(a.biome) - order.indexOf(b.biome) || a.id.localeCompare(b.id))

const html = `<title>Overworld Atlas</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --bg: #edeee8;
  --surface: #f7f7f3;
  --stage: #e3e5dc;
  --ink: #1f2419;
  --muted: #5c6355;
  --line: #d3d6c9;
  --accent: #2f7f8f;
  --accent-ink: #ffffff;
  --thumb-ground: #dfe1d7;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14171a;
    --surface: #1b2025;
    --stage: #0f1215;
    --ink: #e6e8e3;
    --muted: #98a196;
    --line: #2b333a;
    --accent: #58b7c6;
    --accent-ink: #0d1417;
    --thumb-ground: #232a30;
  }
}
:root[data-theme="dark"] {
  --bg: #14171a;
  --surface: #1b2025;
  --stage: #0f1215;
  --ink: #e6e8e3;
  --muted: #98a196;
  --line: #2b333a;
  --accent: #58b7c6;
  --accent-ink: #0d1417;
  --thumb-ground: #232a30;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
.app {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: 'head head' 'rail main';
  height: 100vh;
}
header {
  grid-area: head;
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--line);
}
header h1 {
  margin: 0;
  font-family: 'Pixelify Sans', 'IBM Plex Sans', sans-serif;
  font-weight: 600;
  font-size: 26px;
  letter-spacing: 0.5px;
}
header .sub { color: var(--muted); font-size: 13px; }
header .count {
  margin-left: auto;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: var(--muted);
}

nav {
  grid-area: rail;
  overflow-y: auto;
  border-right: 1px solid var(--line);
  padding: 14px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.biome-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin: 12px 4px 2px;
}
.biome-label:first-child { margin-top: 0; }
.biome-forest { color: #4a8f4f; }
.biome-desert { color: #c07a3a; }
.biome-sea { color: #3a9ec0; }
.map-btn {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.map-btn:hover { background: var(--surface); }
.map-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.map-btn[aria-current="true"] {
  background: var(--surface);
  border-color: var(--accent);
}
.map-btn img {
  width: 64px;
  height: 44px;
  object-fit: cover;
  border-radius: 3px;
  background: var(--thumb-ground);
  image-rendering: pixelated;
}
.map-btn .t { font-weight: 500; font-size: 14px; line-height: 1.25; }
.map-btn .k {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.3;
  display: block;
  margin-top: 1px;
}

main {
  grid-area: main;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.map-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  padding: 12px 20px 0;
}
.map-head h2 {
  margin: 0;
  font-family: 'Pixelify Sans', 'IBM Plex Sans', sans-serif;
  font-weight: 600;
  font-size: 22px;
  text-wrap: balance;
}
.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
}
.dims {
  font-family: 'IBM Plex Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--muted);
}
.zoom {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.zoom button {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.zoom button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.zoom button[aria-pressed="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.map-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  padding: 6px 20px 10px;
}
.notes { color: var(--muted); font-size: 13px; max-width: 60ch; }
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  font-size: 12.5px;
  color: var(--muted);
}
.legend .dia { font-size: 11px; margin-right: 4px; }
.legend b { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }

.stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--stage);
  border-top: 1px solid var(--line);
  cursor: grab;
}
.stage.dragging { cursor: grabbing; }
.stage-inner { padding: 18px; min-width: fit-content; min-height: fit-content; }
.stage img {
  display: block;
  image-rendering: pixelated;
  border-radius: 4px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
}
.stage img.fit { max-width: 100%; height: auto; }

@media (max-width: 760px) {
  .app {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: 'head' 'rail' 'main';
    height: 100vh;
  }
  nav {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: 1px solid var(--line);
    padding: 10px 12px;
    align-items: center;
  }
  .biome-label { margin: 0 2px; writing-mode: vertical-rl; font-size: 10px; }
  .map-btn { grid-template-columns: 56px; grid-template-rows: auto auto; gap: 4px; width: 88px; flex: none; }
  .map-btn img { width: 100%; height: 40px; }
  .map-btn .t { font-size: 12px; }
  .map-btn .k { display: none; }
  .zoom { margin-left: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .map-btn, .zoom button { transition: background 120ms, border-color 120ms; }
}
</style>

<div class="app">
  <header>
    <h1>Overworld Atlas</h1>
    <span class="sub">Nine static open maps for the dungeon crawler</span>
    <span class="count" id="count"></span>
  </header>
  <nav id="rail" aria-label="Maps"></nav>
  <main>
    <div class="map-head">
      <h2 id="map-title"></h2>
      <span class="chip" id="map-chip"></span>
      <span class="dims" id="map-dims"></span>
      <div class="zoom" role="group" aria-label="Zoom">
        <button data-zoom="fit">fit</button>
        <button data-zoom="1">1&times;</button>
        <button data-zoom="2">2&times;</button>
      </div>
    </div>
    <div class="map-meta">
      <p class="notes" id="map-notes"></p>
      <div class="legend" id="map-legend"></div>
    </div>
    <div class="stage" id="stage" tabindex="0" aria-label="Map view — drag or scroll to pan">
      <div class="stage-inner"><img id="map-img" alt=""></div>
    </div>
  </main>
</div>

<script>
const MAPS = ${JSON.stringify(maps)}
const BIOME_CLASS = { forest: 'biome-forest', desert: 'biome-desert', sea: 'biome-sea' }

const rail = document.getElementById('rail')
const img = document.getElementById('map-img')
const stage = document.getElementById('stage')
let current = null
let zoom = 'fit'

let lastBiome = null
for (const m of MAPS) {
  if (m.biome !== lastBiome) {
    lastBiome = m.biome
    const label = document.createElement('div')
    label.className = 'biome-label ' + BIOME_CLASS[m.biome]
    label.textContent = m.biome
    rail.appendChild(label)
  }
  const btn = document.createElement('button')
  btn.className = 'map-btn'
  btn.dataset.id = m.id
  const thumb = document.createElement('img')
  thumb.src = m.src
  thumb.alt = ''
  thumb.loading = 'lazy'
  const text = document.createElement('span')
  const t = document.createElement('span'); t.className = 't'; t.textContent = m.title
  const k = document.createElement('span'); k.className = 'k'; k.textContent = m.technique
  text.append(t, k)
  btn.append(thumb, text)
  btn.addEventListener('click', () => select(m.id))
  rail.appendChild(btn)
}
document.getElementById('count').textContent = MAPS.length + ' maps'

function select(id) {
  current = MAPS.find(m => m.id === id)
  for (const b of rail.querySelectorAll('.map-btn'))
    b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false')
  document.getElementById('map-title').textContent = current.title
  const chip = document.getElementById('map-chip')
  chip.textContent = current.biome
  chip.className = 'chip ' + BIOME_CLASS[current.biome]
  document.getElementById('map-dims').textContent = current.w + '\\u00d7' + current.h + ' tiles \\u00b7 ' + current.technique
  document.getElementById('map-notes').textContent = current.notes
  const legend = document.getElementById('map-legend')
  legend.replaceChildren()
  for (const p of current.pois) {
    const item = document.createElement('span')
    const dia = document.createElement('span')
    dia.className = 'dia'; dia.style.color = p.color; dia.textContent = '\\u25c6'
    const n = document.createElement('b'); n.textContent = p.count
    item.append(dia, n, document.createTextNode('\\u2009' + p.label + (p.count === 1 ? '' : 's')))
    legend.appendChild(item)
  }
  img.src = current.src
  img.alt = current.title + ' \\u2014 ' + current.technique
  stage.scrollTo(0, 0)
  applyZoom()
}

function applyZoom() {
  for (const b of document.querySelectorAll('.zoom button'))
    b.setAttribute('aria-pressed', b.dataset.zoom === String(zoom) ? 'true' : 'false')
  if (zoom === 'fit') { img.classList.add('fit'); img.style.width = '' }
  else {
    img.classList.remove('fit')
    img.style.width = (current.w * 16 * Number(zoom)) + 'px'
  }
}
for (const b of document.querySelectorAll('.zoom button'))
  b.addEventListener('click', () => { zoom = b.dataset.zoom; applyZoom() })

// drag to pan
let drag = null
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return
  drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop }
  stage.classList.add('dragging')
  stage.setPointerCapture(e.pointerId)
})
stage.addEventListener('pointermove', e => {
  if (!drag) return
  stage.scrollLeft = drag.left - (e.clientX - drag.x)
  stage.scrollTop = drag.top - (e.clientY - drag.y)
})
for (const ev of ['pointerup', 'pointercancel'])
  stage.addEventListener(ev, () => { drag = null; stage.classList.remove('dragging') })

// [ and ] cycle maps
document.addEventListener('keydown', e => {
  if (e.key !== '[' && e.key !== ']') return
  const i = MAPS.indexOf(current)
  select(MAPS[(i + (e.key === ']' ? 1 : MAPS.length - 1)) % MAPS.length].id)
})

select(MAPS[0].id)
</script>
`

fs.writeFileSync(OUT, html)
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1) + 'MB')
