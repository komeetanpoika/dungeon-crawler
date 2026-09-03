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

// Meat drumstick — the animal drop's sack/HUD icon (no such tile in the packs).
const MEAT = paint([
  '................', '................', '......####......', '.....#rrrr#.....',
  '....#rrrrrr#....', '....#rrpprr#....', '....#rrrrrr#....', '....#rrrrr#.....',
  '.....#rrr#......', '......#b#.......', '......#b#.......', '.......#b#......',
  '.......#b##.....', '........#ww#....', '.........##.....', '................',
], { r: [196, 96, 64, 255], p: [230, 140, 100, 255], b: [222, 205, 170, 255], w: [245, 240, 225, 255] })

// Lumber — two logs stacked, cut ends showing rings.
const LUMBER = paint([
  '................', '................', '................', '..############..',
  '.#bbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '.#bbbbbbbbbbbbc#',
  '..############..', '.#bbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#', '#rbbbbbbbbbbbbc#',
  '.#bbbbbbbbbbbbc#', '..############..', '................', '................',
], { b: [139, 90, 43, 255], c: [222, 184, 135, 255], r: [200, 160, 110, 255] })

// Cooked meat — the drumstick, browned with a char line.
const MEAT_COOKED = paint([
  '................', '................', '......####......', '.....#rrrr#.....',
  '....#rrkkrr#....', '....#rkrrkr#....', '....#rrrrrr#....', '....#rrrrr#.....',
  '.....#rrr#......', '......#b#.......', '......#b#.......', '.......#b#......',
  '.......#b##.....', '........#ww#....', '.........##.....', '................',
], { r: [150, 75, 40, 255], k: [80, 40, 20, 255], b: [222, 205, 170, 255], w: [245, 240, 225, 255] })

// Stump — a cut trunk seen from above-front, rings on the cut face.
const STUMP = paint([
  '................', '................', '................', '................',
  '................', '.....######.....', '....#ccccccc#...', '...#ccrrrrrcc#..',
  '...#crrcccrrc#..', '...#ccrrrrrcc#..', '...#bbbbbbbbb#..', '...#bbbbbbbbb#..',
  '...#bbbbbbbbb#..', '....#########...', '................', '................',
], { b: [110, 70, 35, 255], c: [222, 184, 135, 255], r: [190, 150, 100, 255] })

// Campfire — crossed logs with a flame.
const CAMPFIRE = paint([
  '................', '................', '.......#........', '......#y#.......',
  '.....#yyy#......', '.....#yoy#......', '....#yoooy#.....', '....#ooroo#.....',
  '...#oorrroo#....', '...#orrrrro#....', '....#rrrrr#.....', '.#bb#######bb#..',
  '..#bbbbbbbbb#...', '.#bbbb#b#bbbb#..', '..###..#..###...', '................',
], { y: [255, 230, 120, 255], o: [255, 150, 40, 255], r: [220, 60, 30, 255], b: [120, 75, 40, 255] })

// Cold hearth: a ring of stones round grey ash. Lit: the same ring with flame.
const HEARTH_COLD = paint([
  '................', '................', '................', '.....######.....',
  '....#ssssss#....', '...#saaaaaas#...', '...#saaaaaas#...', '...#saaaaaas#...',
  '...#saaaaaas#...', '....#ssssss#....', '.....######.....', '................',
  '................', '................', '................', '................',
], { s: [120, 120, 125, 255], a: [90, 88, 86, 255] })
const HEARTH_LIT = paint([
  '................', '.......#........', '......#y#.......', '.....#yoy#......',
  '....#soooos#....', '...#soorroos#...', '...#sorrrros#...', '...#soorroos#...',
  '...#saoooaas#...', '....#ssssss#....', '.....######.....', '................',
  '................', '................', '................', '................',
], { s: [120, 120, 125, 255], a: [90, 88, 86, 255], y: [255, 230, 120, 255], o: [255, 150, 40, 255], r: [220, 60, 30, 255] })

// Bell clapper — a bronze teardrop, the leap episode's quest item.
const CLAPPER = paint([
  '................', '................', '................', '.......##.......',
  '......#bb#......', '......#bb#......', '.....#bbbb#.....', '.....#bbbb#.....',
  '....#bbbbbb#....', '....#bbbbbb#....', '....#bbbbbb#....', '.....#bbbb#.....',
  '......#bb#......', '.......##.......', '................', '................',
], { b: [180, 130, 60, 255] })

// Lamb's fleece — a cream tuft, the leap episode's other quest item.
const FLEECE = paint([
  '................', '................', '..#w##w##w#.....', '.#wwwwwwwww#....',
  '#wwwwwwwwwwww#..', '#wwwwwwwwwwww#..', '#wwwwwwwwwwww#..', '.#wwwwwwwwww#...',
  '..#wwwwwwww#....', '...#wwwwww#.....', '................', '................',
  '................', '................', '................', '................',
], { w: [240, 235, 220, 255] })

// House-interior floorboards (docs/superpowers/specs/2026-08-30-house-interiors-design.md
// §2) — three horizontal boards (two brown shades) separated by darker seam
// rows. Fully opaque (no '.' transparent cells) since floor tiles always
// paint under everything else.
const FLOOR_WOOD = paint([
  'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa', 'ssssssssssssssss', 'bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb', 'ssssssssssssssss',
  'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa',
], { a: [150, 105, 60, 255], b: [130, 88, 48, 255], s: [70, 45, 25, 255] })

for (const [name, px] of [['npc_chicken', CHICKEN], ['npc_deer', DEER], ['item_meat', MEAT],
  ['item_lumber', LUMBER], ['item_meat_cooked', MEAT_COOKED], ['ow_stump', STUMP], ['prop_campfire', CAMPFIRE],
  ['prop_hearth_cold', HEARTH_COLD], ['prop_hearth_lit', HEARTH_LIT],
  ['item_clapper', CLAPPER], ['item_fleece', FLEECE], ['custom_floor_wood', FLOOR_WOOD]]) {
  const p = path.join(OUT, `${name}.png`)
  if (process.argv.includes('--force') || !existsSync(p)) { writePng(p, 16, 16, px); console.log('wrote', p) }
  else console.log('kept', p)
}
