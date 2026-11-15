import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TALES, TALE_IDS } from '../renderer/data/tales.js'
import { REACH, MIN_LAND, reachOf, fitsOf, taleOf, sideOf, sideOfPiece, SIDE_NAMES, wherePhrase } from '../renderer/wilds/tales.js'
import { villagesNear, villageAt, pieceBiome } from '../renderer/wilds/layout.js'

const SEEDS = [3, 77, 2024]
const villages = seed => [{ wx: 0, wy: 0 }, ...villagesNear(seed, 0, 0, 12).filter(v => v.wx || v.wy)]

test('the three tales are declared with their kind and home land', () => {
  assert.deepEqual(TALE_IDS, ['elk', 'tar', 'kivihiisi'])
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
      if (id === null) { for (const k of TALE_IDS) assert.ok(fitsOf(seed, v)[k].length < MIN_LAND); continue }
      seen.add(id)
      const fits = fitsOf(seed, v)[id]
      if (v.wx || v.wy) assert.ok(fits.length >= MIN_LAND, `${id} with ${fits.length} pieces`)
      for (const p of fits) assert.ok(TALES[id].land.includes(pieceBiome(seed, p.wx, p.wy)))
    }
  }
  assert.deepEqual([...seen].sort(), ['elk', 'kivihiisi', 'tar'])
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
