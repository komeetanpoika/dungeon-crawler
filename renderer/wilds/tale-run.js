// Tales at play: the quest modules of Adventure (systems/quests/) driven for
// the villages of the Wilds. One ctx per tale in the window; flags live in
// the world record (world.tales), never in Adventure's save. No DOM and no
// game.js import: game.js passes its own hooks.
//
//   hooks = { getState(), spawn(spawns, depth) -> entities, persist(),
//             refreshInventory(), rollLoot(depth) -> chest contents,
//             save() -> the Wilds save (its clock), isNight() -> boolean,
//             grantTalent(id) }
//
// The Timewarp episodes (systems/episodes/) run here too, for a stranger:
// no Echo (a tale's `remarks` are thought by the player on first coming near
// a point), and the tale's missing villager comes home when it is done.
//
// A module finds its places through mapData.pois. Here those are the named
// points of the tale's place and the giver village's centre, in window tiles
// at the moment of asking (the window moves), and only while their piece is
// in the window: a module that asks for a point that is not there gets null
// and, as on the Adventure maps, does nothing with it.
import { TALES, PLAIN_LINES } from '../data/tales.js'
import { taleRecord, fillLines } from './tales.js'
import { PIECE, pieceKey } from './layout.js'
import { WIN } from './window.js'
import { getPiece } from './world.js'
import { makeCtx } from '../systems/story.js'
import { QUEST_MODULES } from '../systems/quests/index.js'
import { EPISODE_MODULES } from '../systems/episodes/index.js'
import * as lalli from './tale-lalli.js'
import { queueToast, think } from '../systems/feedback.js'
import { TILE } from '../systems/entities.js'
import { recutDeck } from './bridge-art.js'

// tales with a module of their own (`engine: 'wilds'`), not one borrowed from an older mode
const WILDS_MODULES = { lalli }
const SEES_TILES = 10   // how near a thing must be for the player to remark on it
const parseKey = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }
const inWindow = (world, p) => !!world.origin && p.wx >= world.origin.wx && p.wx < world.origin.wx + WIN
  && p.wy >= world.origin.wy && p.wy < world.origin.wy + WIN
const toWin = (world, p, c) => ({ x: (p.wx - world.origin.wx) * PIECE + c.x, y: (p.wy - world.origin.wy) * PIECE + c.y })

// Every village and every tale's place in the window, as the tales they belong to.
function talesInWindow(world) {
  const out = new Map()   // villageKey -> { v, villageIn, placeIn }
  const o = world.origin
  for (let wy = o.wy; wy < o.wy + WIN; wy++) for (let wx = o.wx; wx < o.wx + WIN; wx++) {
    const key = pieceKey(wx, wy)
    if (getPiece(world, wx, wy).village) out.set(key, { v: { wx, wy }, villageIn: true, placeIn: false })
    const place = world.places.get(key)
    // (a place of the Sampo's is no village's: city/sampo-places.js plays it)
    if (place && place.village !== 'sampo' && !out.has(place.village)) out.set(place.village, { v: parseKey(place.village), villageIn: false, placeIn: false })
  }
  for (const [vKey, t] of out) {
    const rec = world.tales.get(vKey)
    t.placeIn = !!rec?.place && world.places.has(rec.place) && inWindow(world, parseKey(rec.place))
  }
  return out
}

function makeRun(state, world, vKey, rec, hooks) {
  const v = parseKey(vKey)
  const taleKey = `tale:${vKey}`
  const tale = TALES[rec.id]
  const placePiece = () => rec.place && world.places.has(rec.place) && inWindow(world, parseKey(rec.place))
    ? getPiece(world, ...Object.values(parseKey(rec.place))) : null
  const villagePoint = () => {
    if (!inWindow(world, v)) return null
    const piece = getPiece(world, v.wx, v.wy)
    return piece.village ? toWin(world, v, piece.village) : null
  }
  const mapData = {
    name: taleKey,
    get pois() {
      const out = []
      const piece = placePiece()
      if (piece) for (const p of piece.points) out.push({ kind: 'landmark', label: p.label, ...toWin(world, piece, p) })
      const at = villagePoint()
      if (at) {
        out.push({ kind: 'giver', label: 'village', ...at })
        // what the village's own tale left standing in it (the hearths)
        for (const p of getPiece(world, v.wx, v.wy).villagePoints ?? []) out.push({ kind: 'landmark', label: p.label, ...toWin(world, v, p) })
      }
      return out
    },
  }
  const lootDepth = () => (placePiece() ?? getPiece(world, v.wx, v.wy)).lootDepth
  const ctx = makeCtx({
    getState: hooks.getState, save: hooks.save?.() ?? { clock: 0 }, record: { [taleKey]: rec }, mapData,
    persist: hooks.persist, refreshInventory: hooks.refreshInventory,
    // an episode says it is done; the tale's rule is still what finishes it
    resolve: () => { ctx.set('resolved') },
    spawn: spawns => {
      const st = hooks.getState()
      for (const e of hooks.spawn(spawns, lootDepth())) {
        e.taleKey = taleKey
        if (e.type === 'npc') e.linesKey = vKey
        // the flame-thief keeps to its village: it sees no fire and wanders nowhere beyond it
        if (e.type === 'sammunut') {
          const c = villagePoint()
          if (c) e.leash = { x: c.x, y: c.y, r: 36 }
          e.bane = 'greywood'   // any dead tree's wood is an ordinary fire to it here
        }
        st.entities.push(e)
      }
    },
    onFlag: () => setLines(hooks.getState(), world, vKey, rec),
    extra: {
      inWilds: true,
      episode: { houses: tale.houses ?? {}, resolvedLines: null },
      // the flame-thief (episodes/hermit.js): grey wood only, this village's
      // people and fires only, the hour left alone, and a Sammunut that rises
      // a short walk from the village instead of at the far corner of a map
      wood: 'greywood',
      runtime: {},
      isWorker: e => e.wildsKey === vKey,
      keepClock: true,
      hasWraith: () => hooks.getState().entities.some(e => e.type === 'sammunut' && e.taleKey === taleKey),
      hasCreature: kind => hooks.getState().entities.some(e => e.type === kind && e.taleKey === taleKey),
      ownsWraith: e => e.taleKey === taleKey,
      ownsFire: f => { const c = villagePoint(); return !!c && Math.max(Math.abs(f.x - c.x), Math.abs(f.y - c.y)) <= 12 },
      wraithSpot: () => {
        const c = villagePoint(), map = hooks.getState().map
        if (!c) return null
        const o = toWin(world, v, { x: 0, y: 0 })
        for (let r = 30; r >= 20; r--) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = c.x + dx, y = c.y + dy
          if (x < o.x + 2 || y < o.y + 2 || x > o.x + PIECE - 3 || y > o.y + PIECE - 3) continue
          if (map[y]?.[x]?.tile === TILE.FLOOR) return { x, y }
        }
        return null
      },
      onResolved: () => setLines(hooks.getState(), world, vKey, rec),
      // the fold (episodes/fold.js): its timer waits for the stranger, nobody
      // turns on them (the tale's `shut` closes the village instead), and burnt
      // cells are kept in the ridge's own tiles, not the window's
      burning: () => !!rec.flags.begun,
      turnVillage: () => {},
      cellKey: (x, y) => { const piece = placePiece(); if (!piece) return null; const o = toWin(world, piece, { x: 0, y: 0 }); return `${x - o.x},${y - o.y}` },
      cellOf: key => { const piece = placePiece(); if (!piece) return null; const [x, y] = key.split(',').map(Number); return toWin(world, piece, { x, y }) },
      // a plank laid or lifted on a pier (the causeway's gaps, the ferryman's
      // pier): the Wilds' bridges are plank deck, cut again round the change
      deck: c => recutDeck(hooks.getState().map, c.x, c.y, { X0: world.origin.wx * PIECE, Y0: world.origin.wy * PIECE }),
      isGiver: e => e.wildsKey === vKey || e.taleKey === taleKey,
      giverCell: villagePoint,
      sees: c => { const p = hooks.getState().player; return !!c && Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= SEES_TILES },
      // The special reward is had once per world and kind; decided the first
      // time a module reaches for it, and then fixed for this tale.
      special: () => {
        rec.special ??= !world.paid.has(rec.id)
        if (rec.special) world.paid.add(rec.id)
        return rec.special
      },
    },
  })
  const module = { episode: EPISODE_MODULES, wilds: WILDS_MODULES }[tale.engine]?.[tale.module] ?? QUEST_MODULES[tale.module]
  return { ctx, tale, module, vKey, taleKey, villagePoint, villageIn: false, placeIn: false }
}

// What the people of a tale say: its village's villagers, and whoever lives at its place.
const plainLines = (world, vKey) => { const v = parseKey(vKey); return PLAIN_LINES[getPiece(world, v.wx, v.wy).biome] ?? PLAIN_LINES.forest }
function setLines(state, world, vKey, rec) {
  // a tale with nothing to say yet leaves its village talking about its country
  const tale = rec && TALES[rec.id]
  // a village that has shut the player out says only that
  const lines = (tale?.shut?.(rec.flags) && tale.shutLines) || fillLines(world, vKey) || plainLines(world, vKey)
  state.villageLines ??= {}
  state.villageLines[vKey] = lines
  if (rec?.place) state.villageLines[rec.place] = lines
}

// Call after the window is built anew (`fresh`: entering the Wilds, waking
// after death) and after every re-centre.
export function arriveTales(state, world, hooks, { fresh = false } = {}) {
  if (!world.origin) return
  const runs = world._taleRuns ??= new Map()
  if (fresh) runs.clear()
  const live = talesInWindow(world)
  state.villageLines = {}
  for (const key of [...runs.keys()]) if (!live.has(key)) runs.delete(key)
  for (const [vKey, at] of live) {
    const rec = world.tales.get(vKey) ?? (at.villageIn ? taleRecord(world, at.v) : null)
    if (!rec) {
      // a village with no tale talks about its country
      if (at.villageIn) state.villageLines[vKey] = plainLines(world, vKey)
      continue
    }
    setLines(state, world, vKey, rec)
    let run = runs.get(vKey)
    if (!run) runs.set(vKey, run = makeRun(state, world, vKey, rec, hooks))
    const placeNew = at.placeIn && !run.placeIn, villageNew = at.villageIn && !run.villageIn
    run.placeIn = at.placeIn; run.villageIn = at.villageIn
    // a kill is counted per visit and per kind: another place's must not count
    // where this tale's creature lives
    const lairNew = run.tale.creatureAt === 'village' ? villageNew : placeNew
    if (lairNew && run.tale.creature && state.creatureKills) delete state.creatureKills[run.tale.creature]
    const on = run.tale.arriveOn ?? 'both'
    if ((placeNew && on !== 'village') || (villageNew && on !== 'place')) run.module?.onArrive?.(run.ctx)
    if (placeNew && !rec.done) run.tale.arrive?.(arrival(state, run, rec))
    if (rec.done) comeHome(state, run)
  }
}

// Once per surface frame, after the Wilds' own tick.
export function tickTales(state, world, delta, hooks) {
  const runs = world._taleRuns
  if (!runs?.size) return
  for (const [vKey, run] of runs) {
    const rec = world.tales.get(vKey)
    if (!rec) continue
    begin(state, run, rec)
    // a tale's own upkeep, about once a second while its place is here
    if (run.tale.tend && run.placeIn && !rec.done && (run.tendT = (run.tendT ?? 0) + delta) >= 1) {
      run.tendT = 0
      run.tale.tend(arrival(state, run, rec))
    }
    tickModule(state, vKey, run, delta)
    remark(state, run, rec)
    if (rec.done || !run.tale.rule(rec.flags, ruleCtx(state, run, rec, hooks))) continue
    rec.done = true
    const place = rec.place && world.places.get(rec.place)
    if (place) place.done = true   // released: it may now be forgotten like other land
    // an episode has no reward of its own: the tale names a talent, had once per world
    if (run.tale.reward && run.ctx.special()) hooks.grantTalent?.(run.tale.reward)
    if (rec.special === false) pay(state, world, vKey, run, hooks)
    comeHome(state, run)
    setLines(state, world, vKey, rec)
    hooks.persist()
  }
}

// A module learns of its creature's death from state.creatureKills, which is
// keyed by kind and outlives re-centres, caves and death. So a kill is shown
// only to the tale whose creature it was (here now, or here last tick), and
// taken away once that tale has seen it: a village whose own place is not in
// the window must not be finished by another village's kill.
function tickModule(state, vKey, run, delta) {
  const kind = run.tale.creature
  const kills = state.creatureKills
  if (!kind || !kills?.[kind]) {
    if (kind) run.sawCreature = (run.tale.creatureAt === 'village' ? run.villageIn : run.placeIn)
      && state.entities.some(e => e.type === kind && e.taleKey === `tale:${vKey}`)
    run.module?.tick?.(run.ctx, delta)
    // a kill the module itself dealt this tick (the Hiisi's last stone) was settled in it
    if (kind && run.sawCreature && state.creatureKills?.[kind]) delete state.creatureKills[kind]
    return
  }
  const lairIn = run.tale.creatureAt === 'village' ? run.villageIn : run.placeIn
  const here = lairIn && state.entities.some(e => e.type === kind && e.taleKey === `tale:${vKey}`)
  const mine = here || (lairIn && run.sawCreature)
  run.sawCreature = here
  if (mine) {
    run.module?.tick?.(run.ctx, delta)
    delete kills[kind]
  } else {
    const kept = kills[kind]
    delete kills[kind]
    run.module?.tick?.(run.ctx, delta)
    kills[kind] = kept
  }
}

// A tale whose special reward this world has already had pays in loot: two
// chests' worth at the village's toughness, laid at the player's feet.
function pay(state, world, vKey, run, hooks) {
  const v = parseKey(vKey)
  const village = getPiece(world, v.wx, v.wy)
  const { player } = state
  const spots = []
  for (let r = 1; r <= 2 && spots.length < 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || spots.length >= 2) continue
    if (state.map[player.y + dy]?.[player.x + dx]?.tile === TILE.FLOOR) spots.push({ x: player.x + dx, y: player.y + dy })
  }
  run.ctx.spawn(spots.map(at => ({ kind: 'floating_pickup', contents: hooks.rollLoot(village.lootDepth), ...at })))
  queueToast(state, { title: village.village?.name ?? run.tale.title, lines: ['The village pays what it can.', 'Take it.'] })
}

// What a tale's rule may ask beyond its flags. The den's wolves are counted
// while the place is in the window and remembered in the flags for when it
// is not (a wolf cannot die out of sight).
function ruleCtx(state, run, rec, hooks) {
  if (run.placeIn) {
    const wolves = state.entities.filter(e => e.type === 'npc' && e.species === 'wolf' && e.hp > 0
      && (e.taleKey === run.taleKey || e.wildsKey === rec.place)).length
    if (rec.flags.wolves !== wolves && run.tale.id === 'fold') rec.flags.wolves = wolves
  }
  return { wolvesAlive: rec.flags.wolves ?? 0, night: !!hooks.isNight?.() }
}

// The stranger's own thoughts on first coming near a thing: what the Echo
// used to say. One at a time, each once (flags.said holds the indices).
function remark(state, run, rec) {
  const remarks = run.tale.remarks
  if (!remarks?.length || state.feedback?.bubble) return
  const said = rec.flags.said ?? []
  const { player } = state
  const pois = run.ctx.mapData.pois
  for (let i = 0; i < remarks.length; i++) {
    const r = remarks[i]
    if (said.includes(i) || (r.when && !r.when(rec.flags))) continue
    const at = pois.find(p => p.label === r.at)
    if (!at || Math.max(Math.abs(at.x - player.x), Math.abs(at.y - player.y)) > (r.within ?? 4)) continue
    think(state, r.text)
    run.ctx.set('said', [...said, i])
    return
  }
}

// The missing villager is home once their tale is done: beside the village's
// middle, with their own face (role 'missing'), every time the village is here.
function comeHome(state, run) {
  const who = run.tale.missing
  if (!who || !run.villageIn) return
  const id = `npc:${run.taleKey}:missing`
  if (state.entities.some(e => e.id === id)) return
  const c = run.villagePoint()
  if (!c) return
  const taken = (x, y) => state.entities.some(e => e.x === x && e.y === y)
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
    const x = c.x + dx, y = c.y + dy
    if (state.map[y]?.[x]?.tile !== TILE.FLOOR || state.map[y][x].overlay || taken(x, y)) continue
    run.ctx.spawn([{ kind: 'npc', species: who.species, role: 'missing', hostile: false, id, x, y }])
    return
  }
}

// A door that opens on a story room, at a tale's place or in the village
// that tells it (Lalli's house): the episode-shaped record game.js hands the
// interior builder ({ houses }), or null.
export function storyEpisode(world, door) {
  const m = /^house:wilds:(-?\d+),(-?\d+)$/.exec(door?.label ?? '')
  if (!m || !door.story) return null
  const key = pieceKey(Math.floor(m[1] / PIECE), Math.floor(m[2] / PIECE))
  // a house declared `in: 'village'` stands in the village; every other at the tale's place
  const place = world.places.get(key)?.id, village = world.tales.get(key)?.id
  const at = id => id && TALES[id]?.houses?.[door.story]
  const id = at(place) && at(place).in !== 'village' ? place : at(village)?.in === 'village' ? village : null
  return id ? { houses: TALES[id].houses } : null
}

// A tale that `begins: 'village'` starts its clock when the player first
// stands in its village (within 10 tiles of the middle), not when the village
// first comes into the window.
function begin(state, run, rec) {
  if (run.tale.begins !== 'village' || rec.flags.begun || !run.villageIn) return
  const c = run.villagePoint(), p = state.player
  if (c && Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= 10) run.ctx.set('begun')
}

// What a tale's own `arrive` gets when its place enters the window.
function arrival(state, run, rec) {
  const isWolf = e => e.type === 'npc' && e.species === 'wolf' && e.hp > 0 && (e.taleKey === run.taleKey || e.wildsKey === rec.place)
  return {
    state, flags: rec.flags,
    point: label => run.ctx.mapData.pois.find(p => p.label === label) ?? null,
    // up to n free walkable cells within 3 tiles of a point
    free: (at, n) => {
      const out = []
      for (let r = 1; r <= 3 && out.length < n; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || out.length >= n) continue
        const x = at.x + dx, y = at.y + dy
        if (state.map[y]?.[x]?.tile === TILE.FLOOR && !state.entities.some(e => e.x === x && e.y === y)) out.push({ x, y })
      }
      return out
    },
    spawn: spawns => run.ctx.spawn(spawns.map(s => ({ ...s, id: `npc:${run.taleKey}:${s.id}` }))),
    think: text => think(state, text),
    wolves: () => state.entities.filter(isWolf).length,
    // is the player at least n tiles from a point?
    away: (at, n) => Math.max(Math.abs(at.x - state.player.x), Math.abs(at.y - state.player.y)) >= n,
  }
}
