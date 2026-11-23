// Draws Kalevanlinna's tile kit (renderer/wilds/city/kit.js) into
// renderer/assets/tiles/: everything the Kenney packs do not have as a tile
// of their own. What the packs do have is cut by
// tools/static-overworld/extract-tiles.mjs (run that first: some art here is
// built on its tiles, Tiny Town's above all, so the city keeps their palette,
// their outline and their light from the top left).
//
//   node tools/city/make-city-tiles.mjs                 draw the tiles
//   node tools/city/make-city-tiles.mjs --sheet f.png   and a contact sheet
//     --panel <text>   only the sheet's panels whose title holds <text>
//     --scale <n>      the sheet's scale (3)
//     --dry            draw but write no tiles (the sheet shows what was drawn)
//
// Multi-cell pieces are drawn whole and sliced into 16x16 tiles. The modules:
// fort.mjs (walls, towers, gates, harbour, castle), town.mjs (church,
// townhouses, shops, roofs, signs), street.mjs (paving, props, windmill),
// fx.mjs (the sprites drawn over the town: smoke, birds in flight, the cart);
// sheet.mjs and scene.mjs lay the contact sheet.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writePng } from '../png-write.mjs'
import { T, loadTiles } from './lib.mjs'
import { setSources } from './common.mjs'
import { CITY_SKINS } from '../../renderer/wilds/city/kit.js'

const TILES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../renderer/assets/tiles')
const args = process.argv.slice(2)
const sheetAt = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : null

const art = new Map()      // tile name -> Pic 16x16
const put = (name, pic) => {
  if (pic.w !== T || pic.h !== T) throw new Error(`${name}: ${pic.w}x${pic.h}`)
  if (art.has(name)) throw new Error(`${name} drawn twice`)
  art.set(name, pic)
}
// lay a picture over a grid of names, one 16x16 cell each
const putGrid = (names, pic) => names.forEach((row, cy) => row.forEach((n, cx) => put(n, pic.cell(cx, cy))))
const putRow = (names, pic, cy = 0) => names.forEach((n, cx) => put(n, pic.cell(cx, cy)))

// the tiles the art is built on: Tiny Town's brick (the wall, every tower),
// its red roof (recoloured), door and windows; the RPG pack's stall
setSources(await loadTiles(TILES, [
  'ow_brick', 'ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r', 'ow_roof_red_chim', 'ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er', 'ow_roof_gable_red',
  'ow_house_door', 'ow_house_win_stone', 'ow_house_win_brown', 'ow_stall_top', 'ow_stall_front',
]))

const ctx = { put, putGrid, putRow }
for (const mod of ['./fort.mjs', './town.mjs', './street.mjs', './fx.mjs']) (await import(mod)).draw(ctx)

// ==== write ===================================================================
const missing = CITY_SKINS.filter(n => !art.has(n) && !fs.existsSync(`${TILES}/${n}.png`))
const stray = [...art.keys()].filter(n => !CITY_SKINS.includes(n))
if (stray.length) throw new Error(`drawn but not in the kit: ${stray.join(' ')}`)
if (missing.length) throw new Error(`kit names with no tile (cut by extract-tiles.mjs?): ${missing.join(' ')}`)
if (!args.includes('--dry')) for (const [name, pic] of art) writePng(`${TILES}/${name}.png`, T, T, pic.d)
console.log(`${args.includes('--dry') ? 'drew' : 'wrote'} ${art.size} city tiles`)

// ==== the contact sheet =======================================================
// Every tile of the kit at x3 on grass, multi-cell pieces put together, and a
// street scene beside a Wilds village house to judge them as one set.
if (sheetAt) {
  const { sheetPanels } = await import('./sheet.mjs')
  const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null
  await sheetPanels(sheetAt, art, TILES, { only: opt('--panel'), scale: Number(opt('--scale') ?? 3) })
}
