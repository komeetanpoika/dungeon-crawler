// Builds renderer/assets/tiles/weapon_ukonvasara.png: Ukko's hammer, the
// Kivihiisi's reward (systems/quests/pass.js) — a maul-headed war hammer
// drawn to the tileset's 16x16 stroke and palette (dark rim, a brown haft
// with one highlight, a steel head lit top-left, one spark of Ukko's
// lightning on the corner). Transcribed as a pixel map like the fire wand.
//
//   node tools/make-ukonvasara-tile.mjs
import { writePng } from './png-write.mjs'

const SHAPE = [
  '................',
  '....aaaaaaaa....',
  '...aLLLLLLLLa...',
  '...aLyssssdLa...',   // y: a spark on the lit corner
  '...aLsssssdDa...',
  '...aLssddddDa...',
  '...aLssddddDa...',
  '...aDDDDDDDDa...',
  '....aaahhaaa....',
  '......ahha......',
  '......ahha......',
  '......aHha......',
  '......aHha......',
  '......ahha......',
  '......ahha......',
  '......aaaa......',
]
const PALETTE = {
  a: [0x3f, 0x26, 0x31],   // dark rim (the tileset's outline)
  L: [0xc9, 0xce, 0xd6],   // steel, lit
  s: [0x8a, 0x8f, 0x98],   // steel
  d: [0x5a, 0x5f, 0x68],   // steel, shadow
  D: [0x3d, 0x41, 0x48],   // head underside
  h: [0x8b, 0x5a, 0x2b],   // haft
  H: [0xc5, 0x8b, 0x4a],   // haft highlight
  y: [0xfc, 0xd3, 0x4d],   // the spark (matches the lightning mark's yellow)
}

const W = 16, H = 16
const rgba = new Uint8Array(W * H * 4)
SHAPE.forEach((row, y) => [...row].forEach((ch, x) => {
  if (ch === '.') return
  const [r, g, b] = PALETTE[ch]
  rgba.set([r, g, b, 255], (y * W + x) * 4)
}))
const out = new URL('../renderer/assets/tiles/weapon_ukonvasara.png', import.meta.url).pathname
writePng(out, W, H, rgba)
console.log(`wrote ${out}`)
