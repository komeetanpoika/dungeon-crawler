// Render Kalevanlinna's four pieces to a PNG with the real tile art, as the
// game lays them (renderer/wilds/city/piece.js).
//
//   node tools/city/render.mjs <seed> [--grid] [--marks] [--scale N] [--out f.png]
//        [--crop x0,y0,x1,y1]   (city tiles: draw only that part, e.g. a block, at a larger scale)
//
// --grid outlines the pieces, --marks the doors (by kind), spawns and arrival points.
import { CITY_KEYS } from '../../renderer/wilds/city/geometry.js'
import { generateCityPiece } from '../../renderer/wilds/city/piece.js'
import { PIECE } from '../../renderer/wilds/layout.js'
import { drawPieces, pieceArtOf } from '../wilds/draw.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v }
const has = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const scale = Number(flag('--scale', 4)), out = flag('--out', 'city.png'), crop = flag('--crop', null)
const grid = has('--grid'), marks = has('--marks')
const seed = Number(args[0])
if (!Number.isFinite(seed)) { console.error('usage: render.mjs <seed> [--grid] [--marks] [--scale N] [--out f.png] [--crop x0,y0,x1,y1]'); process.exit(1) }

const t0 = performance.now()
const pieces = Object.fromEntries(CITY_KEYS.map(k => [k, generateCityPiece(seed, ...k.split(',').map(Number))]))
console.log(`built the city of seed ${seed} in ${(performance.now() - t0).toFixed(0)} ms`)
let arts = [[pieceArtOf(pieces['0,2']), pieceArtOf(pieces['1,2'])], [pieceArtOf(pieces['0,3']), pieceArtOf(pieces['1,3'])]]
if (crop) {
  // one piece-sized canvas per 80 x 80 of the crop, cut from the whole city
  const [x0, y0, x1, y1] = crop.split(',').map(Number)
  const whole = k => { const g = Array.from({ length: 2 * PIECE }, (_, y) => Array.from({ length: 2 * PIECE }, (_, x) => arts[y >= PIECE ? 1 : 0][x >= PIECE ? 1 : 0][k][y % PIECE][x % PIECE])); return g }
  const all = { ground: whole('ground'), deco: whole('deco'), prop: whole('prop') }
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const cut = k => Array.from({ length: PIECE }, (_, y) => Array.from({ length: PIECE }, (_, x) => (x < w && y < h ? all[k][y0 + y]?.[x0 + x] ?? null : null)))
  if (w > PIECE || h > PIECE) { console.error('a crop is at most 80 x 80'); process.exit(1) }
  arts = [[{ ground: cut('ground'), deco: cut('deco'), prop: cut('prop'), marks: [] }]]
}
console.log('wrote', await drawPieces(arts, { scale, grid, marks, out }))
