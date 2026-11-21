// Build the interior tile kit (renderer/interior/kit.js) into
// renderer/assets/tiles/in_*.png: cut from Kenney's Roguelike/RPG pack (CC0,
// https://kenney.nl/assets/roguelike-rpg-pack, a 57x31 sheet at a 17 px
// stride) and drawn from pixel maps where the pack has nothing.
//
//   SCRATCH=/path/with/rpg-x node tools/interiors/extract-tiles.mjs
//
// $SCRATCH/rpg-x/ is the pack unzipped, as for tools/static-overworld/extract-tiles.mjs.
// Every name in INTERIOR_SKINS must have a source here (the tool stops if one
// does not); items marked `dusty` in the kit get a `_d` twin, greyed.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runPixels } from '../static-overworld/px.mjs'
import { INTERIOR_SKINS, ITEMS, PALETTES } from '../../renderer/interior/kit.js'

const SCRATCH = process.env.SCRATCH
if (!SCRATCH) { console.error('set SCRATCH to the folder holding rpg-x/'); process.exit(1) }
const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/assets/tiles')
const SHEET = path.join(SCRATCH, 'rpg-x/Spritesheet/roguelikeSheet_transparent.png')

// A layer: { c, r } a sheet cell (optional f: canvas filter, rot: degrees,
// s: scale, dx/dy: offset in px, flip: mirror left-right) | { px, pal } a
// pixel map | { ref } a tile built earlier in SOURCES. `ops` run on the
// finished tile: 'cold' turns fire to ash.
const cell = (c, r, o = {}) => ({ c, r, ...o })
const SOURCES = {}
const src = (name, layers, ops = []) => { SOURCES[name] = { layers: Array.isArray(layers) ? layers : [layers], ops } }

// ---- walls: four palettes laid out alike, 7 columns apart ---------------
const BASE = { plaster: 13, grey: 20, pale: 27, wood: 34 }
// wall-top mask (N1 E2 S4 W8) -> [column offset, row]
const TOP = { 0: [1, 13], 1: [0, 14], 2: [0, 12], 3: [3, 13], 4: [0, 13], 5: [2, 13], 6: [3, 12], 7: [5, 12],
  8: [2, 12], 9: [4, 13], 10: [1, 12], 11: [6, 12], 12: [4, 12], 13: [5, 13], 14: [6, 13], 15: [1, 13] }
for (const p of PALETTES) {
  const b = BASE[p]
  for (const [m, [dc, r]] of Object.entries(TOP)) src(`in_wall_${p}_${m}`, cell(b + dc, r))
  src(`in_faceu_${p}_l`, cell(b + 4, 16)); src(`in_faceu_${p}_m`, cell(b + 5, 16)); src(`in_faceu_${p}_r`, cell(b + 6, 16))
  src(`in_facel_${p}_l`, cell(b + 1, 15)); src(`in_facel_${p}_m`, cell(b, 15)); src(`in_facel_${p}_r`, cell(b + 3, 15)); src(`in_facel_${p}_lr`, cell(b + 2, 15))
}

// ---- floors and rugs -------------------------------------------------------
const FLOOR = { planks: [8, 2], boards: [9, 2], flags: [5, 2], greyflags: [6, 2], cream: [7, 2], earth: [5, 4] }
for (const [n, [c, r]] of Object.entries(FLOOR)) {
  src(`in_floor_${n}`, cell(c, r))
  src(`in_floor_${n}_worn`, n === 'earth' ? cell(6, 4) : cell(c, r + 1))
}
// the pack's third rug (teal) reads as a pool of water; red and blue are the
// orange one turned
const RUG_ROW = { green: [16], orange: [19], red: [19, 'hue-rotate(-28deg) saturate(1.15) brightness(0.92)'], blue: [19, 'hue-rotate(185deg) saturate(0.7) brightness(0.95)'] }
for (const [c, [r0, f]] of Object.entries(RUG_ROW))
  ['t', 'm', 'b'].forEach((v, dy) => ['l', 'm', 'r'].forEach((h, dx) => src(`in_rug_${c}_${v}${h}`, cell(10 + dx, r0 + dy, f ? { f } : {}))))

// ---- pixel maps for what the pack lacks -------------------------------------
const WEB = { w: 'rgba(232,234,244,0.78)', v: 'rgba(232,234,244,0.42)' }
const webTL = [
  'ww.w...w....w...',
  'w.ww...w...w....',
  '.ww.w..w..w.....',
  'w.ww.w.w.w......',
  '..w.wwvwvw......',
  'w..wwwwww.......',
  '.w.vwwwv........',
  '..wwwwv.........',
  'wwwwvw..........',
  '...wv...........',
  '..w.w...........',
  '.v..w...........',
  'w...v...........',
  '................',
  '................',
  '................',
]
const flipRows = rows => rows.map(r => [...r].reverse().join(''))
const webFloor = [
  '................',
  '.v.....w.....v..',
  '..w....w....w...',
  '...w..vwv..w....',
  '....wwwwwwww....',
  '...vw..w..wv....',
  '..w.w..w..w.w...',
  'vwwwwwwwwwwwwwv.',
  '..w.w..w..w.w...',
  '...vw..w..wv....',
  '....wwwwwwww....',
  '...w..vwv..w....',
  '..w....w....w...',
  '.v.....w.....v..',
  '................',
  '................',
]
src('in_web_tl', { px: webTL, pal: WEB })
src('in_web_tr', { px: flipRows(webTL), pal: WEB })
src('in_web_wall', { px: webTL, pal: WEB })
src('in_web_floor', { px: webFloor, pal: WEB })
src('in_doormat', { px: [
  '................',
  '................',
  '................',
  '................',
  '..f.f.f.f.f.f...',
  '.oooooooooooooo.',
  '.orRrRrRrRrRrro.',
  '.oRyyyyyyyyyyRo.',
  '.orRrRrRrRrRrro.',
  '.oRrRrRrRrRrRro.',
  '.oooooooooooooo.',
  '..f.f.f.f.f.f...',
  '................',
  '................',
  '................',
  '................',
], pal: { o: '#4a2a18', r: '#8c3b2a', R: '#a3503a', y: '#c58a3c', f: '#c9a27a' } })
src('in_bones', { px: [
  '................',
  '................',
  '................',
  '..bb........bb..',
  '.bbbs......bbbs.',
  '..bbbbs..bbbbs..',
  '....sbbbbbbs....',
  '......bbbb......',
  '....sbbbbbbs....',
  '..bbbbs..bbbbs..',
  '.bbbs......bbbs.',
  '..bs........bs..',
  '................',
  '................',
  '................',
  '................',
], pal: { b: '#e9e2cf', s: '#a49a85' } })
src('in_eggs', { px: [
  '................',
  '................',
  '................',
  '................',
  '.....ww.........',
  '....wWWw..ww....',
  '....wWWw.wWWw...',
  '.....ww..wWWw...',
  '...ww.....ww....',
  '..wWWw..ww......',
  '..wWWw.wWWw.....',
  '...ww..wWWw.....',
  '........ww......',
  '................',
  '................',
  '................',
], pal: { w: '#b9b6ad', W: '#efece4' } })
src('in_puddle', { px: [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....pppp.......',
  '...ppPPPPpp.....',
  '..pPPPhPPPPp....',
  '..pPPPPPPPPPpp..',
  '...ppPPPPPPPPp..',
  '.....ppppPPpp...',
  '.........pp.....',
  '................',
  '................',
  '................',
  '................',
], pal: { p: 'rgba(70,90,110,0.55)', P: 'rgba(90,120,150,0.55)', h: 'rgba(200,220,240,0.7)' } })

// The puzzle house's standing mirror: a glass panel on the diagonal in a
// wooden frame, on a little foot. '/' runs bottom-left to top-right.
function mirrorRows() {
  const rows = []
  for (let y = 0; y < 16; y++) {
    let row = ''
    for (let x = 0; x < 16; x++) {
      const s = x + y, inBox = x >= 2 && x <= 13 && y >= 1 && y <= 12
      let ch = '.'
      if (inBox && (s === 15)) ch = 'H'
      else if (inBox && (s === 14 || s === 16)) ch = 'G'
      else if (inBox && (s === 13 || s === 17)) ch = 'w'
      else if (inBox && (s === 12 || s === 18)) ch = 'd'
      if (y >= 12 && y <= 14 && x >= 5 && x <= 10) ch = y === 14 ? 'd' : (x === 5 || x === 10 ? 'd' : 'b')
      row += ch
    }
    rows.push(row)
  }
  return rows
}
const MIRROR = { w: '#9a6a3a', d: '#3b2414', G: '#8fd0ee', H: '#f1fcff', b: '#6b4524' }
src('in_sunmirror_a', { px: mirrorRows(), pal: MIRROR })
src('in_sunmirror_b', { px: flipRows(mirrorRows()), pal: MIRROR })
const PLANTER = [
  '...dddddddddd...',
  '...oOOOOOOOOo...',
  '....oOOOOOOo....',
  '....oOOOOOOo....',
  '.....oooooo.....',
  '................',
]
const potPal = { d: '#5a2e18', o: '#8a4a26', O: '#b8683a' }
src('in_sunseed', { px: [
  '................',
  '.......c........',
  '......cCc.......',
  '.....cCHCc......',
  '.....cCHCc......',
  '....cCCHCCc.....',
  '....cCCHCCc.....',
  '.....cCCCc......',
  '......cCc.......',
  '.......c........',
  ...PLANTER,
], pal: { ...potPal, c: '#5f6d96', C: '#9eaedb', H: '#dfe6ff' } })
src('in_sunbloom', { px: [
  '.....g.gg.g.....',
  '...g.yYYYYy.g...',
  '..g.yYYyyYYy.g..',
  '...yYYoOOoYYy...',
  '..gyYyOWWOyYyg..',
  '...yYyOWWOyYy...',
  '..g.yYoOOoYy.g..',
  '....yYYyyYYy....',
  '...g.yyLLyy.g...',
  '.......LL.......',
  ...PLANTER,
], pal: { ...potPal, g: 'rgba(255,230,120,0.45)', y: '#e8a21e', Y: '#ffd84a', o: '#c46a12', O: '#e8901e', W: '#fff4c0', L: '#4f8a3a' } })
// a clay pot for the house plants (the pack's flowers are ground flowers)
const POT = { px: [
  '................', '................', '................', '................', '................',
  '................', '................', '................', '................', '................',
  ...PLANTER.map(r => r), // rows 10-15
], pal: potPal }
src('in_plant_a', [cell(28, 9, { s: 0.85, dy: -3 }), POT])
src('in_plant_b', [cell(29, 9, { s: 0.85, dy: -3 }), POT])
src('in_plant_c', [cell(25, 9, { s: 0.7, dy: -4 }), POT])
src('in_plant_dead', [cell(27, 9, { s: 0.55, dy: -4, f: 'grayscale(0.6) brightness(0.8)' }), POT])
// the alcove that opens when the sun reaches its seed (pale palette)
const NICHE = { d: '#2a2420', K: '#120e0c', k: '#2e2622' }
src('in_niche_top', { px: [
  '................', '................', '................', '................', '................',
  '................',
  '.....dddddd.....',
  '....dKKKKKKd....',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
], pal: NICHE })
src('in_niche_floor', [cell(BASE.pale, 15), { px: [
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dKKKKKKKKd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dkkkkkkkkd...',
  '...dddddddddd...',
], pal: NICHE }])
const crack = { px: [
  '................', '................', '................', '....k...........', '.....k..........',
  '.....kk.........', '......k.k.......', '.......k........', '......k.k.......', '.....k...k......',
  '................', '................', '................', '................', '................', '................',
], pal: { k: '#1a1410' } }
src('in_window_broken', [cell(42, 0, { f: 'grayscale(0.4) brightness(0.75)' }), crack])

// ---- furniture and dressing from the sheet ----------------------------------
const SHEET_CELLS = {
  in_wardrobe_t: [28, 3], in_wardrobe_b: [28, 4], in_wardrobe2_t: [26, 5], in_wardrobe2_b: [26, 6],
  in_vanity_t: [29, 3], in_vanity_b: [29, 4], in_tallmirror_t: [25, 7], in_tallmirror_b: [25, 8],
  in_books_1: [43, 12], in_books_2: [43, 14], in_books_3: [46, 12], in_books_4: [47, 14],
  in_shelf_empty: [41, 13], in_books_5: [45, 14],
  in_hearth_t: [54, 9], in_hearth_b: [54, 10],
  in_window_tall_t: [44, 2], in_window_tall_b: [44, 3], in_window_orange_t: [45, 2], in_window_orange_b: [45, 3],
  in_window_green_t: [46, 2], in_window_green_b: [46, 3], in_window_teal_t: [47, 2], in_window_teal_b: [47, 3],
  in_window: [42, 0], in_window_white: [43, 0], in_window_curtain: [46, 4], in_window_round: [45, 0],
  in_painting_green: [29, 10], in_painting_orange: [30, 10], in_painting_teal: [31, 10], in_portrait: [29, 11],
  in_mirror_round: [24, 8], in_clock: [26, 8], in_plateshelf: [31, 2], in_potshelf: [31, 3], in_bottleshelf: [29, 2],
  in_hanging_pots: [31, 4], in_antlers: [14, 5], in_banner_orange: [51, 0], in_banner_teal: [51, 3], in_banner_green: [51, 6],
  in_torch: [17, 7], in_net_l: [51, 14], in_net_m: [52, 14], in_net_r: [53, 14],
  in_dresser: [24, 5], in_nightstand: [25, 5], in_cupboard: [24, 6], in_drawers: [23, 6],
  in_stove: [26, 7], in_oven: [13, 0], in_oven_cold: [12, 0], in_sink: [28, 0], in_dishes: [30, 0], in_jars: [31, 0],
  in_worktop: [23, 3], in_chest: [37, 9],
  in_bed_v_t: [15, 3], in_bed_v_b: [15, 4], in_bed_v2_t: [17, 3], in_bed_v2_b: [17, 4],
  in_bed_v3_t: [16, 3], in_bed_v3_b: [16, 4], in_bed_v4_t: [14, 3], in_bed_v4_b: [14, 4],
  in_bedroll: [12, 3], in_bedroll2: [13, 2],
  in_table_l: [19, 6], in_table_r: [20, 6], in_table_small: [23, 4],
  in_chair_s: [19, 2], in_chair_n: [20, 2], in_chair_e: [21, 2], in_chair_w: [22, 2],
  in_stool: [18, 6], in_armchair: [25, 2], in_bench: [18, 4],
  in_barrel: [23, 0], in_barrel2: [26, 0], in_barrel3: [27, 0],
  in_crate: [27, 1], in_crate_bread: [13, 7], in_crate_cheese: [14, 7], in_crate_greens: [14, 6],
  in_sack: [26, 2], in_sack2: [27, 2], in_grain: [41, 10], in_floorchest: [37, 9],
  in_anvil: [15, 0], in_logs: [13, 8], in_candelabra: [19, 8],
  in_statue_t: [50, 10], in_statue_b: [50, 11], in_column: [20, 19], in_gravestone: [51, 9],
  in_rubble: [44, 10], in_skull: [49, 9], in_books_floor: [50, 15],
  in_flower_a: [28, 9], in_flower_b: [29, 9], in_flower_c: [30, 9], in_flower_d: [31, 9],
  in_panel: [25, 6],
}
for (const [n, [c, r]] of Object.entries(SHEET_CELLS)) src(n, cell(c, r))
src('in_hearth_t_cold', cell(54, 9), ['cold'])
src('in_hearth_b_cold', cell(54, 10), ['cold'])
src('in_table_food_l', [cell(19, 6), cell(54, 15, { s: 0.8, dy: -3 })])
src('in_table_food_r', [cell(20, 6), cell(55, 13, { s: 0.8, dy: -3 })])
src('in_table_cards_l', [cell(19, 6), { px: [
  '................', '................', '................', '.....ww.........', '....wwrw.ww.....',
  '....wrww.wrw....', '.....ww..www....', '................', '................', '................',
  '................', '................', '................', '................', '................', '................',
], pal: { w: '#f2eee2', r: '#b0302a' } }])
src('in_table_cards_r', [cell(20, 6), cell(55, 14, { s: 0.75, dy: -3 })])
src('in_table_candle', [cell(23, 4), cell(21, 7, { s: 0.8, dy: -4 })])
src('in_table_books', [cell(24, 4), cell(46, 15, { s: 0.7, dy: -4 })])
src('in_table_broken', cell(23, 4, { rot: 80, dy: 2 }))
src('in_chair_down', cell(21, 4, { rot: 90 }))

// ---- every name the kit uses needs a source; dusty twins follow ------------
const dustyNames = new Set(Object.values(ITEMS).filter(i => i.dusty).flatMap(i => i.tiles.flat()))
const missing = INTERIOR_SKINS.filter(n => n !== 'in_void' && !n.endsWith('_d') && !SOURCES[n] && !fs.existsSync(path.join(TILES, `${n}.png`)))
if (missing.length) { console.error('no source for:', missing.join(' ')); process.exit(1) }
const order = Object.keys(SOURCES)

await runPixels({ sheet: SHEET }, (images, { sources, order, dusty }) => {
  const files = {}, built = {}
  const make = () => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g] }
  for (const name of order) {
    const { layers, ops } = sources[name]
    const [c, g] = make()
    for (const L of layers) {
      g.save()
      if (L.px) {
        for (let y = 0; y < L.px.length; y++) for (let x = 0; x < L.px[y].length; x++) {
          const col = L.pal[L.px[y][x]]
          if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1) }
        }
      } else {
        const img = L.ref ? built[L.ref] : images.sheet
        if (L.f) g.filter = L.f
        g.translate(8 + (L.dx ?? 0), 8 + (L.dy ?? 0))
        if (L.rot) g.rotate(L.rot * Math.PI / 180)
        const s = L.s ?? 1
        g.scale(L.flip ? -s : s, s)
        if (L.ref) g.drawImage(img, -8, -8)
        else g.drawImage(img, L.c * 17, L.r * 17, 16, 16, -8, -8, 16, 16)
      }
      g.restore()
    }
    if (ops.includes('cold')) {
      const d = g.getImageData(0, 0, 16, 16), p = d.data
      for (let i = 0; i < p.length; i += 4) {
        const [r, gg, b] = [p[i], p[i + 1], p[i + 2]]
        if (p[i + 3] && r > 150 && r > gg + 25 && b < 120) { const v = 40 + (r + gg) / 12; p[i] = v; p[i + 1] = v * 0.95; p[i + 2] = v * 0.9 }
      }
      g.putImageData(d, 0, 0)
    }
    built[name] = c
    files[`${name}.png`] = c.toDataURL()
    if (dusty.includes(name)) {
      const [c2, g2] = make()
      g2.filter = 'grayscale(0.55) sepia(0.35) brightness(0.72)'
      g2.drawImage(c, 0, 0)
      files[`${name}_d.png`] = c2.toDataURL()
    }
  }
  // outside the house: nothing at all
  const [v] = make()
  files['in_void.png'] = v.toDataURL()
  return { files }
}, { sources: SOURCES, order, dusty: [...dustyNames] }, TILES)

console.log(`interior kit: ${order.length} tiles + ${dustyNames.size} dusty twins + void -> ${TILES}`)
