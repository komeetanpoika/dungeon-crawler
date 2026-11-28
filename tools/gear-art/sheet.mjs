// A contact sheet of the hero in what he can wear, for looking over the art
// (tools/gear-art/build.mjs) before it ships.
//
//   node tools/gear-art/sheet.mjs <out.png> [scale]
//
// Three blocks, left to right: the Warrior in his tabard, the Archer, the
// Mage. In each block the columns are headwear (none, cap, helm, horned
// helm, headcloth) and the rows are armor (none, jerkin, mail, plate); a
// fifth row is the boots (none, elk, iron-shod, wayfarer's) with a ring on,
// and the last row of the sheet is every icon. Composed with the game's own
// rule (render/hero-look.js lookParts), from the tool's pixels and not from
// the files on disk, so it shows what a build would write.
import { buildAll } from './build.mjs'
import { writePng } from '../png-write.mjs'
import { lookParts } from '../../renderer/render/hero-look.js'
import { makePlayer, makeWornContents, makeOutfitContents, WORN_TYPES } from '../../renderer/systems/entities.js'

const S = 16
const [out, scaleArg] = process.argv.slice(2)
if (!out) { console.error('usage: node tools/gear-art/sheet.mjs <out.png> [scale]'); process.exit(1) }
const K = Number(scaleArg) || 6
const files = buildAll()
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const payload = c => { const { type, ...p } = c; return p }

function compose(look) {
  const px = new Uint8Array(S * S * 4)
  for (const name of [look.feet, look.body, look.head].filter(Boolean)) {
    const src = files[name]
    for (let i = 0; i < S * S * 4; i += 4) if (src[i + 3]) px.set(src.subarray(i, i + 4), i)
  }
  const dot = (colour, [x, y]) => px.set([...hex(colour), 255], (y * S + x) * 4)
  for (const at of look.toes?.at ?? []) dot(look.toes.colour, at)
  if (look.ring) dot(look.ring.colour, look.ring.at)
  return px
}

const CHARS = [['melee', 'plate'], ['ranged', 'ranger'], ['magic', 'robe']]
const HEADS = [null, 'cap', 'helm', 'horned', 'cloth'], ARMORS = [null, 'leather', 'chain', 'plate'], BOOTS = [null, 'elk', 'ironshod', 'wayfarer']
function dressed(stance, outfit, { head = null, armor = null, boots = null, ring = null } = {}) {
  const p = makePlayer(1, 1)
  p.gear[stance].outfit = payload(makeOutfitContents(outfit))
  for (const key of [head, armor, boots, ring]) if (key) p.gear[stance][WORN_TYPES[key].slot] = payload(makeWornContents(key))
  return compose(lookParts(p, stance))
}

const cells = []   // { col, row, px }
CHARS.forEach(([stance, outfit], b) => {
  ARMORS.forEach((armor, r) => HEADS.forEach((head, c) => cells.push({ col: b * 6 + c, row: r, px: dressed(stance, outfit, { head, armor }) })))
  BOOTS.forEach((boots, c) => cells.push({ col: b * 6 + c, row: 4, px: dressed(stance, outfit, { boots, ring: 'miser' }) }))
  cells.push({ col: b * 6 + 4, row: 4, px: dressed(stance, outfit, { head: 'helm', armor: 'plate', boots: 'ironshod', ring: 'breath' }) })
})
const icons = [...Object.keys(WORN_TYPES).map(k => `gear_${k}`), 'outfit_tabard']
icons.forEach((name, i) => cells.push({ col: i, row: 5, px: files[name] }))

const PAD = 2, CELL = S + PAD, COLS = 17, ROWS = 6
const W = COLS * CELL * K, H = ROWS * CELL * K
const sheet = new Uint8Array(W * H * 4)
for (let i = 0; i < W * H; i++) sheet.set([0x4a, 0x6e, 0x46, 255], i * 4)   // grass
for (const { col, row, px } of cells)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    if (!px[i + 3]) continue
    for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++)
      sheet.set(px.subarray(i, i + 4), (((row * CELL + y + 1) * K + dy) * W + (col * CELL + x + 1) * K + dx) * 4)
  }
writePng(out, W, H, sheet)
console.log(`${out}: ${W}x${H}. Blocks: Warrior | Archer | Mage. Columns: none, cap, helm, horned, cloth. Rows: none, jerkin, mail, plate, then boots (none, elk, iron-shod, wayfarer's; fifth: everything on), then icons: ${icons.join(' ')}`)
