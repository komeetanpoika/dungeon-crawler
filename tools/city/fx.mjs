// The sprites of Kalevanlinna's small life (kit.js FX), drawn over the town a
// frame at a time by render/city-fx.js: chimney smoke and the quench's steam,
// a spark, a turnip splat, the busker's notes, the crier's hand bell, pigeons
// and gulls in flight, the horse and cart going north and south. Tiny Town's
// palette and its light from the top left, as the rest of the kit. Each is a
// 16x16 tile, the thing in the middle of it (the screen places it by its
// middle), but the birds and the cart, which sit where a tile's thing sits.
import { Pic, T } from './lib.mjs'
import { INK, S1, S2, W1, W2, W3, YEL, ORA, WHITE } from './common.mjs'
import { FX } from '../../renderer/wilds/city/kit.js'

// ---- smoke and steam: soft lumps of round puffs, no outline ----------------------
// circles [cx, cy, r]; lit from the top left, shaded to the bottom right
function puff(circles, [lit, body, shade]) {
  const p = new Pic(T, T)
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let best = null
    for (const [cx, cy, r] of circles) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r * r) continue
      const k = (dx + dy) / r                      // -1.4 top left .. 1.4 bottom right
      const c = k < -0.55 ? lit : k > 0.45 ? shade : body
      // the lump nearest the light wins where two overlap
      if (!best || k < best.k) best = { k, c }
    }
    if (best) p.set(x, y, best.c)
  }
  return p
}
const SMOKE = ['#d6dbe4', S1, S2]
const STEAM = [WHITE, '#eef2f8', '#d2dae6']
const smoke0 = () => puff([[8, 8, 2.6]], SMOKE)
const smoke1 = () => puff([[7.2, 8.6, 3], [9.4, 7.2, 2.6]], SMOKE)
const smoke2 = () => puff([[6.4, 9, 3.4], [9.8, 8.6, 3.2], [8.2, 5.8, 3]], SMOKE)
const steam0 = () => puff([[8, 8.4, 2.4], [9.6, 7.2, 1.8]], STEAM)
const steam1 = () => puff([[6.8, 8.8, 3], [9.8, 8.2, 2.8], [8.4, 5.6, 2.6]], STEAM)

// ---- a spark: a white heart, yellow round it ---------------------------------------
const spark = () => new Pic(T, T).map(['.o.', 'oWo', '.o.'], { o: YEL, W: WHITE }, 7, 7).set(9, 9, ORA)

// ---- a turnip burst on the cobbles: purple skin, white flesh, the leaves ------------
const splat = () => new Pic(T, T).map([
  '..g.......G.....',
  '.gG..p.....g....',
  '....ppwwp.......',
  '.p.pwwwwPp..p...',
  '..pwwwwwwPp.....',
  '.ppwwwwwwPPp....',
  '..pPwwwwPPp..w..',
  '....pPPPPp......',
  '.w.....p....p...',
], { p: '#b464b4', P: '#7a3a82', w: '#f4f1e8', g: '#84c669', G: '#479f4a' }, 0, 5)

// ---- the busker's tune: a quaver, two beamed --------------------------------------
const note0 = () => new Pic(T, T).map([
  '...aa..',
  '...aaa.',
  '...a.aa',
  '...a..a',
  '...a...',
  '.aaa...',
  'aaaa...',
  '.aa....',
], { a: INK }, 5, 4)
const note1 = () => new Pic(T, T).map([
  '...aaaaaa',
  '...aaaaaa',
  '...a....a',
  '...a....a',
  '...a....a',
  '.aaa..aaa',
  'aaaa.aaaa',
  '.aa...aa.',
], { a: INK }, 4, 4)

// ---- the crier's hand bell: brass under a turned wooden handle ----------------------
const handbell = () => new Pic(T, T).map([
  '...a...',
  '..awa..',
  '..aWa..',
  '..aaa..',
  '.ayyoa.',
  '.ayyoa.',
  'ayyyooa',
  'ayyyyoa',
  'aaaaaaa',
  '...a...',
], { a: INK, w: W1, W: W2, y: YEL, o: ORA }, 5, 3)

// ---- birds in flight, side on and facing east like the perched ones ---------------
// (tf_pigeon_* and tf_gull_* in tools/city/make-townsfolk.mjs: the same colours)
const PIGEON = { 1: '#b4bece', 2: '#8892a8', 3: '#4e5670', g: '#6aa890', p: '#9a78aa', e: '#262b44', '#': '#3f2631' }
const GULL = { W: '#f6f6f2', X: '#d4d8e0', G: '#b8c0cc', H: '#8890a2', 3: '#302e40', Y: '#f2c14e', e: '#262b44' }
const pigeonFly0 = () => new Pic(T, T).map([
  '....3.......',
  '....23......',
  '.....22.....',
  '.....221.11.',
  '3322222pg1e#',
  '.22111111...',
  '..1111......',
], PIGEON, 2, 4)
const pigeonFly1 = () => new Pic(T, T).map([
  '.........11.',
  '3322222pg1e#',
  '.2211122....',
  '..111222....',
  '......222...',
  '......223...',
  '.......3....',
], PIGEON, 2, 7)
const gullFly0 = () => new Pic(T, T).map([
  '.3...........',
  '..3G.........',
  '...GG........',
  '....GGX...WW.',
  '.HHXXWWWWWeYY',
  '..XWWWWWWW...',
  '....XXXX.....',
], GULL, 1, 4)
const gullFly1 = () => new Pic(T, T).map([
  '..........WW.',
  '.HHXXWWWWWeYY',
  '..XWWWWWWW...',
  '...GGXXX.....',
  '..GG.........',
  '.3...........',
], GULL, 1, 7)

// ---- the horse and cart going south and north --------------------------------------
// a: ink, b/w/W: the cart's boards light to dark, c/C: its sacks, h/H: the
// bay's coat and its shade, n: mane and tail, s: the shafts, r: the collar
const CART = { a: INK, b: W1, w: W2, W: W3, c: '#bfb5a0', C: '#e3dccb', h: W2, H: W3, n: INK, s: W3, e: WHITE, r: '#c34b35' }
// going south: the cart seen from the front over the horse coming on, between the shafts
const cartS0 = () => new Pic(T, T).map([
  '................',
  '...cCCc.cCCc....',
  '..cCCCCccCCCc...',
  '.aaaaaaaaaaaaaa.',
  'aabbbbbbbbbbbbaa',
  'aWawwwwwwwwwwaWa',
  'awawWwwwwWwwwawa',
  'aWawwwwwwwwwwaWa',
  'awaaaaaaaaaaaawa',
  'aWa..s....s..aWa',
  'aaa..s....s..aaa',
  '.....s....s.....',
  '....as....sa....',
  '....anaaaana....',
  '....ahnhhnha....',
  '....ahhhhhha....',
], CART)
const cartS1 = () => new Pic(T, T).map([
  '...ahhhnnhhha...',
  '...ahhhnnhhha...',
  '...arrrrrrrra...',
  '...aHaannaaHa...',
  '...aHahnnhaHa...',
  '...aHaehheaHa...',
  '...aHahhhhaHa...',
  '...aHaahhaaHa...',
  '...aHaaHHaaHa...',
  '...aaa.aa.aaa...',
], CART)
// going north: the horse's rump and tail over the cart seen from behind
const cartN0 = () => new Pic(T, T).map([
  '................',
  '......a..a......',
  '.....anaana.....',
  '.....ahnnha.....',
  '.....ahnnha.....',
  '....ahhnnhha....',
  '...ahhhhhhhha...',
  '...ahhhhhhhha...',
  '...aHhhnnhhHa...',
  '...aHha.nahHa...',
  '...aHa.nn.aHa...',
  '...aHa.na.aHa...',
  '...aaa..s.aaa...',
  '.....s....s.....',
  '.....s....s.....',
  '.....s....s.....',
], CART)
const cartN1 = () => new Pic(T, T).map([
  '.....s....s.....',
  '...cCCc.cCCc....',
  '..cCCCCccCCCc...',
  '.aaaaaaaaaaaaaa.',
  'aabbbbbbbbbbbbaa',
  'aWawwwwwwwwwwaWa',
  'awawwwwwwwwwwawa',
  'aWawWwwwwWwwwaWa',
  'awawwwwwwwwwwawa',
  'aWaaaaaaaaaaaaWa',
  'awa..........awa',
  'aaa..........aaa',
  '................',
  '................',
  '................',
  '................',
], CART)

export function draw({ put }) {
  [smoke0, smoke1, smoke2].forEach((f, i) => put(FX.smoke[i], f()))
  ;[steam0, steam1].forEach((f, i) => put(FX.steam[i], f()))
  put(FX.spark, spark())
  put(FX.splat, splat())
  put(FX.note[0], note0()); put(FX.note[1], note1())
  put(FX.handbell, handbell())
  put(FX.pigeonFly[0], pigeonFly0()); put(FX.pigeonFly[1], pigeonFly1())
  put(FX.gullFly[0], gullFly0()); put(FX.gullFly[1], gullFly1())
  put(FX.cartS[0], cartS0()); put(FX.cartS[1], cartS1())
  put(FX.cartN[0], cartN0()); put(FX.cartN[1], cartN1())
}
