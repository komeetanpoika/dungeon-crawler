// A short live check of the Wilds in the real game: launch Electron on this
// display with a throwaway profile, enter with the level20 cheat, walk
// across a piece boundary, go in and out of a cave and a house, die, pause.
// Prints one line per step and exits non-zero on the first thing that is
// wrong. Screenshots land in the directory given (default: the OS tmp dir).
//
//   node tools/wilds/walk.mjs [shots-dir]
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHOTS = path.resolve(process.argv[2] ?? os.tmpdir())
const PROFILE = path.join(os.tmpdir(), 'dc-wilds-walk')
fs.rmSync(PROFILE, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const errors = []
let failed = false
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true }

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${PROFILE}`, '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', APP_DIR, '--dcdebug'],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, timeout: 45_000,
})
try {
  await sleep(4000)
  const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  const shot = name => page.screenshot({ path: path.join(SHOTS, `wilds-${name}.png`) })
  const ev = (fn, arg) => page.evaluate(fn, arg)
  const place = (x, y) => ev(([x, y]) => { const p = window.__dc.state.player; p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16 }, [x, y])
  // Window tiles change whenever the window re-centres, so the driver holds
  // world tiles and converts at the moment of use.
  const worldOf = t => ev(t => { const o = window.__dc.wilds.origin; return { X: t.x + o.wx * 80, Y: t.y + o.wy * 80 } }, t)
  const placeWorld = (X, Y) => ev(([X, Y]) => {
    const o = window.__dc.wilds.origin, p = window.__dc.state.player
    p.x = X - o.wx * 80; p.y = Y - o.wy * 80; p.px = p.x * 32 + 16; p.py = p.y * 32 + 16
  }, [X, Y])
  const playerWorld = () => ev(() => { const o = window.__dc.wilds.origin, p = window.__dc.state.player; return { X: p.x + o.wx * 80, Y: p.y + o.wy * 80 } })
  const noErrors = what => { check(errors.length === 0, `no errors ${what}`, errors.slice(0, 3).join(' | ')); errors.length = 0 }

  // ---- enter ---------------------------------------------------------------
  for (const k of 'level20') { await page.keyboard.press(k); await sleep(120) }
  await sleep(3500)
  const start = await ev(() => {
    const s = window.__dc.state, w = window.__dc.wilds
    return s && w ? { level: s.level, mode: s.mode, w: s.map[0].length, h: s.map.length, x: s.player.x, y: s.player.y,
      entities: s.entities.length, origin: w.origin, doors: s.houseDoors.length, caves: s.caveEntrances.length,
      tile: s.map[s.player.y][s.player.x].tile, weather: !!s.weather, seed: w.seed } : null
  })
  check(!!start, 'the Wilds started')
  if (!start) throw new Error('no state')
  check(start.level === 20 && start.mode === 'wilds', 'depth 20, mode wilds', JSON.stringify([start.level, start.mode]))
  check(start.w === 240 && start.h === 240, 'a 240x240 window')
  check(start.origin.wx === -1 && start.origin.wy === -1, 'window centred on home')
  check(start.tile === 1 && start.x >= 80 && start.x < 160, 'the player stands on open ground in the middle piece', `${start.x},${start.y}`)
  check(start.entities > 20 && start.doors >= 4 && start.caves >= 2, 'things, doors and a cave are around', JSON.stringify([start.entities, start.doors, start.caves]))
  check(start.weather, 'the day cycle runs')
  await shot('1-home')
  noErrors('on entering')

  // ---- walk east across a piece boundary -------------------------------------
  await ev(() => {
    window.__ft = []
    let last = performance.now()
    const f = t => { window.__ft.push(t - last); last = t; requestAnimationFrame(f) }
    requestAnimationFrame(f)
  })
  const gate = await ev(() => window.__dc.wilds.pieces.get('0,0').gates.E)
  await place(80 + 72, 80 + gate.y)
  const near = await ev(() => { const s = window.__dc.state; return s.entities.filter(e => e.x >= 160).slice(0, 1).map(e => ({ k: e.wildsKey, i: e.wildsIx, x: e.x, y: e.y }))[0] })
  await page.keyboard.down('d')
  let crossed = null
  for (let i = 0; i < 80 && !crossed; i++) {
    await sleep(250)
    const o = await ev(() => ({ o: window.__dc.wilds.origin, x: window.__dc.state.player.x }))
    if (o.o.wx === 0) crossed = o
  }
  await page.keyboard.up('d')
  check(!!crossed, 'walking east re-centres the window')
  if (crossed) check(crossed.x >= 86 && crossed.x <= 92, 'the player is 8 tiles into the new middle piece', `x=${crossed.x}`)
  if (near) {
    const after = await ev(n => { const e = window.__dc.state.entities.find(e => e.wildsKey === n.k && e.wildsIx === n.i); return e ? { x: e.x, y: e.y } : null }, near)
    check(!!after && Math.abs(after.x - (near.x - 80)) <= 12, 'a thing in a kept piece moved with the shift', JSON.stringify([near, after]))
  }
  const frames = await ev(() => { const f = window.__ft.slice(5); f.sort((a, b) => b - a); return { worst: f.slice(0, 3).map(v => Math.round(v)), median: Math.round(f[Math.floor(f.length / 2)]), n: f.length } })
  console.log(`     frames while walking: median ${frames.median} ms, worst ${frames.worst.join(', ')} ms over ${frames.n}`)
  check(frames.worst[0] < 250, 'no long freeze on the crossing', `${frames.worst[0]} ms`)
  await sleep(300)
  await shot('2-crossed')
  noErrors('after the crossing')

  // ---- a cave: in and out ------------------------------------------------------
  const arch = await ev(() => { const c = window.__dc.state.caveEntrances[0]; return c ? { x: c.x, y: c.y, label: c.label, depth: c.caveDepth } : null })
  check(!!arch, 'a cave mouth is in the window')
  if (arch) {
    const archAt = await worldOf(arch)
    await placeWorld(archAt.X, archAt.Y)
    await sleep(700)
    const inCave = await ev(() => { const s = window.__dc.state; return { cave: s.cave?.label ?? null, level: s.level, w: s.map[0].length } })
    check(inCave.cave === arch.label && inCave.level === arch.depth, 'stepping on the arch enters the cave', JSON.stringify(inCave))
    await shot('3-cave')
    await ev(() => { const s = window.__dc.state; s.cave.offStairs = true })
    await sleep(300)
    const out = await ev(() => { const s = window.__dc.state; return { cave: !!s.cave, w: s.map[0].length, x: s.player.x, y: s.player.y, level: s.level, entities: s.entities.length } })
    check(!out.cave && out.w === 240 && out.level === 20, 'the stairs lead back to the surface', JSON.stringify(out))
    const back = await playerWorld()
    check(back.X === archAt.X && back.Y === archAt.Y, 'back at the cave mouth', JSON.stringify([archAt, back]))
    noErrors('through the cave')
  }

  // ---- a house: in and out -----------------------------------------------------
  // step off the arch first so the entrance hold is released
  const door = await ev(() => { const d = window.__dc.state.houseDoors[0]; return d ? { x: d.x, y: d.y, label: d.label, tier: d.tier } : null })
  check(!!door, 'a house door is in the window')
  if (door) {
    const doorAt = await worldOf(door)
    await placeWorld(doorAt.X, doorAt.Y + 1)
    await sleep(300)
    await placeWorld(doorAt.X, doorAt.Y)
    await sleep(700)
    const inside = await ev(() => { const s = window.__dc.state; return { cave: s.cave?.label ?? null, level: s.level } })
    check(inside.cave === door.label && inside.level === 19, `a ${door.tier} door opens into an interior`, JSON.stringify(inside))
    await shot('4-house')
    await ev(() => { window.__dc.state.cave.offStairs = true })
    await sleep(300)
    check(await ev(() => !window.__dc.state.cave && window.__dc.state.map.length === 240), 'and back out')
    noErrors('through the house')
  }

  // ---- death: wake in the last village ---------------------------------------------
  await ev(() => { window.__dc.state.player.hp = 0 })
  await sleep(800)
  const woke = await ev(() => {
    const s = window.__dc.state, w = window.__dc.wilds
    return { hp: s.player.hp, max: s.player.maxHp, origin: w.origin, x: s.player.x, y: s.player.y, tile: s.map[s.player.y][s.player.x].tile, cave: !!s.cave }
  })
  check(woke.hp === woke.max && !woke.cave, 'death is a setback, not an end', JSON.stringify(woke))
  check(woke.origin.wx === -1 && woke.origin.wy === -1 && woke.tile === 1, 'you wake in the home village')
  await page.keyboard.press('Enter')
  await sleep(400)
  await shot('5-woke')
  noErrors('after dying')

  // ---- pause saves --------------------------------------------------------------------
  await page.keyboard.press('Escape')
  await sleep(500)
  const saved = await ev(() => { const w = window.__dc.save.wilds; return w ? { pos: w.pos, seed: w.seed, records: Object.keys(w.records).length } : null })
  check(!!saved && saved.seed === start.seed && !!saved.pos && saved.records >= 9, 'pausing saves the world', JSON.stringify(saved))
  const file = path.join(PROFILE, 'saves', 'wilds.json')
  const onDisk = [file, path.join(PROFILE, 'wilds.json')].find(f => fs.existsSync(f))
  check(!!onDisk || fs.readdirSync(PROFILE, { recursive: true }).some(f => String(f).endsWith('wilds.json')), 'wilds.json is on disk')
  noErrors('at the end')
} catch (err) {
  console.log('FAIL', err.message)
  failed = true
} finally {
  await app.close()
}
console.log(failed ? 'WILDS WALK: FAILED' : 'WILDS WALK: all good')
process.exit(failed ? 1 : 0)
