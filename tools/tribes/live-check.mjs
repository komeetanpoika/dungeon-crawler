// A live check of the three tribes in the real game (the web build in
// headless Chromium, a fresh Wilds save, seed 7): each camp and seat is found
// where the generator itself dealt it, the hero is set down beside it by the
// debug hooks (?dcdebug), and what happens is read back off the game's state.
//
//   trolls   a war band: the drum beats and stirs the others
//   king     the Mountain King in his hall lifts a boulder and rolls it
//   coven    a para makes off with one thing from the sack; a witch's hex
//            makes the hero a frog
//   sabbath  Syöjätär spits, and a pool lies where it landed
//   seals    a seal camp is at peace and greets; a ware is bought by stepping
//            on it with its price; the singer mends a hurt hero
//   court    striking the gong starts a bout; the walrus's blows never take
//            the last of the hero's health; a blow on a seal angers the tribe
//   errors   no page errors
//
// One or two screenshots per part (tribes-*.png) in the directory given. One
// line per check; exits non-zero if anything is wrong. About a minute and a half.
//
//   node tools/tribes/live-check.mjs [shots-dir] [--port 8139] [--only trolls,king,coven,sabbath,seals,court]
//   node tools/tribes/live-check.mjs --spots      print where each site lies in seed 7 and exit
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sleep, citySave, driver, startWeb, launchWeb, enterWilds } from '../city/live.mjs'
import { generatePiece } from '../../renderer/wilds/piece.js'
import { PIECE } from '../../renderer/wilds/layout.js'

const argv = process.argv.slice(2)
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const SEED = 7
const PORT = Number(flag('--port') ?? 8139)
const ONLY = flag('--only')?.split(',') ?? null
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const SHOTS = path.resolve(positional[0] ?? path.join(os.tmpdir(), 'dc-tribes'))
const NOON = 0.5

// ---- where they are (pure in the seed) --------------------------------------------------
// The nearest piece to home whose main thing is the tribe's `site`.
function find(site) {
  for (let r = 1; r <= 9; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    const p = generatePiece(SEED, wx, wy, 0)
    if (p.main?.site !== site) continue
    const W = s => ({ ...s, X: wx * PIECE + s.x, Y: wy * PIECE + s.y })
    return { site, piece: p.key, tier: p.tier, X: wx * PIECE + p.main.x, Y: wy * PIECE + p.main.y,
      who: p.spawns.filter(s => s.home || s.kind === 'ware').map(W) }
  }
  return null
}
const SPOTS = { trolls: find('warband') ?? find('trolls'), king: find('hall'), coven: find('paras') ?? find('coven'), sabbath: find('sabbath'), seals: find('seals'), court: find('court') }
if (argv.includes('--spots')) {
  for (const [k, s] of Object.entries(SPOTS)) console.log(k, s ? `${s.site} at (${s.X}, ${s.Y}), piece ${s.piece}, toughness ${s.tier}: ${s.who.map(w => `${w.kind}@${w.X},${w.Y}`).join(' ')}` : 'none')
  process.exit(0)
}
for (const [k, s] of Object.entries(SPOTS)) if (!s) { console.error(`no ${k} within 9 pieces of home in seed ${SEED}`); process.exit(2) }

// ---- the game ---------------------------------------------------------------------------
fs.mkdirSync(SHOTS, { recursive: true })
const errors = []
let fails = 0, passed = 0
const check = (ok, what, detail = '') => { if (ok) passed++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const wants = k => !ONLY || ONLY.includes(k)

const t0 = Date.now()
const srv = await startWeb(PORT)
const first = SPOTS.trolls
const { browser, page } = await launchWeb({ url: `http://localhost:${PORT}`, save: citySave({ seed: SEED, pos: { X: first.X, Y: first.Y + 9 }, frac: NOON }), errors })
const d = driver(page), ev = d.ev
const shot = name => page.screenshot({ path: path.join(SHOTS, `tribes-${name}.png`) })
try {
  await enterWilds(page)
  await sleep(800)
  // the hero takes no damage unless a part asks for it (the bench's seam)
  const mercy = on => ev(async on => {
    const m = await import(new URL('./systems/player-damage.js', location.href).href)
    m.setDamageObserver(on ? () => 0 : null)
  }, on)
  const heal = () => ev(() => { const p = window.__dc.state.player; p.hp = p.maxHp; p.poison = undefined; p.hex = undefined; p.hexWard = 0; p.invulnTimer = 0; p.knockback = null })
  // a fresh hero has no blade: the gong wants one
  const arm = () => ev(async () => {
    const m = await import(new URL('./systems/entities.js', location.href).href)
    window.__dc.state.player.weapon = m.weaponContents('sword')
  })
  const holdNoon = () => ev(f => { window.__dc.save.clock = f * 360 }, NOON)
  const give = (kind, n) => ev(async ([kind, n]) => {
    const inv = await import(new URL('./systems/inventory.js', location.href).href)
    inv.addItem(window.__dc.state.player, inv.makeItem(kind, n))
  }, [kind, n])
  const carried = kind => ev(kind => (window.__dc.state.player.inventory ?? []).reduce((n, i) => n + (i.kind === kind ? i.count ?? 1 : 0), 0), kind)
  // the living of the given types within `reach` tiles of world tile (X, Y), as plain data
  const read = (types, X, Y, reach = 16) => ev(([types, X, Y, reach]) => {
    const { state, wilds } = window.__dc, o = wilds.origin
    const x = X - o.wx * 80, y = Y - o.wy * 80, p = state.player
    return state.entities.filter(e => types.includes(e.type) && e.hp > 0 && !(e.dying > 0) && Math.hypot(e.x - x, e.y - y) <= reach).map(e => ({
      type: e.type, X: e.x + o.wx * 80, Y: e.y + o.wy * 80, hp: e.hp, peaceful: e.peaceful === true, duel: !!e.duel,
      away: Math.hypot(e.px - p.px, e.py - p.py) / 32, haste: e.hasteTimer > 0, drum: !!e.drummer?.on,
      king: e.king?.state, boulder: !!e.boulder, stones: e.stones?.length ?? 0, loot: e.loot?.type ?? null, para: e.para?.state,
      noita: e.noita?.state, wisps: e.wisps?.length ?? 0, syo: e.syo?.state, pools: e.pools?.length ?? 0,
      walrus: e.mursu?.state ?? e.walrus?.state, song: e.singer?.state ?? e.song?.state,
    }))
  }, [types, X, Y, reach])
  const hero = () => ev(() => { const p = window.__dc.state.player; return { hp: p.hp, maxHp: p.maxHp, frog: !!(p.hex?.t > 0), bubble: window.__dc.state.feedback?.bubble?.text ?? null } })
  const wares = () => ev(() => {
    const { state, wilds } = window.__dc, o = wilds.origin
    return state.entities.filter(e => e.type === 'floating_item' && e.price).map(e => ({ X: e.x + o.wx * 80, Y: e.y + o.wy * 80, price: e.price, contents: e.contents?.type }))
  })
  // watch until `until()` gives something, at most `ms`
  const watch = async (ms, until) => { const end = Date.now() + ms; let hit = null; while (Date.now() < end && !(hit = await until())) await sleep(80); return hit }
  await mercy(true)

  if (wants('trolls')) {
    const s = SPOTS.trolls
    await d.goTo(s.X, s.Y + 6); await holdNoon(); await heal()
    const band = ['mohkale', 'louhija', 'rumpali']
    const there = await read(band, s.X, s.Y)
    check(there.length >= 3, 'a troll camp holds its band', `${there.map(t => t.type).join(' ')} at ${s.X},${s.Y} (${s.site}, toughness ${s.tier})`)
    const seen = await watch(7000, async () => { const now = await read(band, s.X, s.Y, 20); return now.some(t => t.drum) && now.some(t => t.haste) ? now : null })
    await shot('trolls')
    check(!!seen, 'the drum beats and stirs the others', seen ? `${seen.filter(t => t.haste).length} stirred` : 'no beat or nobody stirred in 7 s')
    const stones = await watch(7000, async () => { const now = await read(['louhija'], s.X, s.Y, 20); return now.some(t => t.stones > 0) ? now : null })
    if (there.some(t => t.type === 'louhija')) { await shot('trolls-rockfall'); check(!!stones, 'the Quarrier calls a rockfall') }
  }

  if (wants('king')) {
    const s = SPOTS.king
    await d.goTo(s.X, s.Y + 5); await holdNoon(); await heal()
    const k0 = (await read(['vuorenkuningas'], s.X, s.Y))[0]
    check(!!k0, 'the Mountain King sits in his hall', `at ${k0?.X},${k0?.Y} (toughness ${s.tier})`)
    const states = new Set()
    let lifted = false
    const rolled = await watch(12000, async () => {
      const k = (await read(['vuorenkuningas'], s.X, s.Y, 24))[0]
      if (!k) return null
      states.add(k.king)
      if ((k.king === 'lift' || k.king === 'rear') && !lifted) { lifted = true; await shot('king-windup') }
      return k.boulder || k.stones > 0 ? k : null
    })
    await shot('king')
    check(lifted, 'he winds up a move the hero can see', [...states].join(' > '))
    check(!!rolled, 'a boulder rolls or stones are called', rolled ? (rolled.boulder ? 'boulder' : `${rolled.stones} marks`) : [...states].join(' > '))
  }

  if (wants('coven')) {
    const s = SPOTS.coven
    await d.goTo(s.X, s.Y + 6); await holdNoon(); await heal()
    await give('cooked_meat', 3)
    const before = await carried('cooked_meat')
    const there = await read(['para', 'noita', 'kuppari', 'kyy'], s.X, s.Y)
    check(there.some(t => t.type === 'noita') && there.some(t => t.type === 'para'), 'a coven camp holds a witch and her paras', `${there.map(t => t.type).join(' ')} at ${s.X},${s.Y} (${s.site})`)
    let frogShot = false
    const frogged = async () => { const h = await hero(); if (h.frog && !frogShot) { frogShot = true; await shot('frog') } return h.frog }
    const robbed = await watch(14000, async () => { await frogged(); const now = await read(['para'], s.X, s.Y, 24); return now.find(t => t.loot) ?? null })
    await shot('coven')
    const after = await carried('cooked_meat')
    check(!!robbed && after === before - 1, 'a para makes off with exactly one thing from the sack', `${before} cooked meat, then ${after}; it carries ${robbed?.loot}`)
    if (!frogShot) await watch(12000, frogged)
    check(frogShot, 'a witch\'s hex makes the hero a frog')
  }

  if (wants('sabbath')) {
    const s = SPOTS.sabbath
    await d.goTo(s.X, s.Y + 5); await holdNoon(); await heal()
    const m0 = (await read(['syojatar'], s.X, s.Y))[0]
    check(!!m0, 'Syöjätär is at her sabbath', `at ${m0?.X},${m0?.Y} (toughness ${s.tier})`)
    const pooled = await watch(10000, async () => { const m = (await read(['syojatar'], s.X, s.Y, 24))[0]; return m?.pools > 0 ? m : null })
    await shot('sabbath')
    check(!!pooled, 'she spits, and a pool lies where it landed', pooled ? `${pooled.pools} pool(s)` : 'none in 10 s')
  }

  const SEALS = ['norppakauppias', 'norppalaulaja', 'norppavahti', 'mursu']
  if (wants('seals')) {
    const s = SPOTS.seals
    const trader = s.who.find(w => w.kind === 'norppakauppias'), singer = s.who.find(w => w.kind === 'norppalaulaja')
    await d.goTo(trader.X + 2, trader.Y + 3); await holdNoon(); await heal(); await sleep(600)
    const there = await read(SEALS, s.X, s.Y)
    check(there.length >= 4 && there.every(t => t.peaceful), 'a seal camp is at peace', `${there.map(t => t.type).join(' ')} at ${s.X},${s.Y}`)
    await d.placeWorld(trader.X + 1, trader.Y + 2)
    const greeted = await watch(4000, async () => (await hero()).bubble)
    await shot('seals')
    check(!!greeted, 'a seal greets the hero who comes near', greeted ?? 'nothing said')
    const ws = await wares()
    check(ws.length === 3, 'the trader has three wares laid out', ws.map(w => `${w.contents ?? 'sea-chest'} for ${w.price.count} ${w.price.item}`).join(', '))
    if (ws.length) {
      const w = ws[0]
      await give(w.price.item, w.price.count + 1)
      const had = await carried(w.price.item)
      await d.placeWorld(w.X, w.Y)
      const gone = await watch(3000, async () => (await wares()).length < ws.length)
      const left = await carried(w.price.item)
      check(!!gone && left === had - w.price.count, 'stepping on a ware with its price buys it, once', `${w.price.item} ${had} -> ${left}`)
    }
    if (singer) {
      await ev(() => { window.__dc.state.player.hp = 4 })
      await d.placeWorld(singer.X + 1, singer.Y)
      const mended = await watch(8000, async () => { const h = await hero(); return h.hp > 4 ? h : null })
      await shot('seals-song')
      check(!!mended, 'the singer mends a hurt hero who stays by her', mended ? `hp 4 -> ${mended.hp}` : 'no mending in 8 s')
    }
  }

  if (wants('court')) {
    const s = SPOTS.court
    const gong = s.who.find(w => w.kind === 'kumistin'), walrus = s.who.find(w => w.kind === 'mursu')
    await d.goTo(gong.X, gong.Y + 1); await holdNoon(); await heal(); await arm(); await sleep(500)
    const m0 = (await read(['mursu'], walrus.X, walrus.Y))[0]
    await shot('court')
    check(!!m0 && m0.peaceful, 'the walrus sits by his ring, at peace', `at ${m0?.X},${m0?.Y}`)
    // face the gong (it stands north of the hero) and strike it
    await page.keyboard.down('ArrowUp'); await sleep(120); await page.keyboard.up('ArrowUp')
    await d.placeWorld(gong.X, gong.Y + 1)
    let bout = null
    for (let i = 0; i < 6 && !bout; i++) {
      await page.keyboard.down(' '); await sleep(120); await page.keyboard.up(' ')
      bout = await watch(700, async () => { const m = (await read(['mursu'], walrus.X, walrus.Y, 24))[0]; return m?.duel ? m : null })
    }
    check(!!bout, 'striking the gong starts a bout')
    const others = await read(['norppakauppias', 'norppalaulaja', 'norppavahti'], s.X, s.Y, 24)
    check(others.length > 0 && others.every(t => t.peaceful), 'and angers nobody', `${others.length} seals at peace`)
    // the hero, nearly spent, stands in the ring: no blow of the walrus's takes the last of him
    await mercy(false)
    const ring = walrus.home ? { X: walrus.X - walrus.x + walrus.home.x, Y: walrus.Y - walrus.y + walrus.home.y } : { X: s.X, Y: s.Y + 1 }
    await ev(() => { const p = window.__dc.state.player; p.hp = 3; p.invulnTimer = 0 })
    await d.placeWorld(ring.X, ring.Y)
    const moves = new Set()
    let boutShot = false
    const over = await watch(25000, async () => {
      const m = (await read(['mursu'], ring.X, ring.Y, 30))[0]
      if (!m) return { gone: true }
      moves.add(m.walrus)
      if (!boutShot && m.walrus && m.walrus !== 'sit' && m.walrus !== 'stalk') { boutShot = true; await shot('court-bout') }
      return m.duel ? null : m
    })
    const h = await hero()
    await shot('court-after')
    check(!!over && !over.gone && h.hp >= 1, 'a hero brought low is put out of the ring alive, and the bout is over', `hp ${h.hp}; moves seen ${[...moves].join(' > ')}`)
    await mercy(true)
    const calm = await watch(3000, async () => { const now = await read(SEALS, s.X, s.Y, 24); return now.length && now.every(t => t.peaceful) ? now : null })
    check(!!calm, 'after the bout the court is at peace again')
  }
} finally {
  check(errors.length === 0, 'no page errors', errors.slice(0, 4).join(' | '))
  await browser.close()
  srv.kill()
}
console.log(`${passed} ok, ${fails} wrong, ${((Date.now() - t0) / 1000).toFixed(0)} s; screenshots in ${SHOTS}`)
process.exit(fails ? 1 : 0)
