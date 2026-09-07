// Heal a finished map JSON in place — the passes a hand-finished map cannot
// get from its generator: log bridges painted as pier ground become a pier
// overlay over water (pierOverWater), the reachability passes' lone dirt
// stamps go back to grass (carveDirtToGrass), then the shoreline is relaid.
// Afterwards run editor-import.mjs <name> so the painter store matches, and
// export-game-maps.mjs so the game sees it.
// Usage (from tools/static-overworld/): node heal.mjs <map-name> [...]
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MapBuilder, shoreline, pierOverWater, carveDirtToGrass } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const names = process.argv.slice(2)
if (!names.length) { console.error('usage: node heal.mjs <map-name> [...]'); process.exit(1) }
for (const name of names) {
  const file = path.join(HERE, 'out/maps', name + '.json')
  const b = MapBuilder.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')))
  const piers = pierOverWater(b)
  const dirt = carveDirtToGrass(b)
  shoreline(b)
  b.compactPalette()
  fs.writeFileSync(file, JSON.stringify(b.toJSON()))
  console.log(`healed ${name}: ${piers} pier cell(s) laid over water, ${dirt} dirt stamp(s) back to grass, rim relaid`)
}
