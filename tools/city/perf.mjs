// Kalevanlinna's performance gates (spec R1), measured on this machine:
//
//   1. building: buildCity(seed) once per world, warm ≤ 200 ms (the cold
//      first build in a fresh process is shown too: it is paid at Wilds entry),
//      and generateCityPiece from a built city ≤ 10 ms;
//   2. JS per frame: Electron traces of `--secs` seconds on a plain Wilds
//      piece and on the square, back to back, `--pairs` times; the city may
//      add ≤ 4 ms JS a frame on average (canvas raster per frame shown too);
//   3. the web build (npm run web) in headless Chromium with the CPU
//      throttled 4x on the square for `--web-secs` seconds: above 30 fps
//      (and the same on a plain Wilds piece, for comparison).
//
// Both runs start from a Wilds save (throwaway profile / localStorage) at the
// square with the clock at `--frac` of the day (0.47: noon). Exits non-zero
// when a gate fails. About 2 minutes with the defaults.
//
//   node tools/city/perf.mjs [--pairs 3] [--secs 5] [--web-secs 10] [--rate 4]
//        [--frac 0.47] [--seed 7] [--port 8080] [--shots <dir>] [--no-build] [--no-electron] [--no-web] [--no-web-plain]
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { APP_DIR, SQUARE, sleep, citySave, driver, launchGame, startWeb, launchWeb, enterWilds, noDamage, frameRate } from './live.mjs'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d }
const PAIRS = opt('--pairs', 3), SECS = opt('--secs', 5), WEB_SECS = opt('--web-secs', 10), RATE = opt('--rate', 4)
const FRAC = opt('--frac', 0.47), SEED = opt('--seed', 7), PORT = opt('--port', 8080)
const GATE = { addMs: 4, fps: 30, buildMs: 200, pieceMs: 10 }
const PROFILE = path.join(os.tmpdir(), 'dc-city-perf')
const fails = []
const SHOTS = argv.includes('--shots') ? path.resolve(argv[argv.indexOf('--shots') + 1]) : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, `perf-${name}.png`) }) : null
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]

// ---- 1. building, in a fresh process -------------------------------------------
if (!argv.includes('--no-build')) {
  const script = `
    const { buildCity } = await import(${JSON.stringify(path.join(APP_DIR, 'renderer/wilds/city/build.js'))})
    const { generateCityPiece } = await import(${JSON.stringify(path.join(APP_DIR, 'renderer/wilds/city/piece.js'))})
    const t = f => { const t0 = performance.now(); f(); return performance.now() - t0 }
    const cold = t(() => buildCity(${SEED}))
    const warm = []
    for (let i = 0; i < 9; i++) warm.push(t(() => buildCity(${SEED} + 1000 + i)))
    const piece = [[0, 2], [1, 2], [0, 3], [1, 3]].map(([wx, wy]) => t(() => generateCityPiece(${SEED} + 1008, wx, wy)))
    console.log(JSON.stringify({ cold, warm, piece }))`
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))
  const warm = median(out.warm.slice(3)), piece = Math.max(...out.piece)
  console.log(`buildCity: cold ${out.cold.toFixed(0)} ms (paid once at Wilds entry); warm ${out.warm.map(v => v.toFixed(0)).join(' ')} ms, median after three ${warm.toFixed(0)} ms (gate ${GATE.buildMs})`)
  console.log(`generateCityPiece: ${out.piece.map(v => v.toFixed(1)).join(' ')} ms (gate ${GATE.pieceMs})`)
  if (warm > GATE.buildMs) fails.push(`warm buildCity ${warm.toFixed(0)} ms > ${GATE.buildMs}`)
  if (piece > GATE.pieceMs) fails.push(`generateCityPiece ${piece.toFixed(1)} ms > ${GATE.pieceMs}`)
}

// ---- 2. JS per frame in Electron, plain Wilds vs the square ------------------------
// The plain piece: wild land with the city out of the window (its runtime
// dropped), the same time of day, the same walk.
async function trace(app, page, secs) {
  const cdp = await app.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,blink',
    transferMode: 'ReportEvents',
  })
  // a walk round a square, as tools/perf/trace.mjs does
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  const t0 = Date.now()
  for (let i = 0; Date.now() - t0 < secs * 1000; i++) {
    await page.keyboard.down(keys[i % 4]); await sleep(700); await page.keyboard.up(keys[i % 4])
  }
  const done = new Promise(r => cdp.on('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end'); await done
  await cdp.detach()
  const threads = {}
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name
  const main = events.filter(e => e.ph === 'X' && threads[`${e.pid}:${e.tid}`] === 'CrRendererMain')
  const frames = main.filter(e => e.name === 'FireAnimationFrame').length || 1
  const per = n => main.filter(e => e.name === n).reduce((a, e) => a + e.dur, 0) / 1000 / frames
  return { js: per('FunctionCall'), raster: per('Canvas2DLayerBridge::flushRecording'), frames }
}

if (!argv.includes('--no-electron')) {
  const errors = []
  const { app, page } = await launchGame({ profile: PROFILE, save: citySave({ seed: SEED, pos: SQUARE, frac: FRAC }), errors })
  try {
    const d = driver(page)
    await enterWilds(page)
    await noDamage(page)
    await page.bringToFront()
    // a wild piece to the north-west, no village on it, with the city out of the window
    const plain = await d.ev(() => {
      const w = window.__dc.wilds
      for (const [wx, wy] of [[-2, 0], [-2, -1], [2, -1], [-3, 1], [3, 0]]) {
        const p = w.pieces.get(`${wx},${wy}`)
        if (!p || !p.village) return { X: wx * 80 + 40, Y: wy * 80 + 40, wx, wy }
      }
      return { X: -120, Y: 40, wx: -2, wy: 0 }
    })
    const spot = async where => {
      await d.goTo(where.X, where.Y)
      // stand on open ground near there
      await d.ev(([X, Y]) => {
        const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
        for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = X - o.wx * 80 + dx, y = Y - o.wy * 80 + dy
          if (s.map[y]?.[x]?.tile === 1 && s.map[y][x + 1]?.tile === 1 && s.map[y + 1]?.[x]?.tile === 1) { p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16; return }
        }
      }, [where.X, where.Y])
      await d.setFrac(FRAC)
      await sleep(3000)   // the town placed by the clock, the tiles baked
      await d.setFrac(FRAC)
    }
    const rows = []
    for (let i = 0; i < PAIRS; i++) {
      await spot(plain)
      if (i === 0) await shot(page, 'plain')
      const a = await trace(app, page, SECS)
      const aRun = await d.ev(() => !!window.__dc.state.cityRun)
      if (a.frames < SECS * 20) fails.push(`pair ${i + 1}: only ${a.frames} frames on the plain piece (paused?)`)
      await spot(SQUARE)
      if (i === 0) await shot(page, 'square')
      const b = await trace(app, page, SECS)
      const people = await d.ev(() => window.__dc.state.entities.filter(e => e.cityKey !== undefined).length)
      if (b.frames < SECS * 20) fails.push(`pair ${i + 1}: only ${b.frames} frames on the square (paused?)`)
      rows.push({ a, b, aRun, people })
      console.log(`pair ${i + 1}: plain Wilds (${plain.wx},${plain.wy}) JS ${a.js.toFixed(2)} ms/frame, raster ${a.raster.toFixed(2)}${aRun ? ' (city runtime still up!)' : ''}`
        + ` | square JS ${b.js.toFixed(2)}, raster ${b.raster.toFixed(2)}, ${people} city entities | difference JS ${(b.js - a.js).toFixed(2)} ms`)
    }
    const diff = mean(rows.map(r => r.b.js - r.a.js))
    console.log(`mean JS difference over ${PAIRS} pairs: ${diff.toFixed(2)} ms/frame (gate ${GATE.addMs}); raster ${mean(rows.map(r => r.b.raster - r.a.raster)).toFixed(2)} ms/frame`)
    if (diff > GATE.addMs) fails.push(`the city adds ${diff.toFixed(2)} ms JS a frame > ${GATE.addMs}`)
    if (rows.some(r => r.aRun)) fails.push('the city runtime was up on the plain piece')
    if (errors.length) fails.push(`Electron errors: ${errors.slice(0, 3).join(' | ')}`)
  } finally {
    await app.close()
  }
}

// ---- 3. the web build, CPU throttled ------------------------------------------------
if (!argv.includes('--no-web')) {
  const errors = []
  const srv = await startWeb(PORT)
  let browser
  try {
    const web = await launchWeb({ url: `http://localhost:${PORT}`, save: citySave({ seed: SEED, pos: SQUARE, frac: FRAC }), errors })
    browser = web.browser
    const page = web.page, d = driver(page)
    await enterWilds(page)
    await noDamage(page)
    await d.setFrac(FRAC)
    await sleep(3000)
    await d.setFrac(FRAC)
    const cdp = await page.context().newCDPSession(page)
    const throttled = async () => {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
      await sleep(1500)
      const r = await frameRate(page, WEB_SECS)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      return r
    }
    const r = await throttled()
    await shot(page, 'web-square')
    const people = await d.ev(() => window.__dc.state.entities.filter(e => e.cityKey !== undefined).length)
    console.log(`web build, CPU ${RATE}x throttled, square: ${r.fps} fps (frame p50 ${r.p50} ms, p95 ${r.p95} ms), ${people} city entities (gate > ${GATE.fps} fps)`)
    // for comparison, the same on a plain Wilds piece (not gated)
    if (!argv.includes('--no-web-plain')) {
      await d.goTo(-120, 40)
      await d.setFrac(FRAC)
      await sleep(2000)
      const p = await throttled()
      console.log(`  (for comparison, a plain Wilds piece: ${p.fps} fps, frame p50 ${p.p50} ms, p95 ${p.p95} ms; city runtime up: ${await d.ev(() => !!window.__dc.state.cityRun)})`)
    }
    if (!(r.fps > GATE.fps)) fails.push(`web build ${r.fps} fps at ${RATE}x throttle <= ${GATE.fps}`)
    if (errors.length) fails.push(`web errors: ${errors.slice(0, 3).join(' | ')}`)
  } finally {
    await browser?.close()
    srv.kill()
  }
}

console.log(fails.length ? `CITY PERF: FAILED\n  ${fails.join('\n  ')}` : 'CITY PERF: within the gates')
process.exit(fails.length ? 1 : 0)
