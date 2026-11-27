// Desert villages (renderer/wilds/sites.js village(…, desert)): a village
// whose middle is desert is built from the desert kit (flat-roofed mud-brick
// houses, sand paving, palms, awning stalls, a date garden, no bee yard) and
// is otherwise the village it was: door for door, villager for villager, its
// coach stop and its signpost where they stood.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePiece } from '../renderer/wilds/piece.js'
import { setDesertDress } from '../renderer/wilds/desert-art.js'
import { isDesert } from '../renderer/wilds/desert.js'
import { PIECE, villagesNear } from '../renderer/wilds/layout.js'
import { taleOf, kindOf } from '../renderer/wilds/tales.js'
import { makeWorld, getPiece, GEN } from '../renderer/wilds/world.js'
import { enterWilds, snapshotWilds } from '../renderer/wilds/session.js'
import { toWorld } from '../renderer/wilds/window.js'
import { storyEpisode } from '../renderer/wilds/tale-run.js'
import { houseSpec, generateInterior } from '../renderer/interior/index.js'
import { TILE, isWalkable } from '../renderer/systems/entities.js'

const SEEDS = [7, 42, 1]
const REACH = 8
const without = fn => { setDesertDress(false); try { return fn() } finally { setDesertDress(true) } }
// every village within REACH pieces of home on the seeds, with its own tale,
// built with the desert dress on and off; `desert`: its middle is desert
let sample = null
function villages() {
  if (sample) return sample
  sample = []
  for (const seed of SEEDS) for (const v of villagesNear(seed, 0, 0, REACH)) {
    if (v.wx === 0 && v.wy === 0) continue
    const tale = taleOf(seed, v)
    const dressed = generatePiece(seed, v.wx, v.wy, 0, null, tale)
    const c = dressed.village
    const desert = isDesert(seed, v.wx * PIECE + c.x, v.wy * PIECE + c.y)
    sample.push({ seed, v, tale, desert, dressed, at: `seed ${seed} ${v.name} (${v.wx},${v.wy})`, plain: null })
  }
  return sample
}
const plainOf = s => s.plain ??= without(() => generatePiece(s.seed, s.v.wx, s.v.wy, 0, null, s.tale))
const deserts = () => villages().filter(s => s.desert)

const ADOBE = /^ow_(roof|house)_adobe_/
const isHouseArt = n => typeof n === 'string' && (n.startsWith('ow_house_') || n.startsWith('ow_roof_'))
// The cells of the house whose door this is: along the door's row while the
// wall runs on, and up while it is house art.
function houseBox(p, d) {
  let x0 = d.x, x1 = d.x, top = d.y
  while (isHouseArt(p.cells[d.y][x0 - 1]?.overlay)) x0--
  while (isHouseArt(p.cells[d.y][x1 + 1]?.overlay)) x1++
  while (isHouseArt(p.cells[top - 1]?.[d.x]?.overlay)) top--
  return { x0, x1, top, bottom: d.y }
}
const near = (p, r) => {
  const out = []
  for (let y = p.village.y - r; y <= p.village.y + r; y++) for (let x = p.village.x - r; x <= p.village.x + r; x++)
    if ((x - p.village.x) ** 2 + (y - p.village.y) ** 2 <= r * r) out.push({ x, y, cell: p.cells[y][x] })
  return out
}

test('the sample holds desert villages, a tale village and a sunroom among them', () => {
  const d = deserts()
  assert.ok(d.length >= 8, `only ${d.length} desert villages`)
  assert.ok(d.some(s => s.tale === 'lalli') && d.some(s => s.tale === 'fold'), 'no village-borne tale in the desert sample')
  assert.ok(d.some(s => s.dressed.doors.some(x => x.kind === 'sunroom')), 'no sunroom in the desert sample')
})

test('a desert village is built from the desert kit', () => {
  let palms = 0
  for (const s of deserts()) {
    const p = s.dressed, { x: cx, y: cy } = p.village
    // its houses
    const houses = p.doors.filter(d => d.tier === 'safe')
    assert.ok(houses.length >= 4, `${s.at}: ${houses.length} houses`)
    for (const d of houses) {
      assert.equal(d.look.wall, 'adobe', `${s.at}: the house at ${d.x},${d.y} is not adobe`)
      const b = houseBox(p, d)
      assert.ok(b.bottom - b.top >= 2, `${s.at}: the house at ${d.x},${d.y} has no roof`)
      for (let y = b.top; y <= b.bottom; y++) for (let x = b.x0; x <= b.x1; x++)
        assert.match(p.cells[y][x].overlay ?? '', ADOBE, `${s.at}: ${x},${y} of the house at ${d.x},${d.y}`)
    }
    // its street and square
    for (const { x, y, cell } of near(p, 3)) if ((x - cx) ** 2 + (y - cy) ** 2 < 14) assert.match(cell.skin, /^ow_pave_sand_/, `${s.at}: the square at ${x},${y}`)
    for (let y = 0; y < PIECE; y++) for (let x = 0; x < PIECE; x++) {
      const c = p.cells[y][x]
      assert.notEqual(c.skin, 'ow_cobble_green', `${s.at}: green cobbles at ${x},${y}`)
      assert.notEqual(c.overlay, 'ow_beehive', `${s.at}: a beehive at ${x},${y}`)
      if (c.overlay === 'ow_tree_palm_top' && y + 1 < PIECE) assert.equal(p.cells[y + 1][x].overlay, 'ow_tree_palm', `${s.at}: a crown with no trunk at ${x},${y}`)
    }
    for (const { cell } of near(p, 14)) {
      assert.ok(!(cell.overlay ?? '').startsWith('ow_deco_flower_'), `${s.at}: a meadow flower in the village`)
      assert.ok(!(cell.skin ?? '').startsWith('ow_patch_'), `${s.at}: a green field in the village`)
      if (cell.overlay === 'ow_tree_palm') { palms++; assert.equal(cell.tile, TILE.WALL) }
    }
    // the date garden where the field was: the low mud wall, no fence
    for (let y = cy + 7; y <= cy + 10; y++) for (let x = cx - 9; x <= cx - 4; x++) {
      const o = p.cells[y][x].overlay ?? ''
      assert.ok(!o.startsWith('ow_fence_') && !o.startsWith('ow_deco_crop_'), `${s.at}: ${o} in the date garden at ${x},${y}`)
    }
    assert.ok(near(p, 12).some(({ cell }) => cell.overlay === 'ow_prop_wall_sand'), `${s.at}: no mud wall`)
    // a stall wears an awning
    const plain = plainOf(s)
    if (plain.cells[cy + 4][cx - 4].overlay?.startsWith('ow_stall_top'))
      for (let i = 0; i < 3; i++) assert.match(p.cells[cy + 4][cx - 4 + i].overlay ?? '', /^ow_stall_awning_/, `${s.at}: the stall`)
    // the glassmaker's house is adobe outside and the sunroom inside
    for (const d of p.doors.filter(d => d.kind === 'sunroom')) {
      const spec = houseSpec(d, { worldSeed: s.seed })
      assert.equal(spec.version, 'sunroom', `${s.at}: the sunroom door builds ${spec.version}`)
      assert.ok(generateInterior(spec).map.some(r => r.some(c => c.mirror)), `${s.at}: no mirrors in the sunroom`)
    }
  }
  assert.ok(palms >= deserts().length * 2, `only ${palms} palms in ${deserts().length} villages`)
})

// what a village is, apart from its tiles
const doorsOf = p => p.doors.map(d => [d.x, d.y, d.label, d.tier, d.story ?? null, d.kind ?? null, d.look.w, d.look.storeys].join(':'))
const spawnsOf = p => p.spawns.map(s => [s.kind, s.x, s.y, s.species ?? s.npc ?? '', s.id ?? ''].join(':'))
const signsOf = p => p.signs.map(s => [s.x, s.y, s.title].join(':'))
const pointsOf = p => [...p.points, ...p.villagePoints].map(q => [q.label, q.x, q.y].join(':'))

test('the same village, door for door', () => {
  for (const s of deserts()) {
    const p = s.dressed, plain = plainOf(s)
    assert.equal(doorsOf(p).join('|'), doorsOf(plain).join('|'), `${s.at}: the doors`)
    assert.equal(spawnsOf(p).join('|'), spawnsOf(plain).join('|'), `${s.at}: the spawns`)
    assert.equal(JSON.stringify(p.coach), JSON.stringify(plain.coach), `${s.at}: the coach stop`)
    assert.ok(p.coach, `${s.at}: no coach stop`)
    assert.equal(signsOf(p).join('|'), signsOf(plain).join('|'), `${s.at}: the signposts`)
    assert.equal(pointsOf(p).join('|'), pointsOf(plain).join('|'), `${s.at}: the named points`)
    assert.equal(JSON.stringify(p.spawnPoint), JSON.stringify(plain.spawnPoint), `${s.at}: the spawn point`)
  }
})

test('the same village, door for door, whatever tale it is built for', () => {
  // every village-borne tale in one desert village (the tale decides a house, a pen, hearths)
  const s = deserts()[0]
  for (const tale of ['lalli', 'fold', 'flame', 'nakki']) {
    const p = generatePiece(s.seed, s.v.wx, s.v.wy, 0, null, tale)
    const plain = without(() => generatePiece(s.seed, s.v.wx, s.v.wy, 0, null, tale))
    assert.equal(doorsOf(p).join('|'), doorsOf(plain).join('|'), `${s.at} as ${tale}: the doors`)
    assert.equal(spawnsOf(p).join('|'), spawnsOf(plain).join('|'), `${s.at} as ${tale}: the spawns`)
    assert.equal(pointsOf(p).join('|'), pointsOf(plain).join('|'), `${s.at} as ${tale}: the named points`)
    assert.equal(JSON.stringify(p.coach), JSON.stringify(plain.coach), `${s.at} as ${tale}: the coach stop`)
  }
})

test('desert houses open behind', () => {
  for (const s of deserts()) {
    const p = s.dressed
    for (const d of p.doors.filter(d => d.tier === 'safe')) {
      const b = houseBox(p, d)
      for (let x = b.x0; x <= b.x1; x++) {
        const c = p.cells[b.top][x]
        assert.ok(c.overlay.startsWith('ow_roof_adobe_'), `${s.at}: the top row of the house at ${d.x},${d.y} is ${c.overlay}`)
        assert.ok(c.over, `${s.at}: the roof at ${x},${b.top} is not walked behind`)
      }
      for (let y = b.top + 1; y <= b.bottom; y++) for (let x = b.x0; x <= b.x1; x++) assert.ok(!p.cells[y][x].over, `${s.at}: ${x},${y} below the top row opened`)
    }
  }
})

test('an old save wakes in its desert village', () => {
  const SEED = 42
  const v = deserts().find(s => s.seed === SEED).v
  const buildEntities = spawns => spawns.map(s => ({ type: s.kind, x: s.x, y: s.y, px: s.x * 32 + 16, py: s.y * 32 + 16 }))
  const fresh = () => ({
    player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5 }, entities: [], projectiles: [], zones: [], fireZones: [],
    lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: { floats: [] }, caveInstances: {},
  })
  const world = makeWorld(null, { seed: SEED })
  const state = fresh()
  enterWilds(state, world, { wx: 0, wy: 0 }, { buildEntities })
  world.lastVillage = { wx: v.wx, wy: v.wy }
  const saved = { ...JSON.parse(JSON.stringify(snapshotWilds(state, world))), gen: GEN - 1 }
  const again = makeWorld(saved, { seed: 999 })
  assert.deepEqual(again.lastVillage, { wx: v.wx, wy: v.wy })
  const st = fresh()
  enterWilds(st, again, again.pos ?? again.lastVillage, { buildEntities })
  const at = toWorld(again.origin, st.player.x, st.player.y)
  assert.deepEqual([Math.floor(at.X / PIECE), Math.floor(at.Y / PIECE)], [v.wx, v.wy], 'woke elsewhere')
  const p = getPiece(again, v.wx, v.wy)
  assert.ok(p.doors.length >= 4)
  // the door records carry the labels they had before the village was adobe
  const plain = without(() => generatePiece(SEED, v.wx, v.wy, again.deals.get(`${v.wx},${v.wy}`) ?? 0, null, kindOf(again, v)))
  assert.equal(p.doors.map(d => d.label).join('|'), plain.doors.map(d => d.label).join('|'))
  // (the village's houses; a hut out on the piece is no house of the village)
  const village = p.doors.filter(d => d.tier === 'safe')
  assert.ok(village.length >= 4)
  for (const d of village) {
    assert.equal(d.look.wall, 'adobe', d.label)
    const spec = houseSpec(d, { worldSeed: again.seed, story: storyEpisode(again, d)?.houses?.[d.story] ?? null })
    const house = generateInterior(spec)
    assert.equal(spec.label, d.label)
    assert.equal(spec.palette, spec.version === 'sunroom' ? 'pale' : 'plaster', `${d.label}: ${spec.palette}`)
    const at = house.map[house.playerSpawn.y]?.[house.playerSpawn.x]
    assert.ok(house.exit && at && isWalkable(at.tile, at), `${d.label}: no way in`)
  }
})

test('green villages are untouched', () => {
  const key = c => `${c.tile}:${c.skin}:${c.overlay ?? ''}:${c.deco ?? ''}:${c.over ? 1 : 0}`
  let n = 0
  for (const s of villages().filter(s => !s.desert)) {
    const p = s.dressed, plain = plainOf(s)
    // a village is wholly one kit, judged at its middle
    for (const { x, y, cell } of near(p, 13)) {
      assert.ok(!ADOBE.test(cell.overlay ?? '') && !(cell.skin ?? '').startsWith('ow_pave_sand_'), `${s.at}: desert kit at ${x},${y}`)
      // with no desert under it, the village is the same cell for cell
      if (!isDesert(s.seed, s.v.wx * PIECE + x, s.v.wy * PIECE + y)) assert.equal(key(cell), key(plain.cells[y][x]), `${s.at}: ${x},${y}`)
      else assert.equal(cell.overlay ?? '', plain.cells[y][x].overlay ?? '', `${s.at}: ${x},${y}`)
    }
    assert.equal(doorsOf(p).join('|'), doorsOf(plain).join('|'), `${s.at}: the doors`)
    assert.ok(p.doors.filter(d => d.tier === 'safe').every(d => d.look.wall === 'stone' || d.look.wall === 'wood'), `${s.at}: a house that is not green`)
    assert.equal(spawnsOf(p).join('|'), spawnsOf(plain).join('|'), `${s.at}: the spawns`)
    n++
  }
  assert.ok(n >= 10, `only ${n} green villages`)
})
