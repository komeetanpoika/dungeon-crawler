// A live check of coin in the real game (the web build in headless Chromium,
// a fresh Wilds save, seed 7): the hero is set down beside each kind of vendor
// by the debug hooks (?dcdebug), trades with real key presses and clicks, and
// what came of it is read back off the game's state and its menus.
//
//   smith    Seppo at his anvil: the interact key opens his menu; three spare
//            swords are sold out of the bag at their full worth; the coin
//            buys a blade back; a row the purse cannot pay is marked short
//   stall    a stallholder at her stall sells for coin
//   inn      the Golden Pike: ale, a round for the house, eating until the
//            purse is empty, and drinking until the hero is under the table
//   village  a Koivula householder trades in what the house makes
//   road     a crossroads inn's keeper serves and buys at half
//   purse    a purse on the ground is picked up into the HUD, and is saved
//   errors   no page errors
//
// One or two screenshots per part (coin-*.png) in the directory given. One
// line per check; exits non-zero if anything is wrong. About a minute.
//
//   node tools/coin/live-check.mjs [shots-dir] [--port 8141] [--only smith,stall,inn,village,road,purse]
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, startWeb, launchWeb, enterWilds, SQUARE } from '../city/live.mjs'
import { cityFor } from '../../renderer/wilds/city/build.js'
import { generatePiece } from '../../renderer/wilds/piece.js'
import { PIECE } from '../../renderer/wilds/layout.js'
import { VALUES, MARKUP, FARE } from '../../renderer/data/coin.js'
import { PASS_OUT, MOP_FEE } from '../../renderer/systems/tavern.js'

const argv = process.argv.slice(2)
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const SEED = 7
const PORT = Number(flag('--port') ?? 8141)
const ONLY = flag('--only')?.split(',') ?? null
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const SHOTS = path.resolve(positional[0] ?? path.join(os.tmpdir(), 'dc-coin'))
const MORNING = 0.30, AFTERNOON = 0.60
const city = cityFor(SEED)
const fare = id => FARE.find(f => f.id === id)

// the crossroads inns nearest home, as the bare generator deals them (a
// world may have given one's piece to a tale or the Sampo instead: the check
// takes the first the live world really holds)
function findInns() {
  const out = []
  for (let r = 1; r <= 9; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    const door = generatePiece(SEED, wx, wy, 0).doors.find(d => d.kind === 'inn')
    if (door) out.push({ X: wx * PIECE + door.x, Y: wy * PIECE + door.y })
  }
  return out
}

fs.mkdirSync(SHOTS, { recursive: true })
const errors = []
let fails = 0, passed = 0
const check = (ok, what, detail = '') => { if (ok) passed++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`); return ok }
const wants = k => !ONLY || ONLY.includes(k)

const t0 = Date.now()
const srv = await startWeb(PORT)
const { browser, page } = await launchWeb({ url: `http://localhost:${PORT}`, save: citySave({ seed: SEED, pos: SQUARE, frac: MORNING }), errors })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `coin-${name}.png`) })
try {
  await enterWilds(page)
  await sleep(1000)
  await ev(async () => {
    const m = await import(new URL('./systems/player-damage.js', location.href).href)
    m.setDamageObserver(() => 0)
  })
  const until = async (fn, secs, arg, every = 150) => {
    for (let t = 0; t < secs * 1000; t += every) { const r = await ev(fn, arg); if (r) return r; await sleep(every) }
    return null
  }
  const key = async (k, ms = 130) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); await sleep(120) }
  const hero = () => ev(() => { const p = window.__dc.state.player; return { coins: p.coins, drunk: p.drunk ?? 0, full: p.full ?? 0, hp: p.hp, maxHp: p.maxHp, bag: p.inventory.map(i => i.payload?.weaponType ?? i.kind), n: p.inventory.length } })
  const setHero = o => ev(o => Object.assign(window.__dc.state.player, o), o)
  const giveGear = list => ev(async list => {
    const E = await import(new URL('./systems/entities.js', location.href).href)
    const I = await import(new URL('./systems/inventory.js', location.href).href)
    const p = window.__dc.state.player
    for (const wt of list) p.inventory.push(I.itemFromContents({ type: 'weapon', ...E.weaponContents(wt) }))
  }, list)
  // the trade menu as the player sees it, or null while none is up
  const menu = () => ev(() => {
    const o = document.getElementById('menu-overlay')
    if (!o || o.style.display === 'none' || !o.querySelector('.menu-purse')) return null
    return {
      title: o.querySelector('.menu-title')?.textContent ?? '', said: o.querySelector('.menu-subtitle')?.textContent ?? '',
      purse: Number(o.querySelector('.menu-purse span')?.textContent),
      rows: [...o.querySelectorAll('.menu-btn')].map(b => ({
        label: b.childNodes[0]?.textContent ?? '', price: b.querySelector('.menu-price span') ? Number(b.querySelector('.menu-price span').textContent) : null,
        short: b.classList.contains('short'), selected: b.classList.contains('selected'),
      })),
    }
  })
  const pick = async label => {
    await ev(label => { [...document.querySelectorAll('#menu-overlay .menu-btn')].find(b => b.childNodes[0]?.textContent === label)?.click() }, label)
    await sleep(160)
  }
  // who trades among those in the window: [{ id, kind, name, x, y }] (window tiles)
  const vendors = () => ev(async () => {
    const C = await import(new URL('./systems/coin.js', location.href).href)
    return window.__dc.state.entities.filter(e => C.vendorOf(e)).map(e => ({ id: e.id, kind: C.vendorOf(e), name: C.vendorName(e), x: e.x, y: e.y, job: e.city?.person?.job ?? null }))
  })
  // the hero on the free cell beside an entity (by id), facing it; true when placed
  const standBy = id => ev(id => {
    const s = window.__dc.state, e = s.entities.find(e => e.id === id), p = s.player
    if (!e) return false
    const free = (x, y) => (s.map[y]?.[x]?.tile ?? 0) !== 0 && !s.map[y][x].over && !s.entities.some(o => o !== e && o.hp > 0 && o.x === x && o.y === y)
      && !(s.cave && s.cave.stairs.x === x && s.cave.stairs.y === y)
    const c = [[-1, 0], [1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy })).find(c => free(c.x, c.y))
    if (!c) return false
    p.x = c.x; p.y = c.y; p.px = c.x * 32 + 16; p.py = c.y * 32 + 16
    e.ai.wanderPt = null; e.ai.dwell = 30
    return true
  }, id)
  // the interact key beside a vendor: their menu
  const talkTo = async id => {
    if (!(await standBy(id))) return null
    await sleep(200)
    await key('f')
    return until(() => !!document.querySelector('#menu-overlay .menu-purse'), 2).then(() => menu())
  }
  const leaveMenu = async () => { await key('Escape'); await sleep(200) }
  const inside = () => ev(() => window.__dc.state.cave?.label ?? null)
  const leaveHouse = async () => {
    await ev(() => { const s = window.__dc.state, st = s.cave.stairs, p = s.player; s.cave.offStairs = true; p.x = st.x; p.y = st.y; p.px = st.x * 32 + 16; p.py = st.y * 32 + 16 })
    return until(() => !window.__dc.state.cave, 3)
  }
  const lightHouse = () => ev(() => { const s = window.__dc.state; for (const row of s.map) for (const c of row) { c.explored = true; c.visible = true } })
  // through a Wilds door at world tile (X, Y)
  const enterDoor = async (X, Y) => {
    await d.goTo(X, Y + 2)
    await d.placeWorld(X, Y + 1); await sleep(300)
    await d.placeWorld(X, Y)
    return until(() => window.__dc.state.cave?.label ?? null, 3)
  }

  // ---- Seppo ------------------------------------------------------------------------------------
  if (wants('smith')) {
    await d.setFrac(MORNING)
    const at = await until(() => { const w = window.__dc.state.cityRun?.people.get('named:seppo'); return w ? { X: Math.round(w.X), Y: Math.round(w.Y), mode: w.mode, act: w.entry?.act ?? null } : null }, 5)
    check(!!at, 'Seppo is in the town', JSON.stringify(at))
    if (at) {
      await d.goTo(at.X + 2, at.Y + 2)
      const near = await until(() => { const e = window.__dc.state.entities.find(e => e.cityKey === 'named:seppo'); return e && e.city.entry?.act === 'work' ? e.id : null }, 25, null, 400)
      check(!!near, 'he is at work in the morning')
      await setHero({ coins: undefined, drunk: 0, full: 0 })
      await ev(async () => { const E = await import(new URL('./systems/entities.js', location.href).href); const p = window.__dc.state.player; p.weapon = E.weaponContents('dagger'); p.inventory = [] })
      await giveGear(['sword', 'sword', 'sword'])
      const m = await talkTo(near)
      await shot('smith-menu')
      if (check(!!m, 'the interact key opens his menu', m ? `${m.title}: ${m.rows.map(r => r.label + (r.price ? ' ' + r.price : '')).join(', ')}` : await ev(() => window.__dc.state.feedback?.bubble?.text ?? 'no menu'))) {
        check(m.title === 'Seppo', 'the menu is headed with his name', m.title)
        check(m.rows.some(r => r.label === 'Axe' && r.price === VALUES.weapon.axe * MARKUP && r.short), 'the axe is priced and beyond an empty purse')
        check(m.rows.at(-2).label === 'Sell from the bag' && m.rows.at(-1).label === 'Leave', 'Sell and Leave close the list')
        await pick('Sell from the bag')
        const bag = await until(() => { const o = document.getElementById('inv-overlay'); return o && o.style.display !== 'none' ? { selling: o.querySelector('.inv-selling')?.textContent ?? '', blue: o.querySelector('.inv-btn.blue em')?.textContent ?? '', desc: o.querySelector('.inv-desc')?.textContent ?? '' } : null }, 2)
        await shot('smith-bag')
        check(bag?.selling === 'Selling to Seppo', 'the bag opens beside him', JSON.stringify(bag))
        check(/^Sell for 8/.test(bag?.blue ?? ''), 'the blue button sells a sword for its full worth', bag?.blue)
        for (let i = 0; i < 3; i++) await key('f', 750)
        const sold = await hero()
        check(sold.coins === 3 * VALUES.weapon.sword && sold.n === 0, 'three held presses sell three swords', JSON.stringify(sold))
        await key('i')
        const back = await until(() => !!document.querySelector('#menu-overlay .menu-purse'), 2).then(() => menu())
        check(back?.purse === 24 && back.rows.find(r => r.selected)?.label === 'Sell from the bag', 'closing the bag comes back to his menu, the purse full', JSON.stringify({ purse: back?.purse, at: back?.rows.find(r => r.selected)?.label }))
        check(back?.rows.find(r => r.label === 'Sword')?.short === false && back?.rows.find(r => r.label === 'Longsword')?.short === true, 'what the purse reaches is no longer short')
        await pick('Sword')
        const bought = await hero()
        const after = await menu()
        check(bought.coins === 0 && bought.bag.includes('sword'), 'the coin buys a sword back at three times its worth', JSON.stringify(bought))
        check(after?.purse === 0 && !!after.said, 'and the menu stays, the purse empty', after?.said)
        await pick('Sword')
        check((await menu())?.said === 'Your purse says no.' && (await hero()).coins === 0, 'an empty purse buys nothing', (await menu())?.said)
        await shot('smith-broke')
        await leaveMenu()
        check((await menu()) === null, 'Escape leaves')
        const hud = await ev(() => { const n = document.getElementById('hud-purse'); return { hidden: n.hidden, text: n.textContent } })
        check(!hud.hidden && hud.text === '0', 'the HUD shows the purse, empty as it is', JSON.stringify(hud))
      }
    }
  }

  // ---- a stall on the square --------------------------------------------------------------------
  if (wants('stall')) {
    await d.setFrac(MORNING)
    await d.goTo(SQUARE.X, SQUARE.Y)
    const stall = await until(async () => {
      const C = await import(new URL('./systems/coin.js', location.href).href)
      const e = window.__dc.state.entities.find(e => e.city?.person?.job === 'stallholder' && C.vendorOf(e))
      return e ? { id: e.id, kind: C.vendorOf(e), act: e.city.entry?.act } : null
    }, 30, null, 500)
    if (check(!!stall, 'a stallholder at her stall trades', JSON.stringify(stall))) {
      await setHero({ coins: 20 })
      const m = await talkTo(stall.id)
      await shot('stall-menu')
      if (check(!!m && m.rows.length >= 4, 'her menu lists her stall', m ? `${m.title} (${stall.kind}): ${m.rows.map(r => r.label).join(', ')}` : 'no menu')) {
        const first = m.rows[0], n0 = (await hero()).n
        await key('Enter')
        const h = await hero()
        check(h.coins === 20 - first.price, 'Enter buys the first row', `${first.label} for ${first.price}: ${JSON.stringify(h)}`)
        await leaveMenu()
      }
    }
    const idle = await ev(async () => {
      const C = await import(new URL('./systems/coin.js', location.href).href)
      const all = window.__dc.state.entities.filter(e => e.city?.person)
      return { people: all.length, trading: all.filter(e => C.vendorOf(e)).length }
    })
    check(idle.people > idle.trading && idle.trading >= 1, 'only some of the town trades', JSON.stringify(idle))
  }

  // ---- the Golden Pike --------------------------------------------------------------------------
  if (wants('inn')) {
    await d.setFrac(AFTERNOON)
    const door = city.doors.find(x => x.kind === 'inn')
    const f = { X: door.x, Y: door.y + 160 }
    const step = await ev(label => { const fr = window.__dc.state.cityRun?.cc.front?.(label); return fr ? { X: fr.x, Y: fr.y + 160 } : null }, door.label)
    await d.goTo(step?.X ?? f.X, step?.Y ?? f.Y + 1)
    // the town takes its places for the afternoon: someone who pours is behind the door
    const staffed = await until(label => [...window.__dc.state.cityRun.people.values()].some(w => w.mode === 'indoors' && !w.out && w.door === label && ['innkeeper', 'server'].includes(w.person.job)), 30, door.label, 400)
    check(!!staffed, 'someone who pours is in the inn in the afternoon')
    await d.placeWorld(f.X, f.Y)
    const label = await until(() => window.__dc.state.cave?.label ?? null, 3)
    if (check(!!label, 'the inn door opens', label ?? '')) {
      await sleep(500); await lightHouse()
      const keeper = (await vendors()).find(v => v.kind === 'innkeeper')
      if (check(!!keeper, 'the innkeeper is behind his counter', JSON.stringify(await vendors()))) {
        await setHero({ coins: 200, drunk: 0, full: 0, hp: 3 })
        const m = await talkTo(keeper.id)
        await shot('inn-menu')
        if (check(!!m && m.rows[0].label === fare('ale').name, 'his menu is the fare', m ? `${m.title}: ${m.rows.map(r => `${r.label} ${r.price ?? ''}`.trim()).join(', ')}` : 'no menu')) {
          const round = m.rows.find(r => r.label === fare('round').name)
          await key('Enter')
          let h = await hero()
          check(h.coins === 198 && h.drunk > 0.9, 'a mug of ale: two coin, and to the head', JSON.stringify(h))
          await pick(fare('roast').name)
          h = await hero()
          check(h.hp === 9 && h.coins === 198 - fare('roast').price && h.full >= 1.9, 'the roast mends six and fills', JSON.stringify(h))
          await pick(fare('round').name)
          h = await hero()
          const floats = await ev(() => window.__dc.state.feedback.floats.filter(f => f.text === 'Kippis!').length)
          check(h.coins === 198 - fare('roast').price - round.price && round.price >= fare('round').min, 'a round for the house, priced by the head', `${round.price} coin, ${floats} guests lift theirs`)
          // eat until the purse is empty
          await setHero({ coins: 9, full: 0 })
          let bowls = 0
          for (let i = 0; i < 6; i++) { await pick(fare('stew').name); const now = await hero(); if (now.coins < 9 - bowls * 4) bowls++ }
          h = await hero()
          const said = (await menu())?.said
          check(bowls === 2 && h.coins === 1 && said === 'Your purse says no.', 'stew until the purse says no', `${bowls} bowls, ${h.coins} coin left, "${said}"`)
          // drink until under the table
          await setHero({ coins: 100, drunk: 0 })
          let mugs = 0
          for (let i = 0; i < PASS_OUT + 2 && (await menu()); i++) { await pick(fare('ale').name); mugs++ }
          const toast = await until(() => { const t = document.getElementById('toast-overlay'); return t && t.style.display !== 'none' && t.textContent ? t.textContent : null }, 3)
          await shot('inn-under-the-table')
          h = await hero()
          check(mugs === PASS_OUT && /Under the table/.test(toast ?? ''), 'the mug too many puts him under the table', `${mugs} mugs: ${toast}`)
          check(h.coins === 100 - PASS_OUT * fare('ale').price - MOP_FEE, 'and the innkeeper takes his fee', JSON.stringify(h))
          await key(' ')
          await sleep(300)
          // tipsy still: a walk east wanders off its line
          const y0 = await ev(() => window.__dc.state.player.py)
          await setHero({ drunk: 5 })
          let drifted = 0
          for (let i = 0; i < 6 && drifted < 2; i++) { await key('d', 260); drifted = Math.max(drifted, Math.abs((await ev(() => window.__dc.state.player.py)) - y0)) }
          check(drifted >= 2, 'a hero in his cups does not walk straight', `${drifted.toFixed(1)} px off the line`)
          await shot('inn-tipsy')
        }
      }
      await setHero({ drunk: 0, full: 0 })
      check(!!(await leaveHouse()), 'and out into the street')
    }
  }

  // ---- a village household ----------------------------------------------------------------------
  if (wants('village')) {
    await d.setFrac(MORNING)
    await d.goTo(40, 44)
    await sleep(600)
    const doors = await ev(() => { const s = window.__dc.state, o = window.__dc.wilds.origin; return s.houseDoors.filter(x => x.tier === 'safe' && !x.story && !x.kind && !x.city).map(x => ({ X: x.x + o.wx * 80, Y: x.y + o.wy * 80, label: x.label })) })
    let found = null
    const kinds = []
    for (const door of doors.slice(0, 6)) {
      if (!(await enterDoor(door.X, door.Y))) continue
      await sleep(400); await lightHouse()
      const v = await vendors()
      kinds.push(v.map(x => x.kind).join('+') || 'nobody home')
      if (v.length && !found) {
        found = v[0]
        await setHero({ coins: 60 })
        const m = await talkTo(found.id)
        await shot('village-menu')
        if (check(!!m && m.rows.length >= 3, 'a householder trades in what the house makes', m ? `${m.title}: ${m.rows.map(r => `${r.label} ${r.price ?? ''}`.trim()).join(', ')}` : 'no menu')) {
          const row = m.rows.find(r => r.price && !r.short)
          await pick(row.label)
          check((await hero()).coins === 60 - row.price, 'and sells it for coin', `${row.label} for ${row.price}`)
          await leaveMenu()
        }
      }
      await leaveHouse(); await sleep(300)
    }
    check(!!found, 'Koivula has someone to trade with', kinds.join(' | '))
    check(kinds.every(k => !k.includes('+')), 'one trader to a house', kinds.join(' | '))
  }

  // ---- a crossroads inn -------------------------------------------------------------------------
  if (wants('road')) {
    let inn = null
    for (const c of findInns().slice(0, 4)) {
      await d.goTo(c.X, c.Y + 3)
      const there = await ev(([X, Y]) => { const s = window.__dc.state, o = window.__dc.wilds.origin; return s.houseDoors.some(x => x.kind === 'inn' && x.x + o.wx * 80 === X && x.y + o.wy * 80 === Y) }, [c.X, c.Y])
      if (there) { inn = c; break }
    }
    if (check(!!inn, 'a crossroads inn stands within nine pieces of home', JSON.stringify(inn))) {
      const label = await enterDoor(inn.X, inn.Y)
      if (check(!!label, 'its door opens', label ?? '')) {
        await sleep(500); await lightHouse()
        const keeper = (await vendors()).find(v => v.kind === 'innkeeper')
        if (check(!!keeper, 'the innkeeper trades', JSON.stringify(await vendors()))) {
          await ev(() => { const p = window.__dc.state.player; p.coins = 10; p.drunk = 0; p.inventory = [] })
          await giveGear(['longsword'])
          const m = await talkTo(keeper.id)
          await shot('road-inn')
          check(!!m && m.title === 'The innkeeper' && m.rows.some(r => r.label === fare('mead').name), 'the taproom serves', m ? m.rows.map(r => r.label).join(', ') : 'no menu')
          await pick('Sell from the bag')
          const blue = await until(() => document.querySelector('#inv-overlay .inv-btn.blue em')?.textContent ?? null, 2)
          check(blue === `Sell for ${VALUES.weapon.longsword / 2} (hold)`, 'and buys a longsword at half its worth', blue ?? '')
          await key('f', 750)
          check((await hero()).coins === 10 + VALUES.weapon.longsword / 2, 'the coin is in the purse', JSON.stringify(await hero()))
          await key('i'); await sleep(200); await leaveMenu()
        }
        await leaveHouse()
      }
    }
  }

  // ---- a purse on the ground, and the save ------------------------------------------------------
  if (wants('purse')) {
    await sleep(400)
    await ev(() => {
      const s = window.__dc.state, p = s.player
      p.coins = 3
      s.entities.push({ type: 'floating_item', contents: { type: 'coins', count: 7 }, x: p.x, y: p.y, startPx: p.px, startPy: p.py, targetPx: p.px, targetPy: p.py, px: p.px, py: p.py, progress: 1, duration: 0.3 })
    })
    const got = await until(() => window.__dc.state.player.coins === 10, 3)
    const hud = await ev(() => document.getElementById('hud-purse').textContent)
    check(!!got && hud === '10', 'a purse on the ground goes into the hero\'s own', `HUD ${hud}`)
    await key('Escape'); await sleep(300)   // the pause menu saves the Wilds
    const saved = await ev(() => window.__dc.save.body?.coins)
    check(saved === 10, 'and the purse is in the save', String(saved))
    await key('Escape')
  }

  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '))
} catch (e) {
  fails++
  console.log(`FAIL the run threw: ${e.stack ?? e}`)
  await shot('threw').catch(() => {})
} finally {
  await browser.close()
  srv.kill()
}
console.log(`${passed} ok, ${fails} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS}`)
process.exit(fails ? 1 : 0)
