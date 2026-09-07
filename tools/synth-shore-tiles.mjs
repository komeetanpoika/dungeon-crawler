// Synthesise the sand shoreline rims: the eight ow_pond_* bank tiles with
// their grass-green bank recoloured to the beach sand (the two greens map to
// ow_sand_0's light and dark grains; the brown waterline stays), emitted as
// ow_shore_<k>. shoreline() in lib.mjs lays them where every land side of a
// water cell is sandy (beach.mjs). Deterministic; run from anywhere:
//   node tools/synth-shore-tiles.mjs
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { SHORE } from './static-overworld/beach.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')

const sand = readPng(path.join(TILES, 'ow_sand_0.png'))
const lum = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114
let light = null, dark = null, lo = Infinity, hi = -Infinity
for (let i = 0; i < sand.pixels.length; i += 4) {
  const l = lum(sand.pixels[i], sand.pixels[i + 1], sand.pixels[i + 2])
  if (l < lo) { lo = l; dark = [...sand.pixels.subarray(i, i + 3)] }
  if (l > hi) { hi = l; light = [...sand.pixels.subarray(i, i + 3)] }
}
const isGreen = (r, g, b) => g > r && g > b && g > 120
for (const name of SHORE) {
  const src = readPng(path.join(TILES, `ow_pond_${name.slice(-2)}.png`))
  const out = new Uint8Array(src.pixels)
  for (let i = 0; i < out.length; i += 4)
    if (out[i + 3] && isGreen(out[i], out[i + 1], out[i + 2])) out.set(out[i + 1] > 170 ? light : dark, i)
  writePng(path.join(TILES, `${name}.png`), src.width, src.height, out)
}
console.log(`wrote ${SHORE.length} shore tiles to ${path.relative(process.cwd(), TILES)}`)
