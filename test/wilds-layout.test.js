import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hash, hashInt, noise2 } from '../renderer/wilds/rand.js'
import {
  PIECE, BIOMES, biomeAt, pieceBiome, tierAt, lootDepthFor, caveDepthFor, fixedMain,
  villageAt, villagesNear, villageName, blockVillage, NAME_REACH, clearNameMemo, isPermanent, gateAt, pieceKey, pieceOf,
} from '../renderer/wilds/layout.js'

const SEEDS = [1, 7, 42, 1234, 987654]

test('hash is deterministic and spreads', () => {
  assert.equal(hash(5, 3, -9, 2), hash(5, 3, -9, 2))
  assert.equal(hashInt(5, 3, -9, 2), hashInt(5, 3, -9, 2))
  assert.notEqual(hash(5, 3, 9, 2), hash(5, 3, -9, 2))
  assert.notEqual(hash(5, 3, 9, 2), hash(6, 3, 9, 2))
  assert.notEqual(hash(5, 3, 9, 2), hash(5, 3, 9, 3))
  let sum = 0
  for (let i = 0; i < 10000; i++) {
    const v = hash(11, i % 100 - 50, Math.floor(i / 100) - 50)
    assert.ok(v >= 0 && v < 1)
    sum += v
  }
  assert.ok(sum / 10000 > 0.45 && sum / 10000 < 0.55, `mean ${sum / 10000}`)
})

test('noise2 is continuous and stays in range', () => {
  for (let i = 0; i < 200; i++) {
    const x = (hash(3, i, 0) - 0.5) * 4000, y = (hash(3, i, 1) - 0.5) * 4000
    const a = noise2(9, x, y), b = noise2(9, x + 0.01, y)
    assert.ok(a >= 0 && a <= 1)
    assert.ok(Math.abs(a - b) < 0.01, `jump ${Math.abs(a - b)} at ${x},${y}`)
  }
})

test('home is forest', () => {
  for (const seed of SEEDS) {
    assert.equal(biomeAt(seed, 40, 40), 'forest')
    assert.equal(pieceBiome(seed, 0, 0), 'forest')
  }
})

test('each compass direction is mostly its country, with pockets of others', () => {
  const dirs = [
    { name: 'north', ang: -90, own: ['mountain'] },
    { name: 'east', ang: 0, own: ['desert'] },
    { name: 'south', ang: 90, own: ['sea'] },
    { name: 'west', ang: 180, own: ['autumn', 'marsh'] },
  ]
  for (const seed of SEEDS) for (const d of dirs) {
    let own = 0
    const n = 400
    for (let i = 0; i < n; i++) {
      const a = (d.ang + (hash(seed, i, 1) - 0.5) * 60) * Math.PI / 180
      const r = (6 + hash(seed, i, 2) * 6) * PIECE
      const b = biomeAt(seed, Math.round(40 + Math.cos(a) * r), Math.round(40 + Math.sin(a) * r))
      assert.ok(BIOMES.includes(b))
      if (d.own.includes(b)) own++
    }
    assert.ok(own / n >= 0.45, `seed ${seed} ${d.name}: only ${(own / n * 100).toFixed(0)}% own`)
    assert.ok(own / n <= 0.90, `seed ${seed} ${d.name}: ${(own / n * 100).toFixed(0)}% own leaves no pockets`)
  }
})

test('country borders do not follow piece edges', () => {
  // along a piece edge column, the country to the left and right mostly agree
  let differ = 0, total = 0
  for (const seed of SEEDS) for (let wx = -10; wx <= 10; wx++) for (let Y = -800; Y < 800; Y += 7) {
    total++
    if (biomeAt(seed, wx * PIECE - 1, Y) !== biomeAt(seed, wx * PIECE, Y)) differ++
  }
  assert.ok(differ / total < 0.05, `${(differ / total * 100).toFixed(1)}% of edge crossings change country`)
})

test('tier bands', () => {
  assert.equal(tierAt(0, 0), 1)
  assert.equal(tierAt(2, 2), 1)
  assert.equal(tierAt(3, 0), 2)
  assert.equal(tierAt(5, 3), 2)
  assert.equal(tierAt(6, 0), 3)
  assert.equal(tierAt(9, 0), 4)
  assert.equal(tierAt(-7, -7), 4)
  assert.deepEqual([1, 2, 3, 4].map(lootDepthFor), [1, 3, 4, 5])
})

test('one village per 4x4 block, home at (0,0), never on the trio', () => {
  for (const seed of SEEDS) {
    assert.equal(villageAt(seed, 0, 0)?.name, 'Koivula')
    for (let by = -5; by <= 5; by++) for (let bx = -5; bx <= 5; bx++) {
      const found = []
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const v = villageAt(seed, bx * 4 + x, by * 4 + y)
        if (v) found.push({ wx: bx * 4 + x, wy: by * 4 + y, ...v })
      }
      assert.equal(found.length, 1, `block ${bx},${by} has ${found.length} villages`)
      assert.ok(typeof found[0].name === 'string' && found[0].name.length >= 4)
      if (bx === 0 && by === 0) assert.deepEqual([found[0].wx, found[0].wy], [0, 0])
      else assert.equal(fixedMain(found[0].wx, found[0].wy), null)
    }
  }
})

test('villagesNear lists the villages around a piece', () => {
  const near = villagesNear(42, 0, 0, 4)
  assert.ok(near.some(v => v.wx === 0 && v.wy === 0 && v.name === 'Koivula'))
  assert.ok(near.length >= 3)
  for (const v of near) {
    assert.ok(Math.max(Math.abs(v.wx), Math.abs(v.wy)) <= 4)
    assert.equal(villageAt(42, v.wx, v.wy).name, v.name)
  }
})

test('gates agree across an edge and stay in 20..59', () => {
  for (const seed of SEEDS) for (let wy = -6; wy <= 6; wy++) for (let wx = -6; wx <= 6; wx++) {
    const e = gateAt(seed, wx, wy, 'E'), s = gateAt(seed, wx, wy, 'S')
    assert.equal(e, gateAt(seed, wx + 1, wy, 'W'))
    assert.equal(s, gateAt(seed, wx, wy + 1, 'N'))
    for (const g of [e, s]) assert.ok(Number.isInteger(g) && g >= 20 && g <= 59, `gate ${g}`)
  }
  // not all the same
  const set = new Set()
  for (let wx = 0; wx < 30; wx++) set.add(gateAt(1, wx, 0, 'E'))
  assert.ok(set.size > 8)
})

test('home trio, cave depth and permanence', () => {
  assert.equal(fixedMain(0, 0), 'village')
  assert.equal(fixedMain(1, 0), 'ring')
  assert.equal(fixedMain(0, -1), 'cave')
  assert.equal(fixedMain(2, 2), null)
  for (const seed of SEEDS) {
    assert.equal(caveDepthFor(seed, 0, -1), 1)
    for (const [wx, wy, lo] of [[1, 1, 1], [4, 0, 2], [0, 7, 3], [-10, 3, 4]]) {
      const d = caveDepthFor(seed, wx, wy)
      assert.ok(d === lo || d === lo + 1, `cave depth ${d} at tier ${lo}`)
    }
    assert.ok(isPermanent(seed, 1, 1))
    assert.ok(isPermanent(seed, -1, 0))
    const v = villagesNear(seed, 8, 8, 3)[0]
    assert.ok(isPermanent(seed, v.wx, v.wy))
    let plain = null
    for (let wx = 5; wx < 9 && !plain; wx++) if (!villageAt(seed, wx, 3)) plain = wx
    assert.equal(isPermanent(seed, plain, 3), false)
  }
})

test('piece helpers', () => {
  assert.equal(pieceKey(-2, 3), '-2,3')
  assert.deepEqual(pieceOf(-1, 80), { wx: -1, wy: 1 })
  assert.deepEqual(pieceOf(79, -80), { wx: 0, wy: -1 })
})

const villagesOf = (seed, r) => {
  const out = []
  for (let by = -r; by <= r; by++) for (let bx = -r; bx <= r; bx++) { const v = blockVillage(seed, bx, by); if (v) out.push({ ...v, bx, by }) }
  return out
}
const nameSeeds = [...SEEDS]
for (let s = 1; s <= 60; s++) nameSeeds.push(s)

test('no two villages within two blocks of each other share a name', () => {
  assert.equal(NAME_REACH, 2)
  for (const seed of nameSeeds) {
    const vs = villagesOf(seed, 8)
    for (const a of vs) for (const b of vs) {
      if (a === b || Math.max(Math.abs(a.bx - b.bx), Math.abs(a.by - b.by)) > NAME_REACH) continue
      assert.notEqual(villageName(seed, a.wx, a.wy), villageName(seed, b.wx, b.wy), `seed ${seed}: ${a.wx},${a.wy} and ${b.wx},${b.wy}`)
    }
  }
})

test('a village name does not depend on what was asked first', () => {
  for (const seed of SEEDS) {
    const vs = villagesOf(seed, 4)
    clearNameMemo()
    const forward = vs.map(v => villageName(seed, v.wx, v.wy))
    clearNameMemo()
    const backward = vs.slice().reverse().map(v => villageName(seed, v.wx, v.wy)).reverse()
    assert.deepEqual(forward, backward)
  }
})

test('most villages keep their old name', () => {
  const STEMS = ['Koivu', 'Hauki', 'Kuusi', 'Mänty', 'Karhu', 'Suo', 'Kivi', 'Meri', 'Hiekka', 'Ruska', 'Kaisla', 'Louhi',
    'Honka', 'Lehto', 'Vaara', 'Salo', 'Kuura', 'Sammal', 'Terva', 'Ahma']
  const ENDS = ['la', 'niemi', 'koski', 'ranta', 'mäki', 'järvi', 'salo', 'kylä']
  for (const seed of SEEDS) {
    let kept = 0, total = 0
    for (const v of villagesOf(seed, 8)) {
      if (v.wx === 0 && v.wy === 0) continue
      const stem = STEMS[hashInt(seed, v.wx, v.wy, 311) % STEMS.length]
      let end = ENDS[hashInt(seed, v.wx, v.wy, 312) % ENDS.length]
      if (/[äöy]/.test(stem)) end = end.replace('la', 'lä')
      const old = stem + end === 'Koivula' ? 'Koivuniemi' : stem + end
      total++
      if (villageName(seed, v.wx, v.wy) === old) kept++
    }
    assert.ok(kept / total >= 0.8, `seed ${seed}: ${kept}/${total} kept`)
  }
})

test('only the home village is called Koivula', () => {
  for (const seed of nameSeeds) for (const v of villagesOf(seed, 8)) {
    assert.equal(villageName(seed, v.wx, v.wy) === 'Koivula', v.wx === 0 && v.wy === 0)
  }
})
