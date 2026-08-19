// Downsample the Suomenlinna aerial photo to a grid of average colors.
// Crop covers the fortress island group; output feeds gen-sea.mjs.
import { runPixels } from './px.mjs'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRATCH = process.env.SCRATCH
const HERE = path.dirname(fileURLToPath(import.meta.url))
const img = path.join(SCRATCH, 'suomenlinna.jpg')

const result = await runPixels({ img }, (images, a) => {
  const c = document.createElement('canvas')
  c.width = a.gw; c.height = a.gh
  const g = c.getContext('2d')
  // drawImage with source crop downsamples with averaging good enough here
  g.drawImage(images.img, a.x0, a.y0, a.w, a.h, 0, 0, a.gw, a.gh)
  const d = g.getImageData(0, 0, a.gw, a.gh).data
  const grid = []
  for (let y = 0; y < a.gh; y++) {
    const row = []
    for (let x = 0; x < a.gw; x++) {
      const i = (y * a.gw + x) * 4
      row.push([d[i], d[i + 1], d[i + 2]])
    }
    grid.push(row)
  }
  return { grid }
}, { x0: 100, y0: 170, w: 1320, h: 670, gw: 120, gh: 61 })

fs.mkdirSync(path.join(HERE, 'out'), { recursive: true })
fs.writeFileSync(path.join(HERE, 'out/suomenlinna-grid.json'), JSON.stringify(result.grid))
console.log('sampled', result.grid[0].length, 'x', result.grid.length)
