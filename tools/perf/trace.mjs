// Frame-cost tracer for the Electron game on this WSLg machine (software
// canvas: `app.disableHardwareAcceleration()` in main.cjs). Launches the
// game, enters a depth with the `level<N>` cheat, walks in a square for a
// few seconds under a Chromium trace, and prints the per-frame main-thread
// cost split into JS (FunctionCall), canvas rasterisation
// (Canvas2DLayerBridge::flushRecording — the software replay of every
// drawImage/fillRect the frame recorded) and DOM style/layout.
//
//   node tools/perf/trace.mjs [depth=12] [seconds=5]
//
// Main-thread busy near 100% means dropped frames; the 2026-09-05 tile
// cache work took the Mountain Pass from ~22 ms to ~8 ms per frame.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const level = process.argv[2] ?? '12'
const secs = Number(process.argv[3] ?? 5)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--user-data-dir=/tmp/dc-perf-profile', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', APP_DIR],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, timeout: 45_000,
})
await sleep(4000)
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
for (const k of ['l', 'e', 'v', 'e', 'l', ...level.split('')]) { await page.keyboard.press(k); await sleep(120) }
await sleep(2500)

const cdp = await app.context().newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
await cdp.send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,blink',
  transferMode: 'ReportEvents',
})
const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
const t0 = Date.now()
for (let i = 0; Date.now() - t0 < secs * 1000; i++) {
  await page.keyboard.down(keys[i % 4]); await sleep(700); await page.keyboard.up(keys[i % 4])
}
const done = new Promise(r => cdp.on('Tracing.tracingComplete', r))
await cdp.send('Tracing.end'); await done
await app.close()

const threads = {}
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name
const main = events.filter(e => e.ph === 'X' && threads[`${e.pid}:${e.tid}`] === 'CrRendererMain')
let ts0 = Infinity, ts1 = -Infinity
for (const e of main) { if (e.ts < ts0) ts0 = e.ts; if (e.ts + e.dur > ts1) ts1 = e.ts + e.dur }
const wall = (ts1 - ts0) / 1000
const frames = main.filter(e => e.name === 'FireAnimationFrame').length
const sum = n => main.filter(e => e.name === n).reduce((a, e) => a + e.dur, 0) / 1000
// Busy time is the union of top-level task intervals, so nesting is not double counted.
const tasks = main.filter(e => e.name === 'RunTask').map(e => [e.ts, e.ts + e.dur]).sort((a, b) => a[0] - b[0])
let busy = 0, cur = null
for (const [s, t] of tasks) {
  if (!cur || s > cur[1]) { if (cur) busy += cur[1] - cur[0]; cur = [s, t] } else cur[1] = Math.max(cur[1], t)
}
if (cur) busy += cur[1] - cur[0]
console.log(JSON.stringify({ level, wallMs: Math.round(wall), frames, fps: +(frames / wall * 1000).toFixed(1), mainBusyPct: Math.round(busy / 1000 / wall * 100) }))
console.log('per frame on the main thread (ms):')
for (const [label, n] of [['JS', 'FunctionCall'], ['canvas raster', 'Canvas2DLayerBridge::flushRecording'],
  ['style+layout', 'LocalFrameView::RunStyleAndLayoutLifecyclePhases'], ['innerHTML parse', 'HTMLDocumentParser::append'],
  ['whole main frame', 'ProxyMain::BeginMainFrame']]) {
  console.log(`${(sum(n) / frames).toFixed(2).padStart(7)}  ${label}`)
}
