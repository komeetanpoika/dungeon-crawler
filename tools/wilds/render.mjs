// Render a block of Wilds pieces to a PNG with the real tile art, to look at
// the generated land without running the game.
//
//   node tools/wilds/render.mjs <seed> <wx> <wy> [cols=3] [rows=3]
//        [--deal N] [--scale 8] [--grid] [--marks] [--out file.png]
//
// <wx> <wy> is the top-left piece. --grid outlines the pieces, --marks draws
// each piece's main thing, spawns, cave mouths and doors. Kalevanlinna's four
// pieces are cut from the city, as the game does (world.js getPiece).
import { PIECE, MARGIN } from '../../renderer/wilds/layout.js'
import { isCityPiece } from '../../renderer/wilds/city/geometry.js'
import { drawPieces, pieceArtOf } from './draw.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v }
const has = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const deal = Number(flag('--deal', 0)), scale = Number(flag('--scale', 8)), out = flag('--out', 'wilds.png')
const grid = has('--grid'), marks = has('--marks')
const tale = flag('--tale', null)   // draw every piece as this tale's place: elk | tar | kivihiisi
const [seed, wx0, wy0, cols = 3, rows = 3] = args.map(Number)
if (![seed, wx0, wy0].every(Number.isFinite)) { console.error('usage: render.mjs <seed> <wx> <wy> [cols] [rows] [--deal N] [--scale 8] [--grid] [--marks] [--out file.png]'); process.exit(1) }

// One piece as art, from the full generator when it exists and from bare terrain before that.
async function pieceArt(wx, wy) {
  try {
    if (isCityPiece(wx, wy)) {
      const { generateCityPiece } = await import('../../renderer/wilds/city/piece.js')
      return pieceArtOf(generateCityPiece(seed, wx, wy))
    }
    const { generatePiece } = await import('../../renderer/wilds/piece.js')
    return pieceArtOf(generatePiece(seed, wx, wy, deal, tale))
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err
    const { makeTerrain } = await import('../../renderer/wilds/terrain.js')
    const t = makeTerrain(seed, wx, wy, deal)
    t.finish()
    const rowsOf = g => Array.from({ length: PIECE }, (_, y) => Array.from({ length: PIECE }, (_, x) => t.b.palette[g[y + MARGIN][x + MARGIN]] ?? null))
    return { ground: rowsOf(t.b.ground), prop: rowsOf(t.b.prop), marks: [] }
  }
}

const t0 = performance.now()
const arts = []
for (let r = 0; r < rows; r++) { arts.push([]); for (let c = 0; c < cols; c++) arts[r].push(await pieceArt(wx0 + c, wy0 + r)) }
console.log(`generated ${cols * rows} pieces in ${(performance.now() - t0).toFixed(0)} ms`)
console.log('wrote', await drawPieces(arts, { scale, grid, marks, out }))
