// Render map JSONs (lib.mjs format) to PNG previews with the real tile art.
// Usage: node render-maps.mjs out/maps/*.json   -> out/png/<name>.png
import { runPixels } from './px.mjs'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TILES = path.resolve(HERE, '../../renderer/assets/tiles')
const OUT = path.join(HERE, 'out/png')

const POI_COLORS = {
  dungeon_entrance: '#e5484d', village: '#f5a524', ruin: '#c084fc',
  camp: '#34d399', chest: '#facc15', landmark: '#38bdf8',
}

for (const file of process.argv.slice(2)) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'))
  const images = Object.fromEntries(map.palette.map(n => [n, path.join(TILES, n + '.png')]))
  await runPixels(images, (images, m) => {
    const T = 16
    const c = document.createElement('canvas')
    c.width = m.w * T; c.height = m.h * T + 30
    const g = c.getContext('2d')
    g.fillStyle = '#101018'; g.fillRect(0, 0, c.width, c.height)
    g.imageSmoothingEnabled = false
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const gi = m.ground[y][x]
      if (gi >= 0) g.drawImage(images[m.palette[gi]], x * T, y * T)
      const pi = m.prop[y][x]
      if (pi >= 0) g.drawImage(images[m.palette[pi]], x * T, y * T)
    }
    // POI markers: diamond + label
    g.font = 'bold 11px monospace'; g.textAlign = 'left'
    for (const p of m.pois) {
      const cx = p.x * T + T / 2, cy = p.y * T + T / 2
      g.fillStyle = p.color
      g.beginPath()
      g.moveTo(cx, cy - 10); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 10); g.lineTo(cx - 7, cy)
      g.closePath(); g.fill()
      g.strokeStyle = '#000'; g.stroke()
      const text = p.label
      const tw = g.measureText(text).width
      const lx = Math.min(Math.max(2, cx + 9), m.w * T - tw - 4)
      g.fillStyle = 'rgba(0,0,0,0.65)'
      g.fillRect(lx - 2, cy - 7, tw + 6, 14)
      g.fillStyle = '#fff'
      g.fillText(text, lx + 1, cy + 4)
    }
    // spawn marker
    const s = m.playerSpawn
    g.strokeStyle = '#fff'; g.lineWidth = 2
    g.beginPath(); g.arc(s.x * T + 8, s.y * T + 8, 9, 0, Math.PI * 2); g.stroke()
    // caption
    g.fillStyle = '#ddd'; g.font = '13px monospace'
    g.fillText(`${m.name}  —  ${m.technique}`, 6, m.h * T + 19)
    return { files: { [m.name + '.png']: c.toDataURL() } }
  }, {
    ...map,
    pois: map.pois.map(p => ({ ...p, color: POI_COLORS[p.kind] ?? '#fff' })),
    POI_COLORS,
  }, OUT)
  console.log('rendered', map.name)
}
