// The corner minimap: a small canvas of its own in the HUD, north up, the
// hero in the middle. It is redrawn only when the hero steps onto another
// tile or the map changes, never every frame: the game's own canvas is not
// touched (Electron here draws in software). While a sandstorm has taken the
// map (wilds/storm.js) it shows sand-coloured haze and nothing else.
import { drawMap, mapStamp, pruneMapTiles } from './map-draw.js'
import { HAZE } from './weather.js'
import { hash } from '../wilds/rand.js'

export const MINIMAP_PX = 160
export const MINIMAP_SCALE = 2   // pixels to a tile: 80 tiles across

let last = ''

// The haze: the sand's colour with a few soft wisps of blown sand across it,
// a little lighter or darker than the haze, as on the frame (render/
// weather.js HAZE), down to the east as the desert's winds blow. The same
// picture every time (it says nothing of where the hero is), drawn once.
const WISPS = Array.from({ length: 10 }, (_, i) => {
  const h = n => hash(0, i, n, 811)
  return {
    x: h(0) * MINIMAP_PX, y: h(1) * MINIMAP_PX, len: 60 + h(2) * 60, thick: 9 + h(3) * 9,
    light: h(4) < 0.5, a: 0.35 + h(5) * 0.25, turn: Math.PI / 4 + (h(6) - 0.5) * 0.4,
  }
})
function drawHaze(g) {
  g.fillStyle = `rgb(${HAZE.colour.join(',')})`
  g.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX)
  for (const w of WISPS) {
    const rgb = (w.light ? HAZE.sandLight : HAZE.sandDark).join(',')
    g.save()
    g.translate(w.x, w.y)
    g.rotate(w.turn)
    g.scale(w.len / 2, w.thick / 2)
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1)
    grad.addColorStop(0, `rgba(${rgb},${w.a.toFixed(2)})`)
    grad.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = grad
    g.fillRect(-1, -1, 2, 2)
    g.restore()
  }
}

// `hero`: { X, Y } in world tiles, or null to hide the minimap; `haze`:
// a storm has taken the map, so it shows haze only.
export function updateMinimap(world, hero, show, { haze = false } = {}) {
  const el = document.getElementById('minimap')
  if (!el) return
  const on = !!(show && world && hero)
  if (el.hidden === on) {
    el.hidden = !on
    document.body.classList.toggle('has-minimap', on)
    last = ''
  }
  if (!on) return
  const stamp = haze ? 'haze' : `${hero.X},${hero.Y},${mapStamp(world)}`
  if (stamp === last) return
  last = stamp
  if (el.width !== MINIMAP_PX) { el.width = MINIMAP_PX; el.height = MINIMAP_PX }
  if (haze) { drawHaze(el.getContext('2d')); return }
  pruneMapTiles(world)
  drawMap(el.getContext('2d'), world, { cx: hero.X + 0.5, cy: hero.Y + 0.5, scale: MINIMAP_SCALE, w: MINIMAP_PX, h: MINIMAP_PX, hero, edge: true })
}
