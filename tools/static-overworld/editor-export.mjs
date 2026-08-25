// Export a hand-edited Build-tab map back into the static overworld pipeline:
// rewrites out/maps/<name>.json, re-renders the PNG preview, and regenerates
// renderer/data/open-maps.js so the game picks the edits up.
// Usage (from tools/static-overworld/): node editor-export.mjs <map-name> [ruleset]
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fromPainter } from './editor-bridge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE = path.resolve(HERE, '../../renderer/data/painter-maps.json')

const name = process.argv[2]
const ruleset = process.argv[3] ?? 'outdoors'
if (!name) { console.error('usage: node editor-export.mjs <map-name> [ruleset]'); process.exit(1) }

const mapFile = path.join(HERE, 'out/maps', name + '.json')
const original = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
const store = JSON.parse(fs.readFileSync(STORE, 'utf8'))
const painter = store[ruleset]?.maps?.[name]
if (!painter) { console.error(`no editor map "${name}" under ruleset "${ruleset}" in painter-maps.json`); process.exit(1) }

const updated = fromPainter(painter, original)
fs.writeFileSync(mapFile, JSON.stringify(updated))
console.log(`wrote ${mapFile} (palette ${updated.palette.length} names)`)

execFileSync('node', ['render-maps.mjs', path.join('out/maps', name + '.json')], { cwd: HERE, stdio: 'inherit' })
execFileSync('node', ['export-game-maps.mjs'], { cwd: HERE, stdio: 'inherit' })
console.log('preview + renderer/data/open-maps.js regenerated.')
