// Launch the game in Electron, press a key, verify the AudioContext unlocks
// and nothing errors. Run from repo root: node tools/sfx-audition/smoke.mjs
import { _electron } from 'playwright-core'

const app = await _electron.launch({ args: ['.'], env: { ...process.env, DISPLAY: ':0' } })
const win = await app.firstWindow()
const errors = []
win.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2000)          // let init() finish
await win.keyboard.press('Enter')       // any gesture unlocks audio
await win.waitForTimeout(500)

const ctxState = await win.evaluate(() =>
  new AudioContext().state)             // same policy gate the engine faces
console.log('AudioContext state after gesture:', ctxState)
console.log('console errors:', errors.length ? errors : 'none')
await app.close()
if (ctxState !== 'running' || errors.length) process.exit(1)
console.log('SMOKE OK')
