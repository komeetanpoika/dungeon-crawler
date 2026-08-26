// Render labeled contact sheets of the downloaded Kenney packs so tiles can
// be picked by coordinate. Tiny Town: one sheet of its 132 loose tiles.
// RPG pack: the 57x31 spritesheet (17px stride) split into labeled quadrants.
import { runPixels } from './px.mjs'
import * as path from 'node:path'
import * as fs from 'node:fs'

const SCRATCH = process.env.SCRATCH
const OUT = path.join(SCRATCH, 'sheets')

// --- Tiny Town: compose 132 tiles into a 12-wide labeled grid ---
const ttDir = path.join(SCRATCH, 'tiny-town-x/Tiles')
const ttFiles = Object.fromEntries(
  fs.readdirSync(ttDir).filter(f => f.endsWith('.png')).sort()
    .map(f => ['t' + f.match(/\d+/)[0], path.join(ttDir, f)])
)

await runPixels(ttFiles, (images) => {
  const names = Object.keys(images).sort((a, b) => +a.slice(1) - +b.slice(1))
  const Z = 4, COLS = 12, CW = 16 * Z + 12, CH = 16 * Z + 26
  const rows = Math.ceil(names.length / COLS)
  const c = document.createElement('canvas')
  c.width = COLS * CW; c.height = rows * CH
  const g = c.getContext('2d')
  g.fillStyle = '#223'; g.fillRect(0, 0, c.width, c.height)
  g.imageSmoothingEnabled = false
  g.font = '12px monospace'; g.textAlign = 'center'
  names.forEach((n, i) => {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH
    g.drawImage(images[n], x + 6, y + 4, 16 * Z, 16 * Z)
    g.fillStyle = '#fff'
    g.fillText(n.slice(1), x + CW / 2, y + CH - 8)
    g.fillStyle = '#223'
  })
  return { files: { 'tiny-town-sheet.png': c.toDataURL() } }
}, null, OUT)

// --- RPG pack: 4 labeled quadrants at 2x with rulers every tile ---
const sheet = path.join(SCRATCH, 'rpg-x/Spritesheet/roguelikeSheet_transparent.png')
await runPixels({ sheet }, (images, q) => {
  const img = images.sheet
  const STRIDE = 17, T = 16, Z = 3
  const COLS = 57, ROWS = 31
  const qc = Math.ceil(COLS / 2), qr = Math.ceil(ROWS / 2)
  const files = {}
  for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
    const c0 = qx * qc, r0 = qy * qr
    const nc = Math.min(qc, COLS - c0), nr = Math.min(qr, ROWS - r0)
    const M = 34   // ruler margin
    const c = document.createElement('canvas')
    c.width = M + nc * (T * Z + 2); c.height = M + nr * (T * Z + 2)
    const g = c.getContext('2d')
    g.fillStyle = '#223'; g.fillRect(0, 0, c.width, c.height)
    g.imageSmoothingEnabled = false
    g.font = '11px monospace'; g.fillStyle = '#9cf'; g.textAlign = 'center'
    for (let i = 0; i < nc; i++) g.fillText(c0 + i, M + i * (T * Z + 2) + T * Z / 2, 12 + (i % 2) * 11)
    g.textAlign = 'left'
    for (let j = 0; j < nr; j++) g.fillText(r0 + j, 2, M + j * (T * Z + 2) + T * Z / 2 + 4)
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      g.drawImage(img, (c0 + i) * STRIDE, (r0 + j) * STRIDE, T, T,
        M + i * (T * Z + 2), M + j * (T * Z + 2), T * Z, T * Z)
    }
    files[`rpg-q${qx}${qy}.png`] = c.toDataURL()
  }
  return { files }
}, null, OUT)

console.log('sheets written to', OUT)
