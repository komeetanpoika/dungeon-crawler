// The Sampo's story, part 3, at play (sampo.js is the story): the words in
// the giant's belly, the Sampo made whole, the great hall, the eagle on the
// battlements, and the player's choice of where the Sampo ends up. Runs every
// frame of the Wilds beside sampo-run.js, in the street and under a roof, and
// touches nothing unless the story has something to do. DOM-free.
//
//   tickSampoEnd(state, world, delta, hooks)
//     hooks: { spawn(spawns) -> entities, persist(), refreshInventory?(),
//              rollLoot(depth) -> contents, travel({ floor, stair }),
//              choose(ask, onYes), getState?() }
//     After hooks.travel the caller's state is another object: this returns at once.
//   noteSampoSwing(state, world, hooks)     the player swung a weapon (game.js)
//
// Where things happen is told by the floor the player is on
// (state.cave.building.at: 'belly' under the church; 'hall' and 'battlements'
// in the keep) and, in the street, by the fountain's cell. What must not be
// repeated within a visit is kept on state.cave (it goes with the building);
// everything that lasts is a flag.
//
//   the belly      coming beside the cold forge lights it; with it lit, each
//                  blow struck beside the anvil (one counted every BLOW_GAP
//                  seconds) draws a bellow from Vipunen, the fifth his song:
//                  the words. He then coughs the player out into the crypt.
//   Seppo          when he has said his piece over the words (sampo-run.js
//                  tells it), the Sampo is in the player's sack.
//   the great hall carried beside the lid, the Sampo goes under it; the Count
//                  turns it (his telling), herring covers the floor, Granny
//                  Pohjanen comes with her thanks (hers) and is gone as an
//                  eagle with it.
//   battlements    the eagle is there until beaten (state.creatureKills is
//                  the death); the Sampo then lies where she fell.
//   the choice     carrying it beside the lid, or beside the fountain on the
//                  square, asks once per coming; yes sets it there for good,
//                  with the thanks of whoever got it. The fountain then runs,
//                  and resting by it heals.
import { think, speakFrom, announce, sayDuration, queueToast, addFloat } from '../../systems/feedback.js'
import { sfx } from '../../systems/sfx.js'
import { isWalkable } from '../../systems/entities.js'
import { makeItem, addItem } from '../../systems/inventory.js'
import { makeCampfire } from '../../systems/campfire.js'
import { markTileDirty } from '../../systems/tile-dirty.js'
import { PIECE } from '../layout.js'
import { fromCity } from './geometry.js'
import { PLAN } from './plan.js'
import { PROPS } from './kit.js'
import { residentOf } from './indoors.js'
import { setFlag, startTelling, TELL_REACH } from './sampo-run.js'
import { LID_TILE, BLOWS, VIPUNEN, BELLY, SAMPO, HERRING, FLOOD, HALL, EAGLE_WON, ENDINGS, FOUNTAIN_REST } from './sampo.js'

export const ANVIL_TILE = 'in_anvil'
export const BLOW_GAP = 1.6     // seconds between two blows that count (time to read what he bellows)
export const COUGH_AFTER = 4    // seconds from his song to the crypt
const EAGLE = 'louhi'
const GRANNY = 'named:pohjanen'
const COUNT = 'named:count'
const LOOT_DEPTH = 4

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const floorOf = state => state.cave?.building?.at ?? null
const runOf = state => state.cityRun ?? state.cave?.surface?.cityRun ?? null
const carrying = (player, kind) => !!player.inventory?.some(i => i.kind === kind)
const lying = (state, kind) => state.entities.some(e => e.type === 'floating_item' && e.contents?.type === kind)
function takeAll(player, kind) {
  for (let i = (player.inventory?.length ?? 0) - 1; i >= 0; i--) if (player.inventory[i].kind === kind) player.inventory.splice(i, 1)
}

// Where a piece of furniture stands on a floor, found once a map.
const FOUND = new WeakMap()
function cellOf(map, tile) {
  let by = FOUND.get(map)
  if (!by) FOUND.set(map, by = new Map())
  if (by.has(tile)) return by.get(tile)
  let at = null
  for (let y = 0; y < map.length && !at; y++) for (let x = 0; x < map[y].length; x++) if (map[y][x]?.overlay === tile) { at = { x, y }; break }
  by.set(tile, at)
  return at
}

// Open cells round a point, nearest first: walkable, bare, nobody and nothing on them.
function openCells(state, at, n, r = 4) {
  const out = []
  const busy = new Set(state.entities.map(e => `${e.x},${e.y}`))
  busy.add(`${state.player.x},${state.player.y}`)
  for (let d = 0; d <= r && out.length < n; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || out.length >= n) continue
    const x = at.x + dx, y = at.y + dy, cell = state.map[y]?.[x]
    if (cell && isWalkable(cell.tile, cell) && !cell.overlay && !busy.has(`${x},${y}`)) out.push({ x, y })
  }
  return out
}
function lay(state, hooks, contents, at, r) {
  const [spot] = openCells(state, at, 1, r)
  if (!spot) return false
  state.entities.push(...hooks.spawn([{ kind: 'floating_pickup', contents, ...spot }]))
  return true
}
// into the sack, or at the player's feet if it is full
function hand(state, hooks, kind) {
  if (!addItem(state.player, makeItem(kind)).ok) lay(state, hooks, { type: kind, count: 1 }, state.player)
  sfx(state, 'pickup', { px: state.player.px, py: state.player.py })
  hooks.refreshInventory?.()
}

// ---- the belly ------------------------------------------------------------------------

const forgeOf = anvil => ({ x: anvil.x - 2, y: anvil.y })
const forgeLit = (state, anvil) => { const f = forgeOf(anvil); return state.entities.some(e => e.type === 'campfire' && e.x === f.x && e.y === f.y) }

function belly(state, world, delta, hooks) {
  const f = world.sampo.flags, cave = state.cave, { player } = state
  const anvil = cellOf(state.map, ANVIL_TILE)
  if (!anvil) return false
  cave.blowT = Math.max(0, (cave.blowT ?? 0) - delta)
  if (cave.coughT > 0) {
    cave.coughT -= delta
    if (cave.coughT <= 0) {
      announce(state, BELLY.out)
      sfx(state, 'drag', { px: player.px, py: player.py })
      hooks.travel({ floor: 'crypt', stair: 'up' })
      return true
    }
    return false
  }
  if (f.words || forgeLit(state, anvil)) return false
  const forge = forgeOf(anvil)
  if (cheb(forge, player) <= 1) {
    state.entities.push(makeCampfire(forge.x, forge.y, { eternal: true }))
    sfx(state, 'campfire-light', { px: forge.x * 32 + 16, py: forge.y * 32 + 16 })
    think(state, BELLY.lit)
  } else if (!cave.bellySeen && cheb(anvil, player) <= 4 && !state.feedback?.bubble) {
    cave.bellySeen = true
    think(state, BELLY.cold)
  }
  return false
}

export function noteSampoSwing(state, world, hooks) {
  if (!world?.sampo || floorOf(state) !== 'belly') return
  const f = world.sampo.flags, cave = state.cave
  const anvil = cellOf(state.map, ANVIL_TILE)
  if (f.words || !anvil || cave.blowT > 0 || cheb(anvil, state.player) > 1 || !forgeLit(state, anvil)) return
  cave.blows = (cave.blows ?? 0) + 1
  cave.blowT = BLOW_GAP
  announce(state, VIPUNEN[Math.min(cave.blows, BLOWS) - 1])
  sfx(state, 'wall-slam', { px: anvil.x * 32 + 16, py: anvil.y * 32 + 16 })
  state.shake = Math.max(state.shake ?? 0, 5)
  if (cave.blows < BLOWS) return
  setFlag(state, world, 'words', hooks)
  think(state, BELLY.words, sayDuration(BELLY.words))
  cave.coughT = COUGH_AFTER
}

// ---- the great hall -------------------------------------------------------------------

const npc = (state, id) => state.entities.find(e => e.id === id && e.type === 'npc' && !e.hostile && e.hp > 0)

function hall(state, world, hooks) {
  const f = world.sampo.flags, { player } = state
  const lid = cellOf(state.map, LID_TILE)
  if (!lid || !f.forged || f.eagle) return
  const quiet = !state.telling && !state.feedback?.bubble
  if (!f.set) {
    if (quiet && carrying(player, SAMPO) && manhattan(lid, player) === 1) {
      takeAll(player, SAMPO)
      hooks.refreshInventory?.()
      setFlag(state, world, 'set', hooks)
      sfx(state, 'key-pickup', { px: player.px, py: player.py })
      think(state, HALL.set, sayDuration(HALL.set))
    }
    return
  }
  if (!f.turned) {
    const count = npc(state, COUNT)
    if (quiet && count && cheb(count, player) <= TELL_REACH) startTelling(state, count, world)
    return
  }
  if (!f.flood) {
    // what is in the Count's heart, all over his floor
    const spots = openCells(state, { x: lid.x, y: lid.y + 3 }, FLOOD, 6)
    state.entities.push(...hooks.spawn(spots.map(at => ({ kind: 'floating_pickup', contents: { type: HERRING, count: 1 }, ...at }))))
    f.flood = true
    sfx(state, 'sink', { px: player.px, py: player.py })
    hooks.persist?.()
  }
  let granny = npc(state, GRANNY)
  if (!f.stolen) {
    if (!granny) {
      const [at] = openCells(state, { x: lid.x - 1, y: lid.y + 4 }, 1, 5)
      const person = runOf(state)?.people.get(GRANNY)?.person
      if (!at) return
      const spawn = person ? residentOf(person, {}) : { kind: 'npc', species: 'townsfolk', id: GRANNY, hostile: false, lines: [] }
      state.entities.push(...hooks.spawn([{ ...spawn, x: at.x, y: at.y, roam: 0 }]))
      granny = npc(state, GRANNY)
    }
    if (quiet && granny && cheb(granny, player) <= TELL_REACH) startTelling(state, granny, world)
    return
  }
  // her last word is said: she is away, and the Sampo with her
  if (granny && !state.telling) {
    state.entities = state.entities.filter(e => e !== granny)
    announce(state, HALL.eagle)
    sfx(state, 'enemy-death', { px: granny.px, py: granny.py })
    state.shake = Math.max(state.shake ?? 0, 8)
    think(state, HALL.up)
  }
}

// ---- the battlements ------------------------------------------------------------------

function battlements(state, world, hooks) {
  const f = world.sampo.flags, cave = state.cave
  if (!f.stolen || f.castle || f.fountain) return
  const mid = { x: Math.floor(state.map[0].length / 2), y: Math.floor(state.map.length / 2) }
  if (!f.eagle) {
    const eagle = state.entities.find(e => e.type === EAGLE)
    if (eagle) return
    if (cave.eagleUp && state.creatureKills?.[EAGLE]) {
      setFlag(state, world, 'eagle', hooks)
      think(state, EAGLE_WON, sayDuration(EAGLE_WON))
      sfx(state, 'key-pickup', { px: state.player.px, py: state.player.py })
      cave.sampoLaid = lay(state, hooks, { type: SAMPO, count: 1 }, state.player, 5)
      return
    }
    // a new rising: a kill of her kind before is not this one's
    if (state.creatureKills) delete state.creatureKills[EAGLE]
    const [e] = hooks.spawn([{ kind: EAGLE, x: mid.x, y: mid.y - 2 }])
    if (!e) return
    state.entities.push(e)
    cave.eagleUp = true
    return
  }
  // lost on the way down: it is up here again, once a visit
  if (!cave.sampoLaid && !carrying(state.player, SAMPO) && !lying(state, SAMPO)) lay(state, hooks, { type: SAMPO, count: 1 }, mid, 5)
  cave.sampoLaid = true
}

// ---- the choice, and after ------------------------------------------------------------

// the fountain's cell in the window, or null when the square is not in it
function fountainAt(state, world) {
  if (state.cave || !world.origin) return null
  const { X, Y } = fromCity(PLAN.places.fountain.x, PLAN.places.fountain.y)
  const x = X - world.origin.wx * PIECE, y = Y - world.origin.wy * PIECE
  return state.map[y]?.[x] ? { x, y } : null
}

function settle(state, world, hooks, kind) {
  const E = ENDINGS[kind], { player } = state
  takeAll(player, SAMPO)
  hooks.refreshInventory?.()
  setFlag(state, world, kind, hooks)
  sfx(state, 'key-pickup', { px: player.px, py: player.py })
  queueToast(state, E.toast)
  const spots = openCells(state, player, E.loot, 3).filter(c => cheb(c, player) > 0)
  state.entities.push(...hooks.spawn(spots.map(at => ({ kind: 'floating_pickup', contents: hooks.rollLoot(LOOT_DEPTH), ...at }))))
  const count = E.said ? npc(state, COUNT) : null
  if (count) speakFrom(state, count, E.said, sayDuration(E.said))
  world.sampo.flags.paid = true
  hooks.persist?.()
}

function choice(state, world, hooks) {
  const f = world.sampo.flags, { player } = state
  if (!f.eagle || f.castle || f.fountain) return
  const lid = floorOf(state) === 'hall' ? cellOf(state.map, LID_TILE) : null
  const fountain = fountainAt(state, world)
  const at = lid && manhattan(lid, player) === 1 ? 'castle' : fountain && cheb(fountain, player) <= 2 ? 'fountain' : null
  if (!at) { state.sampoAsked = null; return }
  if (state.sampoAsked === at || !carrying(player, SAMPO) || state.telling) return
  state.sampoAsked = at   // asked once a coming: stepping away and back asks again
  hooks.choose(ENDINGS[at].ask, () => settle(hooks.getState?.() ?? state, world, hooks, at))
}

// The fountain with the Sampo in it: it runs (the basin's art, put right
// whenever the square is in the window), and resting beside it heals.
function fountainRuns(state, world, delta) {
  const at = fountainAt(state, world)
  if (!at) return
  const cell = state.map[at.y][at.x]
  if (cell.overlay === PROPS.fountain.empty) { cell.overlay = PROPS.fountain.full; markTileDirty(state.map, at.x, at.y) }
  const { player } = state
  if (cheb(at, player) > FOUNTAIN_REST.tiles || !(player.hp < player.maxHp)) { state.sampoRest = 0; return }
  state.sampoRest = (state.sampoRest ?? 0) + delta
  if (state.sampoRest < FOUNTAIN_REST.every) return
  state.sampoRest = 0
  player.hp = Math.min(player.maxHp, player.hp + 1)
  addFloat(state.feedback, { px: player.px, py: player.py - 12, text: '+1', kind: 'heal' })
}

export function tickSampoEnd(state, world, delta, hooks) {
  if (!world?.sampo) return
  const f = world.sampo.flags
  if (!f.three) return   // nothing of the ending before the pieces are home
  const floor = floorOf(state)
  if (floor === 'belly' && belly(state, world, delta, hooks)) return
  // Seppo has made it whole: it is the player's to carry
  if (f.whole && !f.forged && !state.telling) {
    f.forged = true
    hand(state, hooks, SAMPO)
    hooks.persist?.()
  }
  if (floor === 'hall') hall(state, world, hooks)
  if (floor === 'battlements') battlements(state, world, hooks)
  choice(state, world, hooks)
  if (f.fountain) fountainRuns(state, world, delta)
}
