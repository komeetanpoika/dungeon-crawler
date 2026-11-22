// What tools/city/perf.mjs and walk.mjs share: a Wilds save that starts in
// Kalevanlinna, the real game launched on it (Electron with a throwaway
// profile, or the web build in Chromium), and the debug-hook helpers both
// drive it with (window.__dc, from --dcdebug / ?dcdebug).
//
// Positions are world tiles: the window's tiles change on every re-centre,
// so they are converted at the moment of use.
import { _electron as electron, chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWorld, exportWorld } from '../../renderer/wilds/world.js'
import { normalizeAdventureSave } from '../../renderer/systems/adventure.js'
import { DAY_LENGTH } from '../../renderer/data/weather.js'
import { fromCity } from '../../renderer/wilds/city/geometry.js'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const sleep = ms => new Promise(r => setTimeout(r, ms))

// city tile -> world tile
export const W = (cx, cy) => fromCity(cx, cy)
export const SQUARE = { X: 79, Y: 236 }             // a step south of the fountain (city 79,74)

// A Wilds save (wilds.json / the web build's localStorage) for `seed`, the
// player at world tile `pos`, the clock at `frac` of the day.
export function citySave({ seed = 7, pos = SQUARE, frac = 0.47 } = {}) {
  const world = makeWorld(null, { seed })
  world.pos = { ...pos }
  const save = normalizeAdventureSave(null)
  save.wilds = exportWorld(world)
  save.clock = frac * DAY_LENGTH
  return save
}

// Helpers on a page running the game with the debug hooks.
export function driver(page) {
  const ev = (fn, arg) => page.evaluate(fn, arg)
  const d = {
    ev,
    placeWorld: (X, Y) => ev(([X, Y]) => {
      const o = window.__dc.wilds.origin, p = window.__dc.state.player
      p.x = X - o.wx * 80; p.y = Y - o.wy * 80; p.px = p.x * 32 + 16; p.py = p.y * 32 + 16
    }, [X, Y]),
    playerWorld: () => ev(() => { const o = window.__dc.wilds.origin, p = window.__dc.state.player; return { X: p.x + o.wx * 80, Y: p.y + o.wy * 80 } }),
    setFrac: frac => ev(f => { window.__dc.save.clock = f * 360 }, frac),
    // a piece at a time (a placement outside the window would be off the map),
    // so the window follows the player there
    async goTo(X, Y, { settle = 400 } = {}) {
      for (let i = 0; i < 16; i++) {
        const at = await d.playerWorld()
        const dx = Math.max(-60, Math.min(60, X - at.X)), dy = Math.max(-60, Math.min(60, Y - at.Y))
        if (!dx && !dy) break
        await d.placeWorld(at.X + dx, at.Y + dy)
        await sleep(settle)
      }
      await d.placeWorld(X, Y)
      await sleep(settle)
    },
  }
  return d
}

// Electron on this display with a throwaway profile, on the given Wilds
// save: written through the game's own saveAPI, then the page reloaded so the
// game reads it as it starts. Returns { app, page } at the title.
export async function launchGame({ profile, save, errors = [], width = 1024, height = 720 }) {
  fs.rmSync(profile, { recursive: true, force: true })
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', `--user-data-dir=${profile}`, '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', APP_DIR, '--dcdebug'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, timeout: 45_000,
  })
  const page = await app.firstWindow()
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h), [width, height])
  await page.waitForFunction(() => !!window.saveAPI?.saveWilds, null, { timeout: 30_000 })
  await page.evaluate(s => window.saveAPI.saveWilds(s), save)
  await page.reload()
  await page.getByText('Adventure', { exact: true }).first().waitFor({ timeout: 30_000 })
  return { app, page }
}

// The web build (tools/web-server.mjs) on `port`, resolved once it listens.
export async function startWeb(port = 8080) {
  const srv = spawn(process.execPath, [path.join(APP_DIR, 'tools/web-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('web server did not start')), 15_000)
    srv.stdout.on('data', b => { if (String(b).includes('http://localhost')) { clearTimeout(t); res() } })
    srv.on('exit', c => { clearTimeout(t); rej(new Error(`web server exited ${c}`)) })
  })
  return srv
}

// Chromium (headless) on the web build with the given save in localStorage.
export async function launchWeb({ url, save, errors = [], width = 1024, height = 693 }) {
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.addInitScript(s => { if (!sessionStorage.getItem('t19-seeded')) { localStorage.setItem('dungeon-crawler-wilds', s); sessionStorage.setItem('t19-seeded', '1') } }, JSON.stringify(save))
  await page.goto(url + '/?dcdebug')
  await page.getByText('Adventure', { exact: true }).first().waitFor({ timeout: 30_000 })
  return { browser, page }
}

// Title -> the Wilds, waiting until the window and the town are up.
export async function enterWilds(page) {
  await page.getByText('Adventure', { exact: true }).first().click()
  await page.waitForFunction(() => !!window.__dc?.wilds?.origin && !!window.__dc.state?.map, null, { timeout: 60_000 })
}

// The player takes no damage (the monster bench's seam, player-damage.js):
// a trace or a walk must not end in a death and a wake somewhere else.
export async function noDamage(page) {
  await page.evaluate(async () => {
    const m = await import(new URL('./systems/player-damage.js', location.href).href)
    m.setDamageObserver(() => 0)
  })
}

// rAF frame times over `secs` seconds: { fps, p50, p95 } (ms)
export async function frameRate(page, secs) {
  const ts = await page.evaluate(secs => new Promise(res => {
    const ts = [], t0 = performance.now()
    const step = t => { ts.push(t); if (t - t0 < secs * 1000) requestAnimationFrame(step); else res(ts) }
    requestAnimationFrame(step)
  }), secs)
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b)
  return { fps: +(1000 * (ts.length - 1) / (ts.at(-1) - ts[0])).toFixed(1), p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1) }
}
