// The contact sheet of make-city-tiles.mjs: panels of tiles at x3, each a
// grid of cells; a cell is a tile name, a stack [ground, overlay, ...] or null.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { encodePng } from '../png-write.mjs'
import { runPixels } from '../static-overworld/px.mjs'
import { T } from './lib.mjs'
import { WALL, TOWER, GATE, HARBOUR, CASTLE, CHURCH, HOUSE_FRONT, PAVE, PROPS, FX, CITY_SKINS } from '../../renderer/wilds/city/kit.js'
import { scene } from './scene.mjs'

const row = (...names) => names
const tower = t => [...t.cap, t.body, t.base]

export function panels() {
  const P = []
  const add = (title, cells, opts = {}) => P.push({ title, cells, ...opts })
  const H = HOUSE_FRONT
  add('WALL top by mask (N1 E2 S4 W8), turret', [WALL.top.slice(0, 8), [...WALL.top.slice(8), WALL.turret]], { labels: true })
  add('WALL faces: upper (l m r lr m2 slit) / lower (l m r lr m2)', [Object.values(WALL.upper), Object.values(WALL.lower)], { labels: true })
  add('TOWER round3 round4 square3 square4 (cap, body, base); HARBOUR tower', joinH([tower(TOWER.round3), tower(TOWER.round4), tower(TOWER.square3), tower(TOWER.square4), [...HARBOUR.tower.head, HARBOUR.tower.body, HARBOUR.tower.base]]))
  add('GATE arch2, arch3, side; CASTLE gate2, gate2Open, gate3', joinH([GATE.arch2, GATE.arch3, GATE.side.map(n => [n]), CASTLE.gate2, CASTLE.gate2Open, CASTLE.gate3]), { ground: 'ow_city_pave_cobble_0' })
  add('HARBOUR chain l m float r over water; quay n e s w ne nw se sw, face, mole, bollard', [
    [HARBOUR.chain.l, HARBOUR.chain.m, HARBOUR.chain.float, HARBOUR.chain.m, HARBOUR.chain.r].map(n => ['ow_water_0', n]),
    Object.values(HARBOUR.quay), [['ow_water_0', HARBOUR.face], ...HARBOUR.mole, ['ow_city_pave_flag_0', HARBOUR.bollard]]], { labels: true })
  add('CASTLE roof (ridge, slope, eave), keep faces (upper, lower, door), banner a b, pennant a b, top', joinH([
    [CASTLE.roof.ridge, CASTLE.roof.slope, CASTLE.roof.eave, Object.values(CASTLE.upper), [CASTLE.lower.l, CASTLE.lower.m, CASTLE.lower.win, ...CASTLE.lower.door, CASTLE.lower.r]],
    [[CASTLE.upper.m, CASTLE.upper.m], [[CASTLE.upper.m, CASTLE.banner[0]], [CASTLE.upper.m, CASTLE.banner[1]]], [[TOWER.round3.cap[0][1], CASTLE.pennant[0]], [TOWER.round3.cap[0][1], CASTLE.pennant[1]]]],
    CASTLE.top]))
  add('CHURCH roof, nave faces, door, apse; bell tower', joinH([
    [[...CHURCH.roof.ridge, ...CHURCH.apse.ridge], [...CHURCH.roof.slope, ...CHURCH.apse.slope], [...CHURCH.roof.eave, ...CHURCH.apse.eave],
      [CHURCH.upper.l, CHURCH.upper.win, ...CHURCH.upper.doorTop, CHURCH.upper.m, CHURCH.upper.r, ...CHURCH.apse.upper],
      [CHURCH.lower.l, CHURCH.lower.win, ...CHURCH.lower.door, CHURCH.lower.m, CHURCH.lower.r, ...CHURCH.apse.lower]],
    [...CHURCH.tower.spire, CHURCH.tower.belfry, CHURCH.tower.body, CHURCH.tower.rose, CHURCH.tower.base]]))
  add('HOUSE_FRONT walls (l m win win2 door r) by material', Object.entries(H.walls).map(([, w]) => [w.l, w.m, w.win, w.win2, w.door, w.r]), { labels: true })
  add('HOUSE_FRONT shops, roofs (l m chim r / el em gable er), signs', [
    [...Object.values(H.shop.red), null, ...Object.values(H.shop.green)],
    ...[['red', 'blue'], ['brown', 'dark']].flatMap(([a, b]) => [
      [H.roofs[a].l, H.roofs[a].m, H.roofs[a].chim, H.roofs[a].r, null, H.roofs[b].l, H.roofs[b].m, H.roofs[b].chim, H.roofs[b].r],
      [H.roofs[a].el, H.roofs[a].em, H.roofs[a].gable, H.roofs[a].er, null, H.roofs[b].el, H.roofs[b].em, H.roofs[b].gable, H.roofs[b].er]]),
    Object.values(H.signs).map(n => ['ow_grass_0', H.walls.white.m, n]),
  ])
  add('PAVE square (2x2 x2), cobble 0-3, kerb n e s w, flag, alley, gutter h v, drain', [
    [...PAVE.square[0], ...PAVE.square[0], null, ...PAVE.cobble, null, ...Object.values(PAVE.kerb)],
    [...PAVE.square[1], ...PAVE.square[1], null, ...PAVE.flag, ...PAVE.alley, null, PAVE.gutter.h, PAVE.gutter.v, PAVE.drain],
    [...PAVE.square[0], ...PAVE.square[0]], [...PAVE.square[1], ...PAVE.square[1]]], { labels: false })
  add('PROPS', [
    [PROPS.lamp, PROPS.lampLit, PROPS.bench, PROPS.benchSide, ...PROPS.planter, ...PROPS.washing, PROPS.stocks, PROPS.crier, ...PROPS.cart, PROPS.turnip, PROPS.turnips, PROPS.anvil, PROPS.forge],
    [...PROPS.stall.blue.slice(0, 1), PROPS.stall.red[0], PROPS.stall.green[0], ...PROPS.produce, PROPS.well[0], null, ...PROPS.bed[0]],
    [PROPS.stall.blue[1], PROPS.stall.red[1], PROPS.stall.green[1], null, null, null, PROPS.well[1], null, ...PROPS.bed[1]],
    [null, null, null, null, null, null, null, null, ...PROPS.bed[2]],
  ], { labels: true, ground: 'ow_city_pave_flag_0' })
  add('PROPS windmill base, sails frames 0-3 (alone and over the base)', joinH([PROPS.windmill.base, ...PROPS.windmill.sails, ...PROPS.windmill.sails.map(f => f.map((r, y) => r.map((n, x) => [PROPS.windmill.base[y][x], n])))]))
  add('FX smoke, steam, spark, splat, notes, hand bell; birds perched and flying; washing out and in', [
    [...FX.smoke, ...FX.steam, FX.spark, FX.splat, ...FX.note, FX.handbell],
    ['tf_pigeon_a', 'tf_pigeon_b', ...FX.pigeonFly, null, 'tf_gull_a', 'tf_gull_b', ...FX.gullFly],
    [...PROPS.washing, null, ...PROPS.line],
  ], { labels: true, ground: 'ow_city_pave_square_00' })
  add('FX the cart going south, north (cart over horse, horse over cart), west and east, a carter on the box', joinH([
    FX.cartS.map(n => [n]), FX.cartN.map(n => [n]), [[PROPS.cart[0], PROPS.cart[1]]],
  ]), { ground: 'ow_city_pave_cobble_0' })
  // anything of the kit not shown above, so the sheet holds every tile
  const shown = new Set(P.flatMap(p => p.cells.flat(2)).filter(Boolean))
  const rest = CITY_SKINS.filter(n => !shown.has(n))
  for (let i = 0; i < rest.length; i += 12) add(i ? '' : `the rest of the kit (${rest.length})`, [rest.slice(i, i + 12)], { labels: true })
  return P
}
// put pieces side by side with a blank column between, rows aligned at the bottom
function joinH(pieces) {
  const h = Math.max(...pieces.map(p => p.length))
  const out = Array.from({ length: h }, () => [])
  pieces.forEach((p, i) => {
    const w = Math.max(...p.map(r => r.length))
    for (let y = 0; y < h; y++) {
      const r = p[y - (h - p.length)] ?? []
      for (let x = 0; x < w; x++) out[y].push(r[x] ?? null)
      if (i < pieces.length - 1) out[y].push(null)
    }
  })
  return out
}

export async function sheetPanels(out, art, tilesDir, { only = null, scale = 3 } = {}) {
  const ps = [...panels(), ...scene()].filter(p => !only || p.title.includes(only))
  const names = new Set(['ow_grass_0'])
  for (const p of ps) { if (p.ground) names.add(p.ground); for (const r of p.cells) for (const c of r) for (const n of [c].flat()) if (n) names.add(n) }
  const files = {}
  const urls = {}
  for (const n of names) {
    if (art.has(n)) urls[n] = 'data:image/png;base64,' + encodePng(T, T, art.get(n).d).toString('base64')
    else if (fs.existsSync(`${tilesDir}/${n}.png`)) files[n] = `${tilesDir}/${n}.png`
  }
  await runPixels(files, async (images, a) => {
    for (const [n, u] of Object.entries(a.urls)) images[n] = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = u })
    const S = 16 * a.scale, gap = 18, title = 18
    let wMax = 0, hTot = 8
    const lay = a.panels.map(p => {
      const w = Math.max(...p.cells.map(r => r.length)) * S, h = p.cells.length * (S + (p.labels ? 12 : 0))
      const box = { x: 8, y: hTot + title, w, h }
      hTot += title + h + gap; wMax = Math.max(wMax, w + 16)
      return box
    })
    const c = document.createElement('canvas')
    c.width = Math.max(wMax, 900); c.height = hTot
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false
    g.fillStyle = '#2b2b33'; g.fillRect(0, 0, c.width, c.height)
    g.font = 'bold 13px monospace'
    a.panels.forEach((p, i) => {
      const b = lay[i]
      g.fillStyle = '#e8e8f0'; g.fillText(p.title, b.x, b.y - 5)
      p.cells.forEach((r, y) => r.forEach((cell, x) => {
        const px = b.x + x * S, py = b.y + y * (S + (p.labels ? 12 : 0)) + (p.labels ? 12 : 0)
        const stack = cell == null ? [] : [cell].flat()
        if (!p.noGround && (cell != null || p.fill)) g.drawImage(images[p.ground] ?? images.ow_grass_0, px, py, S, S)
        for (const n of stack) if (n && images[n]) g.drawImage(images[n], px, py, S, S); else if (n && !images[n]) { g.fillStyle = '#f0f'; g.fillRect(px, py, S, S) }
        if (p.labels && stack.length) { g.fillStyle = '#bbb'; g.font = '9px monospace'; g.fillText(stack[stack.length - 1].replace(/^ow_(city_|prop_city_|deco_city_)?/, '').slice(-9), px, py - 2); g.font = 'bold 13px monospace' }
      }))
    })
    return { files: { [a.name]: c.toDataURL() } }
  }, { panels: ps, urls, scale, name: path.basename(out) }, path.dirname(path.resolve(out)))
  console.log(`contact sheet -> ${out}`)
}
