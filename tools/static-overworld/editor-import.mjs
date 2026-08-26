// Put a static overworld map into the tile editor's Build tab for hand-editing.
// Usage (from tools/static-overworld/): node editor-import.mjs <map-name> [ruleset]
//   e.g. node editor-import.mjs forest-2-river
// Then: npm run editor -> select the ruleset (default "outdoors") -> Build tab.
// Export the edits back with editor-export.mjs.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toPainter } from './editor-bridge.mjs'
import { applyMap } from '../tile-editor/painter-maps.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE = path.resolve(HERE, '../../renderer/data/painter-maps.json')

const name = process.argv[2]
const ruleset = process.argv[3] ?? 'outdoors'
if (!name) { console.error('usage: node editor-import.mjs <map-name> [ruleset]'); process.exit(1) }

const mapFile = path.join(HERE, 'out/maps', name + '.json')
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {}

if (store[ruleset]?.maps?.[name])
  console.warn(`overwriting existing editor map "${name}" in ruleset "${ruleset}"`)

applyMap(store, ruleset, name, toPainter(map))
fs.writeFileSync(STORE, JSON.stringify(store))
console.log(`imported ${map.w}x${map.h} "${name}" into painter-maps ruleset "${ruleset}" (active).`)
console.log('open with: npm run editor  ->  ruleset "' + ruleset + '"  ->  Build tab')
