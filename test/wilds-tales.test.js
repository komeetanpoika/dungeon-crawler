import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TALES, TALE_IDS } from '../renderer/data/tales.js'
import { REACH, MIN_LAND, reachOf, fitsOf, taleOf, sideOf, sideOfPiece, SIDE_NAMES, wherePhrase } from '../renderer/wilds/tales.js'
import { villagesNear, villageAt, pieceBiome } from '../renderer/wilds/layout.js'

const SEEDS = [3, 77, 2024]
const villages = seed => [{ wx: 0, wy: 0 }, ...villagesNear(seed, 0, 0, 12).filter(v => v.wx || v.wy)]

test('the three tales are declared with their kind and home land', () => {
  assert.deepEqual(TALE_IDS, ['elk', 'tar', 'kivihiisi', 'nakki', 'fold', 'flame', 'lalli'])
  assert.deepEqual([TALES.elk.kind, TALES.tar.kind, TALES.kivihiisi.kind], ['story', 'need', 'old'])
  assert.deepEqual(TALES.elk.land, ['forest', 'autumn'])
  assert.equal(TALES.kivihiisi.rule({ hiisi_dead: true }), true)
  assert.equal(TALES.elk.rule({}), false)
})

test('reach is the 7x7 round a village without villages and the home trio', () => {
  for (const seed of SEEDS) for (const v of villages(seed).slice(0, 12)) {
    const reach = reachOf(seed, v)
    assert.ok(reach.length <= 48)
    for (const p of reach) {
      assert.ok(Math.max(Math.abs(p.wx - v.wx), Math.abs(p.wy - v.wy)) <= REACH)
      assert.ok(!villageAt(seed, p.wx, p.wy) && !(p.wx === 0 && p.wy === 0))
      assert.ok(!['1,0', '0,-1'].includes(`${p.wx},${p.wy}`))
    }
  }
})

test('a village has one tale whose home land lies in its reach; Koivula has the elk', () => {
  const seen = new Set()
  for (const seed of SEEDS) {
    assert.equal(taleOf(seed, { wx: 0, wy: 0 }), 'elk')
    assert.ok(fitsOf(seed, { wx: 0, wy: 0 }).elk.length >= 1, 'forest round home')
    for (const v of villages(seed)) {
      const id = taleOf(seed, v)
      assert.equal(id, taleOf(seed, v), 'the same every time')
      if (id === null) continue   // nothing fits, or the neighbour rule left nothing
      seen.add(id)
      const fits = fitsOf(seed, v)[id]
      if (v.wx || v.wy) assert.ok(fits.length >= MIN_LAND, `${id} with ${fits.length} pieces`)
      for (const p of fits) assert.ok(TALES[id].land.includes(pieceBiome(seed, p.wx, p.wy)))
    }
  }
  for (const k of TALE_IDS) assert.ok(seen.has(k), `no village tells ${k}`)
})

test('a well-known story has a side with its land on it; other kinds have none', () => {
  assert.equal(sideOfPiece({ wx: 0, wy: 0 }, 0, -2), 0)
  assert.equal(sideOfPiece({ wx: 0, wy: 0 }, 2, -2), 1)
  assert.equal(sideOfPiece({ wx: 0, wy: 0 }, -3, 0), 6)
  for (const seed of SEEDS) for (const v of villages(seed)) {
    const id = taleOf(seed, v)
    if (!id) continue
    const side = sideOf(seed, v, id)
    if (TALES[id].kind !== 'story') { assert.equal(side, null); continue }
    assert.ok(side >= 0 && side < 8)
    assert.ok(fitsOf(seed, v)[id].some(p => sideOfPiece(v, p.wx, p.wy) === side), 'no land on the named side')
  }
  assert.equal(SIDE_NAMES[5], 'south-west')
  assert.equal(wherePhrase({ wx: 4, wy: 4 }, { wx: 6, wy: 4 }), 'a good walk east')
  assert.equal(wherePhrase({ wx: 4, wy: 4 }, { wx: 3, wy: 3 }), 'a short walk north-west')
})

import { makeWorld, getPiece, recordFor, sweep, exportWorld, GEN, FORGET_SECONDS } from '../renderer/wilds/world.js'
import { admit, taleRecord, eligible, SPACING, fillLines, kindOf } from '../renderer/wilds/tales.js'
import { pieceKey } from '../renderer/wilds/layout.js'

// a sporadic walk: a spiral of window centres out to 2 pieces, which shows all of a reach of 3
const SPIRAL = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [2, -1], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-2, -1], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2]]
const cheb = (a, b) => Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy))
const parse = k => { const [wx, wy] = k.split(',').map(Number); return { wx, wy } }
// Bring the 3x3 round (cx, cy) into the window the way session.js does.
function look(world, cx, cy) {
  const nine = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nine.push({ wx: cx + dx, wy: cy + dy })
  const hits = admit(world, nine)
  for (const p of nine) recordFor(world, pieceKey(p.wx, p.wy))
  return hits
}

test('wandering fitting land finds the place: by the fifth eligible piece, never in seen land, never twice', () => {
  for (const seed of [3, 77, 2024, 5, 11]) {
    const world = makeWorld(null, { seed })
    const v = { wx: 0, wy: 0 }
    let found = null
    for (const [cx, cy] of SPIRAL) {
      const before = new Set(world.records.keys())
      const hits = look(world, cx, cy)
      for (const k of hits) {
        if (world.places.get(k).village !== '0,0') continue
        assert.equal(found, null, 'the elk appeared twice')
        assert.ok(!before.has(k), 'it appeared in land already seen')
        found = k
      }
    }
    const rec = taleRecord(world, v)
    assert.ok(found, `seed ${seed}: no elk after walking the whole reach`)
    assert.equal(rec.place, found)
    assert.ok(rec.n <= 5 && rec.nSide <= 2, `rolled ${rec.n} + ${rec.nSide} pieces`)
    assert.equal(getPiece(world, ...Object.values(parse(found))).tale, 'elk')
  }
})

test('searching the named side first finds a well-known story there by the second piece', () => {
  let n = 0
  for (const seed of [3, 77, 2024, 5, 11, 19, 23, 42, 1, 2, 4, 6, 7, 8]) {
    const world = makeWorld(null, { seed })
    const v = { wx: 0, wy: 0 }
    const side = sideOf(seed, v, 'elk')
    // (farmland is never a place, so it is not a piece the player can find there)
    const onSide = fitsOf(seed, v).elk.filter(p => sideOfPiece(v, p.wx, p.wy) === side && pieceClass(seed, p.wx, p.wy) !== 'farmland')
    if (onSide.length < 2) continue
    // admit the on-side pieces alone, as if the player walked straight that way
    for (const p of onSide.slice(0, 2)) { admit(world, [p]); recordFor(world, pieceKey(p.wx, p.wy)) }
    // (a nearer village chooses first and may take a piece for its own tale: not this test's seed)
    if ([...world.places.values()].some(pl => pl.village !== '0,0')) continue
    n++
    const rec = taleRecord(world, v)
    assert.ok(rec.place, `seed ${seed}: not found on its side`)
    assert.equal(sideOfPiece(v, ...Object.values(parse(rec.place))), side)
  }
  assert.ok(n >= 4)
})

test('an immediate need takes the nearest eligible piece when its village comes near, and keeps it', () => {
  let n = 0
  for (const seed of SEEDS) for (const v of villages(seed)) {
    if (taleOf(seed, v) !== 'tar') continue
    n++
    const world = makeWorld(null, { seed })
    const far = p => Math.hypot(p.wx - v.wx, p.wy - v.wy)
    const nearest = Math.min(...fitsOf(seed, v).tar.filter(p => eligible(world, v, 'tar', p.wx, p.wy)).map(far))
    look(world, v.wx, v.wy)
    const rec = taleRecord(world, v)
    assert.ok(rec.place, 'chosen as soon as the village is in the window')
    // its own village is the nearest to the land entering, so it chooses first
    assert.ok(Math.abs(far(parse(rec.place)) - nearest) < 1e-9, 'not the nearest fitting piece')
    const kept = rec.place
    for (const [dx, dy] of [[2, 0], [0, 2], [-2, 0], [0, -2]]) look(world, v.wx + dx, v.wy + dy)
    assert.equal(taleRecord(world, v).place, kept)
    if (n >= 6) return
  }
  assert.ok(n >= 2)
})

// Review Focus 4
test('crowded country: no piece is two places and places keep their distance', () => {
  for (const seed of SEEDS) {
    const world = makeWorld(null, { seed })
    for (let cy = -9; cy <= 9; cy += 2) for (let cx = -9; cx <= 9; cx += 2) look(world, cx, cy)
    const keys = [...world.places.keys()]
    assert.ok(keys.length >= 6, `${keys.length} places in 361 pieces`)
    // two of one kind are never in a window together; different kinds may be neighbours
    for (const [i, a] of keys.entries()) for (const b of keys.slice(i + 1))
      if (world.places.get(a).id === world.places.get(b).id) assert.ok(cheb(parse(a), parse(b)) >= SPACING, `two ${world.places.get(a).id} places ${a} and ${b} too close`)
    for (const [vk, rec] of world.tales) if (rec.place) assert.equal(world.places.get(rec.place).village, vk)
  }
})

test('villagers tell the tale at the exactness of its kind, and stop once it is done', () => {
  const world = makeWorld(null, { seed: 3 })
  const home = fillLines(world, '0,0')
  const side = SIDE_NAMES[sideOf(3, { wx: 0, wy: 0 }, 'elk')]
  assert.ok([...home.villager, ...home.elder].some(l => l.includes(side)), 'the elk story names its side')
  assert.ok(![...home.villager, ...home.elder].some(l => /\{\w+\}/.test(l)), 'a placeholder was left in')
  const rec = taleRecord(world, { wx: 0, wy: 0 })
  rec.place = '-2,1'; world.places.set('-2,1', { id: 'elk', village: '0,0', done: false })
  const after = fillLines(world, '0,0')
  assert.ok([...after.villager, ...after.elder].some(l => l.includes('south-west') || l.includes('west')), 'the side follows the real place')
  rec.flags.hide_given = true
  const done = fillLines(world, '0,0')
  assert.ok(![...done.villager, ...done.elder].some(l => l.includes('south-west')), 'a finished tale is no longer told')
  assert.notDeepEqual(done, after)
})

// ---- found by the whole-branch review ----------------------------------------------
test('the first place a new world shows is Koivula\'s own, and walking its reach finds it in every world', () => {
  let own = 0, other = 0, none = 0
  for (let seed = 1; seed <= 150; seed++) {
    const world = makeWorld(null, { seed })
    const first = look(world, 0, 0)
    if (first.some(k => world.places.get(k).village === '0,0')) own++
    // another village's elk beside home would look like Koivula's and not be
    else if (first.some(k => world.places.get(k).id === 'elk')) other++
    for (const [cx, cy] of SPIRAL.slice(1)) look(world, cx, cy)
    if (!taleRecord(world, { wx: 0, wy: 0 }).place) none++
  }
  assert.ok(own >= 140, `only ${own}/150 first windows hold Koivula's wood`)
  assert.ok(other <= 2, `${other}/150 first windows hold another village's elk and not Koivula's`)
  assert.equal(none, 0, `${none}/150 worlds have no elk after home's whole reach was walked`)
})

test('a village whose country has all been walked has its place', () => {
  let seen = 0, starved = 0
  for (const seed of [3, 77, 2024, 5]) {
    const world = makeWorld(null, { seed })
    for (let cy = -10; cy <= 10; cy++) for (let cx = -10; cx <= 10; cx++) look(world, cx, cy)
    for (const v of villages(seed)) {
      if (Math.max(Math.abs(v.wx), Math.abs(v.wy)) > 5 || !taleOf(seed, v)) continue
      seen++
      if (!taleRecord(world, v).place) starved++
    }
  }
  assert.ok(seen >= 20, `${seen} villages`)
  assert.equal(starved, 0, `${starved}/${seen} villages never got a place`)
})

// ---- step 2: six kinds ----------------------------------------------------------------
test('the six tales are declared: three ride the quest modules, three the episodes', () => {
  assert.deepEqual(['elk', 'tar', 'kivihiisi'].map(k => TALES[k].engine), ['quest', 'quest', 'quest'])
  assert.deepEqual(['nakki', 'fold', 'flame'].map(k => TALES[k].engine), ['episode', 'episode', 'episode'])
  assert.deepEqual(['nakki', 'fold', 'flame'].map(k => TALES[k].kind), ['need', 'need', 'old'])
  assert.deepEqual(['nakki', 'fold', 'flame'].map(k => TALES[k].module), ['lake-1-ferry', 'highland-2-fold', 'marsh-3-hermit'])
  assert.deepEqual(TALE_IDS.map(k => TALES[k].arriveOn), ['both', 'place', 'place', 'place', 'place', 'village', 'both'])
  assert.deepEqual(TALE_IDS.map(k => TALES[k].creatureAt ?? 'place'), ['place', 'place', 'place', 'place', 'place', 'village', 'place'])
  assert.deepEqual(TALE_IDS.filter(k => TALES[k].villageBorne), ['fold', 'flame'])
  assert.deepEqual(['nakki', 'fold', 'flame'].map(k => TALES[k].missing.name), ['Toivo', 'Aino', 'Lauri'])
  assert.equal(TALES.fold.rule({ maahinen_dead: true }, { wolvesAlive: 0 }), false)
  assert.equal(TALES.fold.rule({ maahinen_dead: true }, { wolvesAlive: 1 }), true)
  assert.equal(TALES.flame.rule({ wraith_dead: true }), true)
})

test('neighbouring villages never both carry the fold or the flame-thief', () => {
  const seen = new Set()
  let pairs = 0
  for (let seed = 1; seed <= 40; seed++) {
    const vs = villages(seed)
    for (const v of vs) seen.add(taleOf(seed, v))
    for (const [i, a] of vs.entries()) for (const b of vs.slice(i + 1)) {
      if (Math.max(Math.abs(a.wx - b.wx), Math.abs(a.wy - b.wy)) > 2) continue
      pairs++
      const ka = taleOf(seed, a), kb = taleOf(seed, b)
      if (ka && TALES[ka].villageBorne) assert.notEqual(ka, kb, `seed ${seed}: ${a.wx},${a.wy} and ${b.wx},${b.wy} both tell ${ka}`)
    }
  }
  assert.ok(pairs >= 200, `${pairs} neighbouring pairs`)
  for (const k of TALE_IDS) assert.ok(seen.has(k), `no village tells ${k}`)
})

test('a recorded kind outranks the table', () => {
  const seed = 3
  const v = villages(seed).find(v => (v.wx || v.wy) && taleOf(seed, v) && taleOf(seed, v) !== 'tar' && fitsOf(seed, v).tar.length >= 1)
  assert.ok(v, 'no village to test with')
  const key = `${v.wx},${v.wy}`
  const world = makeWorld(null, { seed })
  world.tales.set(key, { id: 'tar', flags: {}, place: null, n: 0, nSide: 0, done: false })
  assert.equal(kindOf(world, v), 'tar')
  assert.equal(kindOf(makeWorld(null, { seed }), v), taleOf(seed, v))
  look(world, v.wx, v.wy)
  const place = world.tales.get(key).place
  assert.ok(place, 'no place taken')
  assert.equal(world.places.get(place).id, 'tar')
  assert.ok(JSON.stringify(fillLines(world, key)).includes('tar'), 'not the tar pit\'s lines')
  assert.equal(getPiece(world, v.wx, v.wy).villageTale, 'tar')
  assert.equal(getPiece(makeWorld(null, { seed }), v.wx, v.wy).villageTale, taleOf(seed, v))
})

test('the Lalli tale: an immediate need with its own module, people who speak at every stage, and a house', () => {
  const t = TALES.lalli
  assert.equal(t.kind, 'need')
  assert.equal(t.engine, 'wilds')
  assert.deepEqual(t.land, ['forest', 'autumn', 'marsh'])
  assert.deepEqual(t.missing, { species: 'lalli', name: 'Lalli' })
  assert.equal(t.creature, null)
  assert.ok(!t.reward, 'the reward is a thing laid at the tree, not a talent')
  assert.deepEqual(t.houses["Lalli's house"].pickups, [{ type: 'beer' }])
  assert.equal(t.rule({}), false)
  assert.equal(t.rule({ mice: 7, flute_given: true }), false)
  assert.equal(t.rule({ lalli_down: true }), true)
  // whoever can be met at a stage has something to say at it
  const speakers = { villager: 1, elder: 1, kerttu: 1, piper: 1 }
  for (const flags of [{}, { sausage_made: true }, { flute_given: true }, { lalli_down: true }]) {
    const stage = t.lines.find(s => s.when(flags))
    for (const who of [...Object.keys(speakers), flags.lalli_down ? 'lalli' : 'lalli_treed']) assert.ok(stage.by[who]?.length, `${who} is mute at ${JSON.stringify(flags)}`)
  }
  // an immediate need: its village says exactly where
  assert.ok(t.lines.at(-1).by.kerttu.some(l => l.includes('{where}')))
  assert.ok(t.lines.at(-1).by.kerttu.some(l => /two/.test(l) && /meat/.test(l)), 'Kerttu never says what she needs')
  assert.ok(t.lines.at(-1).by.piper.some(l => /beer/.test(l) && /sausage/.test(l)), 'the piper never names his price')
})

// ---- farmland (roads.js pieceClass) ------------------------------------------------------
import { pieceClass } from '../renderer/wilds/roads.js'

test('a new tale place is never admitted onto farmland', () => {
  let places = 0, farms = 0
  for (const seed of SEEDS) {
    const world = makeWorld(null, { seed })
    for (const v of villages(seed).slice(0, 40)) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (pieceClass(seed, v.wx + dx, v.wy + dy) === 'farmland') farms++
      look(world, v.wx, v.wy)
    }
    for (const [key, place] of world.places) {
      const { wx, wy } = parse(key)
      assert.notEqual(pieceClass(seed, wx, wy), 'farmland', `seed ${seed}: the ${place.id} place of ${place.village} is on farmland at ${key}`)
      places++
    }
  }
  // the land round a village is much of it farmland, and the places still come
  assert.ok(farms >= 100, `${farms} farmland pieces round the villages`)
  assert.ok(places >= 40, `${places} places`)
})

test('a place recorded on farmland by an older save stays and takes the main thing', () => {
  const seed = 3
  let farm = null
  for (let r = 1; r <= 12 && !farm; r++) for (let wy = -r; wy <= r && !farm; wy++) for (let wx = -r; wx <= r && !farm; wx++)
    if (Math.max(Math.abs(wx), Math.abs(wy)) === r && pieceClass(seed, wx, wy) === 'farmland') farm = { wx, wy }
  assert.ok(farm, 'no farmland near home')
  const key = pieceKey(farm.wx, farm.wy)
  const v = villagesNear(seed, farm.wx, farm.wy, 3)[0]
  const vKey = pieceKey(v.wx, v.wy)
  const saved = JSON.parse(JSON.stringify(exportWorld(makeWorld(null, { seed }))))
  saved.places = { [key]: { id: 'tar', village: vKey, done: false } }
  saved.tales = { [vKey]: { id: 'tar', flags: {}, place: key, n: 0, nSide: 0, done: false } }
  for (const s of [saved, { ...saved, gen: GEN - 1 }]) {
    const world = makeWorld(s)
    assert.equal(world.places.get(key)?.id, 'tar', 'the recorded place was dropped')
    look(world, farm.wx, farm.wy)
    assert.equal(world.places.get(key)?.id, 'tar', 'the recorded place moved')
    assert.equal(world.tales.get(vKey).place, key)
    assert.equal(getPiece(world, farm.wx, farm.wy).main.kind, 'tale_tar')
  }
})

test('no story promises a side whose fitting land is all farmland', () => {
  let stories = 0
  for (let seed = 1; seed <= 40; seed++) for (const v of villagesNear(seed, 0, 0, 24)) {
    for (const id of TALE_IDS) {
      if (TALES[id].kind !== 'story') continue
      const side = sideOf(seed, v, id)
      if (side === null) continue
      stories++
      const open = fitsOf(seed, v)[id].filter(p => sideOfPiece(v, p.wx, p.wy) === side && pieceClass(seed, p.wx, p.wy) !== 'farmland')
      assert.ok(open.length > 0, `seed ${seed}, village ${v.wx},${v.wy}, ${id}: side ${side} holds only farmland`)
    }
  }
  assert.ok(stories > 100, `only ${stories} promised sides scanned`)
})
