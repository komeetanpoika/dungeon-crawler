// Wolves at the Fold — highland-2-fold episode (docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.2). Pure — no browser/Electron
// imports; game.js wires onArrive/tick through the epCtx.
import { poiCell, checkDeliveries } from '../leap.js'
import { HARVEST } from '../lumber.js'
import { isWalkable, weaponContents, occupiesCell } from '../entities.js'
import { itemFromContents, autoEquipOnPickup } from '../inventory.js'
import { NPC_SPECIES } from '../../data/npcs.js'
import { sfx } from '../sfx.js'
import { think, announce } from '../feedback.js'

const S = 32
const GIFT_MSG_COOLDOWN = 3

export const DELIVERIES = [{
  item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown',
  gives: { type: 'weapon', ...weaponContents('pick') },
}]

export const BURN_INTERVAL = 120
export const BURN_STAGES = 4
export const BURN_RADIUS = 6

const DEADTREE = ['ow_deadtree_0', 'ow_deadtree_1']

// A tree overlay for burn purposes: anything HARVEST tags as choppable, plus
// `ow_tree_*_top` canopy overlays sitting over a two-cell trunk — those
// aren't HARVEST keys in their own right (only the trunk below them is), but
// they still have to char along with it. Scoped to `ow_tree_*` so unrelated
// `_top` art (e.g. `ow_well_top`, also in the fold's palette) never chars.
const isTreeOverlay = overlay => typeof overlay === 'string' &&
  (HARVEST[overlay]?.tool === 'chop' || (overlay.startsWith('ow_tree_') && overlay.endsWith('_top')))

// Every tree overlay within BURN_RADIUS (Chebyshev — the same tile-radius
// idiom leap.js's missingSpawn and nav.js's ringSearch use) of `burn n`'s POI
// chars to a deadtree skin, alternating the two available skins so the band
// doesn't read as one stamped texture. tile/losSoft are left untouched: this
// is a burnt look, not a felling — the band still blocks like a forest.
export function burnBand(map, mapData, n) {
  const spot = poiCell(mapData, `burn ${n}`)
  if (!spot) return []
  const keys = []
  for (let y = spot.y - BURN_RADIUS; y <= spot.y + BURN_RADIUS; y++) {
    for (let x = spot.x - BURN_RADIUS; x <= spot.x + BURN_RADIUS; x++) {
      const cell = map[y]?.[x]
      if (!cell || !isTreeOverlay(cell.overlay)) continue
      cell.overlay = DEADTREE[keys.length % 2]
      keys.push(`${x},${y}`)
    }
  }
  return keys
}

// Re-stamps accumulated burnt keys on a freshly built map (a cave dive/
// return or a reload rebuilds the map from scratch, which would otherwise
// undo the burn).
export function applyBurnt(map, keys) {
  (keys ?? []).forEach((key, i) => {
    if (typeof key !== 'string') return
    const [x, y] = key.split(',').map(Number)
    const cell = map[y]?.[x]
    if (!cell) return
    cell.overlay = DEADTREE[i % 2]
  })
}

// Mirrors onNpcHit's wrath path (systems/npc.js) without going through a hit:
// every village-faction, fight-capable NPC turns hostile together.
function setVillageHostile(state, hostile) {
  state.npcWrath = hostile
  for (const e of state.entities) {
    if (e.type !== 'npc') continue
    const def = NPC_SPECIES[e.species]
    if (def?.faction === 'village' && def.onHit === 'fight') e.hostile = hostile
  }
}

// The free orthogonal walkable tile beside the player, or null. Mirrors
// game.js's dropInventoryItem's own adjacency search.
function freeAdjTile(state) {
  const { player, map } = state
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => occupiesCell(e) && e.x === t.x && e.y === t.y)) ?? null
}

// Whether the pick could land directly in the sack/hand right now: an empty
// weapon hand always has room (autoEquipOnPickup equips into it regardless
// of sack fill), otherwise a free sack slot is needed.
const hasSackRoom = player => !player.weapon || player.inventory.length < player.maxInventory

function dropGiftAt(state, contents, spot) {
  const { player } = state
  state.entities.push({
    type: 'floating_item', contents, x: spot.x, y: spot.y,
    startPx: player.px, startPy: player.py,
    targetPx: spot.x * S + S / 2, targetPy: spot.y * S + S / 2,
    px: player.px, py: player.py, progress: 0, duration: 0.35,
  })
}

// The one delivery this episode declares, checked without side effects so
// the caller can gate on room *before* checkDeliveries consumes the fleece
// and sets fleece_shown.
function pendingDelivery(ctx) {
  const { state, mapData, flags } = ctx
  const d = DELIVERIES[0]
  if (flags[d.sets]) return null
  if (!state.player.inventory.some(i => i.kind === d.item)) return null
  const beside = state.entities.some(e => e.type === 'npc' && e.species === d.to.species && !e.hostile
    && Math.abs(e.x - state.player.x) + Math.abs(e.y - state.player.y) <= 1)
  return beside ? d : null
}

// Never lose the gift: dropped beside the player when there's room on the
// ground; granted straight into the sack/hand when there isn't; and if
// neither has room, the delivery itself is deferred (fleece stays carried,
// fleece_shown stays unset) until the player frees up space.
function tryDeliverFleece(ctx, delta) {
  const { state } = ctx
  if (!pendingDelivery(ctx)) return
  const spot = freeAdjTile(state)
  if (!spot && !hasSackRoom(state.player)) {
    state.foldMsgCooldown = Math.max(0, (state.foldMsgCooldown ?? 0) - delta)
    if (state.foldMsgCooldown <= 0) {
      think(state, 'The elder holds the pick for you.')
      state.foldMsgCooldown = GIFT_MSG_COOLDOWN
    }
    return
  }
  const delivered = checkDeliveries(ctx, DELIVERIES)
  if (!delivered) return
  setVillageHostile(state, false)
  if (spot) dropGiftAt(state, delivered.gives, spot)
  else {
    // itemFromContents returns null for contents it cannot build (an unknown
    // weaponType); nothing to hand over then, but the beat still resolves.
    const item = itemFromContents(delivered.gives)
    if (item) autoEquipOnPickup(state.player, item)
  }
  sfx(state, 'pickup', { px: state.player.px, py: state.player.py })
  sfx(state, 'talent-learned', { px: state.player.px, py: state.player.py })
  ctx.refreshInventory()
  ctx.persist()
}

function tickBurn(ctx, delta) {
  const { state, mapData, flags } = ctx
  if (flags.fleece_shown || flags.maahinen_dead) return
  const burn = flags.burn ?? 0
  if (burn >= BURN_STAGES) return
  state.burnT = (state.burnT ?? 0) + delta
  if (state.burnT < BURN_INTERVAL) return
  state.burnT = 0
  const next = burn + 1
  ctx.set('burn', next)
  const keys = burnBand(state.map, mapData, next)
  ctx.set('burnt', [...new Set([...(flags.burnt ?? []), ...keys])])
  const spot = poiCell(mapData, `burn ${next}`)
  sfx(state, 'fire-burst', spot ? { px: spot.x * S + S / 2, py: spot.y * S + S / 2 } : undefined)
  think(state, "Smoke on the ridge — they've lit another band.")
  if (next === BURN_STAGES) {
    setVillageHostile(state, true)
    announce(state, 'The village turns on you!')
  }
  ctx.persist()
}

// The burrow mouth is the `burrow` POI cell plus its two horizontal
// neighbours, all sealed with rock. lumber.js's harvest tags a mined-through
// rock cell `cleared === 'rock'` (and applyFelled re-tags it on a rebuilt
// map), so one cleared mouth cell means the player broke in.
export function burrowOpen(map, mapData) {
  const mouth = poiCell(mapData, 'burrow')
  if (!mouth) return false
  return [-1, 0, 1].some(dx => map[mouth.y]?.[mouth.x + dx]?.cleared === 'rock')
}

// Puts the Maahinen on the lair POI. Returns whether it actually spawned.
function spawnMaahinen(ctx) {
  const spot = poiCell(ctx.mapData, 'lair')
  if (!spot) { console.warn('fold: no lair POI — the Maahinen cannot spawn'); return false }
  ctx.spawn([{ kind: 'maahinen', x: spot.x, y: spot.y }])
  return true
}

// The Maahinen exists only behind the sealed burrow: it appears when the
// player mines the mouth open (spawning on the arrival that finds it already
// open, so the fight survives a reload or waystone return), and dies only on
// a recorded kill — mere absence is not death, or a not-yet-spawned creature
// would resolve the episode for free.
function tickMaahinen(ctx) {
  const { state, mapData, flags } = ctx
  if (flags.maahinen_dead) return
  if (!flags.maahinen_spawned) {
    if (!burrowOpen(state.map, mapData)) return
    if (!spawnMaahinen(ctx)) return
    ctx.set('maahinen_spawned')
    ctx.persist()
    return
  }
  if (!state.creatureKills?.maahinen) return
  ctx.set('maahinen_dead')
  ctx.persist()
  ctx.resolve()
}

// Arrival (a fresh load or a waystone journey — a cave dive stashes the
// surface state whole and never re-runs this): re-stamp any burnt band from
// a prior session, and put the Maahinen back at the lair if the mouth is
// already open and it is not yet dead. maahinen_spawned only needs setting
// (and persisting) once.
export function onArrive(ctx) {
  const { state, mapData, flags } = ctx
  applyBurnt(state.map, flags.burnt)
  if (flags.maahinen_dead) return
  if (!burrowOpen(state.map, mapData)) return
  if (!spawnMaahinen(ctx)) return
  if (!flags.maahinen_spawned) { ctx.set('maahinen_spawned'); ctx.persist() }
}

export function tick(ctx, delta) {
  // Delivering the fleece on the same frame a burn tier would land stops
  // that burn: tickBurn checks fleece_shown first thing. A delivery deferred
  // for lack of room doesn't set fleece_shown, so the burn timer keeps going.
  tryDeliverFleece(ctx, delta)

  tickBurn(ctx, delta)
  tickMaahinen(ctx)
}
