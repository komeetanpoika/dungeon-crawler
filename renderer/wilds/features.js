// What a Wilds piece holds: one main thing, one to three small things, and
// the paths that lead to them. Stamped onto a piece's terrain (terrain.js)
// before its art passes run.
//
// Order matters and is always the same: open the main pad, run a path from
// each gate to it, pick the small things' spots clear of those paths, run a
// trail from each to the main thing, then stamp the structures. Every
// structure sits inside its own opened pad, so a house or a pond laid over a
// path end never cuts the piece in two.
import { PIECE, FRAME, MARGIN, tierAt, pieceBiome, fixedMain, villageAt, caveDepthFor, pieceKey, BIOME_NAMES } from './layout.js'
import { hash, hashInt, mulberry32 } from './rand.js'
import { stampHouse3 } from '../terrain/lib.js'
import { stampVillage, stampCaveInRocks } from '../terrain/kit.js'

const PAD = { village: 10, ring: 6, cave: 4, camp: 6, boss: 7, ruin: 6, landmark: 7 }
const VILLAGERS = ['villager', 'villager', 'villager', 'elder', 'chicken', 'chicken', 'sheep', 'goat']
const HOUSE_SPOTS = [[-6, -4], [3, -5], [-6, 3], [4, 3]]   // kit.js stampVillage
const RUIN_BITS = ['ow_ruin_pillar', 'ow_ruin_pillar_2', 'ow_ruin_rubble', 'ow_ruin_wall_0', 'ow_ruin_wall_1', 'ow_ruin_wall_2']
const ROCKS = {
  forest: ['ow_rock_gray_moss_0', 'ow_rock_gray_moss_1', 'ow_rock_gray_moss_2'],
  desert: ['ow_rock_brown_0', 'ow_rock_brown_1', 'ow_rock_brown_2'],
  mountain: ['ow_mtn_rock_0', 'ow_mtn_rock_1', 'ow_mtn_rock_2', 'ow_mtn_rock_3', 'ow_mtn_rock_4', 'ow_mtn_rock_5'],
  other: ['ow_rock_gray_0', 'ow_rock_gray_1', 'ow_rock_gray_2'],
}
const rocksFor = biome => ROCKS[biome] ?? (biome === 'autumn' || biome === 'marsh' ? ROCKS.forest : ROCKS.other)

// Camp rosters by the lowest toughness they appear at. Each entry is a list
// of spawn makers; a camp draws its three to five foes from one roster.
const wolf = { npc: 'wolf' }, bear = { npc: 'bear' }
const spider = v => ({ kind: 'monster', variant: v })
const CAMPS = [
  { from: 1, name: 'wolves', foes: [wolf, wolf, wolf] },
  { from: 1, name: 'spiders', foes: [spider('weak'), spider('weak'), spider('medium')] },
  { from: 1, name: 'pete', foes: [{ kind: 'pullopete' }, spider('weak'), spider('weak'), spider('medium')], lead: 1 },
  { from: 2, name: 'bandits', foes: [{ kind: 'guard' }], tent: true },
  { from: 2, name: 'bones', foes: [{ kind: 'rappeluu' }, { kind: 'rappeluu' }, spider('medium')] },
  { from: 2, name: 'bears', foes: [wolf, wolf, bear], lead: 1 },
  { from: 3, name: 'hounds', foes: [{ kind: 'boarhound' }, { kind: 'boarhound' }, spider('strong')] },
  { from: 3, name: 'podeboo', foes: [{ kind: 'podeboo' }, { kind: 'rappeluu' }, { kind: 'rappeluu' }], lead: 1 },
  { from: 4, name: 'manticores', foes: [{ kind: 'manticore' }, { kind: 'boarhound' }, { kind: 'boarhound' }], lead: 1 },
]

const ANIMALS = {
  forest: ['deer', 'deer', 'boar', 'mouse'], autumn: ['deer', 'deer', 'boar', 'mouse'],
  marsh: ['boar', 'mouse', 'mouse'], mountain: ['deer', 'mouse'], sea: ['chicken', 'mouse'],
}

// The one main thing of a piece: fixed for the home trio and for villages,
// otherwise dealt.
export function mainKind(seed, wx, wy, deal = 0) {
  const fixed = fixedMain(wx, wy)
  if (fixed) return fixed
  if (villageAt(seed, wx, wy)) return 'village'
  const tough = tierAt(wx, wy) >= 2
  const table = [['cave', 30], ['camp', tough ? 30 : 45], ['boss', tough ? 15 : 0], ['ruin', 12], ['landmark', 13]]
  let r = hash(seed, wx, wy, 400 + deal) * 100
  for (const [kind, weight] of table) { if (r < weight) return kind; r -= weight }
  return 'camp'
}

export function placeFeatures(t, piece) {
  const { seed, wx, wy, deal, b } = t
  const rng = mulberry32(hashInt(seed, wx, wy, 500 + deal))
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const pick = a => a[Math.floor(rng() * a.length)]
  const B = v => v + MARGIN
  const key = pieceKey(wx, wy)
  const tier = piece.tier

  const taken = new Set()
  const hold = (x, y) => taken.add(`${x},${y}`)
  const spawn = s => { piece.spawns.push(s); hold(s.x, s.y); return s }
  let npcIx = 0
  const npc = (species, x, y) => spawn({ kind: 'npc', species, id: `npc:wilds:${key}:${npcIx++}`, x, y })
  // A free, untaken cell between rMin and rMax tiles of (cx, cy), or null.
  const freeSpot = (cx, cy, rMin, rMax) => {
    for (let tries = 0; tries < 80; tries++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin)
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r)
      if (t.free(x, y) && !taken.has(`${x},${y}`)) return { x, y }
    }
    for (let r = rMin; r <= rMax + 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      if (t.free(cx + dx, cy + dy) && !taken.has(`${cx + dx},${cy + dy}`)) return { x: cx + dx, y: cy + dy }
    }
    return null
  }
  const place = (maker, cx, cy, rMin, rMax) => {
    const at = freeSpot(cx, cy, rMin, rMax)
    if (!at) return null
    return maker.npc ? npc(maker.npc, at.x, at.y) : spawn({ ...maker, x: at.x, y: at.y })
  }
  const door = (x, y, doorTier) =>
    piece.doors.push({ x, y, label: `house:wilds:${wx * PIECE + x},${wy * PIECE + y}`, tier: doorTier, story: null })
  const house = (x, y, style, doorTier) => {
    // 3 wide, 3 tall, top-left at (x - 1, y - 2); the door is the bottom middle
    stampHouse3(b, rng, B(x - 1), B(y - 2), style)
    door(x, y, doorTier)
    hold(x, y); hold(x, y + 1)
  }
  const ring = (cx, cy, r, n, skinOf) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2
      const x = cx + Math.round(Math.cos(a) * r), y = cy + Math.round(Math.sin(a) * r)
      t.setProp(x, y, skinOf(i))
      hold(x, y)
    }
  }
  const pond = (cx, cy, r) => {
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const wob = (hash(seed, wx * PIECE + cx + dx, wy * PIECE + cy + dy, 510 + deal) - 0.5) * 1.2
      if (Math.hypot(dx, dy) + wob <= r) { t.setWater(cx + dx, cy + dy); hold(cx + dx, cy + dy) }
    }
  }

  // ---- the main thing -------------------------------------------------------
  const kind = mainKind(seed, wx, wy, deal)
  const home = wx === 0 && wy === 0
  const mx = home ? 40 : ri(18, PIECE - 19), my = home ? 40 : ri(18, PIECE - 19)
  piece.main = { kind, x: mx, y: my }
  t.open(mx, my, PAD[kind])
  for (const side of ['N', 'E', 'S', 'W']) { const g = t.gateInner(side); t.path(g.x, g.y, mx, my, 2) }

  // ---- small things: spots first, then trails -------------------------------
  const here = t.biome(mx, my)
  const smallKinds = ['chest', 'chest', 'rocks', 'hut']
  if (ANIMALS[piece.biome]) smallKinds.push('animals', 'animals')
  if (['forest', 'autumn', 'marsh'].includes(piece.biome)) smallKinds.push('mushrooms')
  const want = 1 + Math.floor(rng() * 3)
  const lo = FRAME + 5, hi = PIECE - FRAME - 6
  for (let i = 0; i < want; i++) {
    const k = pick(smallKinds)
    const pad = k === 'hut' ? 4 : 2
    for (let tries = 0; tries < 40; tries++) {
      const x = ri(lo, hi), y = ri(lo, hi)
      if (Math.hypot(x - mx, y - my) < PAD[kind] + 8) continue
      if (piece.small.some(s => Math.hypot(x - s.x, y - s.y) < 12)) continue
      let crossed = false
      for (let dy = -pad - 1; dy <= pad + 1 && !crossed; dy++) for (let dx = -pad - 1; dx <= pad + 1; dx++) if (t.onPath(x + dx, y + dy)) { crossed = true; break }
      if (crossed) continue
      piece.small.push({ kind: k, x, y })
      break
    }
  }
  for (const s of piece.small) t.open(s.x, s.y, s.kind === 'hut' ? 4 : 2)
  for (const s of piece.small) t.path(s.x, s.y, mx, my, 1)

  // ---- stamp the main thing ---------------------------------------------------
  let spawnPoint = null
  if (kind === 'village') {
    const v = villageAt(seed, wx, wy) ?? { name: 'Koivula' }
    stampVillage(b, rng, B(mx), B(my))
    for (const [dx, dy] of HOUSE_SPOTS) { door(mx + dx + 1, my + dy + 2, 'safe'); hold(mx + dx + 1, my + dy + 2); hold(mx + dx + 1, my + dy + 3) }
    const toward = (dx, dy) => BIOME_NAMES[pieceBiome(seed, wx + dx * 3, wy + dy * 3)]
    piece.signs.push({
      x: mx - 2, y: my + 1, title: v.name,
      lines: [`North: ${toward(0, -1)}.`, `East: ${toward(1, 0)}.`, `South: ${toward(0, 1)}.`, `West: ${toward(-1, 0)}.`],
    })
    piece.village = { name: v.name, x: mx, y: my }
    spawnPoint = { x: mx + 1, y: my + 1 }
    hold(spawnPoint.x, spawnPoint.y)
    if (home) spawn({ kind: 'weapon', weaponType: 'hatchet', x: mx + 2, y: my + 1 })
    for (const species of VILLAGERS) place({ npc: species }, mx, my, 2, 6)
  } else if (kind === 'ring') {
    ring(mx, my, 4, 8, () => 'ow_mushroom')
    spawn({ kind: 'talent_trigger', x: mx, y: my, outfit: 'robe', rite: 'mushroom_circle' })
    for (let i = 0; i < 3; i++) place({ kind: 'wild_mushroom' }, mx, my, 1, 3)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'cave') {
    stampCaveInRocks(b, rng, B(mx), B(my))
    const caveDepth = caveDepthFor(seed, wx, wy)
    piece.caves.push({ x: mx, y: my, caveDepth, label: `cave:${key}` }, { x: mx + 1, y: my, caveDepth, label: `cave:${key}` })
    hold(mx, my); hold(mx + 1, my)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'camp') {
    const camp = pick(CAMPS.filter(c => c.from <= tier && c.from >= tier - 2))
    if (camp.tent) {
      const tx = mx - 1, ty = my - 3
      t.setProp(tx, ty, 'ow_tent_00'); t.setProp(tx + 1, ty, 'ow_tent_10')
      t.setProp(tx, ty + 1, 'ow_tent_01'); t.setProp(tx + 1, ty + 1, 'ow_tent_11')
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) hold(tx + dx, ty + dy)
    }
    const n = tier >= 4 ? 5 : ri(3, 5)
    const lead = camp.lead ?? 0
    for (let i = 0; i < lead; i++) place(camp.foes[i], mx, my, 1, 4)
    for (let i = lead; i < n; i++) place(camp.foes[lead + ((i - lead) % (camp.foes.length - lead))], mx, my, 2, 5)
    place({ kind: 'chest' }, mx, my, 0, 1)
  } else if (kind === 'boss') {
    if (tier >= 4 && rng() < 0.5) for (let i = 0; i < 3; i++) place({ kind: 'manticore' }, mx, my, 0, 3)
    else for (let i = 0; i < (tier >= 4 ? 2 : 1); i++) place({ kind: 'ogre' }, mx, my, 0, 2)
    place({ kind: 'chest' }, mx, my, 3, 5)
    for (let i = 0; i < 5; i++) { const at = freeSpot(mx, my, 5, 7); if (at) { t.setProp(at.x, at.y, pick(rocksFor(here))); hold(at.x, at.y) } }
  } else if (kind === 'ruin') {
    house(mx, my, 'stone', 'ruin')
    hold(mx, my + 2)
    for (let i = 0; i < 7; i++) { const at = freeSpot(mx, my, 3, 5); if (at) { t.setProp(at.x, at.y, pick(RUIN_BITS)); hold(at.x, at.y) } }
    place({ kind: 'chest' }, mx, my + 2, 1, 2)
    spawnPoint = { x: mx, y: my + 2 }
  } else {
    // landmark: what the country offers
    if (here === 'desert') {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) t.setGround(mx + dx, my + dy, t.grassSkin(mx + dx, my + dy))
      pond(mx, my, 1)
      ring(mx, my, 3, 5, i => i % 2 ? 'ow_tree_small' : 'ow_tree_apple')
      place({ kind: 'chest' }, mx, my, 2, 3)
    } else if (here === 'mountain') {
      ring(mx, my, 4, 8, i => ROCKS.mountain[i % ROCKS.mountain.length])
      place({ kind: 'chest' }, mx, my, 0, 1)
    } else if (here === 'sea') {
      t.setProp(mx, my, 'ow_boat'); hold(mx, my)
      place({ kind: 'chest' }, mx, my, 1, 2)
      for (let i = 0; i < 2; i++) place({ npc: 'chicken' }, mx, my, 2, 5)
    } else {
      pond(mx, my, 3)
      for (let i = 0; i < 2; i++) { const at = freeSpot(mx, my, 4, 6); if (at) { t.setProp(at.x, at.y, 'ow_bush_berry'); hold(at.x, at.y) } }
      for (let i = 0; i < 3; i++) place({ npc: here === 'marsh' ? 'boar' : 'deer' }, mx, my, 4, 6)
    }
  }
  piece.spawnPoint = spawnPoint ?? freeSpot(mx, my, Math.max(1, PAD[kind] - 3), PAD[kind] - 1) ?? { x: mx, y: my }

  // ---- stamp the small things -------------------------------------------------
  for (const s of piece.small) {
    if (s.kind === 'chest') place({ kind: 'chest' }, s.x, s.y, 0, 1)
    else if (s.kind === 'animals') {
      const list = ANIMALS[piece.biome]
      if (tier >= 1 && rng() < 0.2) for (let i = 0; i < 2; i++) place({ npc: 'wolf' }, s.x, s.y, 0, 2)
      else for (let i = ri(2, 3); i > 0; i--) place({ npc: pick(list) }, s.x, s.y, 0, 2)
    } else if (s.kind === 'mushrooms') {
      t.setProp(s.x, s.y, 'ow_mushroom'); hold(s.x, s.y)
      for (let i = ri(2, 4); i > 0; i--) place({ kind: 'wild_mushroom' }, s.x, s.y, 1, 2)
    } else if (s.kind === 'hut') {
      house(s.x, s.y, rng() < 0.5 ? 'red' : 'brown', 'hut')
    } else {
      // a knot of rocks to mine, around the end of the trail
      const set = rocksFor(t.biome(s.x, s.y))
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = s.x + dx, y = s.y + dy
        if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 5 || t.onPath(x, y) || !t.free(x, y) || rng() > 0.6) continue
        t.setProp(x, y, pick(set)); hold(x, y)
      }
    }
  }
  // A piece that could fit no small thing still gets its chest, by the main pad.
  if (!piece.small.length) {
    const at = freeSpot(mx, my, PAD[kind] - 1, PAD[kind] + 2) ?? piece.spawnPoint
    piece.small.push({ kind: 'chest', x: at.x, y: at.y })
    if (!taken.has(`${at.x},${at.y}`)) spawn({ kind: 'chest', x: at.x, y: at.y })
  }
}
