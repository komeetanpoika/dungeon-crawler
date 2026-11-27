// node tools/desert-monsters/bench-smoke.mjs <out-dir> <name> [<name>...]
// Starts the monster bench for each named monster in Electron, lets it run a
// few seconds with the hero walking at it, and reports page errors, where
// its hook's state machine is, and a screenshot (bench-<name>.png).
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = process.argv[2]
const names = process.argv.slice(3)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let bad = 0
for (const name of names) {
  const profile = path.join(OUT, 'profile-' + name)
  fs.rmSync(profile, { recursive: true, force: true })
  const errors = []
  const app = await electron.launch({
    executablePath: path.join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', `--user-data-dir=${profile}`, APP, '--bench', name, '--dcdebug'],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, timeout: 45_000,
  })
  const page = await app.firstWindow()
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.waitForFunction(n => window.__dc?.state?.entities?.some(e => e.type === n), name, { timeout: 30_000 }).catch(e => errors.push('no monster: ' + e.message))
  await sleep(1500)
  await page.keyboard.down('ArrowUp'); await sleep(2500); await page.keyboard.up('ArrowUp')
  await sleep(1500)
  const info = await page.evaluate(n => {
    const s = window.__dc?.state, e = s?.entities.find(e => e.type === n)
    return e ? { hp: e.hp, sink: e.sink, st: e.scorp?.state ?? e.worm?.state ?? (e.pit ? 'pit' : null), heroHp: s.player.hp, panel: !!document.querySelector('[class*=bench], #bench-panel') } : null
  }, name)
  await page.screenshot({ path: path.join(OUT, `bench-${name}.png`) })
  await app.close()
  const real = errors.filter(e => !/net::ERR|Failed to load resource/.test(e))
  if (real.length || !info) bad++
  console.log(name, JSON.stringify(info), real.length ? 'ERRORS: ' + real.slice(0, 3).join(' | ') : 'no errors')
}
process.exit(bad ? 1 : 0)
