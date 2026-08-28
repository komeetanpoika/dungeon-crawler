// Draw 16x16 placeholder animal sprites until real art lands (see
// extract-npc-sprites.mjs). Usage: node tools/npc-placeholders.mjs
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { writePng } from './png-write.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/assets/tiles')
const O = [28, 25, 23, 255]   // outline
const T = [0, 0, 0, 0]

function paint(rows, pal) {
  const rgba = new Uint8Array(16 * 16 * 4)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = ch === '.' ? T : ch === '#' ? O : pal[ch]
    rgba.set(c, (y * 16 + x) * 4)
  }))
  return rgba
}
const CHICKEN = paint([
  '................', '................', '.......##.......', '......#rr#......',
  '.....##ww##.....', '....#wwwwww#....', '...#wwwwwwww#...', '...#wwwwwwww#..#',
  '..#wwwwwwwwww##.', '..#wwwwwwwwww#..', '..#wwwwwwwww#...', '...#wwwwwww#....',
  '....########....', '.....#y##y#.....', '.....#..#.......', '................',
], { r: [220, 60, 60, 255], w: [240, 236, 220, 255], y: [230, 170, 50, 255] })
const DEER = paint([
  '..#.........#...', '..##..#..#..##..', '...#..#..#..#...', '...##.####.##...',
  '....#bbbbbb#....', '....#bwbbwb#....', '...#bbbbbbbb#...', '..#bbbbbbbbbb#..',
  '.#bbbbbbbbbbbb#.', '.#bbbbbbbbbbbb#.', '..#bbbbbbbbbb#..', '..#b#b####b#b#..',
  '..#b#.#..#.#b#..', '..#b#.#..#.#b#..', '..##..##.##.##..', '................',
], { b: [150, 100, 60, 255], w: [245, 235, 215, 255] })

for (const [name, px] of [['npc_chicken', CHICKEN], ['npc_deer', DEER]]) {
  const p = path.join(OUT, `${name}.png`)
  if (process.argv.includes('--force') || !existsSync(p)) { writePng(p, 16, 16, px); console.log('wrote', p) }
  else console.log('kept', p)
}
