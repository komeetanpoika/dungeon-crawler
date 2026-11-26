// The desert's sight rule: a dune crest is walked over but blocks sight
// (renderer/systems/entities.js), the hero's dune-aware sight in the Wilds,
// and the desert's numbers (renderer/wilds/desert.js). Every map here is made
// by hand from piece.js cellOf cells; nothing yet lays a dune in the Wilds.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasLineOfSight, computePlayerFOV, maybeComputeFOV, FOV_STATS } from '../renderer/systems/entities.js'
import { cellOf } from '../renderer/wilds/piece.js'
import { biomeAt } from '../renderer/wilds/layout.js'
import { SIGHT, BEACON_RANGE, DUNE_PREFIX, BEACON_PREFIX, isDesert, inGentleRing, heroSight } from '../renderer/wilds/desert.js'

// A map from rows of glyphs:
//   '.' sand   '^' a dune crest   'T' a palm   'R' a rock   'L' a landmark
const CELL = {
  '.': () => cellOf('ow_sand_0', null, true),
  '^': () => cellOf(`${DUNE_PREFIX}0`, null, true),
  'T': () => cellOf('ow_sand_0', 'ow_tree_palm', false),
  'R': () => cellOf('ow_sand_0', 'ow_rock_0', false),
  'L': () => cellOf('ow_sand_0', `${BEACON_PREFIX}spire`, false),
}
const parse = rows => rows.map(r => [...r].map(ch => CELL[ch]()))
// w x h of sand with glyphs laid at { 'x,y': glyph }
function field(w, h, laid = {}) {
  const map = parse(Array.from({ length: h }, () => '.'.repeat(w)))
  for (const [k, ch] of Object.entries(laid)) { const [x, y] = k.split(',').map(Number); map[y][x] = CELL[ch]() }
  return map
}
// a crest row from x0 to x1 inclusive at y
const crestRow = (laid, y, x0, x1) => { for (let x = x0; x <= x1; x++) laid[`${x},${y}`] = '^'; return laid }

describe('cellOf flags crests and landmarks', () => {
  it('a walkable dune skin is a crest, a blocked landmark overlay a beacon', () => {
    assert.equal(cellOf(`${DUNE_PREFIX}3`, null, true).losDune, true)
    assert.equal(cellOf(`${DUNE_PREFIX}3`, null, false).losDune, undefined, 'a blocked dune cell is no crest')
    assert.equal(cellOf('ow_sand_0', null, true).losDune, undefined)
    assert.equal(cellOf('ow_sand_0', `${BEACON_PREFIX}spire`, false).losBeacon, true)
    assert.equal(cellOf('ow_sand_0', `${BEACON_PREFIX}spire`, true).losBeacon, undefined, 'a walkable landmark is no beacon')
    assert.equal(cellOf('ow_sand_0', 'ow_rock_0', false).losBeacon, undefined)
  })
})

describe('hasLineOfSight over dunes', () => {
  // viewer in the hollow at (5, 2); a crest row at y 4; open sand beyond
  const hollow = () => field(11, 9, crestRow({}, 4, 0, 10))

  it('a crest between viewer and target blocks', () => {
    const map = hollow()
    assert.equal(hasLineOfSight(map, 2, 5, 6, 5), false)
    assert.equal(hasLineOfSight(map, 2, 5, 7, 2), false, 'slanting across it too')
    assert.equal(hasLineOfSight(map, 2, 5, 3, 9), true, 'the hollow itself is open')
  })

  it('a crest right beside the viewer blocks too', () => {
    const map = hollow()
    assert.equal(hasLineOfSight(map, 3, 5, 6, 5), false)
  })

  it('the crest itself is seen', () => {
    const map = hollow()
    assert.equal(hasLineOfSight(map, 2, 5, 4, 5), true)
    assert.equal(hasLineOfSight(map, 2, 5, 4, 7), true, 'at a slant')
  })

  it('standing on a crest you see along it and down both sides', () => {
    const map = hollow()
    assert.equal(hasLineOfSight(map, 4, 1, 4, 10), true, 'along the crest')
    assert.equal(hasLineOfSight(map, 4, 5, 0, 5), true, 'the hollow on one side')
    assert.equal(hasLineOfSight(map, 4, 5, 8, 5), true, 'the hollow on the other')
    assert.equal(hasLineOfSight(map, 4, 5, 8, 1), true, 'slanting down')
    // a crest two cells wide: from its upper row, down the far side
    const wide = field(11, 10, crestRow(crestRow({}, 4, 0, 10), 5, 0, 10))
    assert.equal(hasLineOfSight(wide, 4, 5, 8, 5), true)
    assert.equal(hasLineOfSight(wide, 5, 5, 1, 5), true)
  })

  it('a second crest still blocks from on top of the first', () => {
    const map = field(11, 15, crestRow(crestRow({}, 4, 0, 10), 10, 0, 10))
    assert.equal(hasLineOfSight(map, 4, 5, 7, 5), true, 'the hollow between')
    assert.equal(hasLineOfSight(map, 4, 5, 10, 5), true, 'the next crest itself')
    assert.equal(hasLineOfSight(map, 4, 5, 13, 5), false, 'beyond the next crest')
  })

  it('a landmark is seen over a crest', () => {
    const map = field(11, 9, crestRow({ '5,7': 'L', '8,7': 'R' }, 4, 0, 10))
    assert.equal(hasLineOfSight(map, 2, 5, 7, 5), true, 'the landmark')
    assert.equal(hasLineOfSight(map, 2, 5, 7, 8), false, 'a rock in the same place is not')
    assert.equal(hasLineOfSight(map, 2, 5, 7, 4), false, 'nor the sand beside the landmark')
  })

  it('walls and trees block as before around a crest', () => {
    // a rock still blocks a line that starts on a crest
    const map = field(11, 9, crestRow({ '5,6': 'R' }, 4, 0, 10))
    assert.equal(hasLineOfSight(map, 4, 5, 8, 5), false)
    // and a landmark behind a rock is not seen through the rock
    const behind = field(11, 9, { '5,4': 'R', '5,7': 'L' })
    assert.equal(hasLineOfSight(behind, 2, 5, 7, 5), false)
  })
})

describe("the hero's dune-aware sight", () => {
  it('dune sight hides only what lies behind a crest', () => {
    // hero at (20, 20); a crest south of him at y 24, x 16..24; a palm and a
    // rock north of him, with sand behind each
    const laid = crestRow({ '20,16': 'T', '24,16': 'R' }, 24, 16, 24)
    const map = field(41, 41, laid)
    computePlayerFOV(map, { x: 20, y: 20 }, 20, { los: 'dunes' })
    assert.equal(map[24][20].visible, true, 'the crest itself')
    for (const [x, y] of [[20, 26], [20, 30], [19, 34], [21, 38]]) assert.equal(map[y][x].visible, false, `behind the crest at ${x},${y}`)
    assert.equal(map[26][20].explored, false)
    assert.equal(map[16][20].visible, true, 'the palm')
    assert.equal(map[16][24].visible, true, 'the rock')
    assert.equal(map[10][20].visible, true, 'sand behind the palm')
    assert.equal(map[12][28].visible, true, 'sand behind the rock')
    assert.equal(map[20][39].visible, true, 'open sand at the edge of the radius')
    assert.equal(map[20][0].visible, true)
    assert.equal(map[2][2].visible, false, 'still bounded by the radius')
  })

  it('beacons are lit out to far', () => {
    // a landmark 30 tiles east, not behind any crest; a crest in range elsewhere
    const laid = crestRow({ '35,10': 'L', '35,12': 'R' }, 4, 0, 10)
    const lit = field(50, 21, laid)
    computePlayerFOV(lit, { x: 5, y: 10 }, 20, { los: 'dunes', far: BEACON_RANGE })
    assert.equal(lit[10][35].visible, true)
    assert.equal(lit[10][35].explored, true)
    assert.equal(lit[12][35].visible, false, 'only beacons are seen beyond the radius')
    assert.equal(lit[10][34].visible, false)
    const dark = field(50, 21, laid)
    computePlayerFOV(dark, { x: 5, y: 10 }, 20, { los: 'dunes', far: 0 })
    assert.equal(dark[10][35].visible, false)
    assert.equal(dark[10][35].explored, false)
  })

  it('the ring of far sight starts just past the radius and ends at far', () => {
    // landmarks 21, 32 and 33 tiles east, and one up and to the side at
    // (dx 19, dy -9): 21.02 tiles off
    const map = field(50, 21, { '26,10': 'L', '37,10': 'L', '38,10': 'L', '24,1': 'L' })
    computePlayerFOV(map, { x: 5, y: 10 }, 20, { los: 'dunes', far: BEACON_RANGE })
    assert.equal(map[10][26].visible, true, 'just past the radius')
    assert.equal(map[10][37].visible, true, 'at far')
    assert.equal(map[10][38].visible, false, 'past far')
    assert.equal(map[1][24].visible, true, 'off the axis')
  })

  it('a far beacon is seen over a crest, and none beyond far', () => {
    // a crest running north-south at x 10, between the hero and both landmarks
    const laid = { '30,10': 'L', '45,10': 'L' }
    for (let y = 0; y < 21; y++) laid[`10,${y}`] = '^'
    const map = field(50, 21, laid)
    computePlayerFOV(map, { x: 5, y: 10 }, 20, { los: 'dunes', far: BEACON_RANGE })
    assert.equal(map[10][30].visible, true, 'over the crest at x 10')
    assert.equal(map[10][20].visible, false, 'the sand behind the crest stays hidden')
    assert.equal(map[10][45].visible, false, '40 tiles off is beyond far')
  })

  it('the eight neighbours are always lit', () => {
    // a hollow cell in the middle of crests two deep all round
    for (const los of ['dunes', true]) {
      const laid = {}
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (x !== 3 || y !== 3) laid[`${x},${y}`] = '^'
      const map = field(7, 7, laid)
      computePlayerFOV(map, { x: 3, y: 3 }, 1, { los })
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        assert.equal(map[3 + dy][3 + dx].visible, true, `los ${los}: ${dx},${dy}`)
        assert.equal(map[3 + dy][3 + dx].explored, true)
      }
      assert.equal(map[1][3].visible, false, `los ${los}: nothing beyond`)
    }
  })

  it('no dunes in range means no ray test', () => {
    // a crest 25 tiles off, outside the radius
    const map = field(60, 41, crestRow({}, 20, 45, 47))
    FOV_STATS.rays = 0
    computePlayerFOV(map, { x: 20, y: 20 }, 20, { los: 'dunes', far: BEACON_RANGE })
    assert.equal(FOV_STATS.rays, 0)
    assert.equal(map[20][40].visible, true, 'the whole radius is lit')
    assert.equal(map[0][20].visible, true)
    // one crest cell inside the radius and the rays are cast
    map[20][30] = CELL['^']()
    computePlayerFOV(map, { x: 20, y: 20 }, 20, { los: 'dunes', far: BEACON_RANGE })
    assert.ok(FOV_STATS.rays > 0)
    assert.equal(map[20][35].visible, false, 'behind that crest')
  })

  it('a shift of the window recomputes', () => {
    const map = field(200, 41, crestRow({}, 25, 0, 199))
    const player = { x: 30, y: 20 }
    const opts = { los: 'dunes', far: BEACON_RANGE }
    assert.equal(maybeComputeFOV(map, player, 20, opts), true)
    assert.equal(maybeComputeFOV(map, player, 20, opts), false, 'cached')
    player.x += 80
    assert.equal(maybeComputeFOV(map, player, 20, opts), true)
    assert.equal(map[20][110].visible, true)
    assert.equal(map[20][30].visible, false, 'the old view is cleared')
  })

  it('the cache keys on radius, mode and far', () => {
    const map = field(60, 41, crestRow({}, 25, 0, 59))
    const player = { x: 30, y: 20 }
    maybeComputeFOV(map, player, 14, { los: 'dunes', far: 0 })
    assert.equal(maybeComputeFOV(map, player, 20, { los: 'dunes', far: 0 }), true, 'a new radius')
    assert.equal(map[20][49].visible, true)
    assert.equal(maybeComputeFOV(map, player, 20, { los: 'dunes', far: BEACON_RANGE }), true, 'a new far')
    assert.equal(maybeComputeFOV(map, player, 20, { los: false, far: BEACON_RANGE }), true, 'a new mode')
    assert.equal(map[30][30].visible, true, 'radius-only sees behind the crest')
    assert.equal(maybeComputeFOV(map, player, 20, { los: false, far: BEACON_RANGE }), false, 'then cached')
  })
})

describe('heroSight', () => {
  it('eases from the base or desert radius down to the storm radius', () => {
    assert.equal(heroSight({ desert: false }), 14)
    assert.equal(heroSight({ desert: true }), 20)
    assert.equal(heroSight({ desert: true, storm: 1 }), 4)
    assert.equal(heroSight({ desert: true, storm: 1, village: true }), 8)
    const half = heroSight({ desert: true, storm: 0.5 })
    assert.ok(half > 4 && half < 20, `${half}`)
    assert.ok(Number.isInteger(half))
    assert.equal(heroSight({ desert: false, storm: 0, village: true }), 14, 'a village without a storm sees as ever')
  })

  it('holds the plan’s numbers', () => {
    assert.deepEqual(SIGHT, { base: 14, desert: 20, storm: 4, stormVillage: 8 })
    assert.equal(BEACON_RANGE, 32)
  })
})

describe('desert country and the gentle ring', () => {
  it('isDesert is the tile’s own country', () => {
    const seed = 7
    let desert = 0
    for (let X = -800; X <= 800; X += 40) for (let Y = -800; Y <= 800; Y += 40) {
      const want = biomeAt(seed, X, Y) === 'desert'
      if (want) desert++
      assert.equal(isDesert(seed, X, Y), want, `${X},${Y}`)
    }
    assert.ok(desert > 0, 'the sample finds some desert')
  })

  it('the gentle ring is the pieces round home', () => {
    assert.equal(inGentleRing(0, 0), true)
    assert.equal(inGentleRing(1, -1), true)
    assert.equal(inGentleRing(-1, 1), true)
    assert.equal(inGentleRing(2, 0), false)
    assert.equal(inGentleRing(0, -2), false)
  })
})
