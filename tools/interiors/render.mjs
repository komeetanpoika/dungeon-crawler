// Draw house interiors to one PNG sheet with the real tile art, to judge
// plans, furniture and versions without running the game.
//
//   node tools/interiors/render.mjs [--stage walls|furnish|full] [--version home|...] [--size small|medium|large|grand]
//        [--seeds 1,2,3 | --seeds 1..12] [--cols 3] [--scale 2] [--solved] [--out interiors.png]
//
// --stage walls draws plans with walls and floors only; --stage furnish adds
// furniture without a version's finish or people; full is the real house.
// Spawns are drawn with their sprites; anything without one is a lettered dot.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runPixels } from '../static-overworld/px.mjs'
import { SPRITES } from '../../renderer/render/sprites.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')
const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v }
const has = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const stage = flag('--stage', 'full'), version = flag('--version', 'home'), size = flag('--size', null)
const cols = Number(flag('--cols', 3)), scale = Number(flag('--scale', 2)), out = flag('--out', 'interiors.png')
const solved = has('--solved')
const seedArg = flag('--seeds', '1..6')
const seeds = seedArg.includes('..') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedArg.split('..').map(Number)) : seedArg.split(',').map(Number)
const SIZES = ['small', 'medium', 'large', 'grand']

async function build(seed, i) {
  const sz = size ?? SIZES[i % SIZES.length]
  if (stage === 'walls') {
    const { makePlan } = await import('../../renderer/interior/plan.js')
    const { buildCells } = await import('../../renderer/interior/walls.js')
    const { mulberry32 } = await import('../../renderer/interior/rng.js')
    const plan = makePlan(sz, mulberry32(seed))
    const floors = ['in_floor_planks', 'in_floor_flags', 'in_floor_boards', 'in_floor_greyflags', 'in_floor_cream']
    const pal = ['plaster', 'wood', 'grey', 'pale'][seed % 4]
    return { map: buildCells(plan, { palette: pal, floorOf: id => floors[id % floors.length] }), spawns: [], label: `${sz} ${pal} #${seed}` }
  }
  if (stage === 'furnish') {
    const { makePlan } = await import('../../renderer/interior/plan.js')
    const { buildCells } = await import('../../renderer/interior/walls.js')
    const { assignRoles, floorsFor, furnish } = await import('../../renderer/interior/furnish.js')
    const { mulberry32 } = await import('../../renderer/interior/rng.js')
    const rng = mulberry32(seed * 7919 + 13)
    const plan = makePlan(sz, rng)
    const trade = ['farmer', 'hunter', 'fisher', 'smith', 'baker', 'scholar', 'weaver'][seed % 7]
    const roles = assignRoles(plan, { version, trade, rng })
    const floors = floorsFor(plan, roles, rng, version)
    const pal = version === 'ruin' ? 'grey' : ['plaster', 'wood'][seed % 2]
    const map = buildCells(plan, { palette: pal, floorOf: id => floors.get(id) })
    furnish(map, plan, roles, { version, trade, rng })
    return { map, spawns: [], label: `${version} ${sz} ${pal} ${trade} [${[...roles.values()].join(',')}] #${seed}` }
  }
  const { generateInterior, specFor } = await import('../../renderer/interior/index.js')
  const spec = specFor({ version, size: sz, seed, label: `render:${seed}` })
  const g = generateInterior(spec, { solved })
  const { findSun, traceBeam } = await import('../../renderer/interior/sunroom.js')
  const sun = findSun(g.map)
  const beam = sun ? [{ x: sun.start.x, y: sun.start.y - 1.2 }, ...traceBeam(g.map, sun.start).cells] : null
  return { map: g.map, spawns: g.entitySpawns, beam, label: `${g.version} ${sz} ${spec.palette}${spec.trade ? ' ' + spec.trade : ''} #${seed}` }
}

const SPAWN_ART = s => {
  if (s.kind === 'npc') return SPRITES[`npc_${s.species}`] ?? SPRITES.npc_villager
  if (s.kind === 'monster') return SPRITES[`monster_${s.variant}`]
  if (s.kind === 'guard') return SPRITES.guard
  if (s.kind === 'chest') return SPRITES.chest_0
  if (s.kind === 'floating_pickup') return s.contents?.type === 'potion' ? SPRITES.potion : s.contents?.type === 'weapon' ? SPRITES[`weapon_${s.contents.weaponType}`] : SPRITES[`item_${s.contents?.type}`]
  return null
}

const boards = []
for (let i = 0; i < seeds.length; i++) boards.push(await build(seeds[i], i))
const names = new Set()
const jobs = boards.map(b => ({
  label: b.label, beam: b.beam,
  w: b.map[0].length, h: b.map.length,
  cells: b.map.map(row => row.map(c => [c.skin ?? null, c.deco ?? null, c.overlay ?? null])),
  spawns: b.spawns.map(s => ({ x: s.x, y: s.y, art: SPAWN_ART(s), tag: s.kind[0].toUpperCase() })),
}))
for (const j of jobs) {
  for (const row of j.cells) for (const l of row) for (const n of l) if (n) names.add(n)
  for (const s of j.spawns) if (s.art) names.add(s.art)
}
const files = {}
for (const n of names) { const f = path.join(TILES, `${n}.png`); if (fs.existsSync(f)) files[n] = f; else console.warn('no picture:', n) }

const result = await runPixels(files, (images, { jobs, cols, scale }) => {
  const S = 16 * scale, PAD = 10, LABEL = 18
  const cw = Math.max(...jobs.map(j => j.w)) * S + PAD * 2, ch = Math.max(...jobs.map(j => j.h)) * S + PAD * 2 + LABEL
  const rows = Math.ceil(jobs.length / cols)
  const c = document.createElement('canvas'); c.width = cw * Math.min(cols, jobs.length); c.height = ch * rows
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false
  g.fillStyle = '#101014'; g.fillRect(0, 0, c.width, c.height)
  jobs.forEach((j, k) => {
    const ox = (k % cols) * cw + PAD, oy = Math.floor(k / cols) * ch + PAD + LABEL
    g.fillStyle = '#e8e2d0'; g.font = '13px monospace'; g.fillText(j.label, ox, oy - 6)
    for (let y = 0; y < j.h; y++) for (let x = 0; x < j.w; x++) for (const n of j.cells[y][x]) if (n && images[n]) g.drawImage(images[n], ox + x * S, oy + y * S, S, S)
    if (j.beam?.length) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,214,120,0.75)'; g.lineWidth = scale * 3
      g.beginPath(); j.beam.forEach((p, i) => { const px = ox + p.x * S + S / 2, py = oy + p.y * S + S / 2; if (i) g.lineTo(px, py); else g.moveTo(px, py) }); g.stroke(); g.restore()
    }
    for (const s of j.spawns) {
      if (s.art && images[s.art]) g.drawImage(images[s.art], ox + s.x * S, oy + s.y * S, S, S)
      else { g.fillStyle = '#e5484d'; g.beginPath(); g.arc(ox + s.x * S + S / 2, oy + s.y * S + S / 2, S / 3, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(s.tag, ox + s.x * S + S / 2 - 4, oy + s.y * S + S / 2 + 4) }
    }
  })
  return { files: { 'sheet.png': c.toDataURL('image/png') } }
}, { jobs, cols, scale }, path.dirname(path.resolve(out)))
fs.renameSync(path.join(path.dirname(path.resolve(out)), 'sheet.png'), path.resolve(out))
console.log(`wrote ${out} (${jobs.length} interiors)`)
