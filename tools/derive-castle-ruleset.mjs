// Derive the 'castle' ruleset from the castle-demo painting using the editor's
// pure deriveRules. Re-run after repainting the source map:
//   node tools/derive-castle-ruleset.mjs
// Fails without writing if any painted tile is missing from TABLE (skipped > 0)
// or any tagged tile has no sprite on disk.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveRules } from './tile-editor/derive-rules.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAPS_FILE = join(ROOT, 'renderer/data/painter-maps.json')
const RULESETS_FILE = join(ROOT, 'renderer/data/rulesets.json')
const SOURCE_RULESET = 'catacombs'                    // where the painting is stored
const SOURCE_MAP = 'castle-demo-1781607145194'
const TARGET = 'castle'

// tag, role, member tiles. Only tiles that appear exclusively on the overlay
// layer may take the overlay role; dual-layer tiles keep their base role
// (deriveRules then counts their overlay appearances as "no overlay").
const TABLE = [
  ['castle.floor', 'floor', [
    'tile_0048', 'tile_0050', 'tile_0030', 'tile_0042']],
  ['castle.wall', 'wall', [
    'tile_0000', 'tile_0002', 'tile_0004', 'tile_0005', 'tile_0006',
    'tile_0012', 'tile_0013', 'tile_0015', 'tile_0016', 'tile_0017',
    'tile_0018', 'tile_0026', 'tile_0028', 'tile_0045', 'tile_0057',
    'tile_0059']],
  ['overlay.castle', 'overlay', [
    'tile_0001', 'tile_0014', 'tile_0019', 'tile_0031', 'tile_0064',
    'tile_0065', 'tile_0066']],
]

const tileMeta = new Map()
for (const [tag, role, names] of TABLE)
  for (const name of names) tileMeta.set(name, { role, tags: [tag] })

for (const name of tileMeta.keys()) {
  if (!existsSync(join(ROOT, 'renderer/assets/tiles', `${name}.png`))) {
    console.error(`missing sprite: ${name}.png — aborting`)
    process.exit(1)
  }
}

const store = JSON.parse(readFileSync(MAPS_FILE, 'utf8'))
const map = store[SOURCE_RULESET]?.maps?.[SOURCE_MAP]
if (!map) {
  console.error(`map not found: ${SOURCE_RULESET}/${SOURCE_MAP} — aborting`)
  process.exit(1)
}

const frag = deriveRules(map.base, map.overlay, tileMeta)
if (frag.skipped > 0) {
  console.error(`${frag.skipped} painted cells not covered by TABLE — aborting`)
  process.exit(1)
}

const rulesets = JSON.parse(readFileSync(RULESETS_FILE, 'utf8'))
rulesets[TARGET] = { tiles: frag.tiles, tags: frag.tags }
// Match the editor's save format exactly: 2-space indent, no trailing newline.
writeFileSync(RULESETS_FILE, JSON.stringify(rulesets, null, 2))
console.log(`wrote ruleset '${TARGET}': ${Object.keys(frag.tiles).length} tiles, ` +
  `${Object.keys(frag.tags).length} tags`)
