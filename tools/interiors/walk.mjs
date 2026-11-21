// A short live check of house interiors in the real game: launch Electron on
// this display with a throwaway profile, enter the Wilds through the title,
// walk into every house door in the window, look around (screenshot with the
// whole house lit), check the people and the way out, and walk back out
// through the front door. Prints one line per step, exits non-zero on the
// first thing that is wrong. About a minute.
//
//   node tools/interiors/walk.mjs [shots-dir] [--doors N]
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const nAt = args.indexOf('--doors')
const MAX_DOORS = nAt >= 0 ? Number(args.splice(nAt, 2)[1]) : 8
const SHOTS = path.resolve(args[0] ?? os.tmpdir())
const PROFILE = path.join(os.tmpdir(), 'dc-interiors-walk')
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
  const ev = (fn, arg) => page.evaluate(fn, arg)
  await page.getByText('Adventure', { exact: true }).first().click()
  await sleep(4000)
  // world tiles: the window re-centres as the player moves, so doors are held in world tiles
  const doors = await ev(() => {
    const s = window.__dc.state, o = window.__dc.wilds.origin
    return s.houseDoors.map(d => ({ X: d.x + o.wx * 80, Y: d.y + o.wy * 80, tier: d.tier, label: d.label, story: d.story, kind: d.kind ?? null }))
  })
  check(doors.length >= 4, 'house doors are in the window', `${doors.length}`)
  const placeWorld = (X, Y) => ev(([X, Y]) => {
    const o = window.__dc.wilds.origin, p = window.__dc.state.player
    p.x = X - o.wx * 80; p.y = Y - o.wy * 80; p.px = p.x * 32 + 16; p.py = p.y * 32 + 16
  }, [X, Y])
  const place = (x, y) => ev(([x, y]) => { const p = window.__dc.state.player; p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16 }, [x, y])
  let n = 0
  for (const d of doors.slice(0, MAX_DOORS)) {
    await placeWorld(d.X, d.Y + 2); await sleep(350)
    await placeWorld(d.X, d.Y + 1); await sleep(300)
    await placeWorld(d.X, d.Y); await sleep(1200)
    const inside = await ev(() => {
      const s = window.__dc.state
      if (!s.cave) return null
      const npcs = s.entities.filter(e => e.type === 'npc')
      return {
        label: s.cave.label, level: s.level, w: s.map[0].length, h: s.map.length,
        spawn: { x: s.player.x, y: s.player.y }, exit: s.cave.stairs,
        stairs: s.map.flat().filter(c => c.tile === 3 || c.tile === 4).length,
        exitWalkable: s.map[s.cave.stairs.y][s.cave.stairs.x].tile !== 0,
        npcs: npcs.length, talk: npcs.filter(e => Array.isArray(e.lines)).length,
        foes: s.entities.filter(e => e.hp > 0 && (e.type === 'monster' || e.type === 'guard' || (e.type !== 'npc' && e.type !== 'player' && e.maxHp))).length,
        theme: s.theme?.fogAlpha, faces: s.map.flat().filter(c => c.seeUp).length,
      }
    })
    if (!inside) { check(false, `${d.tier} door ${d.label} opens`); continue }
    check(inside.label === d.label && inside.level === 19, `${d.tier}${d.kind ? '/' + d.kind : ''}${d.story ? ' (' + d.story + ')' : ''} door opens into a house`, `${inside.w}x${inside.h}`)
    check(inside.stairs === 0 && inside.exitWalkable && inside.exit.y === inside.spawn.y + 1 && inside.exit.x === inside.spawn.x, 'the way out is the front door under the player, no stairs', JSON.stringify([inside.spawn, inside.exit]))
    check(inside.faces > 0, 'the north walls have faces that light the rows above')
    if (d.tier === 'safe' && !d.story) check(inside.foes === 0, 'nothing in a village house bites', `${inside.npcs} people, ${inside.foes} foes`)
    if (inside.npcs) check(inside.talk === inside.npcs, 'everyone at home has something to say', `${inside.talk}/${inside.npcs}`)
    // see it whole, then shoot
    await ev(() => { const s = window.__dc.state; for (const row of s.map) for (const c of row) { c.explored = true; c.visible = true } })
    await sleep(500)
    await page.screenshot({ path: path.join(SHOTS, `house-${n++}-${d.tier}.png`) })
    // out through the front door
    await place(inside.exit.x, inside.exit.y); await sleep(900)
    const out = await ev(() => !window.__dc.state.cave)
    check(out, 'walking onto the front door leads back out')
    if (!out) break
  }
  // ---- Päivölä: solve it by walking into mirrors, open the chest, come back solved
  const sunDoor = doors.find(d => d.kind === 'sunroom')
  check(!!sunDoor, "the home village has the glassmaker's house")
  if (sunDoor) {
    await ev(() => { delete window.__dc.state.caveInstances?.[window.__dc.state.houseDoors.find(d => d.kind === 'sunroom').label] })
    await placeWorld(sunDoor.X, sunDoor.Y + 2); await sleep(350)
    await placeWorld(sunDoor.X, sunDoor.Y + 1); await sleep(300)
    await placeWorld(sunDoor.X, sunDoor.Y); await sleep(1500)
    const hall = await ev(() => {
      const s = window.__dc.state
      const mirrors = []
      s.map.forEach((row, y) => row.forEach((c, x) => { if (c.mirror) mirrors.push({ x, y, o: c.mirror, solution: c.solution }) }))
      return { inside: !!s.cave, sun: !!s.cave?.sun, solved: s.cave?.sun?.solved, mirrors, glass: s.entities.some(e => e.role === 'glassmaker') }
    })
    check(hall.inside && hall.sun && hall.solved === false, 'Päivölä opens on a hall with a sunbeam that goes nowhere', `${hall.mirrors.length} mirrors`)
    check(hall.glass, 'the glassmaker is at home')
    await ev(() => { const s = window.__dc.state; for (const row of s.map) for (const c of row) { c.explored = true; c.visible = true } })
    await sleep(500)
    await page.screenshot({ path: path.join(SHOTS, 'sunroom-0-unsolved.png') })
    // walk into each wrong mirror from a free side, holding the arrow key a moment
    const KEY = { east: 'ArrowRight', west: 'ArrowLeft', south: 'ArrowDown', north: 'ArrowUp' }
    let result = null
    // (a decoy's recorded orientation is arbitrary: once the seed is lit, stop)
    for (const m of hall.mirrors.filter(m => m.o !== m.solution)) {
      if (result?.solved) break
      const side = await ev(m => {
        const s = window.__dc.state
        for (const [dx, dy, dir] of [[-1, 0, 'east'], [1, 0, 'west'], [0, -1, 'south'], [0, 1, 'north']]) {
          const c = s.map[m.y + dy]?.[m.x + dx]
          if (c && c.tile !== 0 && !s.entities.some(e => e.x === m.x + dx && e.y === m.y + dy && e.type === 'npc')) return { x: m.x + dx, y: m.y + dy, dir }
        }
        return null
      }, m)
      if (!side) { check(false, `mirror at ${m.x},${m.y} has a side to push from`); continue }
      await place(side.x, side.y); await sleep(150)
      await page.keyboard.down(KEY[side.dir]); await sleep(420); await page.keyboard.up(KEY[side.dir]); await sleep(150)
      result = await ev(m => ({ o: window.__dc.state.map[m.y][m.x].mirror, solved: window.__dc.state.cave.sun.solved }), m)
      check(result.o === m.solution, `walking into the mirror at ${m.x},${m.y} turned it once`, result.o)
    }
    check(result?.solved === true, 'the beam reaches the seed: solved')
    const after = await ev(() => {
      const s = window.__dc.state, a = s.cave.sun.alcove
      return { open: s.map[a.y][a.x].tile !== 0, chest: s.entities.find(e => e.type === 'chest' && e.x === a.x && e.y === a.y) ? { x: a.x, y: a.y } : null,
        solvedSaved: window.__dc.wilds.solved.has(s.cave.label), glad: s.entities.find(e => e.role === 'glassmaker')?.lines.some(l => /gold/i.test(l)) }
    })
    check(after.open && !!after.chest, 'the panel opened on a chest')
    check(after.solvedSaved, 'the world remembers it solved')
    check(after.glad, 'the glassmaker is glad')
    await ev(() => { const s = window.__dc.state; for (const row of s.map) for (const c of row) { c.explored = true; c.visible = true } })
    await sleep(600)
    await page.screenshot({ path: path.join(SHOTS, 'sunroom-1-solved.png') })
    if (after.chest) {
      await place(after.chest.x, after.chest.y + 1); await sleep(200)
      await place(after.chest.x, after.chest.y); await sleep(700)
      check(await ev(() => window.__dc.wilds.looted.has(window.__dc.state.cave.label)), 'opening the chest takes the reward for good')
    }
    // out, forget the stored house (as the reset does), back in: still lit
    const ex = await ev(() => window.__dc.state.cave.stairs)
    await place(ex.x, ex.y); await sleep(900)
    await ev(() => { const s = window.__dc.state; for (const k of Object.keys(s.caveInstances ?? {})) if (k.startsWith('house:')) delete s.caveInstances[k] })
    await placeWorld(sunDoor.X, sunDoor.Y + 2); await sleep(350)
    await placeWorld(sunDoor.X, sunDoor.Y + 1); await sleep(300)
    await placeWorld(sunDoor.X, sunDoor.Y); await sleep(1500)
    const again = await ev(() => { const s = window.__dc.state; return { solved: s.cave?.sun?.solved, chests: s.entities.filter(e => e.type === 'chest').length } })
    check(again.solved === true && again.chests === 0, 'rebuilt after the reset it is still lit, the reward gone', JSON.stringify(again))
  }
  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '))
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
