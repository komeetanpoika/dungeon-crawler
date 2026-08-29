import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { TILE } from '../renderer/systems/entities.js'

const REQUIRED = {
  'lake-1-ferry':     ['runestone', 'village', 'bell', 'pier end', 'nakki', 'pier gap 1', 'pier gap 2', 'islet cache'],
  'highland-2-fold':  ['runestone', 'village', 'fold', 'den', 'burrow', 'lair', 'fleece cache', 'burn 1', 'burn 2', 'burn 3', 'burn 4'],
  'marsh-3-hermit':   ['runestone', 'village', 'hearth', 'hermit hut', 'mushroom ring', 'hearth 1', 'hearth 2', 'hearth 3'],
}
const byName = Object.fromEntries(Object.values(OPEN_MAPS).map(m => [m.name, m]))

for (const [name, labels] of Object.entries(REQUIRED)) {
  describe(name, { skip: !byName[name] && 'not exported yet' }, () => {
    const data = byName[name]
    it('is a leap map with one cave, an exit and a starter-free spawn', () => {
      assert.equal(data.leap, true)
      assert.equal(data.pois.filter(p => p.kind === 'dungeon_entrance').length, 1)
      assert.equal(data.caveDepths.length, 1)
      assert.ok(data.exit)
      assert.equal(data.starter, null)
    })
    for (const label of labels) it(`declares POI "${label}"`, () => {
      assert.ok(data.pois.some(p => p.label === label), `missing ${label}`)
    })
    it('builds; spawn and every POI sit on or beside walkable floor', () => {
      const { map } = buildOpenMap(data)
      const open = (x, y) => map[y]?.[x]?.tile === TILE.FLOOR
      const near = (x, y) => open(x, y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => open(x + dx, y + dy))
      assert.ok(open(data.playerSpawn.x, data.playerSpawn.y), 'spawn')
      for (const p of data.pois) assert.ok(near(p.x, p.y), `poi ${p.label} at ${p.x},${p.y}`)
    })
    it('has at least three caches', () => {
      assert.ok(data.pois.filter(p => p.kind === 'chest').length >= 3)
    })
  })
}

describe('gen-forest maps are unchanged by the kit refactor', () => {
  it('forest-1-clearings JSON on disk still matches the exported data', () => {
    const json = JSON.parse(readFileSync(new URL('../tools/static-overworld/out/maps/forest-1-clearings.json', import.meta.url)))
    assert.deepEqual(json.ground, byName['forest-1-clearings'].ground)
  })
})
