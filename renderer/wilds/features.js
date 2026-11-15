// What a Wilds piece holds: one main thing, two to four small things, the
// paths that lead to them, and the packs that roam the land between. Stamped onto a piece's terrain (terrain.js)
// before its art passes run.
//
// Order matters and is always the same: open the main pad, run a path from
// each gate to it, pick the small things' spots clear of those paths, run a
// trail from each to the main thing, then stamp the structures. Every
// structure sits inside its own opened pad, so a house or a pond laid over a
// path end never cuts the piece in two.
import { PIECE, FRAME, tierAt, pieceBiome, fixedMain, villageAt, caveDepthFor, pieceKey, BIOME_NAMES } from './layout.js'
import { hash, hashInt, mulberry32 } from './rand.js'
import { makeSites, layoutTale, TALE_PAD } from './sites.js'

const PAD = { village: 12, ring: 6, cave: 5, camp: 6, boss: 7, ruin: 8, landmark: 7 }
const VILLAGERS = ['villager', 'villager', 'villager', 'elder', 'chicken', 'chicken', 'sheep', 'goat']
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
  { from: 1, name: 'wolves', look: 'den', foes: [wolf, wolf, wolf] },
  { from: 1, name: 'spiders', look: 'nest', foes: [spider('weak'), spider('weak'), spider('medium')] },
  { from: 1, name: 'pete', look: 'bandits', foes: [{ kind: 'pullopete' }, spider('weak'), spider('weak'), spider('medium')], lead: 1 },
  { from: 2, name: 'bandits', look: 'bandits', foes: [{ kind: 'guard' }] },
  { from: 2, name: 'bones', look: 'graves', foes: [{ kind: 'rappeluu' }, { kind: 'rappeluu' }, spider('medium')] },
  { from: 2, name: 'bears', look: 'den', foes: [wolf, wolf, bear], lead: 1 },
  { from: 3, name: 'hounds', look: 'den', foes: [{ kind: 'boarhound' }, { kind: 'boarhound' }, spider('strong')] },
  { from: 3, name: 'podeboo', look: 'graves', foes: [{ kind: 'podeboo' }, { kind: 'rappeluu' }, { kind: 'rappeluu' }], lead: 1 },
  { from: 4, name: 'manticores', look: 'nest', foes: [{ kind: 'manticore' }, { kind: 'boarhound' }, { kind: 'boarhound' }], lead: 1 },
]

// Roaming packs by toughness; row 0 is the ring round home. Every row has an
// all-spider pack, which is what a village piece draws from: nothing that
// hunts on its own initiative within a walk of the villagers.
const bones = { kind: 'rappeluu' }, hound = { kind: 'boarhound' }
const PACKS = [
  [[spider('weak'), spider('weak')], [wolf], [spider('weak'), spider('weak'), spider('weak')]],
  [[spider('weak'), spider('weak')], [wolf, wolf], [spider('weak'), spider('medium')], [spider('weak'), spider('weak'), spider('weak')]],
  [[spider('medium'), spider('medium')], [bones, bones], [wolf, wolf, wolf], [bear], [spider('weak'), spider('medium'), spider('medium')]],
  [[hound, hound], [spider('strong'), spider('medium')], [bones, bones, bones], [bear, wolf, wolf]],
  [[{ kind: 'manticore' }], [hound, hound, hound], [{ kind: 'podeboo' }, bones], [spider('strong'), spider('strong')]],
]
const VILLAGE_CALM = 24   // tiles round a village centre no pack is dealt into
const nearHome = (wx, wy) => Math.max(Math.abs(wx), Math.abs(wy)) <= 1

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
  // An open-world boss is common far out, rare in the first country and
  // never beside home; what it gives up goes to the camps.
  const boss = tierAt(wx, wy) >= 2 ? 15 : nearHome(wx, wy) ? 0 : 8
  const table = [['cave', 30], ['camp', 45 - boss], ['boss', boss], ['ruin', 12], ['landmark', 13]]
  let r = hash(seed, wx, wy, 400 + deal) * 100
  for (const [kind, weight] of table) { if (r < weight) return kind; r -= weight }
  return 'camp'
}

export function placeFeatures(t, piece) {
  const { seed, wx, wy, deal } = t
  const rng = mulberry32(hashInt(seed, wx, wy, 500 + deal))
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
  const pick = a => a[Math.floor(rng() * a.length)]
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
  const door = (x, y, doorTier) => {
    piece.doors.push({ x, y, label: `house:wilds:${wx * PIECE + x},${wy * PIECE + y}`, tier: doorTier, story: null })
    hold(x, y)
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
  // A tale's place takes the main thing over: its parts are laid out first so
  // roads, small things and packs keep clear of them.
  // (a tale whose place is not built yet is dealt as ordinary land)
  const geo = piece.tale && TALE_PAD[piece.tale] !== undefined ? layoutTale(piece.tale, rng) : null
  const kind = geo ? `tale_${piece.tale}` : mainKind(seed, wx, wy, deal)
  const home = wx === 0 && wy === 0
  const mx = geo ? geo.cx : home ? 40 : ri(18, PIECE - 19), my = geo ? geo.cy : home ? 40 : ri(18, PIECE - 19)
  const pad = geo ? TALE_PAD[piece.tale] : PAD[kind]
  const hub = geo ? geo.hub : { x: mx, y: my }
  const keepOut = geo ? geo.keep : []
  const kept = (x, y, margin) => keepOut.some(k => Math.hypot(x - k.x, y - k.y) < k.r + margin) ||
    (geo?.ways ?? []).some(c => Math.abs(c.x - x) <= margin + 1 && Math.abs(c.y - y) <= margin + 1)
  piece.main = { kind, x: mx, y: my }
  t.open(mx, my, pad)
  for (const side of ['N', 'E', 'S', 'W']) { const g = t.gateInner(side); t.path(g.x, g.y, hub.x, hub.y, 2) }

  // ---- small things: spots first, then trails -------------------------------
  const here = t.biome(mx, my)
  const roster = PACKS[nearHome(wx, wy) ? 0 : tier].filter(p => kind !== 'village' || p.every(f => f.kind === 'monster'))
  const smallKinds = ['chest', 'chest', 'rocks', 'hut']
  if (ANIMALS[piece.biome]) smallKinds.push('animals', 'animals')
  if (['forest', 'autumn', 'marsh'].includes(piece.biome)) smallKinds.push('mushrooms')
  // guarded things: a nest round a chest, old stones with something in them
  if (kind !== 'village') smallKinds.push('nest', 'nest', 'stones')
  const padOf = k => k === 'hut' ? 5 : k === 'stones' ? 3 : 2
  const want = 2 + Math.floor(rng() * 3)
  const lo = FRAME + 5, hi = PIECE - FRAME - 6
  for (let i = 0; i < want; i++) {
    const k = pick(smallKinds)
    const pad = padOf(k)
    for (let tries = 0; tries < 60; tries++) {
      const x = ri(lo, hi), y = ri(lo, hi)
      if (Math.hypot(x - mx, y - my) < pad + 8 || kept(x, y, 6)) continue
      if (piece.small.some(s => Math.hypot(x - s.x, y - s.y) < 10)) continue
      let crossed = false
      for (let dy = -pad - 1; dy <= pad + 1 && !crossed; dy++) for (let dx = -pad - 1; dx <= pad + 1; dx++) if (t.onPath(x + dx, y + dy)) { crossed = true; break }
      if (crossed) continue
      piece.small.push({ kind: k, x, y })
      break
    }
  }
  for (const s of piece.small) t.open(s.x, s.y, padOf(s.kind))
  for (const s of piece.small) t.path(s.x, s.y, hub.x, hub.y, 1)

  // ---- stamp the main thing ---------------------------------------------------
  const sandy = here === 'desert' || here === 'sea'
  const sites = makeSites({
    t, rng, pick, ri, hold, spawn, place, freeSpot, door, npc,
    hash: (x, y, salt) => hash(seed, wx * PIECE + x, wy * PIECE + y, salt + deal),
    taken: (x, y) => taken.has(`${x},${y}`), rocks: rocksFor(here), sandy,
  })
  let spawnPoint = null
  if (geo) {
    piece.points = piece.tale === 'elk' ? sites.elkWood(geo) : piece.tale === 'tar' ? sites.causeway(geo) : sites.oven(geo)
    spawnPoint = hub
    hold(hub.x, hub.y)
  } else if (kind === 'village') {
    const v = villageAt(seed, wx, wy) ?? { name: 'Koivula' }
    spawnPoint = { x: mx + 1, y: my + 1 }
    hold(spawnPoint.x, spawnPoint.y)
    sites.village(mx, my)
    const toward = (dx, dy) => BIOME_NAMES[pieceBiome(seed, wx + dx * 3, wy + dy * 3)]
    piece.signs.push({
      x: mx - 2, y: my + 1, title: v.name,
      lines: [`North: ${toward(0, -1)}.`, `East: ${toward(1, 0)}.`, `South: ${toward(0, 1)}.`, `West: ${toward(-1, 0)}.`],
    })
    piece.village = { name: v.name, x: mx, y: my }
    if (home) spawn({ kind: 'weapon', weaponType: 'hatchet', x: mx + 2, y: my + 1 })
    for (const species of VILLAGERS) place({ npc: species }, mx, my, 2, 6)
  } else if (kind === 'ring') {
    ring(mx, my, 4, 8, () => 'ow_mushroom')
    spawn({ kind: 'talent_trigger', x: mx, y: my, outfit: 'robe', rite: 'mushroom_circle' })
    for (let i = 0; i < 3; i++) place({ kind: 'wild_mushroom' }, mx, my, 1, 3)
    sites.flowers(mx, my, 5, 7, 7)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'cave') {
    sites.cave(mx, my)
    const caveDepth = caveDepthFor(seed, wx, wy)
    piece.caves.push({ x: mx, y: my, caveDepth, label: `cave:${key}` }, { x: mx + 1, y: my, caveDepth, label: `cave:${key}` })
    hold(mx, my); hold(mx + 1, my)
    spawnPoint = { x: mx, y: my + 2 }
  } else if (kind === 'camp') {
    const camp = pick(CAMPS.filter(c => c.from <= tier && c.from >= tier - 2))
    sites.camp(mx, my, camp.look)
    const n = tier >= 4 ? 5 : ri(3, 5)
    const lead = camp.lead ?? 0
    for (let i = 0; i < lead; i++) place(camp.foes[i], mx, my, 1, 4)
    for (let i = lead; i < n; i++) place(camp.foes[lead + ((i - lead) % (camp.foes.length - lead))], mx, my, 2, 5)
    place({ kind: 'chest' }, mx, my, 1, 2)
  } else if (kind === 'boss') {
    sites.lair(mx, my)
    if (tier >= 4 && rng() < 0.5) for (let i = 0; i < 3; i++) place({ kind: 'manticore' }, mx, my, 1, 3)
    else for (let i = 0; i < (tier >= 4 ? 2 : 1); i++) place({ kind: 'ogre' }, mx, my, 1, 2)
    place({ kind: 'chest' }, mx, my, 3, 5)
    for (let i = 0; i < 5; i++) { const at = freeSpot(mx, my, 5, 7); if (at) { t.setProp(at.x, at.y, pick(rocksFor(here))); hold(at.x, at.y) } }
  } else if (kind === 'ruin') {
    sites.ruin(mx, my)
    place({ kind: 'chest' }, mx, my + 3, 0, 2)
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
    } else if (rng() < 0.35) {
      // an old statue someone still tends
      sites.statue(mx, my)
      place({ kind: 'chest' }, mx, my, 1, 2)
    } else {
      pond(mx, my, 3)
      sites.lilies(mx, my, 3, 3)
      sites.flowers(mx, my, 4, 7, 6)
      for (let i = 0; i < 2; i++) { const at = freeSpot(mx, my, 4, 6); if (at) { t.setProp(at.x, at.y, 'ow_bush_berry'); hold(at.x, at.y) } }
      for (let i = 0; i < 3; i++) place({ npc: here === 'marsh' ? 'boar' : 'deer' }, mx, my, 4, 6)
    }
  }
  piece.spawnPoint = spawnPoint ?? freeSpot(mx, my, Math.max(1, pad - 3), pad - 1) ?? { x: mx, y: my }

  // ---- stamp the small things -------------------------------------------------
  for (const s of piece.small) {
    if (s.kind === 'chest') place({ kind: 'chest' }, s.x, s.y, 0, 1)
    else if (s.kind === 'animals') {
      const list = ANIMALS[piece.biome]
      if (kind !== 'village' && rng() < 0.2) for (let i = 0; i < 2; i++) place({ npc: 'wolf' }, s.x, s.y, 0, 2)
      else for (let i = ri(2, 3); i > 0; i--) place({ npc: pick(list) }, s.x, s.y, 0, 2)
    } else if (s.kind === 'mushrooms') {
      t.setProp(s.x, s.y, 'ow_mushroom'); hold(s.x, s.y)
      for (let i = ri(2, 4); i > 0; i--) place({ kind: 'wild_mushroom' }, s.x, s.y, 1, 2)
    } else if (s.kind === 'hut') {
      sites.hut(s.x, s.y)
    } else if (s.kind === 'nest') {
      spawn({ kind: 'chest', x: s.x, y: s.y })
      sites.nest(s.x, s.y)
      for (const foe of pick(roster).slice(0, 2)) place(foe, s.x, s.y, 1, 2)
    } else if (s.kind === 'stones') {
      spawn({ kind: 'chest', x: s.x, y: s.y })
      sites.stones(s.x, s.y)
      const guards = tier >= 2 ? [bones, bones] : pick(roster).slice(0, 2)
      for (const foe of guards) place(foe, s.x, s.y, 1, 3)
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
  // ---- the packs that roam between ---------------------------------------------
  // Two or three in wild land (one more far out), one or two round a village
  // and those well away from it. Half the wild pieces post one on a road.
  const village = kind === 'village'
  const keep = village ? VILLAGE_CALM : pad + 8
  const rim = FRAME + 4
  const roomy = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!t.free(x + dx, y + dy)) return false; return true }
  const clear = (x, y) => x >= rim && y >= rim && x < PIECE - rim && y < PIECE - rim &&
    Math.hypot(x - mx, y - my) >= keep && !kept(x, y, 6) &&
    piece.small.every(s => Math.hypot(x - s.x, y - s.y) >= 8) &&
    piece.packs.every(p => Math.hypot(x - p.x, y - p.y) >= 14)
  const pack = (x, y, road) => {
    const made = pick(roster).map(foe => place(foe, x, y, 0, 2)).filter(Boolean)
    // a village's calm is measured to each foe, not to the middle of its pack
    if (made.length) piece.packs.push({ x, y, road })
  }
  if (!village && rng() < 0.5) {
    const road = []
    for (let y = rim; y < PIECE - rim; y++) for (let x = rim; x < PIECE - rim; x++) if (t.onPath(x, y) && t.free(x, y) && clear(x, y)) road.push({ x, y })
    if (road.length) { const at = pick(road); pack(at.x, at.y, true) }
  }
  const wantPacks = village ? ri(1, 2) : ri(2, 3) + (tier >= 3 ? 1 : 0)
  for (let tries = 0; tries < 400 && piece.packs.length < wantPacks; tries++) {
    const x = ri(rim, PIECE - rim - 1), y = ri(rim, PIECE - rim - 1)
    if (clear(x, y) && roomy(x, y)) pack(x, y, false)
  }

  // A piece that could fit no small thing still gets its chest, by the main pad.
  if (!piece.small.length) {
    const at = freeSpot(mx, my, pad - 1, pad + 2) ?? piece.spawnPoint
    piece.small.push({ kind: 'chest', x: at.x, y: at.y })
    if (!taken.has(`${at.x},${at.y}`)) spawn({ kind: 'chest', x: at.x, y: at.y })
  }
}
