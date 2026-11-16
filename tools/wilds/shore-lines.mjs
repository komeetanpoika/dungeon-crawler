// Does the drawn coast of the Wilds join up from tile to tile? The check
// reads the shore tiles themselves, pixel by pixel, and knows nothing of how
// they were chosen. Every bank is drawn with one dark waterline, a curve a
// pixel thick that runs through a tile from edge to edge. Two things can be
// wrong at the border between two cells:
//
//   an open end   the waterline of one tile reaches the border and the tile
//                 across it does not take it up within TOLERANCE pixels of
//                 where it arrived (beyond touching: the line may step one
//                 pixel sideways as it crosses, not two)
//   bare shore    along the border, land pixels on one side lie against
//                 water pixels on the other with no bank between, for BARE
//                 pixels or more
//
// A border one of whose cells lies under a bridge deck is not judged: the
// deck hides the ground there. Nor is one whose other cell is not given.
//
//   const check = makeShoreCheck()
//   const cell = check(at)   at(x, y) => { skin, overlay } | null, over any block of cells
//   cell(x, y)               what is wrong on the borders of that cell:
//                            [{ side, what, own, other }], side 'n' 'e' 's' 'w'
//
//   node tools/wilds/shore-lines.mjs [seed ...]                 counts over 11 x 11 pieces a seed, seams included
//   node tools/wilds/shore-lines.mjs --at seed wx wy [cols rows] [--tale id]
//                                                               the same for one block of pieces, as JSON lines
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../png-read.mjs'
import { isWaterSkin, isPierSkin } from '../../renderer/terrain/lib.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/assets/tiles')
export const TOLERANCE = 1, BARE = 3
const T = 16
const WATERLINE = '143,103,63'
// a pixel is land (0), water or foam (1), or part of a bank's band (2)
const INK = { '99,197,207': 1, '142,212,219': 1, [WATERLINE]: 2, '197,143,92': 2, '180,131,85': 2 }
const isShoreSkin = n => /^ow_(pond|shore|mud)_|^ow_water_(foam|k)_|^ow_bank_/.test(n ?? '')
// what a tile is, for saying what went wrong
export const shoreKind = n => !n ? 'nothing'
  : n.startsWith('ow_bank_') ? 'a cut'
  : /^ow_(pond|shore|mud)_\d\d$/.test(n) ? 'a square rim'
  : /_slope_|^ow_(pond|shore|mud)_k_[a-z]*[a-eup-t][a-z]*_/.test(n) ? 'a fill'
  : /^ow_water_foam_|^ow_water_k_[a-z]*[ghijm]/.test(n) ? 'the foot of a cut'
  : /^ow_(pond|shore|mud)_k_/.test(n) ? 'a square bank'
  : /^ow_water_k_/.test(n) ? 'a corner'
  : isWaterSkin(n) ? 'open water' : 'land'

export function makeShoreCheck(dir = TILES) {
  const tiles = new Map()
  // a tile's waterline pixels, the ends of that curve, and what each pixel is
  // (a tile that is not of the shore is all land, or all water)
  const tileOf = name => {
    let t = tiles.get(name)
    if (t) return t
    const on = new Uint8Array(T * T), ends = [], ink = new Uint8Array(T * T).fill(isWaterSkin(name) ? 1 : 0)
    if (isShoreSkin(name)) {
      const png = readPng(path.join(dir, `${name}.png`))
      for (let i = 0; i < T * T; i++) {
        const rgb = `${png.pixels[i * 4]},${png.pixels[i * 4 + 1]},${png.pixels[i * 4 + 2]}`
        on[i] = rgb === WATERLINE ? 1 : 0
        ink[i] = INK[rgb] ?? 0
      }
      // the ends: waterline pixels with at most one other beside them
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (!on[y * T + x]) continue
        let near = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < T && y + dy < T && on[(y + dy) * T + x + dx]) near++
        }
        if (near <= 1) ends.push([x, y])
      }
    }
    tiles.set(name, t = { on, ends, ink })
    return t
  }
  return at => {
    const cellAt = (x, y) => { const c = at(x, y); return c ? { skin: c.skin, deck: isPierSkin(c.overlay), t: tileOf(c.skin) } : null }
    // is there waterline in cell (cx, cy) within reach of pixel (px, py) of the block
    const taken = (cx, cy, px, py, reach) => {
      const c = cellAt(cx, cy)
      if (!c || c.deck) return true
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const lx = px + dx - cx * T, ly = py + dy - cy * T
        if (lx >= 0 && ly >= 0 && lx < T && ly < T && c.t.on[ly * T + lx]) return true
      }
      return false
    }
    return (x, y) => {
      const c = cellAt(x, y), out = []
      if (!c || c.deck) return out
      for (const [ex, ey] of c.t.ends) {
        const dx = ex === T - 1 ? 1 : ex === 0 ? -1 : 0, dy = ey === T - 1 ? 1 : ey === 0 ? -1 : 0
        if (!dx && !dy) { out.push({ side: null, what: 'open end', own: c.skin, other: null }); continue }
        const px = x * T + ex, py = y * T + ey
        // across the border it lies on; from a corner pixel, across either border or the corner itself
        const over = dx && dy ? [[x + dx, y], [x, y + dy], [x + dx, y + dy]] : [[x + dx, y + dy]]
        if (over.some(([cx, cy]) => taken(cx, cy, px, py, 1 + TOLERANCE))) continue
        out.push({ side: dy < 0 ? 'n' : dx > 0 ? 'e' : dy > 0 ? 's' : 'w', what: 'open end', own: c.skin, other: at(over[0][0], over[0][1])?.skin ?? null })
      }
      // the borders south and east of this cell (each border once): land pixels lying against water pixels
      for (const [side, dx, dy] of [['e', 1, 0], ['s', 0, 1]]) {
        const o = cellAt(x + dx, y + dy)
        if (!o || o.deck) continue
        let bare = 0
        for (let k = 0; k < T; k++) {
          const a = dx ? c.t.ink[k * T + T - 1] : c.t.ink[(T - 1) * T + k], b = dx ? o.t.ink[k * T] : o.t.ink[k]
          if (a + b === 1) bare++
        }
        if (bare >= BARE) out.push({ side, what: 'bare shore', own: c.skin, other: o.skin })
      }
      return out
    }
  }
}
// one line for a tally
export const shoreFault = m => m.what === 'bare shore' ? `bare shore between ${shoreKind(m.own)} and ${shoreKind(m.other)}`
  : m.side ? `${shoreKind(m.own)} ends against ${shoreKind(m.other)}` : `${shoreKind(m.own)} ends inside its tile`

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { generatePiece } = await import('../../renderer/wilds/piece.js')
  const { PIECE } = await import('../../renderer/wilds/layout.js')
  const args = process.argv.slice(2)
  const tale = args.includes('--tale') ? args.splice(args.indexOf('--tale'), 2)[1] : null
  const check = makeShoreCheck()
  const world = seed => {
    const cache = new Map()
    const piece = (wx, wy) => { const k = `${wx},${wy}`; if (!cache.has(k)) cache.set(k, generatePiece(seed, wx, wy, 0, tale)); return cache.get(k) }
    return (x, y) => piece(Math.floor(x / PIECE), Math.floor(y / PIECE)).cells[((y % PIECE) + PIECE) % PIECE][((x % PIECE) + PIECE) % PIECE]
  }
  if (args[0] === '--at') {
    const [seed, wx, wy, cols = 1, rows = 1] = args.slice(1).map(Number)
    const cell = check(world(seed))
    for (let y = 0; y < rows * PIECE; y++) for (let x = 0; x < cols * PIECE; x++) {
      for (const m of cell(wx * PIECE + x, wy * PIECE + y)) console.log(JSON.stringify({ x, y, ...m }))
    }
  } else {
    const seeds = args.map(Number).filter(Number.isFinite)
    const tally = {}
    let pieces = 0, faults = 0
    for (const seed of seeds.length ? seeds : [1, 3, 77]) {
      const cell = check(world(seed))
      for (let wy = -5; wy <= 5; wy++) for (let wx = -5; wx <= 5; wx++) {
        pieces++
        for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) for (const m of cell(wx * PIECE + x, wy * PIECE + y)) {
          faults++
          tally[shoreFault(m)] = (tally[shoreFault(m)] ?? 0) + 1
        }
      }
    }
    console.log(`${pieces} pieces: ${faults} borders where the coast does not join`)
    for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(7), k)
  }
}
