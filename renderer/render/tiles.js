import { TILE } from '../systems/entities.js'
import { DUNE_PREFIX } from '../wilds/desert.js'
import { isHardpanSkin } from '../wilds/desert-art.js'

// Land the hero has only guessed at (behind a dune crest: `cell.guessed`,
// systems/entities.js computePlayerFOV) is drawn as plain desert, under the
// fog: its own ground when that is desert ground (the sand, rippled, shaded
// or slip face, a dune's crest, hardpan), else GUESS_SAND; never what stands
// on it. Sand fraying into grass (ow_sand_edge_*) counts as other ground: its
// grass would show.
export const GUESS_SAND = 'ow_sand_0'
const isDesertGround = n => typeof n === 'string'
  && ((n.startsWith('ow_sand') && !n.startsWith('ow_sand_edge')) || n.startsWith(DUNE_PREFIX) || isHardpanSkin(n))
export const guessSkin = cell => isDesertGround(cell?.skin) ? cell.skin : GUESS_SAND

// One map cell's art: the skin/default sprite, stair depth shading, and the
// deco (a rug) and overlay prop on top. Pure function of the cell and sprites — nothing here
// depends on time or camera, which is what lets tile-layer.js bake it.
function drawOverlay(ctx, tileObj, px, py, S, sprites) {
  // A house floor carries a third layer between its ground and what stands
  // on it: the rug under a table (renderer/interior/).
  if (tileObj?.deco && sprites[tileObj.deco]) ctx.drawImage(sprites[tileObj.deco], px, py, S, S)
  // furniture shadows (render/interior-shade.js): what stands above falls on
  // this cell, then this cell's own thing throws its shadow, then it stands
  if (tileObj?.castAbove && sprites[`${tileObj.castAbove}#below`]) ctx.drawImage(sprites[`${tileObj.castAbove}#below`], px, py, S, S)
  if (tileObj?.overlay && sprites[`${tileObj.overlay}#cast`]) ctx.drawImage(sprites[`${tileObj.overlay}#cast`], px, py, S, S)
  if (tileObj?.overlay && sprites[tileObj.overlay]) {
    ctx.drawImage(sprites[tileObj.overlay], px, py, S, S)
  }
}

// `part`: 'all' draws the whole cell. A cell that is walked under
// (`over`, wilds/over.js) is drawn in two goes round the people: 'under' its
// ground, 'over' what stands on it; 'over' draws nothing of any other cell.
// 'guess' draws a cell only guessed at (guessSkin), whatever it is.
export function drawTile(ctx, tileId, px, py, S, sprites, tileObj = null, part = 'all') {
  if (part === 'guess') { const g = sprites[guessSkin(tileObj)]; if (g) ctx.drawImage(g, px, py, S, S); return }
  if (part !== 'all') {
    if (part === 'over') { if (tileObj?.over) drawOverlay(ctx, tileObj, px, py, S, sprites); return }
    if (tileObj?.over) { const g = sprites[tileObj.skin] ?? sprites.floor; if (g) ctx.drawImage(g, px, py, S, S); return }
  }
  if (tileId === TILE.STAIR) {
    const w   = tileObj?.stairWidth ?? 1
    const col = tileObj?.stairCol   ?? 0
    let s
    if (w === 3) {
      s = col === 0 ? sprites.stair_left : col === 1 ? sprites.stair_mid : sprites.stair_right
    }
    s = s ?? sprites.stair
    if (s) ctx.drawImage(s, px, py, S, S)
    else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
    const depth = tileObj?.stairDepth
    if (depth > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(depth / 7, 1) * 0.85})`
      ctx.fillRect(px, py, S, S)
    }
    return
  }
  if (tileId === TILE.SNARE) {
    if (sprites.floor) ctx.drawImage(sprites.floor, px, py, S, S)
    ctx.fillStyle = 'rgba(0, 200, 200, 0.35)'
    ctx.fillRect(px, py, S, S)
    return
  }
  // Decoration-pass skin (only ever set on floor/wall cells)
  if (tileObj?.skin && sprites[tileObj.skin]) {
    ctx.drawImage(sprites[tileObj.skin], px, py, S, S)
    drawOverlay(ctx, tileObj, px, py, S, sprites)
    return
  }
  const s = (() => {
    switch (tileId) {
      case TILE.WALL:        return sprites.wall
      case TILE.FLOOR:       return sprites.floor
      case TILE.FLOOR_WOOD:  return sprites.floor_wood
      case TILE.COLUMN:      return sprites.column
      case TILE.DOOR:        return sprites.door
      case TILE.STAIRS_DOWN: return sprites.stairs_dn
      case TILE.STAIRS_UP:   return sprites.stairs_up
      case TILE.TREASURE:    return sprites.treasure
      case TILE.SHRINE:      return sprites.shrine
      case TILE.SAND:        return sprites.sand
      default: return null
    }
  })()
  if (s) ctx.drawImage(s, px, py, S, S)
  else { ctx.fillStyle = '#111'; ctx.fillRect(px, py, S, S) }
  if (tileId === TILE.STAIRS_DOWN && tileObj?.stairDepth > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(tileObj.stairDepth / 7, 1) * 0.85})`
    ctx.fillRect(px, py, S, S)
  }
  drawOverlay(ctx, tileObj, px, py, S, sprites)
}
