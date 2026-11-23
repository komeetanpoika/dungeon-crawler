// Drawing the map of the Wilds (wilds/map.js) onto a 2D canvas: one small
// cached canvas per remembered piece, blitted enlarged, then the landmarks
// and the hero. Shared by the corner minimap and the full-screen map.
import { MAP_N, MAP_COLOURS, landmarks } from '../wilds/map.js'
import { PIECE } from '../wilds/layout.js'

export const MIST = '#12141a'
const RGB = MAP_COLOURS.map(c => (c ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : null))
const tiles = new Map()   // piece key -> { ver, canvas }

function pieceCanvas(world, key) {
  const ver = world.mapVer.get(key) ?? 0
  let t = tiles.get(key)
  if (t && t.ver === ver) return t.canvas
  if (!t) { t = { ver: -1, canvas: document.createElement('canvas') }; t.canvas.width = t.canvas.height = MAP_N; tiles.set(key, t) }
  const pic = world.map.get(key), g = t.canvas.getContext('2d'), img = g.createImageData(MAP_N, MAP_N)
  for (let i = 0; i < pic.length; i++) {
    const c = RGB[pic[i]]
    if (!c) continue
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  t.ver = ver
  return t.canvas
}

// Pictures of pieces the world has since forgotten are dropped.
export function pruneMapTiles(world) {
  for (const key of tiles.keys()) if (!world.map.has(key)) tiles.delete(key)
}

const MARK = { village: '#ffd76a', city: '#ffffff', place: '#ff8f6a' }

// Draw the map into ctx's w×h, world tile (cx, cy) in the middle, `scale`
// pixels to a tile. `hero` is { X, Y } in world tiles; `names` writes the
// landmarks' names; marks off the edge are drawn on it when `edge` is set.
export function drawMap(ctx, world, { cx, cy, scale, w, h, hero = null, names = false, edge = false }) {
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = MIST
  ctx.fillRect(0, 0, w, h)
  const left = cx - w / 2 / scale, top = cy - h / 2 / scale, size = PIECE * scale
  for (const key of world.map.keys()) {
    const [wx, wy] = key.split(',').map(Number)
    const x = Math.round((wx * PIECE - left) * scale), y = Math.round((wy * PIECE - top) * scale)
    if (x >= w || y >= h || x + size <= 0 || y + size <= 0) continue
    ctx.drawImage(pieceCanvas(world, key), x, y, size, size)
  }
  const pad = 5
  for (const m of landmarks(world)) {
    let x = (m.X - left) * scale, y = (m.Y - top) * scale
    const off = x < 0 || y < 0 || x > w || y > h
    if (off && !edge) continue
    x = Math.min(w - pad, Math.max(pad, x)); y = Math.min(h - pad, Math.max(pad, y))
    const r = m.kind === 'city' ? 4 : 3
    ctx.fillStyle = '#000'
    ctx.fillRect(Math.round(x) - r - 1, Math.round(y) - r - 1, 2 * r + 2, 2 * r + 2)
    ctx.fillStyle = MARK[m.kind]
    ctx.fillRect(Math.round(x) - r, Math.round(y) - r, 2 * r, 2 * r)
    if (names && !off) {
      ctx.font = '12px monospace'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.strokeText(m.name, x, y - r - 5)
      ctx.fillStyle = '#f3ead2'
      ctx.fillText(m.name, x, y - r - 5)
    }
  }
  if (hero) {
    const x = Math.round((hero.X + 0.5 - left) * scale), y = Math.round((hero.Y + 0.5 - top) * scale)
    ctx.fillStyle = '#000'
    ctx.fillRect(x - 3, y - 3, 6, 6)
    ctx.fillStyle = '#fff'
    ctx.fillRect(x - 2, y - 2, 4, 4)
  }
}

// How many map versions are in play: changes whenever any picture or mark does.
export function mapStamp(world) {
  let n = world.map.size * 7 + world.found.size * 13 + world.visited.length * 17
  for (const v of world.mapVer.values()) n += v
  return n
}
