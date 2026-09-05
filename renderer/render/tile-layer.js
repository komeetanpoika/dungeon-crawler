// The cached tile layer. Drawing every on-screen cell through drawTile each
// frame — some 700 scaled sprite blits at 1024x693 — was the single largest
// frame cost with the software canvas Electron falls back to here. Instead
// the map is baked into CHUNK x CHUNK-cell offscreen images on demand and a
// frame blits one image per visible chunk. A chunk is rebaked when the
// number of explored cells in it changes (exploration only ever grows) or a
// system marks one of its cells dirty (systems/tile-dirty.js); the whole
// cache is dropped when the map identity changes, so only the current map
// is held.
//
// Fog of war (explored but out of sight) still draws per frame, since it
// moves with the player — but as one rect per horizontal run of fogged
// cells instead of one per cell.
import { TILE } from '../systems/entities.js'
import { takeDirtyTiles } from '../systems/tile-dirty.js'
import { drawTile } from './tiles.js'

export const CHUNK = 16   // cells per chunk side; 512 px at S = 32

// Stairs render even before they are explored and are never fogged: the
// descent is always something the player can see coming.
const isStair = id => id === TILE.STAIR || id === TILE.STAIRS_UP || id === TILE.STAIRS_DOWN

function viewCells(map, S, camX, camY, W, H) {
  return {
    c0: Math.max(0, Math.floor(camX / S)),
    c1: Math.min(map[0].length, Math.ceil((camX + W) / S)),
    r0: Math.max(0, Math.floor(camY / S)),
    r1: Math.min(map.length, Math.ceil((camY + H) / S)),
  }
}

function drawFogRuns(ctx, map, S, camX, camY, { c0, c1, r0, r1 }, fogAlpha) {
  ctx.fillStyle = `rgba(0,0,0,${fogAlpha})`
  for (let row = r0; row < r1; row++) {
    const cells = map[row]
    let run = -1
    for (let col = c0; col < c1; col++) {
      const t = cells[col]
      const fogged = t.explored && !t.visible && !isStair(t.tile)
      if (fogged) { if (run < 0) run = col; continue }
      if (run >= 0) { ctx.fillRect(Math.round(run * S - camX), Math.round(row * S - camY), (col - run) * S, S); run = -1 }
    }
    if (run >= 0) ctx.fillRect(Math.round(run * S - camX), Math.round(row * S - camY), (c1 - run) * S, S)
  }
}

// Bake one chunk: explored cells (and stairs) drawn at chunk-local
// coordinates over a cleared, transparent canvas so the theme background
// shows through unexplored cells. Returns the explored count it was baked at.
function bake(chunk, map, cx, cy, S, sprites) {
  const ctx = chunk.ctx
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, CHUNK * S, CHUNK * S)
  let explored = 0
  for (let r = 0; r < CHUNK; r++) {
    const cells = map[cy * CHUNK + r]
    if (!cells) break
    for (let c = 0; c < CHUNK; c++) {
      const t = cells[cx * CHUNK + c]
      if (!t) break
      if (t.explored) explored++
      else if (!isStair(t.tile)) continue
      drawTile(ctx, t.tile, c * S, r * S, S, sprites, t)
    }
  }
  chunk.explored = explored
}

function countExplored(map, cx, cy) {
  let n = 0
  for (let r = 0; r < CHUNK; r++) {
    const cells = map[cy * CHUNK + r]
    if (!cells) break
    for (let c = 0; c < CHUNK; c++) {
      const t = cells[cx * CHUNK + c]
      if (!t) break
      if (t.explored) n++
    }
  }
  return n
}

export function makeTileLayer(createCanvas) {
  const layer = {
    map: null,
    chunks: new Map(),   // "cx,cy" -> { canvas, ctx, explored }
    draw(ctx, map, sprites, S, camX, camY, W, H, fogAlpha) {
      if (map !== layer.map) { layer.map = map; layer.chunks.clear() }
      const dirty = takeDirtyTiles(map)
      if (dirty) {
        for (let i = 0; i < dirty.length; i += 2) {
          const chunk = layer.chunks.get(`${Math.floor(dirty[i] / CHUNK)},${Math.floor(dirty[i + 1] / CHUNK)}`)
          if (chunk) chunk.explored = -1   // keep the canvas, force a rebake
        }
      }
      const CS = CHUNK * S
      const cx0 = Math.max(0, Math.floor(camX / CS))
      const cx1 = Math.min(Math.ceil(map[0].length / CHUNK), Math.ceil((camX + W) / CS))
      const cy0 = Math.max(0, Math.floor(camY / CS))
      const cy1 = Math.min(Math.ceil(map.length / CHUNK), Math.ceil((camY + H) / CS))
      for (let cy = cy0; cy < cy1; cy++) {
        for (let cx = cx0; cx < cx1; cx++) {
          const key = `${cx},${cy}`
          let chunk = layer.chunks.get(key)
          if (!chunk) {
            const canvas = createCanvas()
            canvas.width = CS
            canvas.height = CS
            chunk = { canvas, ctx: canvas.getContext('2d'), explored: -1 }
            layer.chunks.set(key, chunk)
          }
          if (chunk.explored !== countExplored(map, cx, cy)) bake(chunk, map, cx, cy, S, sprites)
          ctx.drawImage(chunk.canvas, Math.round(cx * CS - camX), Math.round(cy * CS - camY))
        }
      }
      drawFogRuns(ctx, map, S, camX, camY, viewCells(map, S, camX, camY, W, H), fogAlpha)
    },
  }
  return layer
}

// The uncached path: every visible cell through drawTile each frame. Used
// where offscreen canvases are unavailable (tests without a document) and
// kept as the reference the cached layer must match.
export function makeDirectTileLayer() {
  return {
    draw(ctx, map, sprites, S, camX, camY, W, H, fogAlpha) {
      const cells = viewCells(map, S, camX, camY, W, H)
      for (let row = cells.r0; row < cells.r1; row++) {
        for (let col = cells.c0; col < cells.c1; col++) {
          const t = map[row][col]
          if (!t.explored && !isStair(t.tile)) continue
          drawTile(ctx, t.tile, Math.round(col * S - camX), Math.round(row * S - camY), S, sprites, t)
        }
      }
      drawFogRuns(ctx, map, S, camX, camY, cells, fogAlpha)
    },
  }
}
