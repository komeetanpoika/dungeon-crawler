// House versions: who lives behind a door and how the place is left. The
// door record (wilds/features.js, systems/houses.js) says where the house
// stands; houseSpec turns it into what to build; occupants and dress fill
// and finish a furnished house. Pure in their rng.
import { ITEMS, FLOORS, MISC, dusty } from './kit.js'
import { TRADES } from './recipes.js'
import { mulberry32, hashStr, int, pick, chance, weighted, shuffle } from './rng.js'
import { TILE } from '../systems/entities.js'

// The light inside, per version (a DEPTH_THEMES-shaped theme for the cave state).
// `enter` is what the player notices stepping in.
const theme = (bgColor, tint, fogAlpha) => ({ floorTile: 'floor_wood', bgColor, tint, fogAlpha })
export const VERSIONS = {
  home: { theme: theme('#0d0906', null, 0.35), enter: 'Warm air and woodsmoke.' },
  empty: { theme: theme('#0b0806', null, 0.45), enter: 'Nobody is home.' },
  abandoned: { theme: theme('#06070a', 'rgba(30,45,70,0.16)', 0.72), enter: 'Dust, and a long silence.' },
  hideout: { theme: theme('#0c0806', 'rgba(70,35,10,0.10)', 0.55), enter: 'The talk stops. Someone is in here.' },
  nest: { theme: theme('#050505', 'rgba(20,32,20,0.20)', 0.75), enter: 'Webs. Everywhere, webs.' },
  ruin: { theme: theme('#070809', 'rgba(20,30,50,0.14)', 0.68), enter: 'Cold stone and old bones.' },
  sunroom: { theme: theme('#0f0b06', null, 0.25), enter: 'Glass glints on every shelf.' },
}

// A tale's story room (data/tales.js, data/leaps.js `houses[label].room`) ->
// the role of the room its things are found in.
export const STORY_ROOMS = { toivo_kitchen: 'kitchen', aino_larder: 'larder', hermit_woodpile: 'woodshed' }
export const TRADE_LIST = ['farmer', 'hunter', 'fisher', 'smith', 'baker', 'scholar', 'weaver']

function chooseVersion(door, rng, story) {
  if (door.kind === 'sunroom') return 'sunroom'
  if (story) return 'empty'
  if (door.tier === 'ruin') return 'ruin'
  if (door.tier === 'safe') return rng() < 0.12 ? 'abandoned' : 'home'
  return (door.toughness ?? 1) <= 1
    ? weighted(rng, [['home', 30], ['abandoned', 40], ['nest', 20], ['hideout', 10]])
    : weighted(rng, [['home', 20], ['abandoned', 30], ['nest', 25], ['hideout', 25]])
}
function sizeOf(door) {
  const w = door.look?.w
  if (w === 3) return 'small'
  if (w === 4) return 'medium'
  if (w >= 5) return door.look.storeys >= 2 ? 'grand' : 'large'
  return door.tier === 'hut' ? 'small' : 'medium'
}
function paletteOf(door, version) {
  if (version === 'ruin') return 'grey'
  if (version === 'sunroom') return 'pale'
  if (door.look?.wall) return door.look.wall === 'wood' ? 'wood' : 'plaster'
  return door.tier === 'hut' ? 'wood' : 'plaster'
}

// door: { label, tier, story?, kind?, toughness?, look?, city? }. story: the
// episode's `houses[door.story]` ({ room, pickups }) when the door is a story
// house. A Kalevanlinna door (door.city) takes `residents` (the spawns of who
// is in it now) and `household` (the Person records of whose house it is):
// see citySpec. Returns what generateInterior builds.
export function houseSpec(door, { worldSeed = 0, story = null, residents = [], household = [] } = {}) {
  const seed = hashStr(`${worldSeed}|${door.label}`)
  const rng = mulberry32(seed ^ 0x5eed5eed)
  if (door.city) return citySpec(door, seed, rng, residents, household)
  const version = chooseVersion(door, rng, story)
  const trade = version === 'home' || version === 'empty' || version === 'sunroom' ? pick(rng, TRADE_LIST) : null
  // the sunlit hall needs room: the puzzle house is never smaller than large
  const size = version === 'sunroom' && !['large', 'grand'].includes(sizeOf(door)) ? 'large' : sizeOf(door)
  return {
    label: door.label, tier: door.tier ?? 'hut', version, size, palette: paletteOf(door, version),
    toughness: door.toughness ?? 1, trade, seed,
    story: story ? { role: STORY_ROOMS[story.room] ?? 'kitchen', pickups: story.pickups ?? [] } : null,
  }
}

// ---- Kalevanlinna (wilds/city/indoors.js) --------------------------------------
// A city house is lived in, never abandoned: a home when someone is in, else
// empty (the same house, the hearth cold), with `residents` in place of the
// version's occupants and nothing to take (`noLoot`). Its trade comes from
// the door's kind, else from the jobs of whose house it is (workers first),
// else, for a house nobody lives or works in (or none of whose jobs is a
// trade), from its seed.
const KIND_TRADES = { inn: 'innkeeper', smithy: 'smith', warehouse: 'farmer', barracks: null }
const JOB_TRADES = {
  baker: 'baker', weaver: 'weaver', dyer: 'weaver', fisher: 'fisher', 'net-mender': 'fisher', sailor: 'fisher',
  smith: 'smith', apprentice: 'smith', butcher: 'hunter', tanner: 'hunter',
  miller: 'farmer', stallholder: 'farmer', carter: 'farmer', porter: 'farmer',
  organist: 'scholar', vicar: 'scholar', crier: 'scholar', captain: 'scholar',
}
function citySpec(door, seed, rng, residents, household) {
  const version = residents.length ? 'home' : 'empty'
  const trade = Object.hasOwn(KIND_TRADES, door.kind) ? KIND_TRADES[door.kind]
    : household.map(p => JOB_TRADES[p.job]).find(Boolean) ?? pick(rng, TRADE_LIST)
  // a taproom wants the big hall: never smaller than large, like the sunroom
  const size = TRADES[trade]?.hallRole && !['large', 'grand'].includes(sizeOf(door)) ? 'large' : sizeOf(door)
  return {
    label: door.label, tier: 'safe', version, size, palette: paletteOf(door, version),
    toughness: 1, trade, seed, story: null, city: true,
    residents: residents.map(r => ({ ...r })), noLoot: true,
  }
}

// ---- what people say at home -----------------------------------------------
const HOME_LINES = ['Wipe your feet, stranger.', "There's soup on, if you're hungry.", 'Close the door behind you, the heat gets out.', "It isn't much, but it's ours.", 'Mind the caves out there.']
const TRADE_LINES = {
  farmer: ['Rain tomorrow, my knee says.', 'The rye came in thin this year.'],
  hunter: ['That pair of antlers took three days to track.', 'Elk are thick in the birches this autumn.'],
  fisher: ['The nets want mending again.', 'The pike are biting under the ice early.'],
  smith: ["Don't touch the anvil. It bites the careless.", 'Good iron comes from the bogs, if you know where.'],
  baker: ["Bread's not ready. Come back at dawn.", 'Flour gets everywhere. Everywhere.'],
  scholar: ['Mind the books. Some are older than the village.', 'I am writing down the old songs before they are forgotten.'],
  weaver: ['Wool from our own sheep, every thread.', 'Red dye from bedstraw root. Takes all summer.'],
}
// The glassmaker of Päivölä (interior/sunroom.js): a hint before, thanks after.
export const GLASSMAKER = {
  hint: [
    'The sun used to fill this hall. Now it falls on the floor and goes nowhere.',
    'My mirrors were knocked about. Walk into one and it turns.',
    'The seed in the planter wants the light. It has waited a long time.',
  ],
  solved: [
    'Look at it! The whole hall is gold again.',
    'Take what is in the wall. It was meant for whoever woke the seed.',
    'Päivölä, my grandmother called this house. The home of the sun.',
  ],
}
const ELDER_LINES = ['I have lived in this house since I was a boy.', 'The old songs say the sun was kept in a house once.', 'Sit, sit. My legs are not what they were.']
const HERMIT_LINES = ['Not many find their way out here.', 'I keep to myself. You might try it.', 'The woods are quiet, if you let them be.']

export function homeLines(spec, species) {
  if (species === 'elder') return [...ELDER_LINES, ...(TRADE_LINES[spec.trade] ?? []).slice(0, 1)]
  return spec.tier === 'hut' ? [...HERMIT_LINES, ...(TRADE_LINES[spec.trade] ?? [])] : [...HOME_LINES, ...(TRADE_LINES[spec.trade] ?? [])]
}

// ---- who lives there -------------------------------------------------------
// Spawns without a place: generateInterior puts them on bare floor away
// from the door. Pickups (potions, a weapon) are listed apart.
export function occupants(spec, rng) {
  const t = spec.toughness, label = spec.label, out = []
  const monster = variant => ({ kind: 'monster', variant })
  switch (spec.version) {
    case 'home': {
      const n = spec.size === 'small' ? int(rng, 1, 2) : int(rng, 2, 3)
      for (let i = 0; i < n; i++) {
        const species = i > 0 && chance(rng, 0.3) ? 'elder' : 'villager'
        out.push({ kind: 'npc', species, hostile: false, id: `${label}:npc${i}`, lines: homeLines(spec, species) })
      }
      break
    }
    case 'empty': if (spec.tier === 'hut') out.push(monster('weak')); break
    case 'abandoned': if (spec.tier !== 'safe') for (let i = int(rng, 1, 2); i > 0; i--) out.push(monster('weak')); break
    case 'hideout':
      if (t <= 1) { out.push({ kind: 'pullopete' }); if (chance(rng, 0.5)) out.push(monster('weak')) }
      else { for (let i = int(rng, 2, 3); i > 0; i--) out.push({ kind: 'guard' }); if (t >= 3) out.push({ kind: 'pullopete' }) }
      break
    case 'nest': {
      const pool = t <= 1 ? ['weak', 'weak', 'medium'] : t === 2 ? ['weak', 'medium', 'medium'] : ['medium', 'medium', 'strong']
      for (let i = int(rng, 2, t >= 2 ? 4 : 3); i > 0; i--) out.push(monster(pick(rng, pool)))
      break
    }
    case 'ruin': out.push(monster('strong'), monster('medium')); for (let i = int(rng, 1, 2); i > 0; i--) out.push(monster('medium')); break
    case 'sunroom': out.push({ kind: 'npc', species: 'elder', role: 'glassmaker', hostile: false, id: `${label}:glassmaker`, lines: GLASSMAKER.hint }); break
    default: break
  }
  return out
}

export function loot(spec, rng) {
  const potion = { type: 'potion', amount: 4 }
  const weapon = w => ({ type: 'weapon', weaponType: w, name: w[0].toUpperCase() + w.slice(1), damage: { dagger: 1, sword: 2, hatchet: 1 }[w], ...(w === 'hatchet' ? { chop: 1 } : {}) })
  const out = []
  const potions = { home: [0, 1], abandoned: [0, 1], nest: [0, 1], hideout: [1, 2], ruin: [1, 2] }[spec.version] ?? [0, 0]
  for (let i = int(rng, ...potions); i > 0; i--) out.push({ ...potion })
  if (spec.version === 'ruin') out.push(weapon(pick(rng, ['dagger', 'sword'])))
  if (spec.version === 'hideout' && chance(rng, 0.5)) out.push(weapon(pick(rng, ['dagger', 'sword', 'hatchet'])))
  return out
}

// ---- how the place is left ---------------------------------------------------
// a tile name -> the first item listed that lays it (the bar reuses shelves and worktops)
const ofItem = new Map()
for (const [id, it] of Object.entries(ITEMS)) for (const n of it.tiles.flat()) if (!ofItem.has(n)) ofItem.set(n, id)
const SWAP = {
  in_table_l: 'in_table_food_l', in_table_r: 'in_table_food_r',
}
const COLD = { in_hearth_t: 'in_hearth_t_cold', in_hearth_b: 'in_hearth_b_cold', in_oven: 'in_oven_cold' }
const FALLEN = { in_chair_s: 'in_chair_down', in_chair_n: 'in_chair_down', in_chair_e: 'in_chair_down', in_chair_w: 'in_chair_down', in_table_small: 'in_table_broken' }
const WORN = Object.fromEntries(Object.values(FLOORS).map(([a, b]) => [a, b]))

function clearCell(c) { delete c.overlay; if (c.losClear) { c.tile = TILE.FLOOR_WOOD; delete c.losClear } }

export function dress(map, plan, spec, rng) {
  const v = spec.version
  const cells = []
  map.forEach((row, y) => row.forEach((c, x) => cells.push({ c, x, y, ch: plan.grid[y][x] })))
  const floor = cells.filter(e => e.ch === '.')
  const bare = e => !e.c.overlay && !(e.x === plan.spawn.x && e.y === plan.spawn.y)
  if (v === 'home' || v === 'sunroom') {
    for (const { c } of cells) if (SWAP[c.overlay]) c.overlay = SWAP[c.overlay]
    return
  }
  if (v === 'empty') { for (const { c } of cells) if (COLD[c.overlay]) c.overlay = COLD[c.overlay]; return }
  const wrecked = v === 'abandoned' || v === 'nest'
  if (wrecked) {
    for (const e of cells) {
      const c = e.c
      if (!c.overlay) continue
      if (COLD[c.overlay]) { c.overlay = COLD[c.overlay]; continue }
      if (c.overlay.startsWith('in_window') && !c.overlay.includes('tall') && chance(rng, 0.35)) { c.overlay = 'in_window_broken'; continue }
      if (FALLEN[c.overlay] && chance(rng, 0.4)) { c.overlay = FALLEN[c.overlay]; continue }   // knocked over; blocks as before
      const id = ofItem.get(c.overlay)
      if (id && ITEMS[id].on === 'floor' && ITEMS[id].tiles.flat().length === 1 && chance(rng, 0.15)) { clearCell(c); continue }   // carried off
      if (id && ITEMS[id].dusty) c.overlay = dusty(c.overlay)
    }
    for (const { c } of floor) if (WORN[c.skin] && chance(rng, 0.3)) c.skin = WORN[c.skin]
    // half the rugs went too, each whole
    const seen = new Set()
    for (const e of floor) {
      if (!e.c.deco?.startsWith('in_rug_') || seen.has(`${e.x},${e.y}`)) continue
      const rug = [], q = [e]
      seen.add(`${e.x},${e.y}`)
      while (q.length) {
        const r = q.pop(); rug.push(r)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = r.x + dx, y = r.y + dy, k = `${x},${y}`
          if (!seen.has(k) && map[y]?.[x]?.deco?.startsWith('in_rug_')) { seen.add(k); q.push({ c: map[y][x], x, y }) }
        }
      }
      if (chance(rng, 0.5)) for (const r of rug) delete r.c.deco
    }
    // cobwebs in the top corners of every room, on the floor and up the wall
    let webs = 0
    const wallSpots = []
    for (const r of plan.rooms) {
      for (const [x, n] of [[r.x0, 'in_web_tl'], [r.x1, 'in_web_tr']]) {
        const e = { c: map[r.floorY0][x], x, y: r.floorY0 }
        if (bare(e) && chance(rng, v === 'nest' ? 0.95 : 0.7)) { e.c.overlay = n; webs++ }
        const u = map[r.y0][x]
        if (plan.grid[r.y0][x] === 'u' && !u.overlay) { if (chance(rng, 0.5)) { u.overlay = 'in_web_wall'; webs++ } else wallSpots.push(u) }
      }
    }
    if (!webs && wallSpots.length) wallSpots[0].overlay = 'in_web_wall'   // no house nobody keeps is free of them
    const spots = shuffle(rng, floor.filter(bare))
    const flats = v === 'nest'
      ? [...Array(Math.ceil(floor.length / 9)).fill('in_web_floor'), ...Array(int(rng, 1, 3)).fill('in_eggs'), ...Array(int(rng, 1, 3)).fill('in_bones')]
      : [...Array(int(rng, 1, 3)).fill('in_rubble'), ...(chance(rng, 0.5) ? ['in_puddle'] : []), ...(chance(rng, 0.3) ? ['in_bones'] : [])]
    flats.forEach((n, i) => { if (spots[i]) spots[i].c.overlay = n })
    return
  }
  if (v === 'hideout' || v === 'ruin') {
    for (const { c } of floor) if (WORN[c.skin] && chance(rng, v === 'ruin' ? 0.4 : 0.2)) c.skin = WORN[c.skin]
  }
}

export { MISC }
