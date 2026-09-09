// Trance lab: the mushroom trip, side by side, over the real depth-7 forest.
// Six viewports render the same clearing at six points in the minute with the
// real Renderer, real sprites and the real riteVisuals numbers, so the ramp can
// be dialled in by eye instead of guessed. The sliders scale the live numbers
// and the readout says which constants to change to keep what you see.
//
//   node tools/trance-lab/serve.mjs   -> http://127.0.0.1:8879
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// The renderer directory is the web root, so the sprite loader's own
// './assets/tiles/...' paths resolve exactly as they do in the game.
const ROOT = path.resolve(HERE, '../../renderer')
const PORT = 8879
const TYPES = { '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' }

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, body, type) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') return send(200, PAGE, 'text/html; charset=utf-8')
    const file = path.join(ROOT, path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''))
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found', 'text/plain')
    send(200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream')
  } catch (e) { send(500, String(e), 'text/plain') }
}).listen(PORT, '127.0.0.1', () => console.log(`trance lab -> http://127.0.0.1:${PORT}`))

const PAGE = `<!doctype html><meta charset="utf-8"><title>Trance lab</title>
<style>
  body { margin: 0; background: #0d0f0c; color: #d6d3d1; font: 13px system-ui, sans-serif; }
  header { padding: 10px 14px; border-bottom: 1px solid #2a2a24; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 14px; margin: 0 10px 0 0; font-weight: 600; letter-spacing: .04em; }
  label { display: inline-flex; align-items: center; gap: 6px; }
  input[type=range] { width: 120px; }
  .val { color: #a3e635; font-variant-numeric: tabular-nums; min-width: 34px; display: inline-block; }
  #grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px; }
  figure { margin: 0; }
  figcaption { padding: 4px 2px; color: #a8a29e; }
  canvas { width: 100%; display: block; background: #000; image-rendering: pixelated; }
  #out { padding: 0 14px 16px; white-space: pre; color: #86efac; font: 12px ui-monospace, monospace; }
  button { background: #292524; color: #e7e5e4; border: 1px solid #44403c; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
</style>
<header>
  <h1>TRANCE LAB</h1>
  <label>sway <input id=sway type=range min=0.2 max=3 step=0.05 value=1><span class=val id=swayV>1.00</span>×</label>
  <label>tint <input id=tint type=range min=0 max=3 step=0.05 value=1><span class=val id=tintV>1.00</span>×</label>
  <label>rainbow <input id=rain type=range min=0 max=2 step=0.05 value=1><span class=val id=rainV>1.00</span>×</label>
  <label>hue speed <input id=hue type=range min=0 max=4 step=0.1 value=1><span class=val id=hueV>1.00</span>×</label>
  <label>blobs <input id=count type=range min=2 max=10 step=1 value=4><span class=val id=countV>4</span></label>
  <label>blob size <input id=size type=range min=0.08 max=0.6 step=0.01 value=0.32><span class=val id=sizeV>0.32</span></label>
  <label>colour comes in <input id=ease type=range min=0.5 max=5 step=0.1 value=2><span class=val id=easeV>2.0</span></label>
  <button id=pull>preview the pull</button>
</header>
<div id=grid></div>
<div id=out></div>
<script type="module">
import { Renderer } from './render/canvas.js'
import { OPEN_MAPS, OPEN_MAP_SPRITES } from './data/open-maps.js'
import { buildOpenMap } from './systems/openmap.js'
import { riteVisuals, spriteHue, TRANCE_DURATION, PULL_DURATION, pullWash } from './systems/rites.js'

const TINT_MAX = 0.18   // mirrors rites.js, for the readout

const STOPS = [0, 15, 30, 45, 55, 60]
const data = OPEN_MAPS[7]
const { map } = buildOpenMap(data, { depth: 7 })
for (const row of map) for (const c of row) { c.explored = true; c.visible = true }
const ring = data.pois.find(p => p.label === 'mushroom ring')

// A few things drawn one by one, so the per-sprite recolour has something to
// bite on next to the baked tiles.
const near = (dx, dy, e) => ({ ...e, x: ring.x + dx, y: ring.y + dy, px: (ring.x + dx) * 32 + 16, py: (ring.y + dy) * 32 + 16 })
const entities = [
  near(-3, -1, { type: 'crab', facing: 'south', hp: 3, maxHp: 3 }),
  near(3, 1, { type: 'npc', species: 'villager', facing: 'south', hp: 3, maxHp: 3 }),
  near(0, 3, { type: 'campfire', fuel: 'lumber', t: 5 }),
  near(-2, 3, { type: 'potion' }),
]

const player = { x: ring.x, y: ring.y, px: ring.x * 32 + 16, py: ring.y * 32 + 16,
  facing: 'south', hp: 8, maxHp: 8, inventory: [], attackMode: 'melee', invulnTimer: 0, talents: [] }

const views = STOPS.map(elapsed => {
  const fig = document.createElement('figure')
  const cap = document.createElement('figcaption')
  cap.textContent = elapsed === 60 ? '60 s — the call' : elapsed + ' s'
  const canvas = document.createElement('canvas')
  canvas.width = 420; canvas.height = 300
  fig.append(canvas, cap)
  grid.append(fig)
  const r = new Renderer(canvas, {})
  r.resize()   // sizes the backing store and the quarter-res trance layer with it
  // The lab drives the hue clock itself so "hue speed" can be scrubbed without
  // touching the game's own numbers.
  const wheel = r.hueWheel
  r.hueWheel = { get built() { return wheel.built }, beginFrame: () => wheel.beginFrame(), clear: () => wheel.clear(),
    variant: (key, img) => wheel.variant(key, img, spriteHue(key, hueClock(elapsed))) }
  return { elapsed, r }
})

let clock = 0, pullT = null
// How far gone (rites.js tranceLevel) and how much colour has arrived
// (tranceColour) at a fixed point in the minute. The hue clock is the integral
// of the colour ramp; each view is held at one point, so its rate is constant.
const levelAt = elapsed => Math.pow(elapsed / TRANCE_DURATION, 2)
const colourAt = elapsed => Math.pow(levelAt(elapsed), Number(ease.value))
const hueClock = elapsed => clock * colourAt(elapsed) * Number(hue.value)
const state = { map, entities, player, projectiles: [], shockwaves: [], hitEffects: [], zones: [], strikes: [],
  fireZones: [], feedback: { floats: [], bubble: null, banner: null, toasts: [] }, weather: null,
  theme: { bgColor: '#0d0f0c', tint: null, fogAlpha: 0.65 } }

for (const [el, out] of [[sway, swayV], [tint, tintV], [rain, rainV], [hue, hueV], [size, sizeV], [ease, easeV]]) {
  el.oninput = () => { out.textContent = Number(el.value).toFixed(2); report() }
}
count.oninput = () => { countV.textContent = count.value; report() }

// The lab lays out its own blobs so count and size can be scrubbed; the shape
// of the drift matches rainbowBlobs() in systems/rites.js.
const TAU = Math.PI * 2
function labBlobs(t) {
  const n = Number(count.value), rad = Number(size.value)
  return Array.from({ length: n }, (_, i) => ({
    x: 0.5 + 0.4 * Math.sin(t * (0.09 + i * 0.031) * TAU + i),
    y: 0.5 + 0.4 * Math.cos(t * (0.11 + i * 0.023) * TAU + i * 1.7),
    r: rad + rad * 0.25 * Math.sin(t * 0.17 + i),
    hue: (i * (360 / n) + t * (13 + i * 11)) % 360,
  }))
}
pull.onclick = () => { pullT = 0 }

function report() {
  out.textContent = [
    'renderer/systems/rites.js   SWAY_MAX  = ' + (8 * Number(sway.value)).toFixed(2) + '   (from 8)',
    'renderer/systems/rites.js   TINT_MAX  = ' + (0.18 * Number(tint.value)).toFixed(3) + '  (from 0.18)',
    'renderer/render/trance.js   RAINBOW_MAX = ' + (0.5 * Number(rain.value)).toFixed(3) + ' (from 0.5)',
    'renderer/systems/rites.js   spriteHue speed x ' + Number(hue.value).toFixed(2),
    'renderer/systems/rites.js   BLOB_COUNT = ' + count.value + '   blob radius = ' + Number(size.value).toFixed(2),
    'renderer/systems/rites.js   COLOUR_EASE = ' + Number(ease.value).toFixed(1) + '  (from 2)',
    '',
    'colour arrived, by the clock:  ' + [10, 20, 30, 40, 50, 60]
      .map(t => t + 's ' + (colourAt(t) * 100).toFixed(0) + '%').join('   '),
  ].join('\\n')
}
report()

let last = performance.now()
function frame(now) {
  const dt = Math.min(now - last, 100) / 1000
  last = now
  clock += dt
  if (pullT !== null) { pullT += dt; if (pullT > PULL_DURATION) pullT = null }
  for (const { elapsed, r } of views) {
    const p = { ...player, trance: Math.max(0.0001, TRANCE_DURATION - elapsed),
      tranceT: clock, tranceHue: hueClock(elapsed) }
    const fx = riteVisuals({ player: p, tripPull: pullT === null ? null : { t: pullT, dur: PULL_DURATION } })
    const colour = colourAt(elapsed)
    fx.wobbleX *= Number(sway.value); fx.wobbleY *= Number(sway.value)
    fx.colour = colour
    fx.tintAlpha = TINT_MAX * colour * Number(tint.value)
    fx.rainbow.alpha = colour * Number(rain.value)
    if (fx.level > 0) fx.rainbow.blobs = labBlobs(clock)
    state.player = p
    r.updateCamera(p, 0, fx)
    r.render(state, fx)
  }
  requestAnimationFrame(frame)
}
const r0 = views[0].r
await r0.loadSprites(OPEN_MAP_SPRITES)
for (const { r } of views) r.sprites = r0.sprites
window.lab = { views, state }
requestAnimationFrame(frame)
</script>`
