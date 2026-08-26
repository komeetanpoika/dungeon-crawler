import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toPainter, fromPainter, deriveWalkFixes } from '../tools/static-overworld/editor-bridge.mjs'

// A tiny 4x3 overworld map in the out/maps JSON shape: grass shore around a
// water cell, one tree prop, one unwalkable water column.
const fixture = () => ({
  name: 'test-pond', biome: 'forest', technique: 't', notes: 'n',
  w: 4, h: 3,
  palette: ['ow_grass_0', 'ow_water_0', 'ow_tree_small'],
  ground: [
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ],
  prop: [
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, 2, -1, -1],
  ],
  walk: ['1111', '1001', '1011'],
  pois: [{ kind: 'chest', x: 3, y: 0, label: 'cache' }],
  playerSpawn: { x: 0, y: 0 },
})

describe('toPainter', () => {
  const p = toPainter(fixture())

  it('carries dimensions and maps ground indices to tile names', () => {
    assert.equal(p.w, 4)
    assert.equal(p.h, 3)
    assert.equal(p.base[0][0], 'ow_grass_0')
    assert.equal(p.base[1][1], 'ow_water_0')
  })

  it('maps props to the overlay layer, -1 becoming null', () => {
    assert.equal(p.overlay[2][1], 'ow_tree_small')
    assert.equal(p.overlay[0][0], null)
  })

  it('turns the walk grid into collision properties', () => {
    assert.deepEqual(p.props[0][0], { collision: 'walkable' })
    assert.deepEqual(p.props[1][1], { collision: 'wall' })
    assert.deepEqual(p.props[2][1], { collision: 'wall' })
  })
})

describe('fromPainter', () => {
  it('round-trips the fixture unchanged, palette order preserved', () => {
    const m = fixture()
    assert.deepEqual(fromPainter(toPainter(m), m), m)
  })

  it('adds newly painted tile names to the palette', () => {
    const m = fixture()
    const p = toPainter(m)
    p.base[1][1] = 'ow_pond_11'          // repaint the water cell with a pond tile
    const out = fromPainter(p, m)
    assert.ok(out.palette.includes('ow_pond_11'))
    assert.equal(out.palette[out.ground[1][1]], 'ow_pond_11')
    // untouched cells keep their names through the rebuilt palette
    assert.equal(out.palette[out.ground[0][0]], 'ow_grass_0')
    assert.equal(out.palette[out.prop[2][1]], 'ow_tree_small')
  })

  it('reads walkability back from the collision properties', () => {
    const m = fixture()
    const p = toPainter(m)
    p.props[1][1] = { collision: 'walkable' }   // user opens the channel
    const out = fromPainter(p, m)
    assert.equal(out.walk[1], '1101')
  })

  it('an erased base cell falls back to the original ground name', () => {
    const m = fixture()
    const p = toPainter(m)
    p.base[1][1] = null
    const out = fromPainter(p, m)
    assert.equal(out.palette[out.ground[1][1]], 'ow_water_0')
  })

  it('a missing collision cell falls back to the original walk value', () => {
    const m = fixture()
    const p = toPainter(m)
    p.props[1][2] = null
    const out = fromPainter(p, m)
    assert.equal(out.walk[1], '1001')
  })

  it('refuses a resized painter grid — POI coordinates would silently break', () => {
    const m = fixture()
    const p = toPainter(m)
    p.base.push(p.base[0].slice())
    p.h = 4
    assert.throws(() => fromPainter(p, m), /resiz/i)
  })
})

describe('deriveWalkFixes', () => {
  // Edited fixture: the user repaints art but never touches collision.
  const edited = () => {
    const m = fixture()
    const p = toPainter(m)
    p.overlay[1][1] = 'ow_pier_log'        // bridge over the water channel
    p.base[1][2] = 'ow_pond_12'            // water repainted as pond edge
    p.base[2][1] = 'ow_water_0'            // grass repainted as water
    p.overlay[2][1] = null                 //   (tree removed there)
    p.base[0][3] = 'ow_grass_0'            // unchanged name — but same as before
    return { m, p }
  }

  it('a bridge overlay makes the cell walkable', () => {
    const { m, p } = edited()
    const fixed = deriveWalkFixes(p, m)
    assert.equal(fixed.props[1][1].collision, 'walkable')
  })

  it('cells repainted to water or pond become walls', () => {
    const { m, p } = edited()
    p.base[0][1] = 'ow_water_1'            // walkable grass -> open water
    p.base[0][2] = 'ow_pond_01'            // walkable grass -> pond edge
    const fixed = deriveWalkFixes(p, m)
    assert.equal(fixed.props[0][1].collision, 'wall')
    assert.equal(fixed.props[0][2].collision, 'wall')
    assert.equal(fixed.props[2][1].collision, 'wall')
    assert.equal(fixed.props[1][2].collision, 'wall')
  })

  it('cells repainted to grass become walkable', () => {
    const { m, p } = edited()
    p.base[1][2] = 'ow_grass_0'            // water -> grass instead
    const fixed = deriveWalkFixes(p, m)
    assert.equal(fixed.props[1][2].collision, 'walkable')
  })

  it('unchanged cells keep their collision even when art and walk disagree', () => {
    const { m, p } = edited()
    p.props[1][1] = { collision: 'wall' }  // pretend original said wall here
    p.overlay[1][1] = null                 // and the cell is untouched art-wise
    const fixed = deriveWalkFixes(p, m)
    assert.equal(fixed.props[1][1].collision, 'wall')
  })

  it('changed cells with no rule keep their painted collision', () => {
    const { m, p } = edited()
    p.overlay[0][1] = 'ow_rock_gray_0'     // rock prop: no derivation rule
    const fixed = deriveWalkFixes(p, m)
    assert.equal(fixed.props[0][1].collision, 'walkable')
  })

  it('does not mutate its input', () => {
    const { m, p } = edited()
    const before = JSON.stringify(p)
    deriveWalkFixes(p, m)
    assert.equal(JSON.stringify(p), before)
  })
})
