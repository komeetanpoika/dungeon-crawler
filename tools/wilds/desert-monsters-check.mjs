// A live check of the desert's creatures in the real game (the web build in
// headless Chromium, a fresh Wilds save, seed 7): each is found where the
// generator itself dealt it (worked out here from the seed), the hero is set
// down beside it by the debug hooks (?dcdebug), and what happens is driven by
// real key presses and read back off the game's state.
//
//   scorpion  a small scorpion lies buried by day (sunk, hook-driven); walking
//             up to it rouses it
//   worm      walking past a sand worm: it hunts, the ground shakes (tell), it
//             erupts under a hero who keeps walking, and he is hurt
//   antlion   standing on the funnel's slope carries the hero inward; at the
//             bottom the jaws snap; dead, it leaves loot and the funnel goes
//   jackals   a pack harries; with its mates dead the last one runs
//   errors    no page errors
//
// One screenshot per creature (monsters-*.png) in the directory given. One
// line per check; exits non-zero if anything is wrong. About a minute.
//
//   node tools/wilds/desert-monsters-check.mjs [shots-dir] [--port 8137] [--only scorpion,worm,antlion,jackals]
//   node tools/wilds/desert-monsters-check.mjs --spots      print where each creature stands in seed 7 and exit
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, startWeb, launchWeb, enterWilds } from '../city/live.mjs'
import { generatePiece } from '../../renderer/wilds/piece.js'
import { PIECE, pieceBiome } from '../../renderer/wilds/layout.js'
import { TILE } from '../../renderer/systems/entities.js'
import { looseSand } from '../../renderer/wilds/sand.js'

const argv = process.argv.slice(2)
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const SEED = 7
const PORT = Number(flag('--port') ?? 8137)
const ONLY = flag('--only')?.split(',') ?? null
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const SHOTS = path.resolve(positional[0] ?? path.join(os.tmpdir(), 'dc-desert-monsters'))
const NOON = 0.5

// ---- where they stand (pure in the seed) ------------------------------------------------
// The first piece, going out through the desert, that holds each creature
// with open loose sand round it: `east` cells of loose sand running east of
// the cell `south` tiles south of it (the hero's walk), and nothing else
// hostile within `alone` tiles.
const foeOf = s => s.kind === 'npc' ? s.species : s.kind
const HOSTILE = new Set(['skorpioni', 'keisariskorpioni', 'hiekkamato', 'kuoppaleuka', 'jackal', 'wolf', 'bear', 'monster', 'rappeluu', 'manticore', 'podeboo', 'boarhound', 'guard', 'ogre', 'klovni', 'pullopete'])
function find(kind, { south = 0, west = 0, east = 0, alone = 10, min = 1 } = {}) {
  for (let r = 3; r <= 14; r++) for (let wy = -r; wy <= r; wy++) for (let wx = 2; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || pieceBiome(SEED, wx, wy) !== 'desert') continue
    const p = generatePiece(SEED, wx, wy, 0)
    for (const s of p.spawns) {
      if (foeOf(s) !== kind) continue
      const mates = p.spawns.filter(o => o !== s && foeOf(o) === kind && Math.hypot(o.x - s.x, o.y - s.y) <= 5)
      if (mates.length + 1 < min) continue
      if (p.spawns.some(o => o !== s && !mates.includes(o) && HOSTILE.has(foeOf(o)) && Math.hypot(o.x - s.x, o.y - s.y) <= alone)) continue
      // the hero's ground: inside the piece, loose, walkable
      let ok = s.x - west >= 8 && s.x + east < PIECE - 8 && s.y + south < PIECE - 8
      for (let x = s.x - west; ok && x <= s.x + east; x++) for (let dy = 0; dy <= Math.max(south, 0); dy++)
        if (!looseSand(p.cells, x, s.y + dy) || p.cells[s.y + dy][x].tile !== TILE.FLOOR) { ok = false; break }
      if (!ok) continue
      return { kind, X: wx * PIECE + s.x, Y: wy * PIECE + s.y, tier: p.tier, piece: p.key, mates: mates.length }
    }
  }
  return null
}
const SPOTS = {
  scorpion: find('skorpioni', { south: 5, west: 1, east: 1 }),
  worm: find('hiekkamato', { south: 5, west: 6, east: 12, alone: 14 }),
  antlion: find('kuoppaleuka', { south: 3, west: 4, east: 4 }),
  jackals: find('jackal', { south: 6, west: 2, east: 2, min: 3 }),
}
if (argv.includes('--spots')) { for (const [k, s] of Object.entries(SPOTS)) console.log(k, JSON.stringify(s)); process.exit(0) }
for (const [k, s] of Object.entries(SPOTS)) if (!s) { console.error(`no ${k} with room round it in seed ${SEED}'s desert`); process.exit(2) }

// ---- the game ---------------------------------------------------------------------------
fs.mkdirSync(SHOTS, { recursive: true })
const errors = []
let fails = 0, passed = 0
const note = m => console.log(m)
const check = (ok, what, detail = '') => { if (ok) passed++; else fails++; note(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const wants = k => !ONLY || ONLY.includes(k)

const t0 = Date.now()
const srv = await startWeb(PORT)
const start = SPOTS.scorpion
const { browser, page } = await launchWeb({ url: `http://localhost:${PORT}`, save: citySave({ seed: SEED, pos: { X: start.X, Y: start.Y + 6 }, frac: NOON }), errors })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `monsters-${name}.png`) })
try {
  await enterWilds(page)
  await sleep(800)
  // the clock held at noon (scorpions buried), the hero whole before each part
  const heal = () => ev(() => { const p = window.__dc.state.player; p.hp = p.maxHp; p.poison = undefined; p.invulnTimer = 0; p.knockback = null })
  const holdNoon = () => ev(f => { window.__dc.save.clock = f * 360 }, NOON)
  // the creature of `type` (species for an npc) nearest world tile (X, Y), as plain data
  const read = (type, X, Y, reach = 30) => ev(([type, X, Y, reach]) => {
    const { state, wilds } = window.__dc, o = wilds.origin
    const x = X - o.wx * 80, y = Y - o.wy * 80
    const of = e => e.type === 'npc' ? e.species : e.type
    const near = state.entities.filter(e => of(e) === type && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= reach).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
    if (!near) return null
    const p = state.player
    return { x: near.x, y: near.y, hp: near.hp, sink: near.sink ?? 0, away: Math.hypot(near.px - p.px, near.py - p.py) / 32,
      scorp: near.scorp?.state, worm: near.worm?.state, pit: !!near.pit, brain: !!near.brainDriven, goal: near.ai?.current, heroHp: p.hp, heroPx: p.px, heroPy: p.py }
  }, [type, X, Y, reach])
  const hold = async (key, ms, until = null) => {
    await page.keyboard.down(key)
    const end = Date.now() + ms
    let hit = null
    while (Date.now() < end) { await sleep(50); if (until && (hit = await until())) break }
    await page.keyboard.up(key)
    return hit
  }

  if (wants('scorpion')) {
    const s = SPOTS.scorpion
    await d.goTo(s.X, s.Y + 5); await holdNoon(); await heal(); await sleep(400)
    const a = await read('skorpioni', s.X, s.Y)
    check(a?.scorp === 'buried' && a.sink === 1 && !a.brain, 'a scorpion lies buried by day', `state ${a?.scorp}, sink ${a?.sink}, at ${s.X},${s.Y} (toughness ${s.tier})`)
    await shot('scorpion-buried')
    const roused = await hold('ArrowUp', 4000, async () => { const b = await read('skorpioni', s.X, s.Y); return b && b.scorp !== 'buried' ? b : null })
    check(!!roused, 'walking up to it rouses it', roused ? `${roused.scorp} with the hero ${roused.away.toFixed(1)} tiles off` : 'still buried')
    await sleep(500)
    await shot('scorpion-out')
    const c = await read('skorpioni', s.X, s.Y)
    check(!c || c.brain || c.scorp === 'rearing' || c.scorp === 'struck', 'out of the sand the brain drives it', `state ${c?.scorp}`)
  }

  if (wants('worm')) {
    const s = SPOTS.worm
    await d.goTo(s.X - 6, s.Y + 5); await holdNoon(); await heal(); await sleep(400)
    const a = await read('hiekkamato', s.X, s.Y)
    check(!!a && a.sink === 1, 'a sand worm is under the sand', `state ${a?.worm}, ${a?.away.toFixed(1)} tiles off, at ${s.X},${s.Y} (toughness ${s.tier})`)
    const seen = new Set()
    let toldShot = false
    const hurt = await hold('ArrowRight', 9000, async () => {
      const b = await read('hiekkamato', s.X, s.Y)
      if (!b) return null
      seen.add(b.worm)
      if (b.worm === 'tell' && !toldShot) { toldShot = true; await shot('worm-tell') }
      return b.heroHp < 10 && b.worm === 'up' ? b : null
    })
    await sleep(350)                       // risen to its full height
    await shot('worm-up')
    check(seen.has('hunt'), 'it feels a walking hero and hunts', [...seen].join(' > '))
    check(seen.has('tell'), 'the ground shakes before it comes up')
    check(!!hurt, 'it erupts under a hero who keeps walking, and he is hurt', hurt ? `hp ${hurt.heroHp}, the worm ${hurt.away.toFixed(1)} tiles off` : `states ${[...seen].join(' > ')}`)
  }

  if (wants('antlion')) {
    const s = SPOTS.antlion
    // beside the funnel first, then onto its slope and read at once: the slope does not wait
    await d.goTo(s.X + 5, s.Y + 1); await holdNoon(); await heal(); await sleep(300)
    await shot('antlion')
    await d.placeWorld(s.X + 2, s.Y + 1)
    const a = await read('kuoppaleuka', s.X, s.Y, 1)
    check(!!a && a.pit, 'an antlion sits in its funnel', `${a?.away.toFixed(2)} tiles from the hero, at ${s.X},${s.Y} (toughness ${s.tier})`)
    await sleep(450)
    const b = await read('kuoppaleuka', s.X, s.Y, 1)
    check(!!a && !!b && b.away < a.away - 0.4, 'the slope carries a standing hero inward', `${a?.away.toFixed(2)} -> ${b?.away.toFixed(2)} tiles in 0.45 s`)
    let snapped = null
    for (let i = 0; i < 80 && !snapped; i++) { await sleep(60); const c = await read('kuoppaleuka', s.X, s.Y, 1); if (c && c.heroHp < 10) snapped = c }
    check(!!snapped, 'at the bottom the jaws snap', snapped ? `hp ${snapped.heroHp}` : 'no snap in 5 s')
    await shot('antlion-snap')
    // dead, it leaves what it held
    const before = await ev(() => window.__dc.state.entities.filter(e => e.type === 'floating_item').length)
    await ev(([X, Y]) => {
      const { state, wilds } = window.__dc, o = wilds.origin
      const e = state.entities.find(e => e.type === 'kuoppaleuka' && e.x === X - o.wx * 80 && e.y === Y - o.wy * 80)
      if (e) e.hp = 0
    }, [s.X, s.Y])
    await d.goTo(s.X + 5, s.Y + 1)
    await sleep(1200)
    const after = await ev(() => window.__dc.state.entities.filter(e => e.type === 'floating_item').length)
    check(after === before + 1 && !(await read('kuoppaleuka', s.X, s.Y, 1)), 'dead, it is gone and leaves one thing behind', `${before} -> ${after} things lying about`)
    await shot('antlion-dead')
  }

  if (wants('jackals')) {
    const s = SPOTS.jackals
    await d.goTo(s.X, s.Y + 6); await holdNoon(); await heal(); await sleep(1500)
    await shot('jackals')
    const pack = await ev(([X, Y]) => {
      const { state, wilds } = window.__dc, o = wilds.origin
      const x = X - o.wx * 80, y = Y - o.wy * 80
      return state.entities.filter(e => e.type === 'npc' && e.species === 'jackal' && e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 14).map(e => e.ai?.current)
    }, [s.X, s.Y])
    check(pack.length >= 2 && pack.includes('harry'), 'a pack harries', pack.join(', '))
    // all but one struck down: the last one runs
    await heal()
    const left = await ev(([X, Y]) => {
      const { state, wilds } = window.__dc, o = wilds.origin
      const x = X - o.wx * 80, y = Y - o.wy * 80
      const js = state.entities.filter(e => e.type === 'npc' && e.species === 'jackal' && e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 14)
      js.slice(1).forEach(e => { e.hp = 0 })
      const last = js[0], p = state.player
      if (last) last.lastOfPack = true
      // the hero beside the one that is left
      if (last) { p.x = last.x + 2; p.y = last.y; p.px = p.x * 32 + 16; p.py = p.y * 32 + 16 }
      return js.length
    }, [s.X, s.Y])
    await sleep(700)
    const goals = await ev(() => window.__dc.state.entities.filter(e => e.lastOfPack && e.hp > 0).map(e => e.ai?.current))
    check(left >= 2 && goals.length === 1 && goals[0] === 'flee_alone', 'the last one runs', `a pack of ${left}, the one left: ${goals.join(', ')}`)
  }

  const real = errors.filter(e => !/Failed to load resource|net::ERR/.test(e))
  check(real.length === 0, 'no page errors', real.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  srv.kill()
}
note(`(${passed} passed, ${fails} failed; ${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS})`)
process.exit(fails ? 1 : 0)
