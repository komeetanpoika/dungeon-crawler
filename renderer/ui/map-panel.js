// The full map: a pause overlay. The stick or the arrows pan it (so does a
// drag), red zooms in, green zooms out, yellow comes back to the hero. The
// map key and Escape close it, in game.js.
import { drawMap } from '../render/map-draw.js'

export const ZOOMS = [1, 3]      // pixels to a tile
const PAN = 420                  // screen pixels a second while a direction is held
const DIRS = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] }

let open = null   // { world, hero, cx, cy, zoom, held, raf, t, handlers... }

const el = () => document.getElementById('map-overlay')

function draw() {
  const canvas = el().querySelector('canvas')
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  drawMap(canvas.getContext('2d'), open.world, { cx: open.cx, cy: open.cy, scale: ZOOMS[open.zoom], w, h, hero: open.hero, names: true, edge: true })
}

function labels() {
  const { opts, zoom } = open
  const key = name => (opts.touch || !opts.keys?.[name] ? '' : `<kbd>${opts.keys[name]}</kbd>`)
  const one = (name, text, off) => `<span class="inv-btn ${name}${off ? ' off' : ''}" data-btn="${name}"><b></b><em>${text}</em>${key(name)}</span>`
  el().querySelector('.inv-what').innerHTML =
    one('blue', '—', true) + one('red', 'Zoom in', zoom === ZOOMS.length - 1) + one('green', 'Zoom out', zoom === 0) + one('yellow', 'Find me', false)
    + (opts.touch ? '' : `<span class="inv-close">Close<kbd>${opts.keys?.close ?? 'M'}</kbd></span>`)
  el().querySelectorAll('[data-btn]').forEach(n => n.addEventListener('click', () => press(n.dataset.btn)))
  el().querySelector('.inv-close')?.addEventListener('click', () => open?.onClose())
}

function press(name) {
  if (!open) return
  if (name === 'red') open.zoom = Math.min(ZOOMS.length - 1, open.zoom + 1)
  else if (name === 'green') open.zoom = Math.max(0, open.zoom - 1)
  else if (name === 'yellow') { open.cx = open.hero.X + 0.5; open.cy = open.hero.Y + 0.5 }
  else return
  labels()
  draw()
}

function tick(now) {
  if (!open) return
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

// `hero`: { X, Y } in world tiles. `opts`: { touch, keys: { red, green, yellow, close } }.
export function showMap(world, hero, { onClose }, opts = {}) {
  hideMap()
  const root = el()
  root.className = opts.touch ? 'touch' : ''
  root.innerHTML = '<canvas></canvas><div class="inv-what"></div>'
  root.style.display = 'block'
  open = { world, hero, cx: hero.X + 0.5, cy: hero.Y + 0.5, zoom: ZOOMS.length - 1, held: new Set(), t: performance.now(), opts, onClose }
  const swallow = e => { e.preventDefault(); e.stopImmediatePropagation() }
  open.down = (e) => {
    if (DIRS[e.key]) open.held.add(e.key)
    else if (e.key === ' ' || e.key === 'Enter') { if (!e.repeat) press('red') }
    else if (e.key === 'q' || e.key === 'Q') { if (!e.repeat) press('green') }
    else if (e.key === 'Shift') { if (!e.repeat) press('yellow') }
    else if (e.key === 'f' || e.key === 'F') { /* the blue button does nothing here */ }
    else return   // the map key and Escape close it, in game.js
    swallow(e)
  }
  open.up = (e) => { open?.held.delete(e.key) }
  window.addEventListener('keydown', open.down, true)   // capture: outrank game key handlers
  window.addEventListener('keyup', open.up, true)
  open.resize = () => draw()
  window.addEventListener('resize', open.resize)
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

export function hideMap() {
  if (!open) return
  window.removeEventListener('keydown', open.down, true)
  window.removeEventListener('keyup', open.up, true)
  window.removeEventListener('resize', open.resize)
  cancelAnimationFrame(open.raf)
  open = null
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}

export const mapView = () => (open ? { cx: open.cx, cy: open.cy, zoom: open.zoom } : null)
