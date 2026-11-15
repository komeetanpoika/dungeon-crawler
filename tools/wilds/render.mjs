// Render a block of Wilds pieces to a PNG with the real tile art, to look at
// the generated land without running the game.
//
//   node tools/wilds/render.mjs <seed> <wx> <wy> [cols=3] [rows=3]
//        [--deal N] [--scale 8] [--grid] [--marks] [--out file.png]
//
// <wx> <wy> is the top-left piece. --grid outlines the pieces, --marks draws
// each piece's main thing, spawns, cave mouths and doors.
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPixels } from '../static-overworld/px.mjs'
import { PIECE } from '../../renderer/wilds/layout.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v }
const has = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true }
const deal = Number(flag('--deal', 0)), scale = Number(flag('--scale', 8)), out = flag('--out', 'wilds.png')
const grid = has('--grid'), marks = has('--marks')
const [seed, wx0, wy0, cols = 3, rows = 3] = args.map(Number)
if (![seed, wx0, wy0].every(Number.isFinite)) { console.error('usage: render.mjs <seed> <wx> <wy> [cols] [rows] [--deal N] [--scale 8] [--grid] [--marks] [--out file.png]'); process.exit(1) }

// One piece as { ground[][], prop[][] } of tile names plus marks, from the
// full generator when it exists and from bare terrain before that.
async function pieceArt(wx, wy) {
  try {
    const { generatePiece } = await import('../../renderer/wilds/piece.js')
    const p = generatePiece(seed, wx, wy, deal)
    return {
      ground: p.cells.map(r => r.map(c => c.skin)), prop: p.cells.map(r => r.map(c => c.overlay ?? null)),
      marks: [
        { x: p.main.x, y: p.main.y, c: '#fff', label: `${p.main.kind}${p.village ? ' ' + p.village.name : ''} t${p.tier}` },
        ...p.spawns.map(s => ({ x: s.x, y: s.y, c: s.kind === 'chest' || s.kind === 'weapon' ? '#facc15' : s.kind === 'npc' ? '#34d399' : s.kind === 'wild_mushroom' ? '#c084fc' : '#e5484d', label: s.species ?? s.kind })),
        ...p.caves.map(c => ({ x: c.x, y: c.y, c: '#111', label: `d${c.caveDepth}` })),
        ...p.doors.map(d => ({ x: d.x, y: d.y, c: '#f5a524', label: d.tier })),
      ],
    }
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err
    const { makeTerrain } = await import('../../renderer/wilds/terrain.js')
    const { MARGIN } = await import('../../renderer/wilds/layout.js')
    const t = makeTerrain(seed, wx, wy, deal)
    t.finish()
    const rowsOf = g => Array.from({ length: PIECE }, (_, y) => Array.from({ length: PIECE }, (_, x) => t.b.palette[g[y + MARGIN][x + MARGIN]] ?? null))
    return { ground: rowsOf(t.b.ground), prop: rowsOf(t.b.prop), marks: [] }
  }
}

const palette = [], index = new Map()
const idx = n => { if (n == null) return -1; if (!index.has(n)) { index.set(n, palette.length); palette.push(n) } return index.get(n) }
const W = cols * PIECE, H = rows * PIECE
const ground = Array.from({ length: H }, () => new Array(W).fill(-1))
const prop = Array.from({ length: H }, () => new Array(W).fill(-1))
const allMarks = []
const t0 = performance.now()
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const art = await pieceArt(wx0 + c, wy0 + r)
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
    ground[r * PIECE + y][c * PIECE + x] = idx(art.ground[y][x])
    prop[r * PIECE + y][c * PIECE + x] = idx(art.prop[y][x])
  }
  for (const m of art.marks) allMarks.push({ ...m, x: m.x + c * PIECE, y: m.y + r * PIECE })
}
console.log(`generated ${cols * rows} pieces in ${(performance.now() - t0).toFixed(0)} ms`)

const images = Object.fromEntries(palette.map(n => [n, path.join(TILES, n + '.png')]))
const file = path.resolve(out)
await runPixels(images, (images, m) => {
  const T = m.scale
  const c = document.createElement('canvas')
  c.width = m.W * T; c.height = m.H * T
  const g = c.getContext('2d')
  g.fillStyle = '#101018'; g.fillRect(0, 0, c.width, c.height)
  g.imageSmoothingEnabled = T < 16
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const gi = m.ground[y][x]
    if (gi >= 0) g.drawImage(images[m.palette[gi]], x * T, y * T, T, T)
    const pi = m.prop[y][x]
    if (pi >= 0) g.drawImage(images[m.palette[pi]], x * T, y * T, T, T)
  }
  if (m.grid) {
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.setLineDash([6, 5])
    for (let i = 1; i < m.W / m.PIECE; i++) { g.beginPath(); g.moveTo(i * m.PIECE * T, 0); g.lineTo(i * m.PIECE * T, c.height); g.stroke() }
    for (let i = 1; i < m.H / m.PIECE; i++) { g.beginPath(); g.moveTo(0, i * m.PIECE * T); g.lineTo(c.width, i * m.PIECE * T); g.stroke() }
    g.setLineDash([])
  }
  if (m.marks) {
    g.font = `bold ${Math.max(9, T + 3)}px monospace`
    for (const k of m.markList) {
      const cx = (k.x + 0.5) * T, cy = (k.y + 0.5) * T
      g.fillStyle = k.c; g.strokeStyle = '#000'; g.lineWidth = 1
      g.beginPath(); g.arc(cx, cy, Math.max(3, T * 0.6), 0, Math.PI * 2); g.fill(); g.stroke()
      const tw = g.measureText(k.label).width
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(cx + 5, cy - 7, tw + 4, 13)
      g.fillStyle = '#fff'; g.fillText(k.label, cx + 7, cy + 3)
    }
  }
  return { files: { [m.name]: c.toDataURL() } }
}, { W, H, PIECE, scale, grid, marks, markList: allMarks, palette, ground, prop, name: path.basename(file) }, path.dirname(file))
console.log('wrote', file)
