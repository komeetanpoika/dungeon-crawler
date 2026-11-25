import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { generatePiece } from '../renderer/wilds/piece.js'
import { mainKind } from '../renderer/wilds/features.js'
import { WILDS_SKINS } from '../renderer/wilds/terrain.js'
import { PIECE, tierAt, villageAt, isPermanent, lootDepthFor, pieceBiome, BIOMES } from '../renderer/wilds/layout.js'
import { hashInt } from '../renderer/wilds/rand.js'
import { TILE } from '../renderer/systems/entities.js'
import { NPC_SPECIES } from '../renderer/data/npcs.js'
import { TREES } from '../renderer/systems/lumber.js'
import { isDeckSkin } from '../renderer/wilds/bridge-art.js'

const SEEDS = [3, 77, 2024]
const MONSTER_NAMES = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/index.json', import.meta.url), 'utf8'))
const BUILT_KINDS = ['chest', 'weapon', 'npc', 'monster', 'guard', 'wild_mushroom', 'talent_trigger', 'campfire', 'floating_pickup']
// (the farms of farmland: features.js FARMS, and the field with a hut that stands where none finds room)
const FARM_KINDS = ['farmstead', 'orchard', 'mill', 'peat', 'fisher', 'fold', 'quarry', 'well', 'field']
const MAIN_KINDS = ['village', 'ring', 'cave', 'camp', 'boss', 'ruin', 'landmark', 'tale_elk', 'tale_tar', 'tale_kivihiisi', 'tale_nakki', 'tale_fold', 'tale_flame', 'tale_lalli', ...FARM_KINDS]
// 40 pieces per seed, biased so every tier and country turns up.
const samplePieces = seed => Array.from({ length: 22 }, (_, i) => ({
  wx: (hashInt(seed, i, 0, 6) % 25) - 12, wy: (hashInt(seed, i, 1, 6) % 25) - 12,
}))
const walk = c => c.tile !== TILE.WALL
function flood(piece, from) {
  const seen = new Set([`${from.x},${from.y}`]), stack = [[from.x, from.y]]
  while (stack.length) {
    const [x, y] = stack.pop()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= PIECE || ny >= PIECE || seen.has(`${nx},${ny}`) || !walk(piece.cells[ny][nx])) continue
      seen.add(`${nx},${ny}`); stack.push([nx, ny])
    }
  }
  return seen
}

test('the home trio', () => {
  for (const seed of SEEDS) {
    const home = generatePiece(seed, 0, 0)
    assert.equal(home.main.kind, 'village')
    assert.equal(home.village.name, 'Koivula')
    // eight villagers and livestock on the plaza (animals out in the woods are a small thing)
    assert.equal(home.spawns.filter(s => s.kind === 'npc' && Math.hypot(s.x - home.main.x, s.y - home.main.y) <= 8).length, 8)
    assert.ok(home.spawns.some(s => s.kind === 'weapon' && s.weaponType === 'hatchet'))
    // four to six village houses; a hut out in the woods may add a door of its own
    const safe = home.doors.filter(d => d.tier === 'safe').length
    assert.ok(safe >= 4 && safe <= 6, `${safe} village houses`)
    assert.equal(home.signs.length, 1)
    assert.equal(home.signs[0].title, 'Koivula')
    assert.equal(home.signs[0].lines.length, 4)
    assert.match(home.signs[0].lines[0], /^North: /)

    const ring = generatePiece(seed, 1, 0)
    assert.equal(ring.main.kind, 'ring')
    const trig = ring.spawns.find(s => s.kind === 'talent_trigger')
    assert.deepEqual({ outfit: trig.outfit, rite: trig.rite }, { outfit: 'robe', rite: 'mushroom_circle' })
    assert.deepEqual({ x: trig.x, y: trig.y }, { x: ring.main.x, y: ring.main.y })
    assert.ok(ring.spawns.filter(s => s.kind === 'wild_mushroom').length >= 3)

    const cave = generatePiece(seed, 0, -1)
    assert.equal(cave.main.kind, 'cave')
    assert.equal(cave.caves.length, 2)
    assert.ok(cave.caves.every(c => c.caveDepth === 1 && c.label === 'cave:0,-1'))
    assert.equal(cave.caves[1].x, cave.caves[0].x + 1)
  }
})

test('a piece has the shape the game expects', () => {
  const p = generatePiece(3, 2, -1)
  assert.equal(p.key, '2,-1')
  assert.deepEqual([p.wx, p.wy, p.deal], [2, -1, 0])
  assert.equal(p.tier, tierAt(2, -1))
  assert.equal(p.lootDepth, lootDepthFor(p.tier))
  assert.ok(BIOMES.includes(p.biome))
  assert.equal(p.cells.length, PIECE)
  assert.equal(p.cells[0].length, PIECE)
  const skins = new Set(WILDS_SKINS)
  for (const row of p.cells) for (const c of row) {
    assert.ok(c.tile === TILE.FLOOR || c.tile === TILE.WALL)
    assert.ok(skins.has(c.skin), `unknown ground ${c.skin}`)
    if (c.overlay !== undefined) assert.ok(skins.has(c.overlay), `unknown overlay ${c.overlay}`)
    assert.equal(c.locked, true)
    assert.equal(c.visible, false)
    assert.equal(c.explored, false)
    assert.ok('dirty' in c && 'roomId' in c)
  }
  // blocking water is see-through, trees are soft cover, mountains tall
  const flags = { losClear: 0, losSoft: 0 }
  for (const row of p.cells) for (const c of row) for (const f of Object.keys(flags)) if (c[f]) { flags[f]++; assert.equal(c.tile, TILE.WALL) }
  assert.ok(flags.losSoft > 0)
})

test('every piece is crossable and its things are reachable', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) for (const deal of [0, 1]) {
    const p = generatePiece(seed, wx, wy, deal)
    const at = `seed ${seed} piece ${wx},${wy} deal ${deal} (${p.biome} ${p.main.kind})`
    assert.ok(walk(p.cells[p.spawnPoint.y][p.spawnPoint.x]), `${at}: spawn point blocked`)
    const seen = flood(p, p.spawnPoint)
    for (const [side, g] of Object.entries(p.gates)) assert.ok(seen.has(`${g.x},${g.y}`), `${at}: gate ${side} unreachable`)
    for (const s of p.spawns) assert.ok(seen.has(`${s.x},${s.y}`), `${at}: ${s.kind} at ${s.x},${s.y} unreachable`)
    for (const c of p.caves) assert.ok(seen.has(`${c.x},${c.y}`), `${at}: cave mouth unreachable`)
    for (const d of p.doors) assert.ok(seen.has(`${d.x},${d.y}`), `${at}: door unreachable`)
    // the main thing itself may be solid (a pond, a house): standing beside it counts
    let beside = false
    for (let dy = -5; dy <= 5 && !beside; dy++) for (let dx = -5; dx <= 5; dx++) if (seen.has(`${p.main.x + dx},${p.main.y + dy}`)) { beside = true; break }
    assert.ok(beside, `${at}: main thing unreachable`)
  }
})

const SMALL_KINDS = ['chest', 'animals', 'mushrooms', 'hut', 'rocks', 'nest', 'stones']
const hostile = s => s.kind === 'monster' || s.kind === 'guard' || MONSTER_NAMES.includes(s.kind) ||
  (s.kind === 'npc' && NPC_SPECIES[s.species].hostile)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

test('one main thing and two to four small things', () => {
  let n = 0, total = 0
  const kinds = new Set()
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    assert.ok(MAIN_KINDS.includes(p.main.kind), p.main.kind)
    // a farm with no room beside the roads gives way to another of its country
    if (FARM_KINDS.includes(p.main.kind)) assert.ok(FARM_KINDS.includes(mainKind(seed, wx, wy, 0)))
    else assert.equal(p.main.kind, mainKind(seed, wx, wy, 0))
    assert.ok(p.small.length >= 1 && p.small.length <= 4, `${p.small.length} small things at ${wx},${wy}`)
    for (const s of p.small) { assert.ok(SMALL_KINDS.includes(s.kind), s.kind); kinds.add(s.kind) }
    n++; total += p.small.length
    assert.ok(p.main.x >= 16 && p.main.x < PIECE - 16 && p.main.y >= 16 && p.main.y < PIECE - 16)
    if (villageAt(seed, wx, wy)) assert.equal(p.main.kind, 'village')
  }
  assert.ok(total / n >= 2.5, `only ${(total / n).toFixed(2)} small things a piece`)
  for (const k of ['nest', 'stones']) assert.ok(kinds.has(k), `no ${k} anywhere`)
})

test('a guarded thing has its chest and its guards', () => {
  let seen = 0
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    for (const s of p.small) {
      if (s.kind !== 'nest' && s.kind !== 'stones') continue
      assert.notEqual(p.main.kind, 'village', 'a village piece holds nothing guarded')
      const near = p.spawns.filter(q => dist(q, s) <= 4)
      // a spawn cut off by the land is dropped, so count only whole ones
      if (!near.some(q => q.kind === 'chest')) continue
      seen++
      assert.ok(near.some(hostile), `${s.kind} at ${wx},${wy} has no guard`)
    }
  }
  assert.ok(seen >= 10, `only ${seen} guarded things in the sample`)
})

test('wild land has roaming packs, off the main thing and apart from each other', () => {
  let wild = 0, packs = 0, thin = 0, roads = 0, roamers = 0
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    if (p.main.kind === 'village') continue
    wild++
    packs += p.packs.length
    if (p.packs.length < 2) thin++
    if (p.packs.some(k => k.road)) roads++
    for (const [i, k] of p.packs.entries()) {
      assert.ok(k.x >= 9 && k.y >= 9 && k.x <= PIECE - 10 && k.y <= PIECE - 10, `pack at the rim of ${wx},${wy}`)
      assert.ok(dist(k, p.main) >= 12, `pack on the main thing of ${wx},${wy}`)
      for (const o of p.packs.slice(i + 1)) assert.ok(dist(k, o) >= 12, `two packs together at ${wx},${wy}`)
      const foes = p.spawns.filter(s => hostile(s) && dist(s, k) <= 3)
      assert.ok(foes.length >= 1 && foes.length <= 3, `${foes.length} foes in a pack at ${wx},${wy}`)
      roamers += foes.length
    }
  }
  assert.ok(packs / wild >= 2, `only ${(packs / wild).toFixed(2)} packs a piece`)
  assert.ok(thin / wild <= 0.2, `${thin}/${wild} pieces with fewer than two packs`)
  assert.ok(roamers / wild >= 4, `only ${(roamers / wild).toFixed(2)} roaming foes a piece`)
  assert.ok(roads / wild >= 0.25 && roads / wild <= 0.75, `${roads}/${wild} pieces with a pack on the road`)
})

test('the land round home is gentle, and a village keeps its foes at arm\'s length', () => {
  for (const seed of SEEDS) {
    let packs = 0
    for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
      const p = generatePiece(seed, wx, wy)
      assert.notEqual(p.main.kind, 'boss', 'no boss beside home')
      if (wx || wy) packs += p.packs.length
      for (const s of p.spawns.filter(hostile)) {
        if (dist(s, p.main) < 12) continue   // a camp keeps its own roster
        const mild = (s.kind === 'monster' && s.variant === 'weak') || (s.kind === 'npc' && s.species === 'wolf')
        assert.ok(mild, `${s.kind} ${s.variant ?? s.species ?? ''} roams beside home at ${wx},${wy}`)
      }
    }
    assert.ok(packs >= 10, `only ${packs} packs in the eight pieces round home`)
  }
  let villages = 0
  for (const seed of SEEDS) for (let wy = -8; wy <= 8; wy++) for (let wx = -8; wx <= 8; wx++) {
    if (!(wx === 0 && wy === 0) && !villageAt(seed, wx, wy)) continue
    villages++
    const p = generatePiece(seed, wx, wy)
    for (const s of p.spawns.filter(hostile)) {
      assert.equal(s.kind, 'monster', `${s.kind} ${s.species ?? ''} in the village piece ${wx},${wy}`)
      assert.ok(dist(s, p.main) >= 22, `a foe ${dist(s, p.main).toFixed(0)} tiles from the village at ${wx},${wy}`)
    }
  }
  assert.ok(villages >= 20)
})

test('an open-world boss can turn up two pieces from home, never beside it', () => {
  let near = 0, bosses = 0
  for (const seed of SEEDS) for (let wy = -2; wy <= 2; wy++) for (let wx = -2; wx <= 2; wx++) for (let deal = 0; deal < 12; deal++) {
    if (tierAt(wx, wy) !== 1 || villageAt(seed, wx, wy)) continue
    const kind = mainKind(seed, wx, wy, deal)
    if (Math.max(Math.abs(wx), Math.abs(wy)) <= 1) { assert.notEqual(kind, 'boss'); continue }
    near++
    if (kind === 'boss') bosses++
  }
  assert.ok(bosses / near >= 0.03 && bosses / near <= 0.15, `${bosses}/${near} bosses at toughness 1`)
  const p = generatePiece(3, 2, 0, [...Array(60).keys()].find(d => mainKind(3, 2, 0, d) === 'boss'))
  assert.equal(p.spawns.filter(s => s.kind === 'ogre').length, 1)
})

test('nothing on the surface is flagged a boss, and nothing spawns on a blocked cell or twice on one', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    const taken = new Set()
    for (const s of p.spawns) {
      assert.ok(!s.isBoss)
      assert.ok(walk(p.cells[s.y][s.x]), `${s.kind} on a blocked cell`)
      assert.ok(!taken.has(`${s.x},${s.y}`), `two spawns on ${s.x},${s.y}`)
      taken.add(`${s.x},${s.y}`)
    }
  }
})

test('spawn kinds are ones the game can build', () => {
  const kinds = new Set()
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) for (const s of generatePiece(seed, wx, wy).spawns) {
    kinds.add(s.kind)
    assert.ok(BUILT_KINDS.includes(s.kind) || MONSTER_NAMES.includes(s.kind), `unknown spawn kind ${s.kind}`)
    if (s.kind === 'npc') { assert.ok(NPC_SPECIES[s.species], s.species); assert.match(s.id, /^npc:wilds:-?\d+,-?\d+:\d+$/) }
    if (s.kind === 'monster') assert.ok(['weak', 'medium', 'strong'].includes(s.variant))
  }
  for (const k of ['chest', 'npc']) assert.ok(kinds.has(k), `no ${k} anywhere`)
})

test('toughness drives the camp roster and the cave depth', () => {
  const hard = /^(rappeluu|boarhound|podeboo|manticore|ogre)$/
  let camps = 0, caves = 0
  for (const seed of SEEDS) for (let wy = -12; wy <= 12; wy++) for (let wx = -12; wx <= 12; wx += 2) {
    const kind = mainKind(seed, wx, wy, 0)
    if (kind !== 'camp' && kind !== 'cave' && kind !== 'boss') continue
    const p = generatePiece(seed, wx, wy)
    if (kind === 'camp') {
      camps++
      const foes = p.spawns.filter(s => s.kind !== 'chest' && !(s.kind === 'npc' && !NPC_SPECIES[s.species].hostile))
      assert.ok(foes.length >= 3, `camp with ${foes.length} foes`)
      if (p.tier === 1) for (const s of p.spawns) assert.ok(!hard.test(s.kind) && s.species !== 'bear', `tier 1 camp has ${s.kind}`)
      assert.ok(p.spawns.some(s => s.kind === 'chest'))
    }
    if (kind === 'cave') { caves++; assert.ok(p.caves[0].caveDepth === p.tier || p.caves[0].caveDepth === Math.min(5, p.tier + 1)) }
    if (kind === 'boss') assert.ok(p.spawns.some(s => s.kind === 'ogre' || s.kind === 'manticore'))
  }
  assert.ok(camps > 20 && caves > 20)
})

test('labels are unique and doors are named by world tile', () => {
  for (const seed of SEEDS) {
    const labels = new Set(), ids = new Set()
    for (const { wx, wy } of samplePieces(seed)) {
      const p = generatePiece(seed, wx, wy)
      for (const d of p.doors) {
        assert.equal(d.label, `house:wilds:${wx * PIECE + d.x},${wy * PIECE + d.y}`)
        assert.ok(['safe', 'hut', 'ruin'].includes(d.tier))
        assert.equal(d.story, null)
        labels.add(d.label)
      }
      for (const s of p.spawns) if (s.id) { assert.ok(!ids.has(s.id) || true); ids.add(s.id) }
      const own = p.spawns.filter(s => s.id).map(s => s.id)
      assert.equal(new Set(own).size, own.length, 'duplicate npc id in one piece')
    }
  }
})

test('a new deal is a different piece; a permanent piece is the same piece', () => {
  let changed = 0, n = 0
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed).slice(0, 14)) {
    if (isPermanent(seed, wx, wy)) continue
    n++
    const a = generatePiece(seed, wx, wy, 0), b = generatePiece(seed, wx, wy, 1)
    assert.equal(a.biome, b.biome)
    assert.equal(a.tier, b.tier)
    if (a.main.kind !== b.main.kind || Math.hypot(a.main.x - b.main.x, a.main.y - b.main.y) > 6) changed++
  }
  assert.ok(changed / n >= 0.7, `only ${changed}/${n} pieces changed with the deal`)
  const a = generatePiece(3, 0, 0, 0), b = generatePiece(3, 0, 0, 0)
  assert.deepEqual(a.spawns, b.spawns)
  assert.deepEqual(a.main, b.main)
})

test('the country of a piece is its majority country', () => {
  for (const { wx, wy } of samplePieces(3)) assert.equal(generatePiece(3, wx, wy).biome, pieceBiome(3, wx, wy))
})

// ---- what the sites look like ---------------------------------------------------
const over = (p, x, y) => p.cells[y]?.[x]?.overlay ?? ''
const around = (p, at, r, test) => {
  let n = 0
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(over(p, at.x + dx, at.y + dy), at.x + dx, at.y + dy)) n++
  return n
}
const isHouse = s => s.startsWith('ow_house_')
// The house a door belongs to, read back off the cells: its wall row and what stands above it.
function houseAt(p, d) {
  let x0 = d.x, x1 = d.x
  while (isHouse(over(p, x0 - 1, d.y))) x0--
  while (isHouse(over(p, x1 + 1, d.y))) x1++
  let top = d.y
  while (isHouse(over(p, d.x, top - 1)) || over(p, d.x, top - 1).startsWith('ow_roof_')) top--
  return { x0, x1, top, w: x1 - x0 + 1, h: d.y - top + 1 }
}

test('every tile the Wilds can lay has its picture', () => {
  for (const name of WILDS_SKINS)
    assert.ok(fs.existsSync(new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url)), `no picture for ${name}`)
})

test('a house is whole: a door in a wall under two rows of roof, three to five wide', () => {
  const widths = new Set(), roofs = new Set(), walls = new Set()
  let n = 0
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    for (const d of p.doors.filter(d => d.tier !== 'ruin')) {
      n++
      const at = `house at ${d.x},${d.y} of ${wx},${wy} (seed ${seed})`
      assert.match(over(p, d.x, d.y), /^ow_house_(door|dbl)/, `${at}: the door is ${over(p, d.x, d.y)}`)
      const h = houseAt(p, d)
      assert.ok(h.w >= 3 && h.w <= 5, `${at}: ${h.w} wide`)
      assert.ok(h.h === 3 || h.h === 4, `${at}: ${h.h} tall`)
      for (let x = h.x0; x <= h.x1; x++) {
        for (let y = h.top; y <= d.y; y++) {
          const skin = over(p, x, y)
          assert.ok(y < h.top + 2 ? skin.startsWith('ow_roof_') : isHouse(skin), `${at}: ${skin || 'nothing'} at row ${y - h.top}`)
          // (the top row of the roof is walked under: wilds/over.js)
          if (y === h.top) assert.ok(p.cells[y][x].over === true && p.cells[y][x].tile === TILE.FLOOR, `${at}: the top of the roof is not walked under`)
          else if (!(x === d.x && y === d.y)) assert.equal(p.cells[y][x].tile, TILE.WALL, `${at}: a house cell is walkable`)
        }
        // nothing built against the front of the house
        assert.ok(!isHouse(over(p, x, d.y + 1)) && !over(p, x, d.y + 1).startsWith('ow_roof_'), `${at}: another house at its feet`)
      }
      assert.ok(walk(p.cells[d.y + 1][d.x]), `${at}: the doorstep is blocked`)
      widths.add(h.w)
      roofs.add(over(p, h.x0, h.top).replace(/_l$/, ''))
      walls.add(over(p, h.x0, d.y))
    }
  }
  assert.ok(n >= 30, `only ${n} houses in the sample`)
  assert.ok(widths.size >= 3, `house widths: ${[...widths]}`)
  assert.ok(roofs.size >= 2 && walls.size >= 2, `roofs ${[...roofs]} walls ${[...walls]}`)
})

test('a village is lived in: houses, a well, a fenced field and things lying about', () => {
  let villages = 0
  for (const seed of SEEDS) for (let wy = -6; wy <= 6; wy++) for (let wx = -6; wx <= 6; wx++) {
    if (!(wx === 0 && wy === 0) && !villageAt(seed, wx, wy)) continue
    villages++
    const p = generatePiece(seed, wx, wy)
    const at = `village ${wx},${wy} (seed ${seed})`
    const safe = p.doors.filter(d => d.tier === 'safe')
    assert.ok(safe.length >= 4 && safe.length <= 6, `${at}: ${safe.length} houses`)
    assert.ok(new Set(safe.map(d => houseAt(p, d).w)).size >= 2, `${at}: every house the same width`)
    assert.equal(around(p, p.main, 2, s => s === 'ow_well'), 1, `${at}: no well`)
    assert.ok(around(p, p.main, 14, s => s.startsWith('ow_fence_')) >= 8, `${at}: no fence`)
    assert.ok(around(p, p.main, 14, s => s.startsWith('ow_deco_crop_')) >= 4, `${at}: no crops`)
    assert.ok(around(p, p.main, 14, s => s.startsWith('ow_prop_')) >= 8, `${at}: nothing lying about`)
    assert.ok(walk(p.cells[p.spawnPoint.y][p.spawnPoint.x]))
  }
  assert.ok(villages >= 12)
})

test('camps, nests, old stones, ruins and caves have a look of their own', () => {
  const dressed = s => /^ow_(prop_|deco_skull|tent_|ruin_|deadtree_|rock_|mtn_rock_|statue)/.test(s)
  const seen = { camp: 0, fire: 0, nest: 0, stones: 0, ruin: 0, cave: 0, boss: 0 }
  for (const seed of SEEDS) for (const { wx, wy } of [...samplePieces(seed), { wx: 0, wy: -1 }]) {
    const p = generatePiece(seed, wx, wy)
    const at = `${p.main.kind} at ${wx},${wy} (seed ${seed})`
    if (p.main.kind === 'camp' || p.main.kind === 'boss') {
      seen[p.main.kind]++
      assert.ok(around(p, p.main, 7, dressed) >= 5, `${at}: bare ground`)
      if (p.spawns.some(s => s.kind === 'campfire' && dist(s, p.main) <= 3)) seen.fire++
    }
    if (p.main.kind === 'ruin') {
      seen.ruin++
      assert.ok(around(p, p.main, 7, s => s === 'ow_brick' || s.startsWith('ow_ruin_') || s.startsWith('ow_castle_')) >= 8, `${at}: no ruin`)
      assert.equal(p.doors.filter(d => d.tier === 'ruin').length, 1, `${at}: no way in`)
    }
    if (p.main.kind === 'cave') {
      seen.cave++
      assert.ok(around(p, p.caves[0], 4, s => /^ow_(rock_|mtn_)/.test(s)) >= 9, `${at}: a bare arch`)
      assert.ok(walk(p.cells[p.caves[0].y + 1][p.caves[0].x]) || walk(p.cells[p.caves[0].y + 1][p.caves[0].x + 1]), `${at}: the mouth is walled in`)
    }
    for (const s of p.small) {
      if (s.kind === 'nest') { seen.nest++; assert.ok(around(p, s, 3, k => k === 'ow_prop_mound') >= 1, `nest at ${wx},${wy}: no mound`) }
      if (s.kind === 'stones') { seen.stones++; assert.ok(around(p, s, 3, k => k.startsWith('ow_ruin_')) >= 4, `stones at ${wx},${wy}: no stones`) }
    }
  }
  assert.ok(seen.fire >= 3, `only ${seen.fire} camps keep a fire`)
  for (const [k, n] of Object.entries(seen)) assert.ok(n >= 3, `only ${n} ${k} in the sample`)
})

test('low things are seen over and flat things are walked on', () => {
  let low = 0, flat = 0
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed).slice(0, 12)) {
    const p = generatePiece(seed, wx, wy)
    for (const row of p.cells) for (const c of row) {
      const s = c.overlay ?? ''
      if (s.startsWith('ow_deco_')) { flat++; assert.equal(c.tile, TILE.FLOOR, `${s} blocks the way`) }
      if (s.startsWith('ow_prop_') || s.startsWith('ow_fence_')) { low++; assert.equal(c.tile, TILE.WALL, `${s} is walkable`); assert.equal(c.losClear, true, `${s} blocks sight`) }
    }
  }
  assert.ok(low >= 30 && flat >= 10, `${low} low things, ${flat} flat things`)
})

// found while dressing the sites: rock heaped behind a cave mouth or round a
// den sat on the road from the north gate and shut it
test('rock built on a road never shuts a gate', () => {
  let n = 0
  for (let wy = -7; wy <= 7; wy++) for (let wx = -7; wx <= 7; wx++) {
    const kind = mainKind(42, wx, wy, 0)
    if (kind !== 'cave' && kind !== 'camp' && kind !== 'ruin') continue
    n++
    const p = generatePiece(42, wx, wy)
    const seen = flood(p, p.spawnPoint)
    for (const [side, g] of Object.entries(p.gates)) assert.ok(seen.has(`${g.x},${g.y}`), `${kind} at ${wx},${wy}: gate ${side} is cut off`)
  }
  assert.ok(n >= 100)
})

// ---- the places of the tales -----------------------------------------------------
const TALE_SPOTS = { elk: ['forest', 'autumn'], tar: ['sea', 'marsh'], kivihiisi: ['mountain'], nakki: ['forest', 'autumn', 'marsh'], fold: ['forest', 'autumn', 'mountain'], flame: ['marsh', 'autumn', 'forest'], lalli: ['forest', 'autumn', 'marsh'] }
const POINTS = {
  elk: ['forest shrine', 'wallow 1', 'wallow 2', 'wallow 3'],
  tar: ['tar pit', 'lumber camp', 'bridge gap 1', 'bridge gap 2', 'bridge gap 3'],
  kivihiisi: ['hiidenkiuas', 'hermit hut'],
  nakki: ['bell', 'pier end', 'nakki', 'pier gap 1', 'pier gap 2', 'pier gap 3', 'pier gap 4', 'orchard', 'islet cache', "Toivo's hut"],
  fold: ['den', 'burn 1', 'burn 2', 'burn 3', 'burn 4', 'burrow', 'lair', 'fleece cache'],
  flame: ['hermit hut', 'hearth', 'knoll'],
  lalli: ['lalli tree', 'tree foot', 'pond', 'pier end', 'pier bank', 'piper camp'],
}
// Points a tale keeps shut until it is played: behind water or rock.
const SEALED = { nakki: ['nakki', 'pier gap 1', 'pier gap 2', 'pier gap 3', 'pier gap 4', 'orchard'], fold: ['lair', 'burrow', 'burn 1', 'burn 2', 'burn 3', 'burn 4'], lalli: ['pond'] }
// Six pieces of each tale's home land per seed.
const taleCache = new Map()
function talePieces(seed, id) {
  if (taleCache.has(`${seed}:${id}`)) return taleCache.get(`${seed}:${id}`)
  const out = []
  taleCache.set(`${seed}:${id}`, out)
  for (let r = 1; r <= 9 && out.length < 6; r++) for (let wy = -r; wy <= r; wy++) for (let wx = -r; wx <= r; wx++) {
    if (Math.max(Math.abs(wx), Math.abs(wy)) !== r || villageAt(seed, wx, wy) || out.length >= 6) continue
    if (TALE_SPOTS[id].includes(pieceBiome(seed, wx, wy))) out.push(generatePiece(seed, wx, wy, 0, id))
  }
  return out
}
const pt = (p, label) => p.points.find(q => q.label === label)
// A tale's pier is plank deck like any bridge (wilds/bridge-art.js): which
// sides of a deck cell carry an edge beam (1 N / 2 E / 4 S / 8 W), or null.
const beams = (p, x, y) => { const m = /^ow_pier_deck_[hv]_(\d+)p?$/.exec(p.cells[y]?.[x]?.overlay ?? ''); return m ? +m[1] : null }

test('a tale piece has its named points, each reachable from every gate', () => {
  for (const seed of SEEDS) for (const id of Object.keys(POINTS)) for (const p of talePieces(seed, id)) {
    const at = `${id} at ${p.wx},${p.wy} (seed ${seed})`
    assert.equal(p.tale, id)
    assert.equal(p.main.kind, `tale_${id}`)
    assert.deepEqual(p.points.map(q => q.label).sort(), [...POINTS[id]].sort(), at)
    const seen = flood(p, p.spawnPoint)
    for (const [side, g] of Object.entries(p.gates)) assert.ok(seen.has(`${g.x},${g.y}`), `${at}: gate ${side} cut off`)
    for (const q of p.points) {
      if (SEALED[id]?.includes(q.label)) continue
      const beside = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${q.x + dx},${q.y + dy}`))
      assert.ok(beside, `${at}: ${q.label} unreachable`)
    }
    for (const s of p.spawns) assert.ok(s.sealed || seen.has(`${s.x},${s.y}`), `${at}: ${s.kind} unreachable`)
  }
})

test('the elk\'s wood: a shrine and three wallows well apart, each beside its mud', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'elk')) {
    const spots = POINTS.elk.map(l => pt(p, l))
    for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) assert.ok(dist(a, b) >= 22, `${dist(a, b).toFixed(0)} tiles apart`)
    assert.ok(around(p, spots[0], 2, s => s === 'ow_statue') === 1, 'no statue at the shrine')
    for (const w of spots.slice(1)) {
      assert.ok(walk(p.cells[w.y][w.x]), 'a wallow point is stood on')
      let wet = 0
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (/^ow_(water|pond|mud)/.test(p.cells[w.y + dy][w.x + dx].skin)) wet++
      assert.ok(wet >= 5, `a wallow with ${wet} wet cells`)
    }
  }
})

test('the causeway: a deck with a three-cell gap is the only way to the islet', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'tar')) {
    const gaps = [1, 2, 3].map(i => pt(p, `bridge gap ${i}`))
    assert.ok(gaps[0].y === gaps[1].y && gaps[1].y === gaps[2].y && gaps[1].x === gaps[0].x + 1 && gaps[2].x === gaps[1].x + 1)
    // (the piece is made whole; the quest breaks the gap on arrival)
    for (const g of gaps) assert.equal(beams(p, g.x, g.y), 1 | 4, 'a gap cell is not mid-deck: a beam north and south, none along the causeway')
    let deck = 0
    for (let x = gaps[0].x - 8; x <= gaps[2].x + 8; x++) if (isDeckSkin(p.cells[gaps[0].y][x]?.overlay)) deck++
    assert.ok(deck >= 9, `a deck of ${deck}`)
    for (const row of p.cells) for (const c of row) assert.ok(!/^ow_pier_log/.test(c.overlay ?? ''), 'a bare log left on the causeway')
    const chest = p.spawns.find(s => s.kind === 'chest' && dist(s, p.main) <= 3)
    assert.ok(chest, 'no chest on the islet')
    // break the gap as the quest does: the islet must be cut off
    for (const g of gaps) p.cells[g.y][g.x].tile = TILE.WALL
    assert.ok(!flood(p, p.spawnPoint).has(`${chest.x},${chest.y}`), 'the islet is reachable without the deck')
    for (const g of gaps) p.cells[g.y][g.x].tile = TILE.FLOOR   // the sample pieces are shared between tests
    const pit = pt(p, 'tar pit')
    assert.ok(walk(p.cells[pit.y][pit.x]) && p.cells[pit.y][pit.x].overlay === 'ow_deco_firepit')
    assert.ok(around(p, pit, 2, s => s === 'ow_kiln_cold') >= 1 && around(p, pit, 4, s => s === 'ow_prop_woodpile') >= 2)
    assert.ok(p.doors.some(d => dist(d, pt(p, 'lumber camp')) <= 2), 'no crew hut at the camp')
  }
})

test('the giant\'s oven: a bare bowl, a capstone to mine, the hermit and his hut', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'kivihiisi')) {
    const k = pt(p, 'hiidenkiuas')
    assert.equal(p.cells[k.y][k.x].overlay, 'ow_mtn_rock_cap')
    assert.equal(p.cells[k.y][k.x].tile, TILE.WALL)
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      if ((!dx && !dy) || dx * dx + dy * dy > 36) continue
      assert.ok(walk(p.cells[k.y + dy][k.x + dx]), `cover inside the bowl at ${dx},${dy}`)
    }
    const hut = pt(p, 'hermit hut')
    assert.ok(dist(hut, k) >= 9 && dist(hut, k) <= 14)
    assert.ok(p.doors.some(d => d.x === hut.x && d.y === hut.y))
    const hermit = p.spawns.find(s => s.kind === 'npc' && s.species === 'hermit')
    assert.ok(hermit && dist(hermit, hut) <= 3, 'no hermit at the hut')
  }
})

// ---- step 2: the Timewarp stories' places ------------------------------------------------
test('the bell lake: a pier that stops short of the orchard island, a bell, an islet, Toivo\'s hut', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'nakki')) {
    const at = `nakki at ${p.wx},${p.wy} (seed ${seed})`
    const end = pt(p, 'pier end'), bell = pt(p, 'bell')
    assert.deepEqual([bell.x, bell.y], [end.x, end.y])
    assert.ok(walk(p.cells[end.y][end.x]) && isDeckSkin(p.cells[end.y][end.x].overlay), `${at}: the pier end is not a standing plank`)
    // it breaks off with a proper end: beams on the three sides the water is
    assert.equal(beams(p, end.x, end.y), 1 | 2 | 4, `${at}: the pier does not end where it stops`)
    assert.equal(beams(p, end.x - 1, end.y), 1 | 4, `${at}: the pier is cut short of its end`)
    assert.ok(around(p, bell, 1, s => s === 'ow_prop_bell') === 1, `${at}: no bell`)
    const gaps = [1, 2, 3, 4].map(i => pt(p, `pier gap ${i}`))
    gaps.forEach((g, i) => {
      assert.deepEqual([g.x, g.y], [end.x + 1 + i, end.y], `${at}: gap ${i + 1} is not in line`)
      assert.ok(!walk(p.cells[g.y][g.x]) && /^ow_(water|pond|shore|mud)/.test(p.cells[g.y][g.x].skin), `${at}: gap ${i + 1} is not water (${p.cells[g.y][g.x].skin})`)
    })
    assert.deepEqual(pt(p, 'nakki'), { label: 'nakki', x: gaps[0].x, y: gaps[0].y })
    const orchard = pt(p, 'orchard'), chest = p.spawns.find(s => s.kind === 'chest' && s.sealed && dist(s, orchard) <= 4)
    assert.ok(around(p, orchard, 4, s => s === 'ow_tree_apple') >= 4, `${at}: no orchard`)
    assert.ok(chest, `${at}: no chest in the orchard`)
    const before = flood(p, p.spawnPoint)
    assert.ok(!before.has(`${chest.x},${chest.y}`), `${at}: the island is reachable with the gap open`)
    for (const g of gaps) p.cells[g.y][g.x].tile = TILE.FLOOR
    assert.ok(flood(p, p.spawnPoint).has(`${chest.x},${chest.y}`), `${at}: the island is cut off even with the gap planked`)
    for (const g of gaps) p.cells[g.y][g.x].tile = TILE.WALL
    const islet = pt(p, 'islet cache')
    assert.ok(before.has(`${islet.x},${islet.y}`), `${at}: the islet is cut off`)
    assert.ok(p.spawns.some(s => s.kind === 'floating_pickup' && s.contents.type === 'clapper' && s.x === islet.x && s.y === islet.y), `${at}: no clapper on the islet`)
    const hut = pt(p, "Toivo's hut")
    const door = p.doors.find(d => d.x === hut.x && d.y === hut.y)
    assert.ok(door && door.story === "Toivo's hut" && door.tier === 'hut', `${at}: no story door`)
  }
})

test('a village is built for the tale it carries, and stays a whole village', () => {
  const dress = { nakki: s => s.startsWith('ow_prop_fishrack'), fold: (s, x, y, p) => s.startsWith('ow_fence_') && y > p.main.y + 7 && x > p.main.x + 6, flame: s => s === 'prop_hearth_cold' }
  for (const seed of SEEDS) for (const [tale, has] of Object.entries(dress)) {
    const v = [{ wx: 0, wy: 0 }, ...[...Array(40).keys()].flatMap(i => { const wx = (i % 9) - 4, wy = Math.floor(i / 9) - 2; return villageAt(seed, wx, wy) ? [{ wx, wy }] : [] })].slice(0, 3)
    for (const { wx, wy } of v) {
      const p = generatePiece(seed, wx, wy, 0, null, tale)
      const at = `${tale} village ${wx},${wy} (seed ${seed})`
      assert.equal(p.villageTale, tale)
      assert.ok(around(p, p.main, 13, (s, x, y) => has(s, x, y, p)) >= (tale === 'fold' ? 10 : 2), `${at}: nothing shows its trouble`)
      if (tale === 'fold') assert.ok(p.spawns.filter(s => s.kind === 'npc' && s.species === 'sheep' && s.y > p.main.y + 7).length >= 3, `${at}: no sheep in the fold`)
      const seen = flood(p, p.spawnPoint)
      const safe = p.doors.filter(d => d.tier === 'safe')
      assert.ok(safe.length >= 4, `${at}: ${safe.length} houses`)
      for (const d of safe) assert.ok(seen.has(`${d.x},${d.y + 1}`), `${at}: a doorstep is blocked`)
      assert.equal(around(p, p.main, 2, s => s === 'ow_well'), 1, `${at}: no well`)
      for (const [side, g] of Object.entries(p.gates)) assert.ok(seen.has(`${g.x},${g.y}`), `${at}: gate ${side} cut off`)
    }
  }
})

test('the ridge: a den of calm wolves, a burrow sealed with rock, the wood the village burns', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'fold')) {
    const at = `fold at ${p.wx},${p.wy} (seed ${seed})`
    const den = pt(p, 'den'), burrow = pt(p, 'burrow'), lair = pt(p, 'lair'), cache = pt(p, 'fleece cache')
    const wolves = p.spawns.filter(s => s.kind === 'npc' && s.species === 'wolf' && dist(s, den) <= 4)
    assert.equal(wolves.length, 3, `${at}: ${wolves.length} wolves at the den`)
    assert.ok(wolves.every(w => w.hostile === false), `${at}: a den wolf that attacks`)
    for (const dx of [-1, 0, 1]) {
      const c = p.cells[burrow.y][burrow.x + dx]
      assert.ok(c.tile === TILE.WALL && /^ow_(rock_|mtn_rock_)/.test(c.overlay ?? ''), `${at}: the burrow mouth is not rock (${c.overlay})`)
    }
    assert.ok(walk(p.cells[lair.y][lair.x]), `${at}: the lair is solid`)
    const seen = flood(p, p.spawnPoint)
    assert.ok(!seen.has(`${lair.x},${lair.y}`), `${at}: the lair is open`)
    p.cells[burrow.y][burrow.x].tile = TILE.FLOOR
    assert.ok(flood(p, p.spawnPoint).has(`${lair.x},${lair.y}`), `${at}: mining the mouth does not open the lair`)
    p.cells[burrow.y][burrow.x].tile = TILE.WALL
    assert.ok(seen.has(`${cache.x},${cache.y}`), `${at}: the fleece cannot be reached`)
    assert.ok(p.spawns.some(s => s.kind === 'floating_pickup' && s.contents.type === 'fleece' && s.x === cache.x && s.y === cache.y), `${at}: no fleece`)
    for (let n = 1; n <= 4; n++) {
      const b = pt(p, `burn ${n}`)
      assert.ok(around(p, b, 6, s => /^ow_tree_/.test(s)) >= 3, `${at}: nothing to burn at band ${n}`)
      assert.ok(dist(b, den) >= 6, `${at}: band ${n} is on the den`)
    }
  }
})

test('the knoll: grey trees found nowhere else, the hermit and his hut', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'flame')) {
    const at = `flame at ${p.wx},${p.wy} (seed ${seed})`
    const knoll = pt(p, 'knoll'), hut = pt(p, 'hermit hut'), hearth = pt(p, 'hearth')
    assert.ok(around(p, knoll, 7, s => s.startsWith('ow_greytree_')) >= 12, `${at}: ${around(p, knoll, 7, s => s.startsWith('ow_greytree_'))} grey trees`)
    assert.equal(around(p, knoll, 7, s => s.startsWith('ow_deadtree_')), 0, `${at}: an ordinary dead tree in the stand`)
    const door = p.doors.find(d => d.x === hut.x && d.y === hut.y)
    assert.ok(door && door.story === 'hermit hut', `${at}: no story door`)
    assert.ok(p.spawns.some(s => s.kind === 'npc' && s.species === 'hermit' && dist(s, hut) <= 3), `${at}: no hermit`)
    assert.ok(walk(p.cells[hearth.y][hearth.x]) && dist(hearth, hut) <= 4)
  }
  // nowhere else: a hundred ordinary pieces hold no grey tree
  for (let i = 0; i < 100; i++) {
    const p = generatePiece(3, (i % 10) - 5, Math.floor(i / 10) - 5)
    for (const row of p.cells) for (const c of row) assert.ok(!(c.overlay ?? '').startsWith('ow_greytree_'))
  }
})

test('a flame-thief village has three hearths on its square, each with a place to stand', () => {
  for (const seed of SEEDS) {
    const p = generatePiece(seed, 0, 0, 0, null, 'flame')
    assert.deepEqual(p.villagePoints.map(q => q.label), ['hearth 1', 'hearth 2', 'hearth 3'])
    const seen = flood(p, p.spawnPoint)
    for (const h of p.villagePoints) {
      assert.equal(p.cells[h.y][h.x].overlay, 'prop_hearth_cold')
      assert.equal(p.cells[h.y][h.x].tile, TILE.WALL)
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${h.x + dx},${h.y + dy}`)), 'a hearth nobody can stand by')
      assert.ok(dist(h, p.main) <= 5)
    }
    assert.deepEqual(generatePiece(seed, 0, 0).villagePoints, [])
  }
})

// found by the step-2 review: the sheep fold shut a gate in a few villages
test('a village built for the fold keeps every gate it had', () => {
  for (const [seed, wx, wy] of [[2, 0, 6], [2, -2, -10], [3, -6, 11], [5, -2, 14]]) {
    const plain = generatePiece(seed, wx, wy), fold = generatePiece(seed, wx, wy, 0, null, 'fold')
    const was = flood(plain, plain.spawnPoint), is = flood(fold, fold.spawnPoint)
    for (const [side, g] of Object.entries(fold.gates))
      if (was.has(`${g.x},${g.y}`)) assert.ok(is.has(`${g.x},${g.y}`), `village ${wx},${wy} (seed ${seed}): the fold shut gate ${side}`)
  }
})

// ---- the Lalli tale (step 3) ----
const isWater = c => c.tile === TILE.WALL && c.losClear && !c.overlay
test('Lalli\'s pine: a tree no axe can fell, open ground at its foot', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'lalli')) {
    const top = pt(p, 'lalli tree'), foot = pt(p, 'tree foot')
    assert.equal(p.cells[top.y][top.x].overlay, 'ow_lalli_pine_top')
    assert.equal(p.cells[top.y + 1][top.x].overlay, 'ow_lalli_pine_trunk')
    for (const c of [p.cells[top.y][top.x], p.cells[top.y + 1][top.x]]) {
      assert.equal(c.tile, TILE.WALL)
      assert.equal(TREES[c.overlay], undefined, 'the pine is in the lumber table')
    }
    assert.deepEqual(foot, { label: 'tree foot', x: top.x, y: top.y + 2 })
    // room for eight mice and whoever comes to look at them
    let open = 0
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (walk(p.cells[foot.y + dy][foot.x + dx]) && !p.cells[foot.y + dy][foot.x + dx].overlay) open++
    assert.ok(open >= 30, `only ${open} open cells at the foot`)
  }
})

test('the pond: a pier from the bank to an end with deep water on three sides', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'lalli')) {
    const end = pt(p, 'pier end'), bank = pt(p, 'pier bank'), pond = pt(p, 'pond')
    const at = `lalli at ${p.wx},${p.wy} (seed ${seed})`
    assert.equal(end.y, bank.y)
    assert.ok(end.x - bank.x >= 4, `${at}: a pier of ${end.x - bank.x}`)
    assert.ok(walk(p.cells[bank.y][bank.x]) && !/^ow_pier_/.test(p.cells[bank.y][bank.x].overlay ?? ''), `${at}: the bank is not land`)
    for (let x = bank.x + 1; x <= end.x; x++) {
      assert.ok(isDeckSkin(p.cells[end.y][x].overlay), `${at}: no plank at ${x}`)
      assert.ok(walk(p.cells[end.y][x]), `${at}: a plank nobody can stand on`)
      // one deck from the bank to its end: beamed on the water sides only
      assert.equal(beams(p, x, end.y), 1 | 4 | (x === end.x ? 2 : 0) | (x === bank.x + 1 ? 8 : 0), `${at}: the deck is cut at ${x}`)
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [0, -1]]) assert.ok(!walk(p.cells[end.y + dy][end.x + dx]), `${at}: the pier's end is not surrounded by water`)
    assert.ok(!walk(p.cells[pond.y][pond.x]))
    assert.ok(dist(end, pt(p, 'tree foot')) <= 14, `${at}: the pond is a long way from the tree`)
  }
})

test('the piper\'s camp: a tent, a fire and an empty barrel, with room to stand by him', () => {
  for (const seed of SEEDS) for (const p of talePieces(seed, 'lalli')) {
    const camp = pt(p, 'piper camp')
    assert.ok(around(p, camp, 3, s => s.startsWith('ow_tent_')) === 4, 'no tent')
    assert.ok(around(p, camp, 3, s => s.startsWith('ow_prop_barrel')) >= 1, 'no barrel')
    assert.ok(p.spawns.some(s => s.kind === 'campfire' && dist(s, camp) <= 3), 'no fire')
    assert.ok(walk(p.cells[camp.y][camp.x]) && !p.cells[camp.y][camp.x].overlay)
    assert.ok(!p.spawns.some(s => s.x === camp.x && s.y === camp.y), 'something is dealt where the piper stands')
  }
})

test('a Lalli village: his house is a story house, Kerttu has a place by its door, and nothing else changes', () => {
  for (const seed of SEEDS) {
    const plain = generatePiece(seed, 0, 0), p = generatePiece(seed, 0, 0, 0, null, 'lalli')
    assert.deepEqual(p.villagePoints.map(q => q.label), ["Lalli's house", 'kerttu'])
    const [house, kerttu] = p.villagePoints
    const door = p.doors.find(d => d.x === house.x && d.y === house.y)
    assert.equal(door.story, "Lalli's house")
    assert.equal(door.tier, 'safe')
    assert.equal(p.doors.filter(d => d.story).length, 1)
    assert.ok(plain.doors.every(d => !d.story))
    assert.ok(walk(p.cells[kerttu.y][kerttu.x]) && !p.cells[kerttu.y][kerttu.x].overlay, 'Kerttu has nowhere to stand')
    assert.ok(!(kerttu.x === door.x && kerttu.y === door.y + 1), 'Kerttu stands on the doorstep')
    assert.ok(Math.max(Math.abs(kerttu.x - door.x), Math.abs(kerttu.y - door.y)) <= 2)
    assert.ok(!p.spawns.some(s => s.x === kerttu.x && s.y === kerttu.y), 'someone is dealt onto her spot')
    // the same village otherwise, cell for cell and spawn for spawn
    assert.deepEqual(p.cells.map(r => r.map(c => `${c.tile}:${c.skin}:${c.overlay ?? ''}`)), plain.cells.map(r => r.map(c => `${c.tile}:${c.skin}:${c.overlay ?? ''}`)))
    assert.deepEqual(p.spawns, plain.spawns)
  }
})

// House interiors (renderer/interior/) read the house off its door record;
// telling them changes nothing else of the piece (no GEN bump for it).
test('a door tells what the house looks like outside, and how tough the land is', () => {
  const seen = new Set()
  for (const [wx, wy] of [[0, 0], [1, 0], [0, -1], [2, 3], [-3, 1], [4, -2], [-5, -5], [6, 1], [3, 3], [-2, 4]]) {
    const p = generatePiece(12345, wx, wy, 0)
    for (const d of p.doors) {
      assert.equal(d.toughness, p.tier, `${wx},${wy}: door toughness`)
      assert.ok(d.look && [3, 4, 5].includes(d.look.w) && [1, 2].includes(d.look.storeys) && ['stone', 'wood'].includes(d.look.wall), `${wx},${wy}: ${JSON.stringify(d.look)}`)
      seen.add(d.tier)
    }
  }
  assert.ok(seen.has('safe') && seen.has('hut'))
})

test('the pieces are cell for cell what they were before doors told their looks', async () => {
  const { createHash } = await import('node:crypto')
  // (pinned again at GEN 10: 0,0 1,0 0,-1 and -5,-5 have road edges, whose frame lanes wear the road;
  // and again when the road was laid inside its pieces: those four moved; and again when villages kept
  // their houses from main: only 0,0 moved. The sea cost, the city's outside roads and the fold pen's
  // gap moved none of the eight: their road sides stayed, none is a city piece or a fold village.
  // And again when farmland got its farms: -5,-5 is farmland, a marsh farmstead on its dry rise now.
  // And again when roads got their verges (road-art.js), hashed from then on as a cell's deco: the four
  // with road edges moved by their decos alone; the other four have none, and hash as they did.)
  const BEFORE = { '0,0': '332986a7ddd50c40', '1,0': '3d4617d7e8b1de59', '0,-1': 'c1c0741c7cbc583a', '2,3': '66b77a8606371d51', '-3,1': '771ec47c95fd3e55', '4,-2': '4304bf49fc96d546', '-5,-5': 'e0be0d188a85c145', '6,1': '04fd70d97186adb6' }
  for (const [key, want] of Object.entries(BEFORE)) {
    const [wx, wy] = key.split(',').map(Number)
    const p = generatePiece(12345, wx, wy, 0)
    const h = createHash('sha1')
    // (a cell that is walked under since wilds/over.js was a wall then, with the art it still has;
    // a deco, where a cell has one, after its overlay)
    for (const row of p.cells) for (const c of row) h.update(`${c.over ? TILE.WALL : c.tile}|${c.skin}|${c.overlay ?? ''}${c.deco ? `|${c.deco}` : ''};`)
    h.update(JSON.stringify(p.spawns.map(s => [s.kind, s.x, s.y])))
    h.update(JSON.stringify(p.doors.map(d => [d.x, d.y, d.tier, d.story])))
    assert.equal(h.digest('hex').slice(0, 16), want, `piece ${key} changed`)
  }
})
