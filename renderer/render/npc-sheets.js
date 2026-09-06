// Sheet-drawn NPCs: a species whose data/npcs.js entry names a `sheet` blits
// one cell of renderer/assets/npcs/<sheet>.png (built by tools/extract-<sheet>
// -sheet.mjs, grid in the generated <sheet>-sheet.js) instead of a 16x16
// tile. The frame comes from systems/npc-anim.js. A sheet cell keeps its own
// aspect and is drawn `tiles` tiles wide, paws on the tile's baseline, flipped
// to face west like every other creature. Until the image has loaded (or in
// Node, where there is no Image) a flat silhouette stands in so the animal
// never blinks out.
import { SHEET as WOLF } from '../assets/npcs/wolf-sheet.js'
import { npcFrame } from '../systems/npc-anim.js'

const R = Math.round
export const NPC_SHEETS = {
  wolf: { meta: WOLF, tiles: 1.5, silhouette: '#4b5556',
          url: new URL('../assets/npcs/wolf.png', import.meta.url).href },
}

const images = {}
function sheetImage(name) {
  if (!(name in images) && typeof Image !== 'undefined') { const img = new Image(); img.src = NPC_SHEETS[name].url; images[name] = img }
  const img = images[name]
  return img && img.complete && img.naturalWidth > 0 ? img : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(name, img) { images[name] = img }

// (px, py) is the tile's top-left on screen, S the tile size on screen.
export function drawNpcSheet(ctx, e, name, px, py, S, flip) {
  const def = NPC_SHEETS[name]
  if (!def) return false
  const { cellW, cellH, rows } = def.meta
  const dw = R(S * def.tiles), dh = R(dw * cellH / cellW)
  const dx = R(px + S / 2 - dw / 2), dy = R(py + S - dh)
  const img = sheetImage(name)
  ctx.save()
  if (flip) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1) } else ctx.translate(dx, dy)
  if (img) {
    const { row, frame } = npcFrame(e, def.meta)
    ctx.drawImage(img, frame * cellW, rows[row].row * cellH, cellW, cellH, 0, 0, dw, dh)
  } else {
    ctx.fillStyle = def.silhouette
    ctx.fillRect(R(dw * 0.1), R(dh * 0.3), R(dw * 0.8), R(dh * 0.5))
    ctx.fillRect(R(dw * 0.7), R(dh * 0.1), R(dw * 0.25), R(dh * 0.4))
  }
  ctx.restore()
  return true
}
