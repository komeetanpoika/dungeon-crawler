import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signNearby } from '../renderer/systems/signs.js'
import { MAP_SIGNS } from '../renderer/data/signs.js'
import { buildOpenMap } from '../renderer/systems/openmap.js'
import { OPEN_MAPS } from '../renderer/data/open-maps.js'
import { isWalkable } from '../renderer/systems/entities.js'

describe('MAP_SIGNS data', () => {
  it('Aspengrove has a readable signpost on its baked sign prop tile', () => {
    const signs = MAP_SIGNS['forest-1-clearings']
    assert.equal(signs.length, 1)
    const s = signs[0]
    assert.deepEqual({ x: s.x, y: s.y }, { x: 32, y: 31 })
    assert.equal(s.title, 'Aspengrove')
    assert.ok(s.lines.length >= 2)
    for (const l of s.lines) assert.equal(typeof l, 'string')
    const data = OPEN_MAPS[7]
    assert.equal(data.palette[data.prop[s.y][s.x]], 'ow_sign', 'sign sits on the baked ow_sign prop')
  })
})

describe('signNearby', () => {
  const signs = [{ x: 32, y: 31, title: 'Aspengrove', lines: ['east'] }]

  it('finds the sign from every orthogonally adjacent tile', () => {
    for (const [x, y] of [[31, 31], [33, 31], [32, 30], [32, 32]])
      assert.equal(signNearby(signs, x, y), signs[0], `${x},${y}`)
  })

  it('ignores diagonal and distant tiles', () => {
    for (const [x, y] of [[31, 30], [33, 32], [30, 31], [32, 29]])
      assert.equal(signNearby(signs, x, y), null, `${x},${y}`)
  })

  it('tolerates missing sign lists', () => {
    assert.equal(signNearby(undefined, 1, 1), null)
    assert.equal(signNearby([], 1, 1), null)
  })
})

describe('buildOpenMap signs', () => {
  it('attaches the map\'s signs to the build result', () => {
    const { signs } = buildOpenMap(OPEN_MAPS[7])
    assert.equal(signs.length, 1)
    assert.equal(signs[0].title, 'Aspengrove')
  })

  it('maps without signs get an empty list', () => {
    const other = Object.values(OPEN_MAPS).find(d => !MAP_SIGNS[d.name])
    const { signs } = buildOpenMap(other)
    assert.deepEqual(signs, [])
  })
})

describe('Seagrave signpost', () => {
  const data = Object.values(OPEN_MAPS).find(d => d.name === 'sea-2-fishing-village')
  const sign = MAP_SIGNS['sea-2-fishing-village'][0]

  it('has flavor text and a direction to the sea cave', () => {
    assert.equal(sign.title, 'Seagrave')
    assert.ok(sign.lines.length >= 2)
    assert.ok(sign.lines.some(l => /sea cave/i.test(l)), 'points to the sea cave')
  })

  it('is stamped into the map: ow_sign overlay on a solid tile', () => {
    const { map, signs } = buildOpenMap(data)
    assert.equal(signs.length, 1)
    const c = map[sign.y][sign.x]
    assert.equal(c.overlay, 'ow_sign')
    assert.equal(isWalkable(c.tile), false, 'sign tile blocks movement')
  })

  it('stands beside walkable plaza tiles so it can be read', () => {
    const { map } = buildOpenMap(data)
    const readable = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dx, dy]) => isWalkable(map[sign.y + dy][sign.x + dx].tile))
    assert.ok(readable)
  })

  it('the stamp leaves Aspengrove\'s baked sign untouched', () => {
    const { map } = buildOpenMap(OPEN_MAPS[7])
    const a = MAP_SIGNS['forest-1-clearings'][0]
    assert.equal(map[a.y][a.x].overlay, 'ow_sign')
    assert.equal(isWalkable(map[a.y][a.x].tile), false)
  })
})
