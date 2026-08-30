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

// Split a 32x32 design (32 rows of 32 chars, row-major) into one 16x16
// quadrant: (r, c) = (0,0) top-left … (1,1) bottom-right — matches the
// custom_<name>_00|01|10|11 file suffixes the editor's 2x2 format expects.
function quad(rows32, r, c) {
  return rows32.slice(r * 16, r * 16 + 16).map(row => row.slice(c * 16, c * 16 + 16))
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

// Leap episode creatures (docs/superpowers/specs/2026-08-29-leap-episodes-design.md
// §4) — each is designed once on a 32x32 grid, then split into the four
// custom_<name>_00|01|10|11 16x16 quadrants the editor's 2x2 format expects
// (00 top-left, 01 top-right, 10 bottom-left, 11 bottom-right).

// Näkki — green-black water spirit, weed-hair, two pale eyes, head and
// shoulders only (it is always in water): a waterline bar closes off the
// bottom quadrants, and the surface below is left transparent but for a
// few ripples.
const NAKKI_32 = [
  '.............#..#..#............', '.............#..#..#............', '..........#..#..#..#..#.........', '..........#..#..#..#..#.........',
  '............########............', '..........##nnnnnnnn##..........', '.........#nnnnnnnnnnnn#.........', '........#nnnnnnnnnnnnnn#........',
  '........#nnneennnneennn#........', '........#nnneennnneennn#........', '.........#nnnnnnnnnnnn#.........', '..........#nnnnkknnnn#..........',
  '......####nnnnnnnnnnnn####......', '....##nnnnnnnnnnnnnnnnnnnn##....', '..##nnnnnnnnnnnnnnnnnnnnnnnn##..', '..############################..',
  '..#n##n##n##n##n##n##n##n##n##..', '................................', '................................', '....kk....kk....kk....kk...kk...',
  '................................', '................................', '.......nn....nn....nn....nn.....', '................................',
  '................................', '................................', '................................', '................................',
  '................................', '................................', '................................', '................................',
]
const NAKKI_PAL = { n: [60, 90, 60, 255], k: [20, 35, 30, 255], e: [220, 235, 200, 255] }

// Maahinen — brown burrower: a low squat mound (no waist), a blunt rounded
// snout lobe on the front-lower edge with one eye and two nostril dots, two
// big splayed claws below it with visible finger tips, and dust at the base.
const MAAHINEN_32 = [
  '................................', '................................', '................................', '................................',
  '................................', '................................', '..........############..........', '........##bbbbbbbbbbbb##........',
  '......##bbbbbbbbbbbbbbbb##......', '.....#bbbbbbbbbbbbbbbbbbbb#.....', '....#bbbbbbbbbbbbbbbbbddbbb#....', '....#bbbbbbbbbbbbbbbbbddbbb#....',
  '...#bbbbbbbbbbbbbbbbbbbbbbbb##..', '...#bbbbbbbbbbbbbbbbbbbbbbbbbb#.', '...#bbbbbbbbbbbbbbbbbbbbbbbbbbb#', '...#bbbbbbbbbbbbbbbbbbbbbbbbbbb#',
  '...#bbbbbbbbbbbbbbbbbbbbbbbddbb#', '...#bbbbbbbbbbbbbbbbbbbbbbbbbbb#', '...#bbbbbbbbbbbbbbbbbbbbbbbbbbb#', '...#bbbbbbbbbbbbbbbbbbbbbbbbbbb#',
  '....#bbbbbbbbbbbbbbbbbbbbbbddbb#', '....#bbbbbbbbbbbbbbbbbbbbbbbbbb#', '.....#####################bbbb#.', '.......#yyyy#......#yyyy#.####..',
  '......#yyyyyy#....#yyyyyy#......', '.....##########..##########.....', '......y..y...y....y..y...y......', '................................',
  '....t.....t.........t........t..', '......t.........t.........t.....', '.............t.........t........', '................................',
]
const MAAHINEN_PAL = { b: [120, 80, 45, 255], d: [70, 45, 25, 255], y: [235, 215, 150, 255], t: [210, 180, 140, 255] }

// Sammunut — blue-grey ragged wraith, hood, one ember eye, trailing wisps,
// no feet: the hem tears unevenly and dissolves into wisps below it.
const SAMMUNUT_32 = [
  '..............####..............', '............##gggg##............', '...........wggggggggw...........', '..........#gggggggggg#..........',
  '.........#gggggggggggg#.........', '.........wggggggggggggw.........', '........#gggggggggggggg#........', '........#gggggggggrgggg#........',
  '........#gggggggggrgggg#........', '.......#gggggggggggggggg#.......', '.......wggggggggggggggggw.......', '......#gggggggggggggggggg#......',
  '......#gggggggggggggggggg#......', '......#gggggggggggggggggg#......', '.....#gggggggggggggggggggg#.....', '.....#gggggggggggggggggggg#.....',
  '.....#gggggggggggggggggggg#.....', '.....#gggggggggggggggggggg#.....', '.....#gggggggggggggggggggg#.....', '.....#gggggggggggggggggggg#.....',
  '......#gggggggggggggggggg#......', '......####################......', '......#.#.#.#...#.#.#.#...#.#...', '......#.#...#...#...#.#...#.....',
  '.......g#...#...#...#.....#.....', '........g...#.......g...........', '.......g....#.........g.........', '.........g...........g..........',
  '..........g............g........', '...............g.........g......', '........w...g...g.........w.....', '.........w.......w......w.......',
]
const SAMMUNUT_PAL = { g: [120, 130, 160, 255], w: [200, 205, 220, 255], r: [255, 120, 40, 255] }

const CREATURES = [['nakki', NAKKI_32, NAKKI_PAL], ['maahinen', MAAHINEN_32, MAAHINEN_PAL], ['sammunut', SAMMUNUT_32, SAMMUNUT_PAL]]
const CREATURE_TILES = CREATURES.flatMap(([name, rows32, pal]) => [
  [`custom_${name}_00`, paint(quad(rows32, 0, 0), pal)],
  [`custom_${name}_01`, paint(quad(rows32, 0, 1), pal)],
  [`custom_${name}_10`, paint(quad(rows32, 1, 0), pal)],
  [`custom_${name}_11`, paint(quad(rows32, 1, 1), pal)],
])

for (const [name, px] of [['npc_chicken', CHICKEN], ['npc_deer', DEER], ['item_meat', MEAT],
  ['item_lumber', LUMBER], ['item_meat_cooked', MEAT_COOKED], ['ow_stump', STUMP], ['prop_campfire', CAMPFIRE],
  ['prop_hearth_cold', HEARTH_COLD], ['prop_hearth_lit', HEARTH_LIT],
  ['item_clapper', CLAPPER], ['item_fleece', FLEECE], ...CREATURE_TILES]) {
  const p = path.join(OUT, `${name}.png`)
  if (process.argv.includes('--force') || !existsSync(p)) { writePng(p, 16, 16, px); console.log('wrote', p) }
  else console.log('kept', p)
}
