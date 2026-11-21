// Draw a block of Wilds pieces to a PNG with the real tile art: the drawing
// half of tools/wilds/render.mjs, shared with tools/city/render.mjs.
//
// arts[r][c] = { ground, deco?, prop, marks } for the piece in row r, column
// c: PIECE x PIECE tile names (null for none) and marks { x, y, c, label }
// in piece tiles.
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPixels } from '../static-overworld/px.mjs'
import { PIECE } from '../../renderer/wilds/layout.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')

export async function drawPieces(arts, { scale = 8, grid = false, marks = false, out = 'wilds.png' } = {}) {
  const rows = arts.length, cols = arts[0].length
  const palette = [], index = new Map()
  const idx = n => { if (n == null) return -1; if (!index.has(n)) { index.set(n, palette.length); palette.push(n) } return index.get(n) }
  const W = cols * PIECE, H = rows * PIECE
  const layers = { ground: [], deco: [], prop: [] }
  for (const k of Object.keys(layers)) layers[k] = Array.from({ length: H }, () => new Array(W).fill(-1))
  const markList = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const art = arts[r][c]
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++)
      for (const k of Object.keys(layers)) layers[k][r * PIECE + y][c * PIECE + x] = idx(art[k]?.[y]?.[x] ?? null)
    for (const m of art.marks ?? []) markList.push({ ...m, x: m.x + c * PIECE, y: m.y + r * PIECE })
  }
  const images = Object.fromEntries(palette.map(n => [n, path.join(TILES, n + '.png')]))
  const file = path.resolve(out)
  await runPixels(images, (images, m) => {
    const T = m.scale
    const c = document.createElement('canvas')
    c.width = m.W * T; c.height = m.H * T
    const g = c.getContext('2d')
    g.fillStyle = '#101018'; g.fillRect(0, 0, c.width, c.height)
    g.imageSmoothingEnabled = T < 16
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) for (const layer of [m.ground, m.deco, m.prop]) {
      const i = layer[y][x]
      if (i >= 0) g.drawImage(images[m.palette[i]], x * T, y * T, T, T)
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
  }, { W, H, PIECE, scale, grid, marks, markList, palette, ground: layers.ground, deco: layers.deco, prop: layers.prop, name: path.basename(file) }, path.dirname(file))
  return file
}

// A generated piece (Wilds or city) as art for drawPieces.
export function pieceArtOf(p) {
  return {
    ground: p.cells.map(r => r.map(c => c.skin)), deco: p.cells.map(r => r.map(c => c.deco ?? null)), prop: p.cells.map(r => r.map(c => c.overlay ?? null)),
    marks: [
      { x: p.main.x, y: p.main.y, c: '#fff', label: `${p.main.kind}${p.village ? ' ' + p.village.name : ''} t${p.tier}` },
      ...p.spawns.map(s => ({ x: s.x, y: s.y, c: s.kind === 'chest' || s.kind === 'weapon' ? '#facc15' : s.kind === 'npc' ? '#34d399' : s.kind === 'wild_mushroom' ? '#c084fc' : '#e5484d', label: s.species ?? s.kind })),
      ...p.caves.map(c => ({ x: c.x, y: c.y, c: '#111', label: `d${c.caveDepth}` })),
      ...p.doors.map(d => ({ x: d.x, y: d.y, c: '#f5a524', label: d.kind ?? d.tier })),
    ],
  }
}
