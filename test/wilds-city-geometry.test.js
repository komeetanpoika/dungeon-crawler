import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCityPiece, toCity, fromCity, CITY_KEYS, BAY, inBay, CITY } from '../renderer/wilds/city/geometry.js'
import { isPermanent, villageAt, MARGIN } from '../renderer/wilds/layout.js'
import { makeTerrain } from '../renderer/wilds/terrain.js'
import { makeWorld, exportWorld, GEN } from '../renderer/wilds/world.js'
import { admit } from '../renderer/wilds/tales.js'

test('the city is four fixed pieces south of Koivula', () => {
  assert.deepEqual(['0,2', '1,2', '0,3', '1,3'].every(k => isCityPiece(...k.split(',').map(Number))), true)
  assert.equal(isCityPiece(0, 1), false); assert.equal(isCityPiece(2, 2), false); assert.equal(isCityPiece(0, 4), false)
  assert.deepEqual(fromCity(0, 0), { X: 0, Y: 160 }); assert.deepEqual(toCity(159, 319), { cx: 159, cy: 159 })
  assert.equal(CITY.name, 'Kalevanlinna')
})

test('city pieces are permanent and never a village or a tale place', () => {
  for (const seed of [1, 7, 4242]) for (const k of CITY_KEYS) {
    const [wx, wy] = k.split(',').map(Number)
    assert.equal(isPermanent(seed, wx, wy), true); assert.equal(villageAt(seed, wx, wy), null)
  }
  for (const seed of [1, 7, 4242, 99]) {
    const world = makeWorld(null, { seed })
    admit(world, CITY_KEYS.map(k => { const [wx, wy] = k.split(','); return { wx: +wx, wy: +wy } }))
    assert.equal([...world.places.keys()].some(k => CITY_KEYS.includes(k)), false)
  }
})

test('the bay south of the harbour is open water in every world', () => {
  assert.equal(inBay(BAY.X, BAY.Y), true); assert.equal(inBay(BAY.X + BAY.rx + 1, BAY.Y), false)
  for (const seed of [1, 7, 4242, 99]) {
    const t = makeTerrain(seed, 0, 4, 0); t.finish()
    for (const [X, Y] of [[78, 322], [70, 324], [79, 321]]) {
      assert.equal(t.kind(X, Y - 320), 'water', `seed ${seed} ${X},${Y}`)
      assert.equal(t.b.walkable(X + MARGIN, Y - 320 + MARGIN), false, `seed ${seed} ${X},${Y}`)
    }
  }
})

test('a saved tale place on a city piece is released, its flags kept', () => {
  const saved = { seed: 3, gen: 8, tales: { '0,0': { id: 'elk', flags: { seen: true }, place: '1,2', n: 1, nSide: 0, done: false } }, places: { '1,2': { id: 'elk', village: '0,0', done: false } } }
  const w = makeWorld(saved)
  assert.equal(w.places.has('1,2'), false); assert.equal(w.tales.get('0,0').place, null); assert.deepEqual(w.tales.get('0,0').flags, { seen: true })
})

test('the day counter is saved and survives a GEN bump', () => {
  const w = makeWorld({ seed: 1, gen: 8, day: 5 }); assert.equal(w.day, 5); assert.equal(exportWorld(w).day, 5); assert.equal(GEN, 9)
  assert.equal(makeWorld(null).day, 0)
})
