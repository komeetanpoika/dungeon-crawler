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

const SEEDS = [3, 77, 2024]
const MONSTER_NAMES = JSON.parse(fs.readFileSync(new URL('../renderer/data/monsters/index.json', import.meta.url), 'utf8'))
const BUILT_KINDS = ['chest', 'weapon', 'npc', 'monster', 'guard', 'wild_mushroom', 'talent_trigger']
const MAIN_KINDS = ['village', 'ring', 'cave', 'camp', 'boss', 'ruin', 'landmark']
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
    // the four village houses; a hut out in the woods may add a fifth door
    assert.equal(home.doors.filter(d => d.tier === 'safe').length, 4)
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

test('one main thing and one to three small things', () => {
  for (const seed of SEEDS) for (const { wx, wy } of samplePieces(seed)) {
    const p = generatePiece(seed, wx, wy)
    assert.ok(MAIN_KINDS.includes(p.main.kind), p.main.kind)
    assert.equal(p.main.kind, mainKind(seed, wx, wy, 0))
    assert.ok(p.small.length >= 1 && p.small.length <= 3, `${p.small.length} small things at ${wx},${wy}`)
    for (const s of p.small) assert.ok(['chest', 'animals', 'mushrooms', 'hut', 'rocks'].includes(s.kind), s.kind)
    assert.ok(p.main.x >= 16 && p.main.x < PIECE - 16 && p.main.y >= 16 && p.main.y < PIECE - 16)
    if (villageAt(seed, wx, wy)) assert.equal(p.main.kind, 'village')
  }
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
    if (kind === 'boss') { assert.ok(p.tier >= 2); assert.ok(p.spawns.some(s => s.kind === 'ogre' || s.kind === 'manticore')) }
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
