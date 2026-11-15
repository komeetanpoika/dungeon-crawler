// Tales at play: the quest modules of Adventure (systems/quests/) driven for
// the villages of the Wilds. One ctx per tale in the window; flags live in
// the world record (world.tales), never in Adventure's save. No DOM and no
// game.js import: game.js passes its own hooks.
//
//   hooks = { getState(), spawn(spawns, depth) -> entities, persist(),
//             refreshInventory(), rollLoot(depth) -> chest contents }
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
import { queueToast } from '../systems/feedback.js'
import { TILE } from '../systems/entities.js'

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
    if (place && !out.has(place.village)) out.set(place.village, { v: parseKey(place.village), villageIn: false, placeIn: false })
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
      if (at) out.push({ kind: 'giver', label: 'village', ...at })
      return out
    },
  }
  const lootDepth = () => (placePiece() ?? getPiece(world, v.wx, v.wy)).lootDepth
  const ctx = makeCtx({
    getState: hooks.getState, save: null, record: { [taleKey]: rec }, mapData,
    persist: hooks.persist, refreshInventory: hooks.refreshInventory,
    spawn: spawns => {
      const st = hooks.getState()
      for (const e of hooks.spawn(spawns, lootDepth())) {
        e.taleKey = taleKey
        if (e.type === 'npc') e.linesKey = vKey
        st.entities.push(e)
      }
    },
    onFlag: () => setLines(hooks.getState(), world, vKey, rec),
    extra: {
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
  return { ctx, tale, module: QUEST_MODULES[tale.module], villageIn: false, placeIn: false }
}

// What the people of a tale say: its village's villagers, and whoever lives at its place.
function setLines(state, world, vKey, rec) {
  const lines = fillLines(world, vKey)
  if (!lines) return
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
      if (at.villageIn) state.villageLines[vKey] = PLAIN_LINES[getPiece(world, at.v.wx, at.v.wy).biome] ?? PLAIN_LINES.forest
      continue
    }
    setLines(state, world, vKey, rec)
    let run = runs.get(vKey)
    if (!run) runs.set(vKey, run = makeRun(state, world, vKey, rec, hooks))
    const placeNew = at.placeIn && !run.placeIn, villageNew = at.villageIn && !run.villageIn
    run.placeIn = at.placeIn; run.villageIn = at.villageIn
    // a kill is counted per visit and per kind: another place's must not count here
    if (placeNew && run.tale.creature && state.creatureKills) delete state.creatureKills[run.tale.creature]
    if (placeNew || villageNew) run.module?.onArrive?.(run.ctx)
  }
}

// Once per surface frame, after the Wilds' own tick.
export function tickTales(state, world, delta, hooks) {
  const runs = world._taleRuns
  if (!runs?.size) return
  for (const [vKey, run] of runs) {
    const rec = world.tales.get(vKey)
    if (!rec) continue
    run.module?.tick?.(run.ctx, delta)
    if (rec.done || !run.tale.rule(rec.flags)) continue
    rec.done = true
    const place = rec.place && world.places.get(rec.place)
    if (place) place.done = true   // released: it may now be forgotten like other land
    if (rec.special === false) pay(state, world, vKey, run, hooks)
    setLines(state, world, vKey, rec)
    hooks.persist()
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
