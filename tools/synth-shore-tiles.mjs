// Synthesise the shoreline rims for other banks: the eight ow_pond_* bank
// tiles with their grass-green bank recoloured (the two greens map to the
// bank material's light and dark grains; the brown waterline stays) —
// ow_shore_<k> for beach sand (ow_sand_0) and ow_mud_<k> for a marsh pool's
// mud band (ow_dirt_0, its dominant and dark grains). shoreline() in
// lib.mjs lays each where every land side of a water cell is that
// material. Also ow_pier_log_v: the pier tile turned
// upright (transposed), so a causeway running north-south shows planks along
// its length instead of ladder rungs (layPiersOverWater picks it).
// Deterministic; run from anywhere:
//   node tools/synth-shore-tiles.mjs
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'
import { RIM_TILES } from './static-overworld/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.join(HERE, '../renderer/assets/tiles')

const lum = (r, g, b) => r * 0.299 + g * 0.587 + b * 0.114
// the lightest and darkest non-green grains of a ground tile
const grains = f => {
  let light = null, dark = null, lo = Infinity, hi = -Infinity
  for (let i = 0; i < f.pixels.length; i += 4) {
    const [r, g, b] = f.pixels.subarray(i, i + 3)
    if (g > r && g > b) continue   // the tile's own grass nibs
    const l = lum(r, g, b)
    if (l < lo) { lo = l; dark = [r, g, b] }
    if (l > hi) { hi = l; light = [r, g, b] }
  }
  return { light, dark }
}
const isGreen = (r, g, b) => g > r && g > b && g > 120
let n = 0
// ow_dirt_0.png is a 4-bit indexed PNG png-read.mjs cannot open: its two
// grains (dominant and dark) are copied here
const MUD = { light: [234, 165, 108], dark: [207, 130, 84] }
for (const [prefix, base] of [['ow_shore', 'ow_sand_0'], ['ow_mud', null]]) {
  const { light, dark } = base ? grains(readPng(path.join(TILES, `${base}.png`))) : MUD
  for (const name of RIM_TILES[prefix.slice(3)]) {
    const src = readPng(path.join(TILES, `ow_pond_${name.slice(-2)}.png`))
    const out = new Uint8Array(src.pixels)
    for (let i = 0; i < out.length; i += 4)
      if (out[i + 3] && isGreen(out[i], out[i + 1], out[i + 2])) out.set(out[i + 1] > 170 ? light : dark, i)
    writePng(path.join(TILES, `${name}.png`), src.width, src.height, out)
    n++
  }
}
const log = readPng(path.join(TILES, 'ow_pier_log.png'))
const upright = new Uint8Array(log.pixels.length)
for (let y = 0; y < log.height; y++) for (let x = 0; x < log.width; x++)
  upright.set(log.pixels.subarray((y * log.width + x) * 4, (y * log.width + x) * 4 + 4), (x * log.height + y) * 4)
writePng(path.join(TILES, 'ow_pier_log_v.png'), log.height, log.width, upright)
console.log(`wrote ${n} rim tiles and ow_pier_log_v to ${path.relative(process.cwd(), TILES)}`)
