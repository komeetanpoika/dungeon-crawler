import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN, insideWalls, wallCells, streetCells } from '../renderer/wilds/city/plan.js'
import { cutBlocks, reserved } from '../renderer/wilds/city/blocks.js'

const N = 160
const key = (x, y) => y * N + x
const SEEDS = [1, 7, 4242]
const rectCells = r => { const out = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push([x, y]); return out }
const placeRects = () => Object.values(PLAN.places).filter(p => p.x0 !== undefined)
const basin = { ...PLAN.harbour.basin, y1: PLAN.harbour.mouth.y }
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
const alleyCells = b => {
  const set = new Set()
  for (const a of b.alleys) {
    const [[ax, ay], [bx, by]] = a.pts
    const horiz = ay === by
    for (let y = Math.min(ay, by); y <= Math.max(ay, by) + (horiz ? a.w - 1 : 0); y++)
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx) + (horiz ? 0 : a.w - 1); x++) set.add(key(x, y))
  }
  return set
}
const forbidden = (x, y) => {
  if (!insideWalls(x, y) || wallCells().has(key(x, y)) || streetCells().has(key(x, y)) || inRect(basin, x, y)) return 'land'
  if (placeRects().some(r => inRect(r, x, y))) return 'place'
  for (const r of reserved()) if (inRect(r.clear || r, x, y)) return 'reserved ' + r.id
  return null
}

test('the same seed cuts the same blocks; another seed cuts others', () => {
  assert.deepEqual(cutBlocks(7), cutBlocks(7))
  assert.notDeepEqual(cutBlocks(7).lots, cutBlocks(8).lots)
})

test('no lot, yard, garden or alley overlaps a street, the wall, a fixed place, the water, or another', () => {
  for (const seed of SEEDS) {
    const b = cutBlocks(seed)
    const owner = new Map()
    const claim = (r, what) => {
      for (const [x, y] of rectCells(r)) {
        assert.equal(forbidden(x, y), null, `${what} at ${x},${y} seed ${seed}: ${forbidden(x, y)}`)
        assert.ok(!owner.has(key(x, y)), `${what} overlaps ${owner.get(key(x, y))} at ${x},${y}`)
        owner.set(key(x, y), what)
      }
    }
    for (const l of b.lots) claim(l, l.id)
    b.yards.forEach((r, i) => claim(r, 'yard' + i))
    b.gardens.forEach((r, i) => claim(r, 'garden' + i))
    for (const k of alleyCells(b)) {
      const x = k % N, y = Math.floor(k / N)
      assert.equal(forbidden(x, y), null, `alley at ${x},${y}`)
      assert.ok(!owner.has(k), `alley overlaps ${owner.get(k)} at ${x},${y}`)
    }
  }
})

test('point places keep a footprint: windmill, fountain, crier and stocks', () => {
  const ids = reserved().map(r => r.id).sort()
  assert.deepEqual(ids, ['crier', 'fountain', 'stocks', 'windmill'])
  const w = reserved().find(r => r.id === 'windmill')
  assert.deepEqual([w.x0, w.y0, w.x1, w.y1], [127, 99, 129, 101])
  assert.deepEqual([w.clear.x0, w.clear.x1], [126, 130])
})

test('every door opens onto street or alley, and every alley joins streets at both ends', () => {
  const sc = streetCells()
  const front = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }
  for (const seed of SEEDS) {
    const b = cutBlocks(seed); const ac = alleyCells(b)
    for (const l of b.lots) {
      const [dx, dy] = front[l.front]
      assert.ok(inRect(l, l.door.x, l.door.y), 'door in lot ' + l.id)
      const onFace = l.front === 'S' ? l.door.y === l.y1 : l.front === 'N' ? l.door.y === l.y0 : l.front === 'E' ? l.door.x === l.x1 : l.door.x === l.x0
      assert.ok(onFace, 'door on the front face ' + l.id)
      const k = key(l.door.x + dx, l.door.y + dy)
      assert.ok(sc.has(k) || ac.has(k), `door of ${l.id} faces nothing (seed ${seed})`)
    }
    for (const a of b.alleys) {
      const [[ax, ay], [bx, by]] = a.pts; const horiz = ay === by
      const [ex, ey] = horiz ? [[ax - 1, ay], [bx + 1, by]] : [[ax, ay - 1], [bx, by + 1]]
      for (const [x, y] of [ex, ey]) for (let i = 0; i < a.w; i++) {
        const k = horiz ? key(x, y + i) : key(x + i, y)
        assert.ok(sc.has(k) || ac.has(k), `alley end at ${x},${y} dead-ends (seed ${seed})`)
      }
      assert.ok(a.w === 1 || a.w === 2)
    }
  }
})

test('lots are 3-5 wide at the front and 4-7 deep, terraced against their street', () => {
  for (const seed of SEEDS) for (const l of cutBlocks(seed).lots) {
    const w = l.x1 - l.x0 + 1, h = l.y1 - l.y0 + 1
    const [fw, dp] = l.front === 'S' || l.front === 'N' ? [w, h] : [h, w]
    assert.ok(fw >= 3 && fw <= 5, `${l.id} frontage ${fw}`)
    assert.ok(dp >= 4 && dp <= 7, `${l.id} depth ${dp}`)
    assert.ok([1, 2, 3].includes(l.storeys) && ['wood', 'plaster', 'stone'].includes(l.wall) && ['red', 'blue', 'slate'].includes(l.roof))
  }
})

test('districts flavour the lots', () => {
  for (const seed of SEEDS) {
    const by = {}
    for (const l of cutBlocks(seed).lots) (by[l.district] ||= []).push(l)
    const share = (d, kind) => by[d].filter(l => l.kind === kind).length / by[d].length
    for (const d of ['market', 'crafts', 'harbour', 'gardens']) assert.ok(by[d] && by[d].length >= 6, `${d} has ${by[d]?.length} lots (seed ${seed})`)
    assert.ok(share('market', 'shop') >= 0.6, 'market shops')
    assert.ok(share('crafts', 'workshop') >= 0.4, 'crafts workshops')
    assert.ok(share('harbour', 'cottage') >= 0.5, 'harbour cottages')
    for (const l of by.market) if (l.kind === 'shop') assert.ok(l.sign, 'shop sign')
    for (const l of cutBlocks(seed).lots) if (l.kind !== 'shop' && l.kind !== 'workshop') assert.equal(l.sign, null)
  }
})

test('there are enough homes for the townsfolk', () => {
  for (const seed of [1, 7, 4242]) assert.ok(cutBlocks(seed).lots.length >= 70)
})
