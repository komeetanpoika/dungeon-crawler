// Crop chosen 16x16 cells from the Tiny Creatures sheet (CC0, Clint
// Bellanger) into renderer/assets/tiles/npc_*.png. Skips with a note when the
// pack has not been unzipped into vendor/tiny-creatures/.
// Usage: node tools/extract-npc-sprites.mjs [--list]   (--list prints a contact sheet index)
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png-read.mjs'
import { writePng } from './png-write.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.join(HERE, 'static-overworld/vendor/tiny-creatures')
const OUT = path.join(HERE, '../renderer/assets/tiles')
const CELL = 16

// Which sheet cell is which animal. Fill these in after running --list and
// eyeballing the sheet (cell index = row * columns + col).
const PICKS = {
  npc_chicken: { file: 'tiny-creatures.png', col: 0, row: 0 },
  npc_deer:    { file: 'tiny-creatures.png', col: 1, row: 0 },
}

if (!fs.existsSync(VENDOR)) {
  console.log(`tiny-creatures not found at ${VENDOR} — keeping placeholder sprites`)
  process.exit(0)
}
const sheets = fs.readdirSync(VENDOR, { recursive: true }).filter(f => f.endsWith('.png'))
if (process.argv.includes('--list')) {
  for (const f of sheets) {
    const img = readPng(path.join(VENDOR, f))
    console.log(f, `${img.width}x${img.height}`, `${img.width / CELL} cols x ${img.height / CELL} rows`)
  }
  process.exit(0)
}
for (const [name, pick] of Object.entries(PICKS)) {
  const rel = sheets.find(f => f.endsWith(pick.file))
  if (!rel) { console.warn(`${name}: sheet ${pick.file} not in the pack`); continue }
  const img = readPng(path.join(VENDOR, rel))
  const out = new Uint8Array(CELL * CELL * 4)
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx = pick.col * CELL + x, sy = pick.row * CELL + y
    const si = (sy * img.width + sx) * 4
    out.set(img.pixels.subarray(si, si + 4), (y * CELL + x) * 4)
  }
  writePng(path.join(OUT, `${name}.png`), CELL, CELL, out)
  console.log('wrote', name)
}
