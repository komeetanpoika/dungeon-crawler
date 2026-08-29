// Crop chosen 16x16 tiles from the Tiny Creatures pack (CC0, Clint Bellanger —
// assets/tiny-creatures/) into renderer/assets/tiles/npc_*.png. The pack's
// per-tile PNGs (Tiles/tile_NNNN.png) are 4-bit palette images WITHOUT a tRNS
// chunk, so their background renders opaque black in the game; the spaced
// sheet Tilemap/tilemap.png is 8-bit RGBA with real alpha, so cells are cut
// from it and written back out as RGBA. Tile numbers match Preview.png
// (row-major, 1-based, 10 per row). Skips with a note when the pack is absent.
// Usage: node tools/extract-npc-sprites.mjs
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHEET = path.join(HERE, '../assets/tiny-creatures/Tilemap/tilemap.png')
const OUT = path.join(HERE, '../renderer/assets/tiles')
const CELL = 16
const COLS = 10
const PITCH = 17      // 16 px cell + 1 px spacing

// Tile numbers from the pack's Preview.png / Tilesheet.txt (row-major, 1-based).
// Animals live in rows 16–18: 151 chicken, 152 cow, 153 goat, 154 sheep,
// 161 boar, 162 doe, 163 stag, 164 bear, 166 wolf, 170 fox — pick here.
const PICKS = {
  npc_chicken: 151,
  npc_goat:    153,
  npc_sheep:   154,
  npc_boar:    161,
  npc_deer:    162,
  npc_bear:    164,
  npc_wolf:    166,
}

if (!fs.existsSync(SHEET)) {
  console.log(`tiny-creatures not found at ${SHEET} — keeping placeholder sprites`)
  process.exit(0)
}
const sheet = readPng(SHEET)
for (const [name, tile] of Object.entries(PICKS)) {
  const col = (tile - 1) % COLS, row = Math.floor((tile - 1) / COLS)
  const ox = col * PITCH, oy = row * PITCH
  if (ox + CELL > sheet.width || oy + CELL > sheet.height) { console.warn(`${name}: tile ${tile} outside the sheet`); continue }
  const out = new Uint8Array(CELL * CELL * 4)
  let clear = 0
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const si = ((oy + y) * sheet.width + (ox + x)) * 4
    out.set(sheet.pixels.subarray(si, si + 4), (y * CELL + x) * 4)
    if (sheet.pixels[si + 3] === 0) clear++
  }
  if (!clear) console.warn(`${name}: tile ${tile} has no transparent pixels — wrong cell?`)
  writePng(path.join(OUT, `${name}.png`), CELL, CELL, out)
  console.log('wrote', name, '<- tile', tile, `(${clear} clear px)`)
}
