// Overview picture of the Wilds' road network: one square per piece, coloured
// by country (dimmed where wild), road sides as thick lines, marks for the
// piece classes, town names, a legend. Prints the share of each class.
//
//   node tools/wilds/roads.mjs <seed> [wx0=-12] [wy0=-12] [cols=24] [rows=24]
//        [--cell 24] [--out roads.png]
import * as path from 'node:path'
import { runPixels } from '../static-overworld/px.mjs'
import { pieceBiome, villageAt, BIOME_NAMES } from '../../renderer/wilds/layout.js'
import { roadSides, pieceClass } from '../../renderer/wilds/roads.js'

const args = process.argv.slice(2)
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v }
const cell = Number(flag('--cell', 24)), out = flag('--out', 'roads.png')
const [seed, wx0 = -12, wy0 = -12, cols = 24, rows = 24] = args.map(Number)
if (!Number.isFinite(seed)) { console.error('usage: roads.mjs <seed> [wx0] [wy0] [cols] [rows] [--cell 24] [--out roads.png]'); process.exit(1) }

const COLORS = { forest: '#3f8f3f', autumn: '#c8782a', mountain: '#8a8a96', desert: '#e2c36b', sea: '#2f6fc0', marsh: '#5f7f55' }
const pieces = [], share = {}
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const wx = wx0 + c, wy = wy0 + r
  const cls = pieceClass(seed, wx, wy)
  share[cls] = (share[cls] ?? 0) + 1
  const v = villageAt(seed, wx, wy)
  pieces.push({ c, r, wx, wy, cls, biome: pieceBiome(seed, wx, wy), sides: roadSides(seed, wx, wy), name: wx === 0 && wy === 0 ? 'Koivula' : v?.name ?? null })
}
const total = cols * rows
console.log(Object.entries(share).map(([k, n]) => `${k} ${(100 * n / total).toFixed(1)}%`).join('  '))

const file = path.resolve(out)
await runPixels({}, (_, m) => {
  const T = m.cell, LEG = 150
  const cv = document.createElement('canvas')
  cv.width = m.cols * T; cv.height = m.rows * T + LEG
  const g = cv.getContext('2d')
  g.fillStyle = '#101018'; g.fillRect(0, 0, cv.width, cv.height)
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) * f | 0},${(n >> 8 & 255) * f | 0},${(n & 255) * f | 0})` }
  for (const p of m.pieces) {
    const x = p.c * T, y = p.r * T
    g.fillStyle = shade(m.colors[p.biome], p.cls === 'wild' ? 0.5 : 0.85)
    g.fillRect(x, y, T, T)
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1)
  }
  const road = (p, col, w) => {
    const cx = p.c * T + T / 2, cy = p.r * T + T / 2
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'
    for (const [s, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
      if (!p.sides[s]) continue
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + dx * T / 2, cy + dy * T / 2); g.stroke()
    }
  }
  for (const p of m.pieces) { road(p, '#000', Math.max(5, T / 5)) }
  for (const p of m.pieces) { road(p, '#f4efe0', Math.max(3, T / 8)) }
  g.font = `bold ${Math.max(10, T * 0.42)}px sans-serif`
  const label = (txt, x, y, col) => {
    g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y)
  }
  for (const p of m.pieces) {
    const cx = p.c * T + T / 2, cy = p.r * T + T / 2
    const cls = p.cls
    if (cls === 'village') {
      g.fillStyle = '#d33'; g.strokeStyle = '#fff'; g.lineWidth = 2
      g.beginPath(); g.arc(cx, cy, T * 0.26, 0, 7); g.fill(); g.stroke()
    } else if (cls === 'city') {
      g.fillStyle = '#8a2be2'; g.strokeStyle = '#fff'; g.lineWidth = 1
      g.fillRect(p.c * T + 2, p.r * T + 2, T - 4, T - 4); g.strokeRect(p.c * T + 2, p.r * T + 2, T - 4, T - 4)
    } else if (cls === 'farmland') {
      g.fillStyle = '#ffe14a'; g.fillRect(cx - 3, cy - 3, 6, 6)
    } else if (cls === 'roadside') {
      g.fillStyle = '#fff'; g.fillRect(cx - 1.5, cy - 1.5, 3, 3)
    } else if (cls === 'fixed') {
      g.strokeStyle = '#0ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 6, cy - 6); g.lineTo(cx + 6, cy + 6); g.moveTo(cx + 6, cy - 6); g.lineTo(cx - 6, cy + 6); g.stroke()
    }
    if (p.wx === 0 && p.wy === 0) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(p.c * T + 1.5, p.r * T + 1.5, T - 3, T - 3) }
  }
  g.textBaseline = 'middle'
  for (const p of m.pieces) {
    if (!p.name) continue
    label(p.name, p.c * T + T * 0.62, p.r * T + T * 0.2, p.wx === 0 && p.wy === 0 ? '#ff8' : '#fff')
  }
  // city name over its 2x2
  for (const p of m.pieces) if (p.cls === 'city' && p.wx === 0 && p.wy === 2) label('Kalevanlinna', p.c * T + 3, p.r * T + T * 1.0, '#e8c8ff')
  // legend
  const ly = m.rows * T + 12
  g.font = '13px sans-serif'; g.textBaseline = 'alphabetic'
  let x = 8
  const item = (draw, txt) => { draw(x, ly); g.fillStyle = '#ddd'; g.fillText(txt, x + 18, ly + 11); x += 28 + g.measureText(txt).width }
  for (const [b, col] of Object.entries(m.colors)) item((x, y) => { g.fillStyle = col; g.fillRect(x, y, 14, 14) }, m.names[b])
  const ly2 = ly + 30; x = 8
  const item2 = (draw, txt) => { draw(x, ly2); g.fillStyle = '#ddd'; g.fillText(txt, x + 20, ly2 + 11); x += 32 + g.measureText(txt).width }
  item2((x, y) => { g.fillStyle = '#d33'; g.beginPath(); g.arc(x + 7, y + 7, 6, 0, 7); g.fill() }, 'village')
  item2((x, y) => { g.fillStyle = '#8a2be2'; g.fillRect(x, y, 14, 14) }, 'city')
  item2((x, y) => { g.fillStyle = '#ffe14a'; g.fillRect(x + 4, y + 4, 6, 6) }, 'farmland')
  item2((x, y) => { g.fillStyle = '#fff'; g.fillRect(x + 5, y + 5, 3, 3) }, 'roadside')
  item2((x, y) => { g.strokeStyle = '#0ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12, y + 12); g.moveTo(x + 12, y); g.lineTo(x, y + 12); g.stroke() }, 'fixed (home trio)')
  item2((x, y) => { g.fillStyle = '#555'; g.fillRect(x, y, 14, 14) }, 'wild (dimmed)')
  item2((x, y) => { g.strokeStyle = '#f4efe0'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, y + 7); g.lineTo(x + 14, y + 7); g.stroke() }, 'road')
  item2((x, y) => { g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(x + 1, y + 1, 12, 12) }, 'home piece (0,0)')
  g.fillStyle = '#aaa'; g.fillText(`seed ${m.seed}, pieces ${m.wx0},${m.wy0} +${m.cols}x${m.rows}`, 8, ly2 + 40)
  return { files: { [m.name]: cv.toDataURL() } }
}, { cell, cols, rows, pieces, colors: COLORS, names: BIOME_NAMES, seed, wx0, wy0, name: path.basename(file) }, path.dirname(file))
console.log('wrote', file)
