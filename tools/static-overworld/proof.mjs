// Render every extracted ow_* tile with its name so mis-picks are visible.
import { runPixels } from './px.mjs'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/assets/tiles')
const files = Object.fromEntries(
  fs.readdirSync(TILES).filter(f => f.startsWith('ow_')).sort()
    .map(f => [f.replace('.png', ''), path.join(TILES, f)])
)

await runPixels(files, (images) => {
  const names = Object.keys(images).sort()
  const Z = 3, COLS = 8, CW = 150, CH = 16 * Z + 30
  const rows = Math.ceil(names.length / COLS)
  const c = document.createElement('canvas')
  c.width = COLS * CW; c.height = rows * CH
  const g = c.getContext('2d')
  g.fillStyle = '#445'; g.fillRect(0, 0, c.width, c.height)
  g.imageSmoothingEnabled = false
  g.font = '11px monospace'; g.textAlign = 'center'
  names.forEach((n, i) => {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH
    g.drawImage(images[n], x + (CW - 16 * Z) / 2, y + 4, 16 * Z, 16 * Z)
    g.fillStyle = '#fff'
    g.fillText(n.replace('ow_', ''), x + CW / 2, y + CH - 8)
  })
  return { files: { 'proof.png': c.toDataURL() } }
}, null, process.env.SCRATCH + '/sheets')
console.log('proof written')
