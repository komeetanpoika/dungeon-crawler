import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_GROW, GATHER, linksOfBlock, roadSides, roadsFrom, townsAlong, pieceClass, townOf, CITY_DOORS, EXTRA_SOUTH } from '../renderer/wilds/roads.js'
import { villageAt, blockVillage } from '../renderer/wilds/layout.js'
import { isCityPiece } from '../renderer/wilds/city/geometry.js'

const SEEDS = [1, 7, 42, 1234, 987654]
const blockOf = t => [Math.floor(t.wx / 4), Math.floor(t.wy / 4)]
const inBlock = (t, bx, by) => { const [x, y] = blockOf(t); return x === bx && y === by }
const stepOk = (p, q) => Math.abs(p.wx - q.wx) + Math.abs(p.wy - q.wy) === 1

test('every block links east, and one block in three of every row links south, also west and north of home', () => {
  assert.equal(EXTRA_SOUTH, 0.1)
  for (const seed of SEEDS) for (let by = -6; by < 6; by++) {
    let south = 0
    for (let bx = -6; bx < 6; bx++) {
      const links = linksOfBlock(seed, bx, by)
      assert.ok(links.some(l => (inBlock(l.a, bx, by) && inBlock(l.b, bx + 1, by)) || (inBlock(l.b, bx, by) && inBlock(l.a, bx + 1, by))),
        `east link of ${bx},${by}`)
      if (links.some(l => inBlock(l.a, bx, by) && inBlock(l.b, bx, by + 1))) south++
    }
    assert.ok(south >= 4, `row ${by} has ${south} south links in 12 blocks`)
  }
})

test('a route is edge-adjacent, never crosses a city piece or a third village', () => {
  for (const seed of SEEDS) for (let by = -4; by < 4; by++) for (let bx = -4; bx < 4; bx++) {
    for (const l of linksOfBlock(seed, bx, by)) {
      const r = l.route
      assert.ok(r.length >= 2)
      for (let i = 1; i < r.length; i++) assert.ok(stepOk(r[i - 1], r[i]), 'adjacent steps')
      assert.ok(l.a.key === 'city' ? CITY_DOORS.some(d => d.wx === r[0].wx && d.wy === r[0].wy) : r[0].wx === l.a.wx && r[0].wy === l.a.wy, 'starts at a')
      const last = r[r.length - 1]
      if (l.b.key === 'city') assert.ok(CITY_DOORS.some(d => d.wx === last.wx && d.wy === last.wy))
      else assert.ok(last.wx === l.b.wx && last.wy === l.b.wy, 'ends at b')
      r.forEach((p, i) => {
        const end = i === 0 || i === r.length - 1
        if (isCityPiece(p.wx, p.wy)) assert.ok(end && (l.a.key === 'city' && i === 0 || l.b.key === 'city' && i === r.length - 1), 'city piece only at a city end')
        if (villageAt(seed, p.wx, p.wy)) assert.ok(end, 'village piece only at an end')
      })
    }
  }
})

test('both pieces on an edge agree on the road', () => {
  for (const seed of SEEDS) for (let wy = -24; wy <= 24; wy++) for (let wx = -24; wx <= 24; wx++) {
    const s = roadSides(seed, wx, wy)
    assert.equal(s.E, roadSides(seed, wx + 1, wy).W, `E of ${wx},${wy}`)
    assert.equal(s.S, roadSides(seed, wx, wy + 1).N, `S of ${wx},${wy}`)
  }
})

test('every village is reached from every other along road edges inside a 12x12-block sample grown by one piece', () => {
  for (const seed of SEEDS) {
    const lo = -24 - 1, hi = 24
    const villages = []
    for (let by = -6; by < 6; by++) for (let bx = -6; bx < 6; bx++) villages.push(blockVillage(seed, bx, by))
    const seen = new Set(), key = (x, y) => `${x},${y}`
    const stack = [villages[0]]
    seen.add(key(villages[0].wx, villages[0].wy))
    const D = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
    while (stack.length) {
      const p = stack.pop()
      const s = roadSides(seed, p.wx, p.wy)
      for (const side of 'NESW') {
        if (!s[side]) continue
        const x = p.wx + D[side][0], y = p.wy + D[side][1]
        if (x < lo || x > hi || y < lo || y > hi || seen.has(key(x, y))) continue
        seen.add(key(x, y)); stack.push({ wx: x, wy: y })
      }
    }
    for (const v of villages) assert.ok(seen.has(key(v.wx, v.wy)), `seed ${seed}: village ${v.wx},${v.wy} is cut off`)
  }
})

test('roadsFrom gives every village a road east and a road west, and each road back', () => {
  for (const seed of SEEDS) for (let by = -5; by < 5; by++) for (let bx = -5; bx < 5; bx++) {
    const v = blockVillage(seed, bx, by)
    const key = `${v.wx},${v.wy}`
    const roads = roadsFrom(seed, key)
    if (key !== '0,0') {
      assert.ok(roads.some(r => inBlock(r.town, bx + 1, by)), `${key} has no road east`)
      assert.ok(roads.some(r => inBlock(r.town, bx - 1, by)), `${key} has no road west`)
    }
    for (const r of roads) {
      assert.equal(r.leagues, r.route.length - 1)
      assert.ok(r.route[0].wx === v.wx && r.route[0].wy === v.wy)
      const back = roadsFrom(seed, r.town.key).filter(b => b.town.key === key && b.leagues === r.leagues)
      assert.ok(back.length >= 1, `${r.town.key} does not list ${key} back`)
    }
  }
  for (const seed of SEEDS) {
    const k = roadsFrom(seed, '0,0'), c = roadsFrom(seed, 'city')
    assert.ok(k.some(r => r.town.key === 'city'))
    for (const dir of [1, -1]) {
      assert.ok([...k, ...c].some(r => inBlock(r.town, dir, 0)), `home block has a road to block ${dir},0`)
    }
    for (const r of c) assert.ok(['N', 'W', 'E'].includes(r.side), `city road leaves by ${r.side}`)
    for (const r of c) {
      const back = roadsFrom(seed, r.town.key).filter(b => b.town.key === 'city' && b.leagues === r.leagues)
      assert.ok(back.length >= 1)
    }
  }
})

test('Koivula and the city are one road apart', () => {
  for (const seed of SEEDS) {
    const r = roadsFrom(seed, '0,0').find(d => d.town.key === 'city')
    assert.deepEqual(r.route, [{ wx: 0, wy: 0 }, { wx: 0, wy: 1 }, { wx: 0, wy: 2 }])
    assert.equal(r.side, 'S')
  }
})

test('townsAlong names the next town and counts the pieces to it', () => {
  for (const seed of SEEDS) {
    const l = linksOfBlock(seed, 2, 2).find(x => x.route.length >= 4)
    if (!l) continue
    const r = l.route
    const D = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
    const side = (p, q) => 'NESW'.split('').find(s => p.wx + D[s][0] === q.wx && p.wy + D[s][1] === q.wy)
    for (let i = 0; i + 1 < r.length; i++) {
      const found = townsAlong(seed, r[i].wx, r[i].wy, side(r[i], r[i + 1])).find(t => t.town.key === l.b.key)
      assert.ok(found, `step ${i}`)
      assert.ok(found.leagues === r.length - 1 - i, `leagues at ${i}`)
      assert.ok(townsAlong(seed, r[i].wx, r[i].wy, side(r[i], r[i + 1])).length <= 2)
    }
    const beside = townsAlong(seed, r[r.length - 2].wx, r[r.length - 2].wy, side(r[r.length - 2], r[r.length - 1]))
    assert.equal(beside.find(t => t.town.key === l.b.key).leagues, 1)
  }
})

test('piece classes: a village wins over farmland, the first piece out of a town is farmland, the rest of a road is roadside', () => {
  for (const seed of SEEDS) {
    const l = linksOfBlock(seed, 3, 3).find(x => x.route.length >= 5)
    assert.ok(l)
    const r = l.route
    assert.equal(pieceClass(seed, r[0].wx, r[0].wy), 'village')
    assert.equal(pieceClass(seed, r[1].wx, r[1].wy), 'farmland')
    assert.equal(pieceClass(seed, r[r.length - 2].wx, r[r.length - 2].wy), 'farmland')
    assert.equal(pieceClass(seed, r[2].wx, r[2].wy), 'roadside')
    assert.equal(pieceClass(seed, 0, 0), 'village')
    assert.equal(pieceClass(seed, 1, 0), 'fixed')
    assert.equal(pieceClass(seed, 0, -1), 'fixed')
    assert.equal(pieceClass(seed, 1, 3), 'city')
    assert.equal(pieceClass(seed, 0, 1), 'farmland')
    assert.ok(townOf(seed, 'city').name === 'Kalevanlinna')
  }
})

test('two villages side by side: the link has no piece between and neither becomes farmland', t => {
  for (let seed = 1; seed < 3000; seed++) for (let by = -3; by < 3; by++) for (let bx = -3; bx < 3; bx++) {
    if (bx === 0 && by === 0) continue
    const l = linksOfBlock(seed, bx, by).find(x => x.route.length === 2 && x.a.key !== 'city' && x.b.key !== 'city')
    if (!l) continue
    for (const p of l.route) assert.equal(pieceClass(seed, p.wx, p.wy), 'village')
    return
  }
  t.skip('no adjacent village pair in the scan')
})

test('about half the world stays wild', () => {
  for (const seed of SEEDS) {
    let wild = 0
    for (let wy = -20; wy < 20; wy++) for (let wx = -20; wx < 20; wx++) if (pieceClass(seed, wx, wy) === 'wild') wild++
    const share = wild / 1600
    assert.ok(share >= 0.45 && share <= 0.7, `seed ${seed}: wild share ${share}`)
  }
})

test('no route of the home blocks passes through a village except at its two ends, over seeds 1..600 (and seed 245)', () => {
  for (let seed = 1; seed <= 600; seed++) for (const [bx, by] of [[0, 0], [-1, 0], [1, 0], [0, -1]]) {
    for (const l of linksOfBlock(seed, bx, by)) l.route.forEach((p, i) => {
      if (i > 0 && i < l.route.length - 1) assert.ok(!villageAt(seed, p.wx, p.wy), `seed ${seed} block ${bx},${by}: village ${p.wx},${p.wy} mid-route`)
    })
  }
  for (const l of linksOfBlock(245, 0, 0)) l.route.slice(1, -1).forEach(p => assert.ok(!villageAt(245, p.wx, p.wy)))
})

test('every piece of every link lies within the gathering radius of its owning block, and every block still has its east link', () => {
  assert.equal(GATHER, 1 + Math.ceil(MAX_GROW / 4))
  for (let seed = 1; seed <= 150; seed++) for (let by = -4; by < 4; by++) for (let bx = -4; bx < 4; bx++) {
    const links = linksOfBlock(seed, bx, by)
    assert.ok(links.some(l => inBlock(l.a, bx, by) || inBlock(l.b, bx, by)), `block ${bx},${by} lost its east link`)
    for (const l of links) for (const p of l.route) {
      assert.ok(Math.abs(Math.floor(p.wx / 4) - bx) <= GATHER && Math.abs(Math.floor(p.wy / 4) - by) <= GATHER, `seed ${seed} block ${bx},${by} piece ${p.wx},${p.wy}`)
    }
  }
})
