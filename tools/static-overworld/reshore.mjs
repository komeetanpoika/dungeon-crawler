// Re-dress the water in a finished map JSON: open water becomes the two
// plain skins (ow_water_2/3 are shore-corner tiles, see WATER_SKINS) and
// every water cell touching land gets the pond rim (shoreline()). For maps
// that were hand-edited in the tile editor and must NOT be regenerated —
// afterwards run editor-import.mjs <name> so the painter store matches.
// Usage (from tools/static-overworld/): node reshore.mjs <map-name> [...]
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MapBuilder, shoreline, reshore } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const names = process.argv.slice(2)
if (!names.length) { console.error('usage: node reshore.mjs <map-name> [...]'); process.exit(1) }
for (const name of names) {
  const file = path.join(HERE, 'out/maps', name + '.json')
  const b = MapBuilder.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')))
  const fixed = reshore(b)
  shoreline(b)
  b.compactPalette()
  fs.writeFileSync(file, JSON.stringify(b.toJSON()))
  console.log(`reshored ${name}: ${fixed} shore-corner water cell(s) made plain, rim laid`)
}
