// Where the three tribes live (renderer/wilds/tribes-cast.js, features.js,
// sites.js): on mountain, marsh and sea country, judged at the spot, the
// Wilds deals the trolls', the coven's and the seal folk's packs, camps and
// seats; everywhere else, and with the switch off, nothing changes.
//
// Pieces are compared as JSON strings with === and never with a deep assert:
// a failing deep diff of two pieces has crashed this machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { generatePiece } from '../renderer/wilds/piece.js'
import { PIECE, FRAME, biomeAt, biomeSampler, pieceBiome, tierAt } from '../renderer/wilds/layout.js'
import { pieceClass } from '../renderer/wilds/roads.js'
import { mainKind } from '../renderer/wilds/features.js'
import { inGentleRing } from '../renderer/wilds/desert.js'
import { GEN, makeWorld } from '../renderer/wilds/world.js'
import { enterWilds, tickWilds } from '../renderer/wilds/session.js'
import { toWindow } from '../renderer/wilds/window.js'
import { shiftDeep } from '../renderer/wilds/shift.js'
import { TILE } from '../renderer/systems/entities.js'
import { TRIBES, WARES, MEMBERS } from '../renderer/data/tribes.js'
import { tribes, setTribes, tribeAt, tribeOfKind, TRIBE_KINDS, TRIBE_PACKS, TRIBE_CAMPS, TRIBE_SEATS, pickWares } from '../renderer/wilds/tribes-cast.js'

const SEED = 7
const without = fn => { setTribes(false); try { return fn() } finally { setTribes(true) } }
const COUNTRY = { mountain: 'peikot', marsh: 'noidat', sea: 'norpat' }
const isTribal = s => TRIBE_KINDS.has(s.kind) || s.kind === 'ware'
const count = (list, kind) => list.filter(s => s.kind === kind).length
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
// everything of a piece that the game or a neighbour reads, as one string
const whole = p => JSON.stringify([p.cells, p.spawns, p.doors, p.caves, p.signs, p.packs, p.small, p.main, p.spawnPoint, p.points, p.village, p.coach, p.road])
// the countries on a piece's own tiles
function countriesOf(seed, wx, wy) {
  const at = biomeSampler(seed, wx * PIECE, wy * PIECE, wx * PIECE + PIECE - 1, wy * PIECE + PIECE - 1)
  const seen = new Set()
  for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) seen.add(at(wx * PIECE + x, wy * PIECE + y))
  return seen
}
// is the country `want` within r tiles of a piece's cell?
const near = (p, at, r, want) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (biomeAt(SEED, p.wx * PIECE + at.x + dx, p.wy * PIECE + at.y + dy) === want) return true
  return false
}

// The pieces looked at: for each tribe's country the camps and the bosses the
// land deals within twelve pieces of home (most of them), some of its other
// pieces, its villages and farms; and some pieces of the other countries.
// Built once, with the tribes on.
let block = null
function pieces() {
  if (block) return block
  const want = { camp: 16, boss: 12, settled: 4, other: 5 }
  const got = {}
  const list = []
  for (let r = 0; r <= 12; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r) continue
    const country = pieceBiome(SEED, wx, wy)
    const cls = pieceClass(SEED, wx, wy)
    const dealt = mainKind(SEED, wx, wy, 0)
    const group = cls === 'village' || cls === 'farmland' ? 'settled' : dealt === 'camp' || dealt === 'boss' ? dealt : 'other'
    const key = `${COUNTRY[country] ?? 'none'}:${group}`
    const most = COUNTRY[country] ? want[group] : 6
    if ((got[key] ?? 0) >= most) continue
    got[key] = (got[key] ?? 0) + 1
    list.push({ wx, wy })
  }
  block = list.map(({ wx, wy }) => generatePiece(SEED, wx, wy, 0))
  return block
}
const withSite = site => pieces().filter(p => p.main.site === site)

test('GEN is bumped: the spawn lists of mountain, marsh and sea pieces changed', () => assert.equal(GEN, 13))

test('tribeAt: the trolls hold the mountains, the coven the marsh, the seal folk the sea; nobody with the switch off', () => {
  assert.equal(tribes(), true)
  assert.equal(tribeAt('mountain'), 'peikot')
  assert.equal(tribeAt('marsh'), 'noidat')
  assert.equal(tribeAt('sea'), 'norpat')
  for (const b of ['forest', 'autumn', 'desert', undefined]) assert.equal(tribeAt(b), null)
  for (const [key, tribe] of Object.entries(TRIBES)) assert.equal(tribeAt(tribe.country), key)
  without(() => { assert.equal(tribes(), false); for (const b of ['mountain', 'marsh', 'sea', 'forest']) assert.equal(tribeAt(b), null) })
  assert.equal(tribes(), true)
})

test('the tables: packs by toughness with none round home, camps and a seat for each tribe, all of its own members', () => {
  for (const [tribe, names] of Object.entries(MEMBERS)) {
    const own = f => names.includes(f.kind)
    for (const name of names) { assert.ok(TRIBE_KINDS.has(name), name); assert.equal(tribeOfKind(name), tribe) }
    const packs = TRIBE_PACKS[tribe]
    assert.equal(packs.length, 5)
    assert.equal(packs[0].length, 0, `${tribe}: no pack in the ring round home`)
    for (const row of packs) for (const p of row) assert.ok(p.length >= 1 && p.length <= 5 && p.every(own))
    for (const c of TRIBE_CAMPS[tribe]) {
      assert.equal(c.tribe, tribe)
      assert.ok(['den', 'nest', 'bandits', 'graves'].includes(c.look) && c.from >= 1 && c.from <= 2 && c.foes.length > (c.lead ?? 0) && c.foes.every(own), c.name)
      assert.equal(!!c.friendly, TRIBES[tribe].nature === 'friendly', c.name)
      assert.equal(!!c.vendor, !!c.friendly, `${c.name}: a friendly camp trades`)
    }
    assert.ok(TRIBE_CAMPS[tribe].some(c => c.from === 1), `${tribe}: a camp from toughness 1`)
    const seat = TRIBE_SEATS[tribe]
    assert.equal(seat.odds, 0.6)
    assert.ok(own(seat.boss) && seat.foes.every(own))
    assert.equal(!!seat.friendly, TRIBES[tribe].nature === 'friendly')
  }
  assert.equal(tribeOfKind('ogre'), null)
  assert.equal(TRIBE_SEATS.peikot.site, 'hall'); assert.equal(TRIBE_SEATS.noidat.site, 'sabbath'); assert.equal(TRIBE_SEATS.norpat.site, 'court')
  assert.equal(TRIBE_SEATS.peikot.boss.kind, 'vuorenkuningas'); assert.equal(TRIBE_SEATS.noidat.boss.kind, 'syojatar'); assert.equal(TRIBE_SEATS.norpat.boss.kind, 'mursu')
  assert.ok(TRIBE_PACKS.norpat.every(row => row.length === 0), 'the seals keep to their camps')
  for (const tribe of ['peikot', 'noidat']) for (let row = 1; row <= 4; row++) assert.ok(TRIBE_PACKS[tribe][row].length >= 1, `${tribe} roams at toughness ${row}`)
})

test('pickWares: three different wares of the trader\'s list, by the rng alone', () => {
  const rngOf = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }
  const seen = new Set()
  for (let seed = 1; seed <= 60; seed++) {
    const picked = pickWares(rngOf(seed))
    assert.equal(picked.length, 3)
    assert.equal(new Set(picked).size, 3)
    for (const w of picked) { assert.ok(WARES.includes(w)); seen.add(w.id) }
    assert.equal(pickWares(rngOf(seed)).map(w => w.id).join(), picked.map(w => w.id).join())
  }
  assert.equal(seen.size, WARES.length, 'every ware is laid out somewhere')
})

test('every member has a def the registry lists: its tribe, its role, and no spawn of its own', () => {
  const dir = new URL('../renderer/data/monsters/', import.meta.url)
  const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'))
  assert.equal(index.join(), [...index].sort().join(), 'the index stays sorted')
  for (const [tribe, names] of Object.entries(MEMBERS)) for (const name of names) {
    assert.ok(index.includes(name), `${name} is in the index`)
    const def = JSON.parse(fs.readFileSync(new URL(`${name}.json`, dir), 'utf8'))
    assert.equal(def.name, name)
    assert.equal(def.behavior.tribe, tribe, name)
    assert.ok(['fighter', 'mage', 'healer', 'thief', 'warlock', 'vendor', 'boss', 'gong'].includes(def.behavior.role), `${name}: role ${def.behavior.role}`)
    assert.equal(def.spawn, null, `${name} is dealt by the Wilds alone`)
    assert.ok(def.stats.hp >= 1 && def.stats.speed >= 0, name)
  }
})

test('a tribe is met only on its own country, and every one of its spawns has a home there', () => {
  const met = { peikot: 0, noidat: 0, norpat: 0 }
  for (const p of pieces()) for (const s of p.spawns) {
    if (!isTribal(s)) continue
    const tribe = s.kind === 'ware' ? s.tribe : tribeOfKind(s.kind)
    met[tribe]++
    if (s.kind === 'ware') { assert.ok(near(p, s, 8, TRIBES[tribe].country), `${p.key}: a ware off the ${TRIBES[tribe].country}`); continue }
    const h = s.home
    assert.ok(h && Number.isInteger(h.x) && Number.isInteger(h.y) && h.x >= FRAME && h.y >= FRAME && h.x < PIECE - FRAME && h.y < PIECE - FRAME, `${p.key}: ${s.kind} at ${s.x},${s.y} has no home in its piece`)
    assert.ok(dist(s, h) <= 9, `${p.key}: ${s.kind} stands ${dist(s, h).toFixed(1)} from its home`)
    // (a court's heart is a tile south of the spot it was judged at)
    assert.ok(near(p, h, 1, TRIBES[tribe].country), `${p.key}: ${s.kind} is at home on ${biomeAt(SEED, p.wx * PIECE + h.x, p.wy * PIECE + h.y)}`)
    assert.ok(!inGentleRing(p.wx, p.wy), `${p.key}: ${s.kind} in the ring round home`)
  }
  for (const [tribe, n] of Object.entries(met)) assert.ok(n >= 20, `${n} spawns of ${tribe} in the block`)
})

test('every member of every tribe is met in the block', () => {
  const seen = new Set()
  for (const p of pieces()) for (const s of p.spawns) if (TRIBE_KINDS.has(s.kind)) seen.add(s.kind)
  assert.equal([...seen].sort().join(), Object.values(MEMBERS).flat().sort().join())
})

test('with the switch off no tribe is dealt anywhere, and a piece that holds none of their country is the same piece either way', () => {
  let same = 0, touched = 0
  for (const p of pieces()) {
    const plain = without(() => generatePiece(SEED, p.wx, p.wy, 0))
    assert.ok(!plain.spawns.some(isTribal), `${p.key} deals no tribe with the switch off`)
    assert.ok(plain.main.tribe === undefined && plain.packs.every(k => k.tribe === undefined), `${p.key} names no tribe with the switch off`)
    const lands = countriesOf(SEED, p.wx, p.wy)
    if (lands.has('mountain') || lands.has('marsh') || lands.has('sea')) { if (whole(p) !== whole(plain)) touched++; continue }
    assert.ok(whole(p) === whole(plain), `${p.key} (no tribe's country on it) differs with the tribes on`)
    same++
  }
  assert.ok(same >= 8, `${same} pieces off the tribes' countries compared`)
  assert.ok(touched >= 30, `${touched} pieces changed by the tribes`)
})

test('the ring round home is as it was, whatever country lies in it', () => {
  for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
    const on = generatePiece(SEED, wx, wy, 0), off = without(() => generatePiece(SEED, wx, wy, 0))
    assert.ok(whole(on) === whole(off), `${wx},${wy}`)
  }
  // (a seed whose home ring holds a pocket of sea)
  for (const seed of [11, 23]) for (const [wx, wy] of [[1, 1], [0, 1], [-1, 0], [1, -1]]) {
    const on = generatePiece(seed, wx, wy, 0), off = without(() => generatePiece(seed, wx, wy, 0))
    assert.ok(whole(on) === whole(off), `seed ${seed}: ${wx},${wy}`)
  }
})

test('a village and farmland on a tribe\'s country hold nobody of the tribe', () => {
  let checked = 0
  for (const p of pieces()) {
    if (p.cls !== 'village' && p.cls !== 'farmland') continue
    if (!COUNTRY[p.biome]) continue
    checked++
    assert.ok(!p.spawns.some(isTribal), `${p.cls} ${p.key}: ${p.spawns.filter(isTribal).map(s => s.kind).join(' ')}`)
    assert.ok(whole(p) === whole(without(() => generatePiece(SEED, p.wx, p.wy, 0))), `${p.cls} ${p.key} differs with the tribes on`)
  }
  assert.ok(checked >= 8, `${checked} settled pieces on the tribes' countries`)
})

test('a roaming pack of a tribe is one of its table\'s for the toughness, at home where it was dealt', () => {
  const met = { peikot: 0, noidat: 0 }
  for (const p of pieces()) for (const k of p.packs) {
    if (!k.tribe) continue
    met[k.tribe]++
    const foes = p.spawns.filter(s => TRIBE_KINDS.has(s.kind) && s.home.x === k.x && s.home.y === k.y)
    assert.ok(foes.length >= 1, `${p.key}: a pack of ${k.tribe} with nobody in it`)
    const row = TRIBE_PACKS[k.tribe][p.tier]
    // (a foe with no free cell, or cut off, is left out: the pack is then part of a row's pack)
    assert.ok(row.some(pack => foes.every(f => pack.some(m => m.kind === f.kind)) && foes.length <= pack.length), `${p.key}: ${foes.map(f => f.kind).join(' ')} is no pack of toughness ${p.tier}`)
    for (const f of foes) assert.ok(dist(f, k) <= 4, `${p.key}: ${f.kind} strays from its pack`)
  }
  assert.ok(met.peikot >= 5 && met.noidat >= 5, `packs: ${JSON.stringify(met)}`)
  assert.ok(pieces().every(p => p.packs.every(k => k.tribe !== 'norpat')), 'the seals do not roam')
})

test('the trolls\' camps: the horseshoe of rock with a fire in its lap, the band at home by it, and a chest', () => {
  const camps = [...withSite('trolls'), ...withSite('warband')]
  assert.ok(camps.length >= 2, `${camps.length} troll camps in the block`)
  for (const p of camps) {
    assert.equal(p.main.kind, 'camp'); assert.equal(p.main.tribe, 'peikot')
    const camp = TRIBE_CAMPS.peikot.find(c => c.name === p.main.site)
    assert.ok(camp.from <= p.tier, `${p.key}: ${camp.name} at toughness ${p.tier}`)
    assert.equal(p.spawns.filter(s => s.kind === 'campfire' && s.x === p.main.x && s.y === p.main.y).length, 1, `${p.key}: the fire`)
    const band = p.spawns.filter(s => TRIBE_KINDS.has(s.kind) && s.home.x === p.main.x && s.home.y === p.main.y)
    assert.equal(band.map(s => s.kind).sort().join(), camp.foes.map(f => f.kind).sort().join(), p.key)
    assert.ok(p.spawns.some(s => s.kind === 'chest' && dist(s, p.main) <= 3), `${p.key}: the camp's chest`)
    // the horseshoe: rock north of the fire
    assert.equal(p.cells[p.main.y - 4][p.main.x].tile, TILE.WALL, `${p.key}: rock behind the fire`)
  }
})

test('the coven\'s camps: graves round a fire, the witch and what she keeps', () => {
  const camps = [...withSite('paras'), ...withSite('coven')]
  assert.ok(camps.length >= 2, `${camps.length} coven camps in the block`)
  for (const p of camps) {
    assert.equal(p.main.kind, 'camp'); assert.equal(p.main.tribe, 'noidat')
    const camp = TRIBE_CAMPS.noidat.find(c => c.name === p.main.site)
    assert.equal(p.spawns.filter(s => s.kind === 'campfire' && s.x === p.main.x && s.y === p.main.y).length, 1, `${p.key}: the fire`)
    const band = p.spawns.filter(s => TRIBE_KINDS.has(s.kind) && s.home.x === p.main.x && s.home.y === p.main.y)
    assert.equal(band.map(s => s.kind).sort().join(), camp.foes.map(f => f.kind).sort().join(), p.key)
    assert.ok(band.some(s => s.kind === 'noita'), `${p.key}: a witch`)
  }
})

// a trader's stall: the trader with three different wares in a row before him
function stallOf(p, heart) {
  const traders = p.spawns.filter(s => s.kind === 'norppakauppias')
  assert.equal(traders.length, 1, `${p.key}: one trader`)
  const trader = traders[0]
  const wares = p.spawns.filter(s => s.kind === 'ware')
  assert.equal(wares.length, 3, `${p.key}: three wares`)
  const prices = new Set()
  for (const [i, w] of wares.entries()) {
    assert.equal(w.tribe, 'norpat')
    assert.ok(w.x === trader.x - 1 + i && w.y === trader.y + 1, `${p.key}: ware ${i} at ${w.x},${w.y} by the trader at ${trader.x},${trader.y}`)
    assert.ok(typeof w.price.item === 'string' && Number.isInteger(w.price.count) && w.price.count >= 1, `${p.key}: a price`)
    const row = WARES.find(r => JSON.stringify(r.price) === JSON.stringify(w.price) && (r.loot ? w.loot === true && w.contents === undefined : JSON.stringify(r.contents) === JSON.stringify(w.contents)))
    assert.ok(row, `${p.key}: ware ${i} is none of the trader's list`)
    prices.add(row.id)
    assert.equal(p.cells[w.y][w.x].tile, TILE.FLOOR, `${p.key}: ware ${i} lies on open ground`)
  }
  assert.equal(prices.size, 3, `${p.key}: three different wares`)
  assert.ok(dist(trader, heart) <= 8, `${p.key}: the trader by the heart`)
  return trader
}
// nothing that hunts within 24 tiles of a haven's heart, and no pack dealt there
function calmRound(p, heart) {
  for (const k of p.packs) assert.ok(dist(k, heart) >= 24, `${p.key}: a pack ${dist(k, heart).toFixed(1)} from the haven`)
  for (const s of p.spawns) {
    if (s.kind === 'chest') assert.ok(dist(s, heart) > 8, `${p.key}: a chest in the haven`)
    if (['ogre', 'manticore', 'guard'].includes(s.kind)) assert.ok(dist(s, heart) >= 20, `${p.key}: ${s.kind} by the haven`)
  }
}

test('a seal camp: a trader with three priced wares, a singer and two guards by the tents\' fire; no chest, and no pack within 24 tiles', () => {
  const camps = withSite('seals')
  assert.ok(camps.length >= 2, `${camps.length} seal camps in the block`)
  for (const p of camps) {
    assert.equal(p.main.kind, 'camp'); assert.equal(p.main.tribe, 'norpat')
    stallOf(p, p.main)
    assert.equal(count(p.spawns, 'norppalaulaja'), 1, `${p.key}: a singer`)
    assert.equal(count(p.spawns, 'norppavahti'), 2, `${p.key}: two guards`)
    assert.equal(count(p.spawns, 'mursu') + count(p.spawns, 'kumistin'), 0)
    assert.equal(p.spawns.filter(s => s.kind === 'campfire' && s.x === p.main.x && s.y === p.main.y).length, 1, `${p.key}: the fire`)
    for (const s of p.spawns) if (tribeOfKind(s.kind) === 'norpat') assert.ok(s.home.x === p.main.x && s.home.y === p.main.y && dist(s, p.main) <= 7, `${p.key}: ${s.kind} by the fire`)
    // the tents of the bandits' look
    assert.ok(p.cells[p.main.y - 4][p.main.x - 4].overlay?.startsWith('ow_tent'), `${p.key}: a tent`)
    calmRound(p, p.main)
  }
})

test('a trader lays his wares off the trails: nobody buys by walking one (a stall with a path through every place it could stand is rare)', () => {
  // (sea country is sand, and a trail over sand wears ow_path_sand_*)
  const stalls = [...withSite('seals'), ...withSite('court')]
  const trodden = stalls.filter(p => p.spawns.some(s => s.kind === 'ware' && p.cells[s.y][s.x].skin.startsWith('ow_path')))
  assert.ok(stalls.length >= 6, `${stalls.length} stalls in the block`)
  assert.ok(trodden.length <= stalls.length / 5, `${trodden.length} of ${stalls.length} stalls have a ware on a trail: ${trodden.map(p => p.key).join(' ')}`)
})

// the cells reached from `from` over open ground
function reach(p, from) {
  const seen = new Set([from.y * PIECE + from.x]), stack = [[from.x, from.y]]
  while (stack.length) {
    const [x, y] = stack.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, i = ny * PIECE + nx
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen.has(i) || p.cells[ny][nx].tile !== TILE.FLOOR) continue
      seen.add(i); stack.push([nx, ny])
    }
  }
  return seen
}

test('the walrus\'s court: a ring of stones walked through from outside to its middle, the gong, the walrus on his seat, a stall, a singer, three guards', () => {
  const courts = withSite('court')
  assert.ok(courts.length >= 2, `${courts.length} courts in the block`)
  for (const p of courts) {
    assert.equal(p.main.kind, 'boss'); assert.equal(p.main.tribe, 'norpat')
    const c = p.main.court
    assert.ok(c.ring.r === 5 && c.ring.x === p.main.x && c.ring.y === p.main.y + 1, `${p.key}: the ring`)
    const walrus = p.spawns.filter(s => s.kind === 'mursu'), gong = p.spawns.filter(s => s.kind === 'kumistin')
    assert.equal(walrus.length, 1, `${p.key}: the walrus`); assert.equal(gong.length, 1, `${p.key}: the gong`)
    assert.ok(walrus[0].x === c.seat.x && walrus[0].y === c.seat.y && walrus[0].ring === 5, `${p.key}: the walrus on his seat, his ring's size with him`)
    assert.ok(gong[0].x === c.gong.x && gong[0].y === c.gong.y && gong[0].ring === undefined, `${p.key}: the gong at its place`)
    for (const s of [walrus[0], gong[0]]) assert.ok(s.home.x === c.ring.x && s.home.y === c.ring.y, `${p.key}: ${s.kind} belongs to the ring`)
    const trader = stallOf(p, c.ring)
    assert.ok(trader.x === c.mat.x && trader.y === c.mat.y, `${p.key}: the trader on his mat`)
    assert.equal(count(p.spawns, 'norppalaulaja'), 1, `${p.key}: a singer`)
    assert.equal(count(p.spawns, 'norppavahti'), 3, `${p.key}: three guards`)
    assert.ok(!p.spawns.some(s => s.kind === 'ogre'), `${p.key}: no ogre holds a court`)
    // outside the ring: the seat, the gong, the stall and its wares, the guards
    for (const s of p.spawns) if (s.kind === 'ware' || tribeOfKind(s.kind) === 'norpat') assert.ok(dist(s, c.ring) > c.ring.r + 0.5 && dist(s, c.ring) <= 9, `${p.key}: ${s.kind} ${dist(s, c.ring).toFixed(1)} from the ring's middle`)
    // the ring: stones on its circle, open ground inside, and a way in from the piece's paths
    let stones = 0, inside = 0
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const cell = p.cells[c.ring.y + dy][c.ring.x + dx], d = Math.hypot(dx, dy)
      if (d <= 4) { inside++; assert.equal(cell.tile, TILE.FLOOR, `${p.key}: the ring's floor at ${dx},${dy}`) }
      else if (d < 6 && cell.tile === TILE.WALL && cell.overlay?.startsWith('ow_rock')) stones++
    }
    assert.ok(stones >= 12 && stones <= 15, `${p.key}: ${stones} stones in the ring`)
    const seen = reach(p, p.spawnPoint)
    assert.ok(seen.has(c.ring.y * PIECE + c.ring.x), `${p.key}: the ring's middle is reached from where the paths meet`)
    assert.ok(seen.has(c.seat.y * PIECE + c.seat.x) && seen.has(c.gong.y * PIECE + c.gong.x), `${p.key}: the seat and the gong are reached`)
    // walked through anywhere: the cell between each two stones is open
    let gaps = 0
    for (let i = 0; i < 16; i++) {
      const a = (i + 0.5) / 16 * Math.PI * 2
      const x = c.ring.x + Math.round(Math.cos(a) * 5), y = c.ring.y + Math.round(Math.sin(a) * 5)
      if (p.cells[y][x].tile === TILE.FLOOR && seen.has(y * PIECE + x)) gaps++
    }
    assert.ok(gaps >= 12, `${p.key}: ${gaps} gaps between the ring's stones`)
    // two tents and a fire north of it
    assert.equal(p.spawns.filter(s => s.kind === 'campfire' && dist(s, c.ring) <= 9 && s.y < c.ring.y - 5).length, 1, `${p.key}: the fire`)
    let tents = 0
    for (let dy = -9; dy <= -5; dy++) for (let dx = -6; dx <= 6; dx++) if (p.cells[c.ring.y + dy][c.ring.x + dx].overlay?.startsWith('ow_tent')) tents++
    assert.equal(tents, 8, `${p.key}: two tents`)
    calmRound(p, c.ring)
  }
})

test('the Mountain King\'s hall and the sabbath: the boss by the fire with its retinue, at 6 boss pieces in 10 or so of its country', () => {
  const halls = withSite('hall'), sabbaths = withSite('sabbath')
  assert.ok(halls.length >= 2 && sabbaths.length >= 2, `${halls.length} halls, ${sabbaths.length} sabbaths in the block`)
  for (const p of [...halls, ...sabbaths]) {
    const tribe = p.main.tribe, seat = TRIBE_SEATS[tribe]
    assert.equal(p.main.kind, 'boss'); assert.equal(seat.site, p.main.site)
    assert.equal(p.spawns.filter(s => s.kind === 'campfire' && s.x === p.main.x && s.y === p.main.y).length, 1, `${p.key}: the fire`)
    const court = p.spawns.filter(s => TRIBE_KINDS.has(s.kind) && s.home.x === p.main.x && s.home.y === p.main.y)
    assert.equal(count(court, seat.boss.kind), 1, `${p.key}: the boss`)
    assert.ok(dist(court.find(s => s.kind === seat.boss.kind), p.main) <= 3, `${p.key}: the boss by the fire`)
    for (const f of seat.foes) assert.ok(count(court, f.kind) >= 1, `${p.key}: ${f.kind} in the retinue`)
    // (a manticore may roam the land far out; none lairs here)
    assert.ok(!p.spawns.some(s => s.kind === 'ogre' || (s.kind === 'manticore' && dist(s, p.main) < 8)), `${p.key}: no ogre in a tribe's seat`)
    assert.ok(p.spawns.some(s => s.kind === 'chest' && dist(s, p.main) <= 6), `${p.key}: the seat's chest`)
    if (tribe === 'peikot') {
      assert.equal(count(court, 'louhija'), p.tier >= 3 ? 1 : 0, `${p.key}: a Quarrier from toughness 3`)
      assert.equal(p.cells[p.main.y - 4][p.main.x].tile, TILE.WALL, `${p.key}: the hall's rock`)
    } else {
      // a ring of dead trees and graves, open to the south
      let posts = 0
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const o = p.cells[p.main.y + dy][p.main.x + dx].overlay ?? ''
        if (Math.abs(Math.hypot(dx, dy) - 5) < 1 && (o.startsWith('ow_deadtree') || o.startsWith('ow_prop_grave') || o.startsWith('ow_prop_cross'))) posts++
      }
      assert.ok(posts >= 9, `${p.key}: ${posts} posts in the sabbath's ring`)
      for (const dx of [-1, 0, 1]) assert.equal(p.cells[p.main.y + 5][p.main.x + dx].tile, TILE.FLOOR, `${p.key}: open to the south`)
    }
  }
  // the ogre keeps some of the lairs on a tribe's country, and all of them elsewhere
  const lairs = pieces().filter(p => p.main.kind === 'boss' && !p.main.tribe)
  assert.ok(lairs.some(p => COUNTRY[p.biome]), 'no ogre\'s lair left on the tribes\' countries')
  for (const p of lairs) assert.ok(p.spawns.some(s => s.kind === 'ogre' || s.kind === 'manticore'), `${p.key}: a lair with nobody in it`)
})

test('a spawn\'s home moves with it into the window, and with the window when it re-centres', () => {
  const at = withSite('trolls')[0] ?? withSite('warband')[0]
  const world = makeWorld(null, { seed: SEED })
  const buildEntities = spawns => spawns.map(s => ({ type: s.kind, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16, ...(s.home ? { home: s.home } : {}) }))
  const state = { player: { x: 0, y: 0, px: 0, py: 0 }, entities: [] }
  enterWilds(state, world, { wx: at.wx, wy: at.wy }, { buildEntities })
  const check = () => {
    let n = 0
    for (const e of state.entities) {
      if (!e.home) continue
      n++
      const [wx, wy] = e.wildsKey.split(',').map(Number)
      const s = world.pieces.get(e.wildsKey).spawns[e.wildsIx]
      assert.ok(s.home !== e.home, 'the piece\'s spawn keeps its own home')
      const want = toWindow(world.origin, wx * PIECE + s.home.x, wy * PIECE + s.home.y)
      assert.ok(e.home.x === want.x && e.home.y === want.y, `${e.type}: home ${e.home.x},${e.home.y}, wanted ${want.x},${want.y}`)
      assert.ok(Math.hypot(e.x - e.home.x, e.y - e.home.y) <= 9, `${e.type} is by its home`)
    }
    return n
  }
  assert.ok(check() >= 3, 'the camp\'s trolls are built')
  // walk east into the next piece: the window re-centres, and homes go with it
  const p = state.player
  p.x = 2 * PIECE + 10; p.px = p.x * 32 + 16
  const { recentred } = tickWilds(state, world, 0.016, { buildEntities })
  assert.ok(recentred && recentred.dx === 1 && recentred.dy === 0)
  assert.ok(check() >= 3, 'and are still there, their homes with them')
  // (the piece's own spawn list is never moved)
  for (const s of at.spawns) if (s.home) assert.ok(s.home.x < PIECE && s.home.y < PIECE)
})

test('shiftDeep moves an entity\'s home with it', () => {
  const e = { type: 'para', x: 100, y: 90, px: 3216, py: 2896, home: { x: 97, y: 92 } }
  shiftDeep([e], -80, 0)
  assert.equal(e.x, 20); assert.equal(e.home.x, 17); assert.equal(e.home.y, 92)
})

test('pieces of three seeds are generated without a throw, on every country and with every deal', () => {
  let n = 0
  for (const seed of [7, 11, 23]) for (let i = 0; i < 67; i++) {
    // (spread over the land out to twelve pieces, by a fixed stride)
    const wx = ((i * 7 + seed) % 25) - 12, wy = ((i * 11 + seed * 3) % 25) - 12
    const p = generatePiece(seed, wx, wy, i % 3)
    n++
    for (const s of p.spawns) {
      assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y) && (s.sealed || p.cells[s.y][s.x].tile === TILE.FLOOR), `seed ${seed} ${p.key}: ${s.kind} on a shut cell`)
      if (TRIBE_KINDS.has(s.kind)) assert.ok(s.home && tierAt(wx, wy) === p.tier, `seed ${seed} ${p.key}: ${s.kind} without a home`)
    }
  }
  assert.ok(n >= 200)
})
