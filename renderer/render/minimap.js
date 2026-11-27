// The corner minimap: a small canvas of its own in the HUD, north up, the
// hero in the middle. It is redrawn only when the hero steps onto another
// tile or the map changes, never every frame: the game's own canvas is not
// touched (Electron here draws in software). While a sandstorm has taken the
// map (wilds/storm.js) it shows sand-coloured haze and nothing else.
import { drawMap, mapStamp, pruneMapTiles } from './map-draw.js'

export const MINIMAP_PX = 160
export const MINIMAP_SCALE = 2   // pixels to a tile: 80 tiles across

let last = ''

// The haze: the sand's colour with streaks of blown sand across it, the
// same every time (it says nothing of where the hero is).
const HAZE = '#c9a971'
const STREAKS = Array.from({ length: 22 }, (_, i) => {
  const h = (n) => { const x = Math.sin((i + 1) * n) * 43758.5453; return x - Math.floor(x) }
  return { x: h(12.9898) * MINIMAP_PX, y: h(78.233) * MINIMAP_PX, len: 18 + h(37.719) * 46, light: h(9.151) < 0.6, a: 0.18 + h(5.37) * 0.3 }
})
function drawHaze(g) {
  g.fillStyle = HAZE
  g.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX)
  for (const s of STREAKS) {
    g.fillStyle = s.light ? `rgba(246,226,182,${s.a.toFixed(2)})` : `rgba(140,106,64,${s.a.toFixed(2)})`
    // a little down to the east, as the desert's wind blows
    for (let i = 0; i < s.len; i += 4) g.fillRect(Math.round(s.x + i) % MINIMAP_PX, Math.round(s.y + i * 0.4) % MINIMAP_PX, 4, 2)
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
