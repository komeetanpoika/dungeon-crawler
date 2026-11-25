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
// A town heard of and not reached is pencilled in: a hollow ring and its
// name in pencil (the map has no parchment; a muted grey-brown).
export const PENCIL = '#b3a58c'
// The coach's mark on a ride: a small block in a colour the land never takes.
const COACH = '#7fe3ff'

// Draw the map into ctx's w×h, world tile (cx, cy) in the middle, `scale`
// pixels to a tile (it may be a fraction: the coach's ride fits its road).
// `hero` is { X, Y } in world tiles; `names` writes the landmarks' names;
// marks off the edge are drawn on it when `edge` is set. `ride` is the
// coach's: { route, X, Y }, its road (pieces, wilds/roads.js) drawn dotted
// over whatever is or is not seen, and the coach at world tile (X, Y) on top.
export function drawMap(ctx, world, { cx, cy, scale, w, h, hero = null, names = false, edge = false, ride = null }) {
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = MIST
  ctx.fillRect(0, 0, w, h)
  const left = cx - w / 2 / scale, top = cy - h / 2 / scale
  for (const key of world.map.keys()) {
    const [wx, wy] = key.split(',').map(Number)
    // both edges rounded, so pieces meet without a seam at any scale
    const x = Math.round((wx * PIECE - left) * scale), y = Math.round((wy * PIECE - top) * scale)
    const x1 = Math.round(((wx + 1) * PIECE - left) * scale), y1 = Math.round(((wy + 1) * PIECE - top) * scale)
    if (x >= w || y >= h || x1 <= 0 || y1 <= 0) continue
    ctx.drawImage(pieceCanvas(world, key), x, y, x1 - x, y1 - y)
  }
  const pad = 5
  for (const m of landmarks(world)) {
    let x = (m.X - left) * scale, y = (m.Y - top) * scale
    const off = x < 0 || y < 0 || x > w || y > h
    if (off && !edge) continue
    x = Math.min(w - pad, Math.max(pad, x)); y = Math.min(h - pad, Math.max(pad, y))
    const heard = m.kind === 'heard'
    const r = m.kind === 'city' ? 4 : 3
    if (heard) {
      ctx.beginPath()
      ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2)
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.stroke()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = PENCIL
      ctx.stroke()
    } else {
      ctx.fillStyle = '#000'
      ctx.fillRect(Math.round(x) - r - 1, Math.round(y) - r - 1, 2 * r + 2, 2 * r + 2)
      ctx.fillStyle = MARK[m.kind]
      ctx.fillRect(Math.round(x) - r, Math.round(y) - r, 2 * r, 2 * r)
    }
    if (names && !off) {
      ctx.font = '12px monospace'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.strokeText(m.name, x, y - r - 5)
      ctx.fillStyle = heard ? PENCIL : '#f3ead2'
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
  if (ride) drawRide(ctx, ride, left, top, scale)
}

// The road from the middle of each piece to the next, dotted in pencil over
// a dark rim, and the coach on it.
function drawRide(ctx, { route, X, Y }, left, top, scale) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.setLineDash([1, 6])
  ctx.beginPath()
  route.forEach((p, i) => {
    const x = (p.wx * PIECE + PIECE / 2 - left) * scale, y = (p.wy * PIECE + PIECE / 2 - top) * scale
    if (i) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  })
  ctx.lineWidth = 5
  ctx.strokeStyle = '#000'
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = PENCIL
  ctx.stroke()
  ctx.restore()
  const x = Math.round((X - left) * scale), y = Math.round((Y - top) * scale)
  ctx.fillStyle = '#000'
  ctx.fillRect(x - 6, y - 5, 12, 10)
  ctx.fillStyle = COACH
  ctx.fillRect(x - 5, y - 4, 10, 8)
}

// How many map versions are in play: changes whenever any picture or mark does.
export function mapStamp(world) {
  let n = world.map.size * 7 + world.found.size * 13 + world.visited.length * 17 + world.heard.size * 19
  for (const v of world.mapVer.values()) n += v
  return n
}
