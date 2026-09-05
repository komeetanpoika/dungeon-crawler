// Builds renderer/assets/tiles/weapon_firewand.png: the tileset's straight
// wand (tile_0129, the Storm Wand's art) with its purple tip repainted in
// fire colours, so each wand reads as its own colour — cyan Spark (wavy
// tile_0130), purple Storm (straight tile_0129), orange Fireball (this).
// The source tile is a 4-bit indexed PNG our reader does not parse, so the
// shape is transcribed here as a pixel map instead of read from disk.
//
//   node tools/make-firewand-tile.mjs
import { writePng } from './png-write.mjs'

const SHAPE = [
  '......aaaa......',
  '.....aaaaaa.....',
  '.....aaBBaa.....',   // B: tip highlight (flame yellow)
  '....aaaBBaaa....',
  '....aacbbcaa....',   // b: tip core (fire orange)
  '....aacbbcaa....',
  '....aadccdaa....',
  '....aaaeeaaa....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaddaa.....',
  '.....aaccaa.....',
  '.....aaccaa.....',
  '.....aaaaaa.....',
  '......aaaa......',
]
const PALETTE = {
  a: [0x3f, 0x26, 0x31],   // dark rim
  c: [0xbd, 0x6c, 0x4a],   // shaft
  d: [0xea, 0xa5, 0x6c],   // shaft highlight
  e: [0x76, 0x3b, 0x36],   // collar shadow
  b: [0xf9, 0x73, 0x16],   // fire orange (matches the Fireball Wand's bolt colour)
  B: [0xfc, 0xd3, 0x4d],   // flame-yellow tip
}

const W = 16, H = 16
const rgba = new Uint8Array(W * H * 4)
SHAPE.forEach((row, y) => [...row].forEach((ch, x) => {
  if (ch === '.') return
  const [r, g, b] = PALETTE[ch]
  rgba.set([r, g, b, 255], (y * W + x) * 4)
}))
const out = new URL('../renderer/assets/tiles/weapon_firewand.png', import.meta.url).pathname
writePng(out, W, H, rgba)
console.log(`wrote ${out}`)
