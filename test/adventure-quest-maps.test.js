import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { MAP_RITES } from '../renderer/data/rites.js'
import { WALLOWS, SHRINE } from '../renderer/systems/quests/clearings.js'
import { PIT, GAPS, CAMP } from '../renderer/systems/quests/river.js'

const clearings = OPEN_MAPS[7]
const poi = label => clearings.pois.find(p => p.label === label)
const walkable = (x, y) => clearings.walk[y]?.[x] === '1'

// Breadth-first step count over walkable cells — the chase legs have to be a
// walk, not a teleport, and a wallow behind a wall would strand the quest.
function steps(from, to) {
  const key = (x, y) => `${x},${y}`
  const seen = new Set([key(from.x, from.y)])
  let front = [from], n = 0
  while (front.length) {
    if (front.some(c => c.x === to.x && c.y === to.y)) return n
    const next = []
    for (const c of front) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy
      if (!walkable(x, y) || seen.has(key(x, y))) continue
      seen.add(key(x, y)); next.push({ x, y })
    }
    front = next; n++
  }
  return Infinity
}

describe('the Clearings wallows', () => {
  it('declares all three, as landmarks, on walkable cells', () => {
    for (const label of WALLOWS) {
      const p = poi(label)
      assert.ok(p, `missing ${label}`)
      assert.equal(p.kind, 'landmark', label)
      assert.ok(walkable(p.x, p.y), `${label} at ${p?.x},${p?.y} is not walkable`)
    }
  })
  it('keeps the hunt walkable end to end, in legs worth walking', () => {
    const chain = [poi(SHRINE), ...WALLOWS.map(poi)]
    for (let i = 0; i + 1 < chain.length; i++) {
      const d = steps(chain[i], chain[i + 1])
      assert.ok(d >= 20 && d <= 90, `leg ${i + 1} is ${d} steps`)
    }
  })
  it("leaves the map's dungeons and its waystone alone", () => {
    assert.equal(clearings.pois.filter(p => p.kind === 'dungeon_entrance').length, 2)
    assert.ok(poi('forest shrine'))
    assert.equal(clearings.pois.filter(p => p.kind === 'village' || p.kind === 'camp').length, 1)
  })
  it('takes no label a rite already claims', () => {
    const riteLabels = new Set((MAP_RITES[clearings.name] ?? []).map(r => r.fromPoi))
    for (const label of WALLOWS) assert.equal(riteLabels.has(label), false, label)
  })
})

describe('the River Split tar pit and bridge gaps', () => {
  const river = OPEN_MAPS[11]
  const rp = label => river.pois.find(p => p.label === label)
  const skinAt = (x, y) => river.palette[river.ground[y][x]]
  it('declares the pit and three gaps as landmarks', () => {
    for (const label of [PIT, ...GAPS]) {
      const p = rp(label)
      assert.ok(p, `missing ${label}`)
      assert.equal(p.kind, 'landmark', label)
    }
  })
  it('the pit is walkable ground four cells east of the camp', () => {
    const pit = rp(PIT), camp = rp(CAMP)
    assert.ok(camp && camp.kind === 'camp')
    assert.deepEqual({ x: pit.x, y: pit.y }, { x: camp.x + 4, y: camp.y })
    assert.equal(river.walk[pit.y][pit.x], '1')
  })
  it('the gaps are the south bridge deck: baked walkable planks over water, in one east-west row', () => {
    const gaps = GAPS.map(rp)
    for (const g of gaps) {
      assert.equal(river.walk[g.y][g.x], '1', 'baked as planks')
      assert.ok(skinAt(g.x, g.y).startsWith('ow_water'), `${g.x},${g.y} is over water`)
      assert.equal(river.palette[river.prop[g.y][g.x]], 'ow_pier_log', `${g.x},${g.y} has the plank prop`)
    }
    assert.deepEqual(gaps.map(g => g.x), [48, 49, 50])
    assert.ok(gaps.every(g => g.y === 58))
    assert.equal(river.walk[58][47], '1', 'the west end of the deck is walkable')
    assert.equal(river.walk[58][51], '1', 'the east end of the deck is walkable')
  })
  it("leaves the north bridge, the bear cave and the shrine alone", () => {
    assert.deepEqual({ x: rp('north bridge').x, y: rp('north bridge').y }, { x: 67, y: 22 })
    assert.equal(river.pois.filter(p => p.kind === 'dungeon_entrance').length, 1)
    assert.ok(rp('river shrine'))
    assert.equal(river.pois.filter(p => p.kind === 'village' || p.kind === 'camp').length, 1)
  })
  it('takes no label a rite already claims', () => {
    const riteLabels = new Set((MAP_RITES[river.name] ?? []).map(r => r.fromPoi))
    for (const label of [PIT, ...GAPS]) assert.equal(riteLabels.has(label), false, label)
  })
})
