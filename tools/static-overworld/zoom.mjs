// Zoom labeled regions of the RPG spritesheet for exact tile-picking.
// Usage: SCRATCH=... node zoom.mjs c0 r0 c1 r1 outname
import { runPixels } from './px.mjs'
import * as path from 'node:path'

const SCRATCH = process.env.SCRATCH
const [c0, r0, c1, r1, name] = process.argv.slice(2)
const sheet = path.join(SCRATCH, 'rpg-x/Spritesheet/roguelikeSheet_transparent.png')

await runPixels({ sheet }, (images, a) => {
  const img = images.sheet
  const STRIDE = 17, T = 16, Z = 7, M = 40
  const nc = a.c1 - a.c0 + 1, nr = a.r1 - a.r0 + 1
  const c = document.createElement('canvas')
  c.width = M + nc * (T * Z + 4); c.height = M + nr * (T * Z + 4)
  const g = c.getContext('2d')
  g.fillStyle = '#334'; g.fillRect(0, 0, c.width, c.height)
  g.imageSmoothingEnabled = false
  g.font = '14px monospace'; g.fillStyle = '#cef'; g.textAlign = 'center'
  for (let i = 0; i < nc; i++) g.fillText(a.c0 + i, M + i * (T * Z + 4) + T * Z / 2, 16)
  g.textAlign = 'left'
  for (let j = 0; j < nr; j++) g.fillText(a.r0 + j, 4, M + j * (T * Z + 4) + T * Z / 2)
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++)
    g.drawImage(img, (a.c0 + i) * STRIDE, (a.r0 + j) * STRIDE, T, T,
      M + i * (T * Z + 4), M + j * (T * Z + 4), T * Z, T * Z)
  return { files: { [a.name + '.png']: c.toDataURL() } }
}, { c0: +c0, r0: +r0, c1: +c1, r1: +r1, name }, path.join(SCRATCH, 'sheets'))
console.log('ok', name)
