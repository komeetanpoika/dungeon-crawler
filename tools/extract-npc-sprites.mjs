// Copy chosen 16x16 tiles from the Tiny Creatures pack (CC0, Clint Bellanger —
// assets/tiny-creatures/) into renderer/assets/tiles/npc_*.png. The pack ships
// one PNG per creature (Tiles/tile_0001..0180, numbered as on Preview.png), so
// this is a rename, not a sheet crop. Skips with a note when the pack is absent.
// Usage: node tools/extract-npc-sprites.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACK = path.join(HERE, '../assets/tiny-creatures/Tiles')
const OUT = path.join(HERE, '../renderer/assets/tiles')
const CELL = 16

// Tile numbers from the pack's Preview.png / Tilesheet.txt (row-major, 1-based).
// Animals live in rows 16–18: 151 chicken, 152 cow, 153 goat, 154 sheep,
// 161 boar, 162 doe, 163 stag, 164 bear, 166 wolf, 170 fox — pick here.
const PICKS = {
  npc_chicken: 151,
  npc_deer:    162,
}

if (!fs.existsSync(PACK)) {
  console.log(`tiny-creatures not found at ${PACK} — keeping placeholder sprites`)
  process.exit(0)
}
for (const [name, tile] of Object.entries(PICKS)) {
  const src = path.join(PACK, `tile_${String(tile).padStart(4, '0')}.png`)
  if (!fs.existsSync(src)) { console.warn(`${name}: ${src} missing`); continue }
  // The pack's PNGs are 4-bit indexed, which png-read.mjs does not decode (the
  // browser does), so size-check straight from the IHDR bytes instead.
  const hdr = fs.readFileSync(src)
  const w = hdr.readUInt32BE(16), h = hdr.readUInt32BE(20)
  if (w !== CELL || h !== CELL) { console.warn(`${name}: ${src} is ${w}x${h}, not ${CELL}x${CELL}`); continue }
  fs.copyFileSync(src, path.join(OUT, `${name}.png`))
  console.log('wrote', name, '<- tile', tile)
}
