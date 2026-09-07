// Photograph an open map as the game draws it: launch the Electron game on
// this WSLg display, enter a depth with the level<N> cheat, set the clock
// to noon, reveal every cell, and walk the camera over the map in viewport
// steps, stitching the canvas captures into one PNG at the game's 32 px
// cells. Enemies and NPCs are cleared so the tiles read unobstructed; the
// player sprite and HUD bars remain where each capture centred.
//
//   node tools/map-shots/shoot.mjs <depth> <out.png>
//
// Read the result with an image viewer, or crop cells x,y from it at 32 px
// each. This is how the 2026-09-07 healing pass on River Split and the
// Mountain Pass found its defects (pier ground over the void, dirt carve
// stamps, mountain ground adrift in the woods).
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const [level, out] = process.argv.slice(2)
if (!level || !out) { console.error('usage: node tools/map-shots/shoot.mjs <depth> <out.png>'); process.exit(1) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const S = 32

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=/tmp/dc-map-shots-${level}`, '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', APP_DIR, '--dcdebug'],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, timeout: 45_000,
})
await sleep(4000)
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
page.on('pageerror', e => console.log('PAGEERR', e.message))
for (const k of ['l', 'e', 'v', 'e', 'l', ...level.split('')]) { await page.keyboard.press(k); await sleep(120) }
await sleep(3000)

const info = await page.evaluate(() => {
  const s = window.__dc.state, c = document.getElementById('game-canvas')
  window.__shots = document.createElement('canvas')
  window.__shots.width = s.map[0].length * 32; window.__shots.height = s.map.length * 32
  return { w: s.map[0].length, h: s.map.length, cw: c.width, ch: c.height, depth: s.depth, mapName: s.mapData?.name }
})
console.log(JSON.stringify(info))
const vw = info.cw / S, vh = info.ch / S
const xs = [], ys = []
for (let cx = vw / 2; cx < info.w + vw / 2; cx += vw) xs.push(Math.min(cx, info.w - vw / 2))
for (let cy = vh / 2; cy < info.h + vh / 2; cy += vh) ys.push(Math.min(cy, info.h - vh / 2))
for (const cy of ys) for (const cx of xs) {
  // teleport (the camera centres on player.px/py), let the FOV recompute,
  // then light every cell so the whole viewport is drawn unfogged
  await page.evaluate(([cx, cy]) => {
    const s = window.__dc.state
    if (window.__dc.save) window.__dc.save.clock = 180
    s.player.x = Math.floor(cx); s.player.y = Math.floor(cy); s.player.px = cx * 32; s.player.py = cy * 32
    s.enemies = []; if (s.npcs) s.npcs = []
  }, [cx, cy])
  await sleep(400)
  await page.evaluate(() => { for (const row of window.__dc.state.map) for (const t of row) { t.explored = true; t.visible = true } })
  await sleep(500)
  await page.evaluate(() => {
    const s = window.__dc.state, c = document.getElementById('game-canvas')
    window.__shots.getContext('2d').drawImage(c, Math.round(s.player.px - c.width / 2), Math.round(s.player.py - c.height / 2))
  })
}
const dataUrl = await page.evaluate(() => window.__shots.toDataURL('image/png'))
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
await app.close()
console.log(`wrote ${out} (${info.w}x${info.h} cells)`)
