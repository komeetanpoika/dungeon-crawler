// A live check of Kalevanlinna in the real game: Electron on this display
// with a throwaway profile and a Wilds save that starts just outside the
// north gate on a morning (seed 7, day 1: a busker plays that morning).
// It walks in, then, the clock set through the debug hooks (--dcdebug):
//
//   gate     walks in through the north gate
//   dawn     the square at dawn
//   crier    the crier at his box: his hand bell and his news
//   talk     two talking pairs on the square at once, each with its own bubbles
//   smith    the smith's hammer swinging at the anvil
//   busker   the busker playing (his notes)
//   gulls    the harbour gulls, settled and lifting as the player comes
//   noon     the square at noon
//   bell     the church bell ringing
//   cart     day 4's morning cart and its carter, followed down to its stall
//            and back out (south, a turn, north)
//   dusk     the square at dusk
//   inn      into the taproom; a resident struck down; out (no house kept, no
//            crime in the street); in again (the struck one is not there)
//   barracks into the barracks
//   follow   one townsperson followed to a door and in after them
//   crime    a townsperson hit twice: the warning, the pursuit, the stocks
//            and its crowd and turnips, freed
//   wolf     a wolf led to the north gate stops outside the walls
//   night    the square at night (lamps lit)
//
// and all along watches for anyone standing in a doorway. One line per check,
// screenshots of each (city-*.png) in the directory given; exits non-zero if
// anything is wrong. About three minutes; `--only a,b` runs some sections
// (the clock only goes forward, so they still run in the order above).
//
//   node tools/city/walk.mjs [shots-dir] [--only gate,inn,...] [--seed 7] [--day 1]
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { W, sleep, citySave, driver, launchGame, enterWilds, noDamage } from './live.mjs'
import { cityFor } from '../../renderer/wilds/city/build.js'
import { sceneWindows } from '../../renderer/wilds/city/scenes.js'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const SEED = Number(opt('--seed', 7)), DAY = Number(opt('--day', 1))
const ONLY = opt('--only', null)?.split(',') ?? null
const SHOTS = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(os.tmpdir(), 'dc-city-walk'))
const PROFILE = path.join(os.tmpdir(), 'dc-city-walk-profile')
fs.mkdirSync(SHOTS, { recursive: true })
const city = cityFor(SEED)
const spot = id => W(city.spots[id].x, city.spots[id].y)
const slot = id => sceneWindows(SEED, DAY).find(s => s.id === id) ?? null
const errors = []
let failed = false
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' — ' + extra : ''}`); if (!ok) failed = true; return ok }
const note = s => console.log(`     ${s}`)

const save = citySave({ seed: SEED, pos: W(80, 14), frac: 0.215 })
save.wilds.day = DAY
const t0 = Date.now()
const { app, page } = await launchGame({ profile: PROFILE, save, errors })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `city-${name}.png`) })
const noErrors = what => { check(errors.length === 0, `no errors ${what}`, errors.slice(0, 3).join(' | ')); errors.length = 0 }
const frac = () => ev(() => ((window.__dc.save.clock % 360) + 360) % 360 / 360)
const atLeast = async f => { if (await frac() < f) await d.setFrac(f) }
const until = async (fn, secs, arg, every = 250) => {
  for (let t = 0; t < secs * 1000; t += every) { const r = await ev(fn, arg); if (r) return r; await sleep(every) }
  return null
}
// the nearest open cell to a world tile, and the player put on it
// (never a door, a cave mouth or the waystone: stepping on one goes in)
const placeOpen = (X, Y) => ev(([X, Y]) => {
  const s = window.__dc.state, o = window.__dc.wilds.origin, p = s.player
  const into = new Set([...(s.houseDoors ?? []), ...(s.caveEntrances ?? []), ...(s.mapExit ? [s.mapExit] : [])].flatMap(d => Array.from({ length: d.span ?? 1 }, (_, i) => `${d.x + i},${d.y}`)))
  for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = X - o.wx * 80 + dx, y = Y - o.wy * 80 + dy
    if (s.map[y]?.[x]?.tile === 1 && !into.has(`${x},${y}`) && !s.entities.some(e => e.hp > 0 && e.x === x && e.y === y)) { p.x = x; p.y = y; p.px = x * 32 + 16; p.py = y * 32 + 16; return { X: X + dx, Y: Y + dy } }
  }
  return null
}, [X, Y])
const goOpen = async (X, Y, settle = 600) => { await d.goTo(X, Y, { settle: 350 }); const at = await placeOpen(X, Y); await sleep(settle); return at }
// out of the city's reach and back: everyone stands where the clock says
const replace = async () => {
  const at = await d.playerWorld()
  await d.goTo(80, 40, { settle: 300 })   // piece (1,0): the window then holds no city piece
  check(!!(await until(() => !window.__dc.state.cityRun, 3)), 'the town is let go when no city piece is in the window')
  await goOpen(at.X, at.Y, 1200)
}
// a swing at one of the city's people (cityKey) or an npc (id), from the cell west of them
const strike = (key, by = 'cityKey') => ev(([key, by]) => {
  const s = window.__dc.state, e = s.entities.find(e => e[by] === key && e.hp > 0)
  if (!e) return null
  const p = s.player
  for (const [dx, dy, facing] of [[-1, 0, 'east'], [1, 0, 'west'], [0, 1, 'north'], [0, -1, 'south']]) {
    const c = s.map[e.y + dy]?.[e.x + dx]   // any floor (a house's are wood, 7): not a wall or a column
    if (!c || c.tile === 0 || c.tile === 8 || c.voidZone) continue
    p.x = e.x + dx; p.y = e.y + dy; p.px = p.x * 32 + 16; p.py = p.y * 32 + 16; p.facing = facing
    return { hp: e.hp }
  }
  return null
}, [key, by])
const swing = async () => { await page.keyboard.down(' '); await sleep(80); await page.keyboard.up(' '); await sleep(120) }
const hpOf = (key, by = 'cityKey') => ev(([key, by]) => window.__dc.state.entities.find(e => e[by] === key)?.hp ?? null, [key, by])
const leave = async () => {
  await ev(() => { const s = window.__dc.state, st = s.cave.stairs, p = s.player; s.cave.offStairs = true; p.x = st.x; p.y = st.y; p.px = st.x * 32 + 16; p.py = st.y * 32 + 16 })
  return until(() => !window.__dc.state.cave, 3)
}
const section = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return
  const s0 = Date.now()
  // every section starts in the street (a house stops the clock and the town)
  if (await ev(() => !!window.__dc.state.cave)) { check(false, `${name}: the player was left indoors; out first`); await leave() }
  try { await fn() } catch (err) { check(false, `${name}: ${err.message.split('\n')[0]}`) }
  noErrors(`in ${name}`)
  note(`(${name}: ${((Date.now() - s0) / 1000).toFixed(1)} s, clock ${(await frac()).toFixed(3)})`)
}

try {
  await enterWilds(page)
  await noDamage(page)
  await page.bringToFront()
  // a new save is unarmed: a dagger (1 a blow; a townsperson has 3 hp)
  await ev(async () => {
    const { weaponContents } = await import(new URL('./systems/entities.js', location.href).href)
    window.__dc.state.player.weapon = weaponContents('dagger')
  })
  check(await ev(([s, d]) => window.__dc.wilds.seed === s && window.__dc.wilds.day === d, [SEED, DAY]), 'the prepared save is the one loaded', `seed ${SEED}, day ${DAY}`)
  // anyone standing in a doorway (a door or its front step) longer than 10 s, outside a scene and a post
  await ev(() => {
    const st = window.__stuck = { at: new Map(), seen: [] }
    setInterval(() => {
      const s = window.__dc.state, run = s?.cityRun, o = window.__dc.wilds?.origin
      if (!run || s.cave || !o) { st.at.clear(); return }
      const ox = o.wx * 80, oy = o.wy * 80, cells = new Set()
      for (const dr of s.houseDoors ?? []) {
        if (!run.cc.doorOf.has(dr.label)) continue   // a village's door beyond the walls
        cells.add(`${dr.x},${dr.y}`)
        const f = run.cc.front(dr.label)
        cells.add(`${f.x - ox},${f.y + 160 - oy}`)
      }
      const p = s.player
      for (const e of s.entities) {
        if (e.cityKey === undefined || !(e.hp > 0)) continue
        const w = run.people.get(e.cityKey), k = `${e.x},${e.y}`
        if (!w || w.scene || w.hunt || w.entry?.act === 'post' || !cells.has(k) || Math.max(Math.abs(p.x - e.x), Math.abs(p.y - e.y)) <= 2) { st.at.delete(e.cityKey); continue }
        const r = st.at.get(e.cityKey)
        if (r && r.k === k) {
          r.t += 0.5
          if (r.t >= 10 && !r.told) { r.told = true; st.seen.push({ id: e.cityKey, name: w.person.name, job: w.person.job, act: w.entry?.act, phase: w.phase, at: { X: e.x + ox, Y: e.y + oy }, frac: run.frac }) }
        } else st.at.set(e.cityKey, { k, t: 0 })
      }
    }, 500)
  })

  // ---- in through the north gate ------------------------------------------------
  await section('gate', async () => {
    await placeOpen(80, 174)
    await sleep(500)
    const outside = await ev(() => { const s = window.__dc.state; return { run: !!s.cityRun, ward: !!s.map[s.player.y][s.player.x].ward } })
    check(!outside.ward, 'the walk starts outside the walls')
    await page.keyboard.down('ArrowDown')
    const inside = await until(() => { const s = window.__dc.state, o = window.__dc.wilds.origin; return s.player.y + o.wy * 80 >= 186 ? { Y: s.player.y + o.wy * 80, ward: !!s.map[s.player.y][s.player.x].ward, run: !!s.cityRun } : null }, 6, null, 100)
    await page.keyboard.up('ArrowDown')
    check(!!inside && inside.ward && inside.run, 'walking south passes the north gate into the city', JSON.stringify(inside))
    await sleep(300)
    await shot('gate')
  })

  // ---- the square at dawn ---------------------------------------------------------
  await section('dawn', async () => {
    await goOpen(79, 236, 1500)
    const n = await ev(() => window.__dc.state.entities.filter(e => e.cityKey !== undefined).length)
    check(n >= 8, 'people about the square at dawn', `${n} city entities`)
    await shot('square-dawn')
  })

  // ---- the crier's hand bell and his news ------------------------------------------
  await section('crier', async () => {
    const s = slot('crier')
    await atLeast(s.a + 0.004)
    await replace()
    const box = spot('crier')
    await goOpen(box.X, box.Y + 4, 500)
    const r0 = await until(() => window.__dc.state.cityRun?.fx.crier?.rings ?? 0, 25)
    check(!!r0, 'the crier rings his bell at his box', `rings ${r0}`)
    if (r0) {
      const rung = await until(n => (window.__dc.state.cityRun.fx.crier?.rings ?? 0) > n, 22, r0, 100)
      await sleep(150)
      await shot('crier-bell')
      check(!!rung, 'and rings again')
      const said = await until(() => {
        const s = window.__dc.state, by = s.cityRun.fx.crier?.by, e = s.entities.find(e => e.cityKey === by)
        return e?.city?.say?.text ?? null
      }, 6)
      check(!!said && said.length > 10, 'his call is news, over his own head', said)
      await shot('crier-news')
    }
  })

  // ---- two talking pairs at once -------------------------------------------------------
  await section('talk', async () => {
    const s = sceneWindows(SEED, DAY).find(w => w.id === 'talk' && w.place === 'square' && w.b > 0.27)
    await atLeast(s.a + 0.002)
    await goOpen(79, 236, 300)
    const both = await until(() => {
      const keys = new Map()
      for (const e of window.__dc.state.entities) {
        const say = e.city?.say, sc = e.city?.scene
        if (e.cityKey === undefined || !say || say.t >= (say.dur ?? 2) || sc?.id !== 'talk') continue
        keys.set(sc.key, say.text)
      }
      return keys.size >= 2 ? [...keys.values()] : null
    }, 20, null, 150)
    await shot('talk-pairs')
    check(!!both, 'two pairs talk at once, each line over its own speaker', JSON.stringify(both))
  })

  // ---- the smith's swing ------------------------------------------------------------------
  await section('smith', async () => {
    const anvil = spot('smithy-anvil')
    await goOpen(anvil.X - 2, anvil.Y + 3, 300)
    const sw = await until(() => {
      const s = window.__dc.state, fx = s.cityRun?.fx.smithy, e = fx && s.entities.find(e => e.cityKey === fx.by)
      return fx?.state === 'hammering' && e?.attack?.phase === 'swing' ? { blows: fx.blows } : null
    }, 25, null, 60)
    await shot('smith-swing')
    check(!!sw, 'the smith swings his hammer at the anvil', JSON.stringify(sw))
  })

  // ---- the busker ----------------------------------------------------------------------------
  await section('busker', async () => {
    const s = slot('busker')
    if (!check(!!s, 'the day has a busker')) return
    await atLeast(s.a + 0.002)
    await goOpen(79, 238, 300)
    const at = await until(() => { const fx = window.__dc.state.cityRun?.fx.busker; return fx?.playing ? { X: fx.X, Y: fx.Y } : null }, 30)
    if (at) { await goOpen(at.X, at.Y + 3, 900) }
    await shot('busker')
    check(!!at, 'the busker plays (and his notes rise)', JSON.stringify(at))
  })

  // ---- the gulls --------------------------------------------------------------------------------
  await section('gulls', async () => {
    const g = await (async () => { await goOpen(80, 270, 600); return ev(() => { const f = window.__dc.state.cityRun?.fx.flocks.find(f => f.kind === 'gull'); return f ? { X: f.X, Y: f.Y, state: f.state } : null }) })()
    if (!check(!!g, 'gulls about the harbour', JSON.stringify(g))) return
    await goOpen(Math.round(g.X), Math.round(g.Y) - 6, 900)
    await shot('gulls-settled')
    const before = await ev(() => window.__dc.state.cityRun.fx.flocks.find(f => f.kind === 'gull').state)
    await placeOpen(Math.round(g.X), Math.round(g.Y))
    const lifted = await until(() => { const f = window.__dc.state.cityRun.fx.flocks.find(f => f.kind === 'gull'); return f.state !== 'settled' ? f.state : null }, 3, null, 100)
    await sleep(300)
    await shot('gulls-lift')
    check(before === 'settled' && !!lifted, 'the gulls lift as the player comes among them', `${before} -> ${lifted}`)
  })

  // ---- the square at noon --------------------------------------------------------------------------
  await section('noon', async () => {
    await atLeast(0.47)
    await replace()
    await goOpen(79, 236, 1200)
    await shot('square-noon')
  })

  // ---- the church bell -------------------------------------------------------------------------------------
  await section('bell', async () => {
    const s = slot('church')
    await atLeast(s.a + 0.004)
    const steps = spot('church-steps')
    await goOpen(steps.X + 2, steps.Y + 3, 600)
    const ringing = await until(() => window.__dc.state.cityRun?.fx.bell, 5)
    await sleep(400)
    await shot('church-bell')
    check(!!ringing, 'the church bell rings')
  })

  // ---- the cart (day 4's morning: the whole trip, in and back out) ------------------------
  await section('cart', async () => {
    const CART_DAY = 4
    const s = sceneWindows(SEED, CART_DAY).find(w => w.id === 'cart')
    if (!check(!!s, `day ${CART_DAY} has a cart`)) return
    // another day's morning: the city reads world.day, so this is a new day for the town
    await ev(([day, f]) => { window.__dc.wilds.day = day; window.__dc.save.clock = f * 360 }, [CART_DAY, s.a + 0.002])
    await replace()
    await goOpen(79, 236, 300)
    const started = await until(() => window.__dc.state.cityRun?.fx.carts.length > 0, 8)
    check(!!started, 'a cart sets out from the north gate')
    const seen = new Set()
    let last = null, prevDir = null
    for (let t = 0; started && t < 75_000; t += 400) {
      const c = await ev(() => { const k = window.__dc.state.cityRun?.fx.carts[0]; return k ? { X: k.X, Y: k.Y, dir: k.dir, state: k.state, by: k.by, look: k.look } : null })
      if (!c) break
      // six tiles behind it: on screen, never in its way
      const u = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[c.dir]
      await placeOpen(Math.round(c.X - 6 * u[0]), Math.round(c.Y - 6 * u[1]))
      // a way it has held for two looks (not a one-tile hop round a corner)
      const held = c.dir === prevDir
      prevDir = c.dir
      if (held && !seen.has(c.dir)) {
        seen.add(c.dir)
        await sleep(250)
        await shot(`cart-${c.dir}`)
        note(`cart going ${c.dir} (${c.state}) at ${Math.round(c.X)},${Math.round(c.Y)}, carter ${c.by} (look ${c.look}) on the box`)
      }
      if (c.state === 'unloading' && last !== 'unloading') { await sleep(200); await shot('cart-unloading') }
      last = c.state
      if (seen.has('north') && seen.size >= 3 && c.Y < 200) break
      await sleep(400)
    }
    check(seen.has('north') && seen.has('south') && (seen.has('east') || seen.has('west')), 'the cart goes south to its stall, turns, and back north', [...seen].join(' '))
  })

  // ---- dusk and night ----------------------------------------------------------------------------------------
  await section('dusk', async () => {
    await atLeast(0.75)
    await replace()
    await goOpen(79, 236, 1200)
    await shot('square-dusk')
  })
  // ---- the inn: in, a resident struck down, out, in again ---------------------------------------------
  const enter = async door => {
    const front = city.doors.find(x => x.label === door.label)
    const f = { X: front.x, Y: front.y + 160 }
    // its front step is the street cell beside it
    const step = await ev(([X, Y]) => {
      const s = window.__dc.state, o = window.__dc.wilds.origin, run = s.cityRun
      const label = `house:city:${X},${Y}`, fr = run?.cc.front?.(label)
      return fr ? { X: fr.x, Y: fr.y + 160 } : null
    }, [f.X, f.Y])
    await goOpen(step.X, step.Y, 300)
    await d.placeWorld(step.X, step.Y)
    await sleep(250)
    await d.placeWorld(f.X, f.Y)
    return until(l => window.__dc.state.cave?.label === l ? { label: l, city: !!window.__dc.state.cave.city } : null, 3, door.label)
  }
  const residents = () => ev(() => window.__dc.state.entities.filter(e => e.type === 'npc' && e.hp > 0).map(e => ({ id: e.id, species: e.species, x: e.x, y: e.y })))
  await section('inn', async () => {
    const inn = city.doors.find(x => x.kind === 'inn')
    const inside = await enter(inn)
    if (!check(!!inside?.city, 'the inn door opens into a city house', JSON.stringify(inside))) return
    await sleep(600)
    const folk = await residents()
    check(folk.length >= 1, 'the taproom has people in it in the evening', folk.map(f => f.id).join(' '))
    await shot('inn-taproom')
    const victim = folk.find(f => f.species === 'townsfolk') ?? folk[0]
    if (!victim) return
    await ev(id => { window.__dc.state.entities.find(e => e.id === id).hp = 1 }, victim.id)
    let gone = false
    for (let i = 0; i < 5 && !gone; i++) { await strike(victim.id, 'id'); await swing(); await sleep(300); gone = !((await hpOf(victim.id, 'id')) > 0) }
    check(gone, 'a resident struck down inside', victim.id)
    await shot('inn-struck')
    check(!!(await leave()), 'and back out into the street')
    await sleep(400)
    const after = await ev(id => {
      const s = window.__dc.state, run = s.cityRun, w = run?.people.get(id)
      return { kept: Object.keys(s.caveInstances ?? {}).filter(k => k.startsWith('house:city:')), crime: run?.crime.level, out: w?.out, mode: w?.mode }
    }, victim.id)
    check(after.kept.length === 0, 'no city house is kept in caveInstances', after.kept.join(' '))
    check(after.crime === 'calm', 'no crime in the street for a blow indoors', after.crime)
    check(after.out === true, 'the struck one is out until the next day', JSON.stringify(after))
    const again = await enter(inn)
    check(!!again, 'the inn opens again')
    await sleep(600)
    const folk2 = await residents()
    check(!folk2.some(f => f.id === victim.id), 'the struck one is not inside the second time', folk2.map(f => f.id).join(' '))
    await shot('inn-again')
    await leave()
  })

  await section('barracks', async () => {
    const br = city.doors.find(x => x.kind === 'barracks')
    const inside = await enter(br)
    if (!check(!!inside?.city, 'the barracks door opens', JSON.stringify(inside))) return
    await sleep(600)
    const folk = await residents()
    note(`in the barracks: ${folk.map(f => `${f.id}(${f.species})`).join(' ') || 'nobody'}`)
    check(folk.every(f => f.species === 'watchman'), 'whoever is in the barracks is of the watch')
    await shot('barracks')
    await leave()
  })

  // ---- one townsperson to a door and in -----------------------------------------------------------------
  await section('follow', async () => {
    await goOpen(79, 236, 300)
    let who = null
    for (let tries = 0; tries < 30 && !who; tries++) {
      who = await ev(() => {
        const s = window.__dc.state, run = s.cityRun, o = window.__dc.wilds.origin
        for (const w of run.people.values()) {
          if (w.mode !== 'near' || w.scene || w.hunt || w.goal?.kind !== 'door' || w.phase !== 'go' || !w.entity) continue
          const f = run.cc.front(w.goal.door)
          const dist = Math.max(Math.abs(f.x - w.X), Math.abs(f.y + 160 - w.Y))
          if (dist >= 3 && dist <= 14) return { id: w.id, name: w.person.name, door: w.goal.door, act: w.entry?.act }
        }
        return null
      })
      if (!who) await sleep(500)
    }
    if (!check(!!who, 'someone near is walking to a door', JSON.stringify(who))) return
    note(`following ${who.name} (${who.id}, ${who.act}) to ${who.door}`)
    let inside = false, w = null
    const f = await ev(door => { const f = window.__dc.state.cityRun.cc.front(door); return { X: f.x, Y: f.y + 160 } }, who.door)
    for (let t = 0; t < 30_000 && !inside; t += 500) {
      w = await ev(id => {
        const s = window.__dc.state, w = s.cityRun.people.get(id)
        return { mode: w.mode, X: +w.X.toFixed(1), Y: +w.Y.toFixed(1), door: w.door, phase: w.phase, goal: w.goal?.kind, wi: w.wi, path: w.path?.length ?? 0, still: +(w.still ?? 0).toFixed(1), scene: w.scene?.id ?? null }
      }, who.id)
      if (w.mode === 'indoors') { inside = w.door === who.door; break }
      // stand six tiles off on the far side from their door, so as never to be in their way
      const dx = Math.sign(w.X - f.X) || 1, dy = Math.sign(w.Y - f.Y)
      await placeOpen(Math.round(w.X) + 6 * dx, Math.round(w.Y) + 6 * dy)
      await sleep(500)
    }
    check(inside, 'they walk in through their door', inside ? who.door : `last seen ${JSON.stringify(w)}, door step ${JSON.stringify(f)}`)
    if (!inside) return
    const [cx, cy] = who.door.slice('house:city:'.length).split(',').map(Number)
    const got = await enter({ label: who.door, x: cx, y: cy - 160 })
    if (!check(!!got, 'the player follows them in')) return
    await sleep(600)
    const folk = await residents()
    check(folk.some(f => f.id === who.id), 'and finds them inside', folk.map(f => f.id).join(' '))
    await shot('follow-inside')
    await leave()
  })

  // ---- the law: a warning, the pursuit, the stocks --------------------------------------------------------
  await section('crime', async () => {
    await goOpen(80, 190, 800)
    const find = () => until(() => {
      const s = window.__dc.state, run = s.cityRun, p = s.player
      let best = null, bd = Infinity
      for (const e of s.entities) {
        const w = e.cityKey !== undefined && run.people.get(e.cityKey)
        if (!w || w.species !== 'townsfolk' || w.scene || !(e.hp > 1) || !s.map[e.y][e.x].ward) continue
        const dd = Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y))
        if (dd < bd) { bd = dd; best = e.cityKey }
      }
      return best
    }, 5)
    let victim = await find()
    if (victim === null) { await goOpen(79, 236, 800); victim = await find() }
    if (!check(victim !== null, 'a townsperson inside the walls to hit', victim === null ? JSON.stringify(await ev(() => {
      const s = window.__dc.state, run = s.cityRun, out = { run: !!run, cave: !!s.cave, near: 0 }
      for (const e of s.entities) if (e.cityKey !== undefined) { out.near++; const w = run?.people.get(e.cityKey); const k = `${w?.species}:${e.hp}:${!!s.map[e.y]?.[e.x]?.ward}:${w?.scene?.id ?? '-'}`; out[k] = (out[k] ?? 0) + 1 }
      return out
    })) : '')) return
    const hit = async () => {
      const hp0 = await hpOf(victim)
      for (let i = 0; i < 6; i++) { if (!(await strike(victim))) return false; await swing(); await sleep(150); if ((await hpOf(victim)) < hp0) return true }
      return false
    }
    check(await hit(), 'the first blow lands')
    const warned = await ev(() => ({ level: window.__dc.state.cityRun.crime.level, bubble: window.__dc.state.feedback.bubble?.text }))
    await shot('warned')
    check(warned.level === 'warned' && warned.bubble === 'Put that away!', 'the first blow is a warning, shouted', JSON.stringify(warned))
    await sleep(1700)
    check(await hit(), 'the second blow lands')
    const wanted = await ev(() => ({ level: window.__dc.state.cityRun.crime.level, bubble: window.__dc.state.feedback.bubble?.text }))
    check(wanted.level === 'wanted' && wanted.bubble === 'Seize them!', 'a second blow while it stands makes the player wanted', JSON.stringify(wanted))
    const hunters = await until(() => {
      const run = window.__dc.state.cityRun, n = [...run.people.values()].filter(w => w.hunt).length
      const hostile = window.__dc.state.entities.filter(e => e.cityKey !== undefined && e.hostile).length
      return n && hostile ? { n, hostile } : null
    }, 4)
    await sleep(800)
    await shot('pursuit')
    check(!!hunters, 'the watch comes after the player', JSON.stringify(hunters))
    // the watch takes the player alive: their last blow ends in the stocks
    await ev(async () => {
      const m = await import(new URL('./systems/player-damage.js', location.href).href)
      m.setDamageObserver(null)
      window.__dc.state.player.hp = 1
    })
    const seated = await until(() => window.__dc.state.player.stocks?.seated ? window.__dc.state.cityRun.crime.level : null, 25)
    check(seated === 'stocks', 'caught, the player sits in the stocks', String(seated))
    await noDamage(page)
    if (!seated) return
    const crowd = await until(() => {
      const run = window.__dc.state.cityRun
      const gawk = [...run.people.values()].filter(w => w.scene?.id === 'gawk').length
      return run.fx.turnips.length && gawk >= 2 ? { gawk, turnips: run.fx.turnips.length } : null
    }, 15, null, 100)
    await shot('stocks-turnips')
    check(!!crowd, 'a crowd gathers round the stocks and turnips fly', JSON.stringify(crowd))
    await ev(() => { window.__dc.state.cityRun.crime.t = 0.5 })
    const freed = await until(() => { const s = window.__dc.state; return !s.player.stocks && s.cityRun.crime.level === 'calm' ? { hp: s.player.hp, bubble: s.feedback.bubble?.text } : null }, 4)
    check(!!freed, 'and freed after their time', JSON.stringify(freed))
    await shot('freed')
  })

  // ---- a wolf at the gate ----------------------------------------------------------------------------------
  await section('wolf', async () => {
    const g = W(80, 20)   // the north gate's wall line
    await goOpen(g.X, g.Y - 8, 500)
    const made = await ev(async () => {
      const { makeNpc } = await import(new URL('./systems/npc.js', location.href).href)
      const s = window.__dc.state, p = s.player
      let at = null
      for (let r = 0; r < 6 && !at; r++) for (let dx = -r; dx <= r && !at; dx++) {
        const x = p.x + dx, y = p.y - 5 - r
        if (s.map[y]?.[x]?.tile === 1 && !s.map[y][x].ward) at = { x, y }
      }
      if (!at) return null
      const wolf = makeNpc({ species: 'wolf', id: 't19-wolf', ...at })
      s.entities.push(wolf)
      return { hostile: wolf.hostile, ...at }
    })
    if (!check(!!made?.hostile, 'a hostile wolf outside the gate', JSON.stringify(made))) return
    const start = await ev(() => { const s = window.__dc.state, o = window.__dc.wilds.origin, e = s.entities.find(e => e.id === 't19-wolf'); return { X: e.x + o.wx * 80, Y: e.y + o.wy * 80 } })
    await sleep(600)
    // the player walks in; the wolf comes after
    for (let k = 0; k <= 14; k += 2) { await placeOpen(g.X, g.Y - 6 + k); await sleep(250) }
    await placeOpen(g.X, g.Y + 7)
    let onWard = 0, near = Infinity, last = null
    for (let t = 0; t < 7000; t += 200) {
      const w = await ev(() => {
        const s = window.__dc.state, o = window.__dc.wilds.origin, e = s.entities.find(e => e.id === 't19-wolf')
        if (!e) return null
        const foe = s.entities.some(x => x.cityKey !== undefined && x.city?.foe === e)
        return { X: e.x + o.wx * 80, Y: e.y + o.wy * 80, hp: e.hp, ward: !!s.map[e.y]?.[e.x]?.ward, foe }
      })
      if (!w) break
      if (w.ward) onWard++
      const was = near
      near = Math.min(near, Math.abs(w.Y - g.Y))
      last = w
      if (near <= 2 && was > 2) await shot('wolf-gate')
      await sleep(200)
    }
    check(near <= 4, 'the wolf comes after the player, up to the gate', `from ${JSON.stringify(start)} to within ${near} tiles of the wall line`)
    check(onWard === 0, 'the wolf never sets foot inside the walls', `frames on warded ground: ${onWard}`)
    check(!!last && last.Y < g.Y, 'it stays outside the gate', JSON.stringify(last))
    note(`a watchman took it on: ${last?.foe ?? 'gone (killed?)'}`)
    await shot('wolf-after')
  })

  await section('night', async () => {
    await atLeast(0.92)
    await replace()
    await goOpen(79, 236, 1500)
    const lit = await ev(() => { const run = window.__dc.state.cityRun; return { lamps: run.lights.lit.reduce((a, v) => a + v, 0), sources: run.lights.sources.length, windows: run.lights.windows.length } })
    check(lit.lamps > 0 && lit.sources > 0, 'the lamps are lit at night', JSON.stringify(lit))
    await shot('square-night')
  })

  const stuck = await ev(() => window.__stuck.seen)
  check(stuck.length === 0, 'nobody stood in a doorway for 10 s or more', JSON.stringify(stuck))
} catch (err) {
  check(false, err.message.split('\n')[0])
} finally {
  await app.close()
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS})`)
console.log(failed ? 'CITY WALK: FAILED' : 'CITY WALK: all good')
process.exit(failed ? 1 : 0)
