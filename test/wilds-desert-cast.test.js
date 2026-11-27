// The desert's own creatures in the Wilds' dealing (renderer/wilds/
// desert-cast.js, features.js): on desert country the roaming packs, a camp's
// garrison, a nest's and old stones' guards and the stray wolves come from
// the desert's tables; everywhere else nothing changes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generatePiece } from '../renderer/wilds/piece.js'
import { PIECE, pieceBiome, biomeAt } from '../renderer/wilds/layout.js'
import { pieceClass } from '../renderer/wilds/roads.js'
import { GEN } from '../renderer/wilds/world.js'
import { TILE } from '../renderer/systems/entities.js'
import { isLooseSkin } from '../renderer/wilds/sand.js'
import { DUNE_PREFIX } from '../renderer/wilds/desert.js'
import { DESERT_PACKS, DESERT_CAMPS, DESERT_RARE, isGentle, isBound, setDesertCast, desertCast, WORM_KEEP, PIT_ROOM } from '../renderer/wilds/desert-cast.js'

const SEED = 7
const without = fn => { setDesertCast(false); try { return fn() } finally { setDesertCast(true) } }
const DESERT_KINDS = new Set(['skorpioni', 'keisariskorpioni', 'hiekkamato', 'kuoppaleuka'])
const isDesertFoe = s => DESERT_KINDS.has(s.kind) || (s.kind === 'npc' && s.species === 'jackal')
const isForestFoe = s => s.kind === 'monster' || (s.kind === 'npc' && (s.species === 'wolf' || s.species === 'bear'))
// is there country `want` (or, with `not`, any other) within r tiles of a spawn?
const near = (p, s, r, test) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(biomeAt(SEED, p.wx * PIECE + s.x + dx, p.wy * PIECE + s.y + dy))) return true
  return false
}

// A block that holds forest, the desert's near side and its deep: built once.
let block = null
function pieces() {
  if (block) return block
  block = []
  for (let wy = -4; wy <= 2; wy++) for (let wx = -2; wx <= 12; wx++) block.push(generatePiece(SEED, wx, wy, 0))
  return block
}

test('GEN is bumped: the spawn lists of desert pieces changed', () => assert.equal(GEN, 12))

test('the tables: every row has a gentle pack, and what is bound to the sand is marked', () => {
  assert.equal(desertCast(), true)
  assert.equal(DESERT_PACKS.length, 5)
  for (const [i, row] of DESERT_PACKS.entries()) {
    assert.ok(row.some(isGentle), `row ${i} has a pack of small scorpions`)
    assert.ok(row.filter(p => !DESERT_RARE.has(p)).some(p => !isBound(p)), `row ${i} has a pack to post on a path`)
    for (const p of row) assert.ok(p.length >= 1 && p.length <= 4)
  }
  assert.equal(isGentle([{ kind: 'keisariskorpioni' }]), false)
  assert.equal(isBound([{ kind: 'hiekkamato' }]), true)
  assert.equal(isBound([{ kind: 'kuoppaleuka' }]), true)
  assert.ok(DESERT_PACKS[0].every(p => !isBound(p)) && DESERT_PACKS[1].every(p => !isBound(p)), 'no worm or antlion near home')
  // an antlion is always alone
  for (const row of DESERT_PACKS) for (const p of row) if (p.some(f => f.kind === 'kuoppaleuka')) assert.equal(p.length, 1)
  // a camp for every toughness, by the rule features.js picks with
  for (let tier = 1; tier <= 4; tier++) assert.ok(DESERT_CAMPS.some(c => c.from <= tier && c.from >= tier - 2), `a camp at ${tier}`)
  for (const c of DESERT_CAMPS) assert.ok(['den', 'nest', 'bandits', 'graves'].includes(c.look) && c.foes.length > (c.lead ?? 0))
})

test('desert creatures stand on desert country and the forest\'s off it', () => {
  let desertFoes = 0
  for (const p of pieces()) for (const s of p.spawns) {
    if (isDesertFoe(s)) { desertFoes++; assert.ok(near(p, s, 3, b => b === 'desert'), `${s.kind} ${s.species ?? ''} at ${p.key} ${s.x},${s.y} has no desert near`) }
    if (isForestFoe(s)) assert.ok(near(p, s, 3, b => b !== 'desert'), `${s.kind} ${s.species ?? s.variant ?? ''} at ${p.key} ${s.x},${s.y} stands in the desert`)
  }
  assert.ok(desertFoes > 100, `${desertFoes} desert foes in the block`)
})

test('all four kinds, and both scorpions, are met in the block', () => {
  const seen = new Set()
  for (const p of pieces()) for (const s of p.spawns) if (isDesertFoe(s)) seen.add(s.kind === 'npc' ? 'jackal' : s.kind)
  assert.deepEqual([...seen].sort(), ['hiekkamato', 'jackal', 'keisariskorpioni', 'kuoppaleuka', 'skorpioni'])
})

test('with the cast off the desert deals as it did, and off the desert nothing differs either way', () => {
  const key = p => JSON.stringify(p.spawns)
  let same = 0
  for (const p of pieces()) {
    const plain = without(() => generatePiece(SEED, p.wx, p.wy, 0))
    assert.ok(!plain.spawns.some(isDesertFoe), `${p.key} deals no desert creature with the cast off`)
    if (!p.spawns.some(isDesertFoe) && !p.spawns.some(s => near(p, s, 3, b => b === 'desert'))) { assert.equal(key(p), key(plain), p.key); same++ }
  }
  assert.ok(same > 15, `${same} pieces off the desert compared`)
})

test('a village and farmland in the desert have nothing but small scorpions in the sand', () => {
  let checked = 0
  for (let wy = -8; wy <= 6 && checked < 12; wy++) for (let wx = 2; wx <= 16 && checked < 12; wx++) {
    const cls = pieceClass(SEED, wx, wy)
    if ((cls !== 'village' && cls !== 'farmland') || pieceBiome(SEED, wx, wy) !== 'desert') continue
    const p = generatePiece(SEED, wx, wy, 0)
    checked++
    for (const s of p.spawns) assert.ok(!isDesertFoe(s) || s.kind === 'skorpioni', `${cls} ${p.key}: ${s.kind} ${s.species ?? ''}`)
  }
  assert.ok(checked >= 6, `${checked} settled desert pieces`)
})

test('an antlion has its room: flat loose sand three tiles round, and nothing else dealt into it', () => {
  let pits = 0
  for (const p of pieces()) for (const s of p.spawns) {
    if (s.kind !== 'kuoppaleuka') continue
    pits++
    for (let dy = -PIT_ROOM; dy <= PIT_ROOM; dy++) for (let dx = -PIT_ROOM; dx <= PIT_ROOM; dx++) {
      const c = p.cells[s.y + dy][s.x + dx]
      assert.equal(c.tile, TILE.FLOOR, `${p.key} ${s.x + dx},${s.y + dy} is open`)
      assert.ok(isLooseSkin(c.skin) && !c.skin.startsWith(DUNE_PREFIX), `${p.key} ${s.x + dx},${s.y + dy} is flat loose sand (${c.skin})`)
      assert.ok(!c.overlay, `${p.key} ${s.x + dx},${s.y + dy} holds nothing (${c.overlay})`)
    }
    for (const o of p.spawns) if (o !== s) assert.ok(Math.max(Math.abs(o.x - s.x), Math.abs(o.y - s.y)) > PIT_ROOM, `${p.key}: ${o.kind} in the pit`)
  }
  assert.ok(pits >= 3, `${pits} antlions in the block`)
})

test('a worm keeps away from its piece\'s heart and starts in sand', () => {
  let worms = 0
  for (const p of pieces()) for (const s of p.spawns) {
    if (s.kind !== 'hiekkamato') continue
    worms++
    // (the heart is the main thing's middle, or up to six tiles from it for an inn)
    assert.ok(Math.hypot(s.x - p.main.x, s.y - p.main.y) >= WORM_KEEP - 6, `${p.key}: a worm ${Math.hypot(s.x - p.main.x, s.y - p.main.y).toFixed(1)} from the main thing`)
    assert.ok(isLooseSkin(p.cells[s.y][s.x].skin), `${p.key}: a worm on ${p.cells[s.y][s.x].skin}`)
  }
  assert.ok(worms >= 3, `${worms} worms in the block`)
})
