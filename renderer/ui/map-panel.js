// The full map: a pause overlay. The stick or the arrows pan it (so does a
// drag), red zooms in, green zooms out, yellow comes back to the hero. The
// map key and Escape close it, in game.js.
//
// The coach's ride (showRide) borrows it: the map opens by itself over the
// road between two towns and the coach's mark travels it; nothing pans or
// zooms, and any key, button or tap ends the ride at once.
import { drawMap } from '../render/map-draw.js'
import { PIECE } from '../wilds/layout.js'
import { rideAt, RIDE_SECONDS } from '../wilds/coach.js'

export const ZOOMS = [1, 3]      // pixels to a tile
const PAN = 420                  // screen pixels a second while a direction is held
const DIRS = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] }
// screen pixels kept clear round the road on a ride (the towns' names sit above their marks)
const RIDE_PAD = 48

// open: { world, hero, cx, cy, zoom, held, raf, t, opts, onClose, handlers... },
// and on a ride also ride: { route, from, to, start, onDone }
let open = null

const el = () => document.getElementById('map-overlay')

function draw() {
  const canvas = el().querySelector('canvas')
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const ctx = canvas.getContext('2d')
  const ride = open.ride
  if (ride) {
    const v = rideView(ride.route, ride.from, ride.to, w, h)
    const at = rideAt(ride.route, (performance.now() - ride.start) / 1000 / RIDE_SECONDS)
    drawMap(ctx, open.world, { cx: v.cx, cy: v.cy, scale: v.scale, w, h, names: true, edge: true, ride: { route: ride.route, X: at.X, Y: at.Y } })
    return
  }
  drawMap(ctx, open.world, { cx: open.cx, cy: open.cy, scale: ZOOMS[open.zoom], w, h, hero: open.hero, names: true, edge: true })
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// The buttons. On a ride every one is off (greyed) and pressing any ends the ride.
function labels() {
  const { opts, zoom, ride } = open
  const key = name => (ride || opts.touch || !opts.keys?.[name] ? '' : `<kbd>${esc(opts.keys[name])}</kbd>`)
  const one = (name, text, off) => `<span class="inv-btn ${name}${off || ride ? ' off' : ''}" data-btn="${name}"><b></b><em>${text}</em>${key(name)}</span>`
  el().querySelector('.inv-what').innerHTML =
    one('red', 'Zoom in', zoom === ZOOMS.length - 1) + one('green', 'Zoom out', zoom === 0) + one('yellow', 'Find me', false)
    + (opts.touch ? '' : `<span class="inv-close">Close${ride ? '' : `<kbd>${esc(opts.keys?.close ?? 'M')}</kbd>`}</span>`)
  el().querySelectorAll('[data-btn]').forEach(n => n.addEventListener('click', () => press(n.dataset.btn)))
  el().querySelector('.inv-close')?.addEventListener('click', () => open?.onClose())
}

function press(name) {
  if (!open) return
  if (open.ride) { endRide(); return }
  if (name === 'red') open.zoom = Math.min(ZOOMS.length - 1, open.zoom + 1)
  else if (name === 'green') open.zoom = Math.max(0, open.zoom - 1)
  else if (name === 'yellow') { open.cx = open.hero.X + 0.5; open.cy = open.hero.Y + 0.5 }
  else return
  labels()
  draw()
}

function tick(now) {
  if (!open) return
  if (open.ride) {
    if (now - open.ride.start >= RIDE_SECONDS * 1000) { endRide(); return }
    draw()
    open.raf = requestAnimationFrame(tick)
    return
  }
  const dt = Math.min(0.1, (now - open.t) / 1000)
  open.t = now
  let dx = 0, dy = 0
  for (const k of open.held) { dx += DIRS[k][0]; dy += DIRS[k][1] }
  if (dx || dy) {
    const step = PAN * dt / ZOOMS[open.zoom]
    open.cx += Math.sign(dx) * step
    open.cy += Math.sign(dy) * step
    draw()
  }
  open.raf = requestAnimationFrame(tick)
}

const swallow = e => { e.preventDefault(); e.stopImmediatePropagation() }

// The overlay put up, empty: a canvas and the button bar.
function mount(touch) {
  hideMap()
  const root = el()
  root.className = touch ? 'touch' : ''
  root.innerHTML = '<canvas></canvas><div class="inv-what"></div>'
  root.style.display = 'block'
  document.body.classList.add('pad-panel')
  return root
}

// The key handlers (capture: they outrank the game's), and a redraw on a resize.
function listen() {
  window.addEventListener('keydown', open.down, true)
  window.addEventListener('keyup', open.up, true)
  open.resize = () => draw()
  window.addEventListener('resize', open.resize)
}

// `hero`: { X, Y } in world tiles. `opts`: { touch, keys: { red, green, yellow, close } }.
export function showMap(world, hero, { onClose }, opts = {}) {
  const root = mount(opts.touch)
  open = { world, hero, cx: hero.X + 0.5, cy: hero.Y + 0.5, zoom: ZOOMS.length - 1, held: new Set(), t: performance.now(), opts, onClose }
  open.down = (e) => {
    if (DIRS[e.key]) open.held.add(e.key)
    else if (e.key === ' ' || e.key === 'Enter') { if (!e.repeat) press('red') }
    else if (e.key === 'q' || e.key === 'Q') { if (!e.repeat) press('green') }
    else if (e.key === 'Shift') { if (!e.repeat) press('yellow') }
    else if (e.key === 'f' || e.key === 'F') { /* the blue button has no job here, and must not act in the world */ }
    else return   // the map key and Escape close it, in game.js
    swallow(e)
  }
  open.up = (e) => { open?.held.delete(e.key) }
  listen()
  // a drag pans
  const canvas = root.querySelector('canvas')
  let grab = null
  canvas.addEventListener('pointerdown', e => { grab = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId) })
  canvas.addEventListener('pointermove', e => {
    if (!open || !grab || e.pointerId !== grab.id) return
    open.cx -= (e.clientX - grab.x) / ZOOMS[open.zoom]; open.cy -= (e.clientY - grab.y) / ZOOMS[open.zoom]
    grab.x = e.clientX; grab.y = e.clientY
    draw()
  })
  const drop = e => { if (grab && e.pointerId === grab.id) grab = null }
  canvas.addEventListener('pointerup', drop)
  canvas.addEventListener('pointercancel', drop)
  labels()
  draw()
  open.raf = requestAnimationFrame(tick)
}

// Where the ride's map looks and how near: centred between the two towns
// (`from`, `to`: their marks, world tiles), as near as the full map's nearest
// zoom and no nearer than shows both towns and every piece of the road with
// RIDE_PAD to spare in a w×h canvas. Pure.
export function rideView(route, from, to, w, h) {
  const cx = (from.X + to.X) / 2, cy = (from.Y + to.Y) / 2
  let rx = 1, ry = 1
  for (const p of [...route.map(r => ({ X: r.wx * PIECE + PIECE / 2, Y: r.wy * PIECE + PIECE / 2 })), from, to]) {
    rx = Math.max(rx, Math.abs(p.X - cx))
    ry = Math.max(ry, Math.abs(p.Y - cy))
  }
  const fit = Math.min((w / 2 - RIDE_PAD) / rx, (h / 2 - RIDE_PAD) / ry)
  return { cx, cy, scale: Math.min(ZOOMS.at(-1), Math.max(0.05, fit)) }
}

// The coach's ride: `route` the road's pieces (wilds/roads.js), `from` and
// `to` the two towns' marks on the map in world tiles (wilds/map.js
// landmarks; else the road's ends, wilds/coach.js rideAt at 0 and 1). The
// mark travels the road over RIDE_SECONDS; then, or at once on any key
// press, button or tap, the map closes and onDone is called. Land not seen
// stays blank under the dotted road. `opts`: { touch } (where the buttons sit).
export function showRide(world, { route, from, to }, { onDone }, opts = {}) {
  const root = mount(opts.touch)
  open = { world, hero: null, zoom: ZOOMS.length - 1, held: new Set(), opts, onClose: endRide,
    ride: { route, from, to, start: performance.now(), onDone } }
  open.down = (e) => {
    swallow(e)
    if (!e.repeat) endRide()   // a key held from before the ride is not a press
  }
  open.up = () => {}           // a key let go reaches the game: nothing stays held after the ride
  listen()
  root.querySelector('canvas').addEventListener('pointerdown', () => endRide())
  labels()
  draw()
  open.raf = requestAnimationFrame(tick)
}

function endRide() {
  const done = open?.ride?.onDone
  if (!done) return
  hideMap()
  done()
}

export function hideMap() {
  if (!open) return
  window.removeEventListener('keydown', open.down, true)
  window.removeEventListener('keyup', open.up, true)
  window.removeEventListener('resize', open.resize)
  cancelAnimationFrame(open.raf)
  open = null
  document.body.classList.remove('pad-panel')
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}

export const mapView = () => (open ? { cx: open.cx, cy: open.cy, zoom: open.zoom } : null)
