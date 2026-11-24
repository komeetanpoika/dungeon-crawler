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
//
// Cells that are walked under (`over`, wilds/over.js: a roof's top row, a
// gate's arch) are baked in two parts: their ground with the rest, and what
// stands on them into a second image of the chunk, its `top`, which
// drawOver blits after the people. A chunk without such a cell has no top.
// Only the strips of the top that hold anything are blitted (`top.rects`, one
// per run of such cells along a row): a roof's first row is a few cells of a
// chunk, and a blit of the whole see-through image cost a street of houses a
// fifth of its frames on the software canvas.
// Their fog is laid in drawOver too, once over ground and top together.
import { TILE } from '../systems/entities.js'
import { takeDirtyTiles } from '../systems/tile-dirty.js'
import { drawTile } from './tiles.js'

export const CHUNK = 16   // cells per chunk side; 512 px at S = 32
// A baked chunk is a megabyte of canvas. Every map before the Wilds had at
// most a few dozen chunks; a 240x240 window has 225, so the cache drops the
// ones farthest from the view once it holds more than this (counted in
// canvases: a chunk with a top is two).
export const MAX_CHUNKS = 64
const KEEP_CHUNKS = 48

// A mushroom trip recolours the world itself. The bakes stay in their own
// colours — they outlive the trip — and each chunk keeps a hue-rotated copy
// beside it, rebuilt a couple of chunks a frame so the software canvas never
// stalls on a wall of filtered blits. The whole world turns as one: giving
// chunks their own hues drew a hard 512-px seam across the ground, which reads
// as a broken renderer rather than as a trip. Colour varies across the view
// through the rainbow layer instead, which is smooth.
const HUE_STEPS = 12
const STEP_DEG = 360 / HUE_STEPS
export const HUE_BUDGET = 2   // chunks recoloured per frame

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

// `over`: the fog of the cells walked under (drawOver) or of all the others (draw)
function drawFogRuns(ctx, map, S, camX, camY, { c0, c1, r0, r1 }, fogAlpha, over = false) {
  ctx.fillStyle = `rgba(0,0,0,${fogAlpha})`
  for (let row = r0; row < r1; row++) {
    const cells = map[row]
    let run = -1
    for (let col = c0; col < c1; col++) {
      const t = cells[col]
      const fogged = t.explored && !t.visible && !isStair(t.tile) && !t.over === !over
      if (fogged) { if (run < 0) run = col; continue }
      if (run >= 0) { ctx.fillRect(Math.round(run * S - camX), Math.round(row * S - camY), (col - run) * S, S); run = -1 }
    }
    if (run >= 0) ctx.fillRect(Math.round(run * S - camX), Math.round(row * S - camY), (c1 - run) * S, S)
  }
}

// Bake one chunk: explored cells (and stairs) drawn at chunk-local
// coordinates over a cleared, transparent canvas so the theme background
// shows through unexplored cells. Returns the explored count it was baked at.
function bake(chunk, map, cx, cy, S, sprites, createCanvas) {
  const ctx = chunk.ctx
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, CHUNK * S, CHUNK * S)
  let explored = 0, tops = null
  for (let r = 0; r < CHUNK; r++) {
    const cells = map[cy * CHUNK + r]
    if (!cells) break
    for (let c = 0; c < CHUNK; c++) {
      const t = cells[cx * CHUNK + c]
      if (!t) break
      if (t.explored) explored++
      else if (!isStair(t.tile)) continue
      drawTile(ctx, t.tile, c * S, r * S, S, sprites, t, 'under')
      if (t.over) (tops ??= []).push(c, r, t)
    }
  }
  chunk.explored = explored
  chunk.huedAt = -1   // any trip colour over this bake is now stale
  bakeTop(chunk, tops, S, sprites, createCanvas)
}

// The chunk's second image: what stands on its walked-under cells. Kept only
// while the chunk has such a cell in view of memory.
function bakeTop(chunk, tops, S, sprites, createCanvas) {
  if (!tops) { chunk.top = null; return }
  let top = chunk.top
  if (!top) {
    const canvas = createCanvas()
    canvas.width = CHUNK * S
    canvas.height = CHUNK * S
    top = chunk.top = { canvas, ctx: canvas.getContext('2d') }
  }
  top.ctx.imageSmoothingEnabled = false
  top.ctx.clearRect(0, 0, CHUNK * S, CHUNK * S)
  // (the cells come row by row, west to east: a run is cells side by side)
  const rects = top.rects = []
  for (let i = 0; i < tops.length; i += 3) {
    const c = tops[i], r = tops[i + 1], last = rects.at(-1)
    drawTile(top.ctx, tops[i + 2].tile, c * S, r * S, S, sprites, tops[i + 2], 'over')
    if (last && last.y === r * S && last.x + last.w === c * S) last.w += S
    else rects.push({ x: c * S, y: r * S, w: S, h: S })
  }
  top.explored = chunk.explored   // (what its trip colour is checked against)
  top.huedAt = -1
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

// The recoloured copy of one chunk, rebuilt only when its own hue step moves
// or the bake underneath it changed. Over budget, the copy it already has is
// blitted at its slightly stale colour — far better than a pop back to green.
function tripColour(chunk, hue, sat, CS, createCanvas, budget) {
  const step = Math.round(hue / STEP_DEG) % HUE_STEPS
  if (chunk.hued && chunk.hueStep === step && chunk.huedAt === chunk.explored) return chunk.hued
  if (budget.left <= 0) return chunk.hued ?? chunk.canvas
  budget.left--
  if (!chunk.hued) {
    const c = createCanvas()
    c.width = CS
    c.height = CS
    chunk.hued = c
    chunk.huedCtx = c.getContext('2d')
  }
  const hx = chunk.huedCtx
  hx.setTransform(1, 0, 0, 1, 0, 0)
  hx.clearRect(0, 0, CS, CS)
  hx.imageSmoothingEnabled = false
  hx.filter = `hue-rotate(${step * STEP_DEG}deg) saturate(${sat.toFixed(2)})`
  hx.drawImage(chunk.canvas, 0, 0)
  hx.filter = 'none'
  chunk.hueStep = step
  chunk.huedAt = chunk.explored
  return chunk.hued
}

function dropColour(chunk) {
  if (chunk.hued) { chunk.hued = null; chunk.huedCtx = null; chunk.hueStep = -1 }
  return chunk.canvas
}

export function makeTileLayer(createCanvas) {
  const layer = {
    map: null,
    chunks: new Map(),   // "cx,cy" -> { canvas, ctx, explored }
    // The Wilds window re-centred: `map` holds the same cells as `oldMap`,
    // moved by (dxChunks, dyChunks). Baked chunks move with them instead of
    // being baked again; the ones that fell off are dropped. If the layer
    // last drew some other map (a cave just left, say) there is nothing of
    // oldMap's to move and the cache simply starts over.
    rekey(oldMap, map, dxChunks, dyChunks) {
      const whole = Number.isInteger(dxChunks) && Number.isInteger(dyChunks)
      const next = new Map()
      if (whole && layer.map === oldMap) {
        const cw = Math.ceil(map[0].length / CHUNK), ch = Math.ceil(map.length / CHUNK)
        for (const [key, chunk] of layer.chunks) {
          const [cx, cy] = key.split(',').map(Number)
          const nx = cx + dxChunks, ny = cy + dyChunks
          if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) next.set(`${nx},${ny}`, chunk)
        }
      }
      layer.chunks = next
      layer.map = map
    },
    draw(ctx, map, sprites, S, camX, camY, W, H, fogAlpha, hue = 0, sat = 1) {
      if (map !== layer.map) { layer.map = map; layer.chunks.clear() }
      const dirty = takeDirtyTiles(map)
      if (dirty) {
        for (let i = 0; i < dirty.length; i += 2) {
          const chunk = layer.chunks.get(`${Math.floor(dirty[i] / CHUNK)},${Math.floor(dirty[i + 1] / CHUNK)}`)
          if (chunk) chunk.explored = -1   // keep the canvas, force a rebake
        }
      }
      const budget = { left: HUE_BUDGET }
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
          if (chunk.explored !== countExplored(map, cx, cy)) bake(chunk, map, cx, cy, S, sprites, createCanvas)
          const img = hue > 0
            ? tripColour(chunk, hue, sat, CS, createCanvas, budget)
            : dropColour(chunk)
          ctx.drawImage(img, Math.round(cx * CS - camX), Math.round(cy * CS - camY))
        }
      }
      let held = layer.canvases()
      if (held > MAX_CHUNKS) {
        // keep what is nearest the view
        const mx = (cx0 + cx1 - 1) / 2, my = (cy0 + cy1 - 1) / 2
        const far = [...layer.chunks.keys()].map(key => {
          const [x, y] = key.split(',').map(Number)
          return { key, d: Math.max(Math.abs(x - mx), Math.abs(y - my)) }
        }).sort((a, b) => b.d - a.d)
        for (const { key } of far) {
          if (held <= KEEP_CHUNKS) break
          held -= layer.chunks.get(key).top ? 2 : 1
          layer.chunks.delete(key)
        }
      }
      drawFogRuns(ctx, map, S, camX, camY, viewCells(map, S, camX, camY, W, H), fogAlpha)
    },
    // how many chunk images are held
    canvases() {
      let n = 0
      for (const chunk of layer.chunks.values()) n += chunk.top ? 2 : 1
      return n
    },
    // What is walked under, over the people: the tops of the chunks draw()
    // just baked (call it after draw, in the same frame), then their fog.
    drawOver(ctx, map, sprites, S, camX, camY, W, H, fogAlpha, hue = 0, sat = 1) {
      if (map !== layer.map) return
      const CS = CHUNK * S
      // in a trip a top turns colour in the frame its chunk's ground does (so
      // a roof is never two colours), and waits with it otherwise
      const step = Math.round(hue / STEP_DEG) % HUE_STEPS
      const cx0 = Math.max(0, Math.floor(camX / CS))
      const cx1 = Math.min(Math.ceil(map[0].length / CHUNK), Math.ceil((camX + W) / CS))
      const cy0 = Math.max(0, Math.floor(camY / CS))
      const cy1 = Math.min(Math.ceil(map.length / CHUNK), Math.ceil((camY + H) / CS))
      let any = false
      for (let cy = cy0; cy < cy1; cy++) {
        for (let cx = cx0; cx < cx1; cx++) {
          const chunk = layer.chunks.get(`${cx},${cy}`), top = chunk?.top
          if (!top) continue
          any = true
          const img = hue > 0
            ? tripColour(top, hue, sat, CS, createCanvas, { left: chunk.hued && chunk.hueStep === step && chunk.huedAt === chunk.explored ? 1 : 0 })
            : dropColour(top)
          const ox = Math.round(cx * CS - camX), oy = Math.round(cy * CS - camY)
          for (const r of top.rects) ctx.drawImage(img, r.x, r.y, r.w, r.h, ox + r.x, oy + r.y, r.w, r.h)
        }
      }
      if (any) drawFogRuns(ctx, map, S, camX, camY, viewCells(map, S, camX, camY, W, H), fogAlpha, true)
    },
  }
  return layer
}

// The uncached path: every visible cell through drawTile each frame. Used
// where offscreen canvases are unavailable (tests without a document) and
// kept as the reference the cached layer must match.
export function makeDirectTileLayer() {
  return {
    rekey() {},
    draw(ctx, map, sprites, S, camX, camY, W, H, fogAlpha, hue = 0, sat = 1) {
      const cells = viewCells(map, S, camX, camY, W, H)
      for (let row = cells.r0; row < cells.r1; row++) {
        for (let col = cells.c0; col < cells.c1; col++) {
          const t = map[row][col]
          if (!t.explored && !isStair(t.tile)) continue
          drawTile(ctx, t.tile, Math.round(col * S - camX), Math.round(row * S - camY), S, sprites, t, 'under')
        }
      }
      drawFogRuns(ctx, map, S, camX, camY, cells, fogAlpha)
    },
    drawOver(ctx, map, sprites, S, camX, camY, W, H, fogAlpha) {
      const cells = viewCells(map, S, camX, camY, W, H)
      let any = false
      for (let row = cells.r0; row < cells.r1; row++) {
        for (let col = cells.c0; col < cells.c1; col++) {
          const t = map[row][col]
          if (!t.over || !t.explored) continue
          any = true
          drawTile(ctx, t.tile, Math.round(col * S - camX), Math.round(row * S - camY), S, sprites, t, 'over')
        }
      }
      if (any) drawFogRuns(ctx, map, S, camX, camY, cells, fogAlpha, true)
    },
  }
}
