// Wolves at the Fold — highland-2-fold episode (docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.2). Pure — no browser/Electron
// imports; game.js wires onArrive/tick through the epCtx.
import { poiCell, checkDeliveries } from '../leap.js'
import { HARVEST } from '../lumber.js'
import { isWalkable, weaponContents } from '../entities.js'
import { NPC_SPECIES } from '../../data/npcs.js'
import { sfx } from '../sfx.js'
import { think, announce } from '../feedback.js'

const S = 32

export const DELIVERIES = [{
  item: 'fleece', to: { species: 'elder' }, sets: 'fleece_shown',
  gives: { type: 'weapon', ...weaponContents('pick') },
}]

export const BURN_INTERVAL = 120
export const BURN_STAGES = 4
export const BURN_RADIUS = 6

const DEADTREE = ['ow_deadtree_0', 'ow_deadtree_1']

// A tree overlay for burn purposes: anything HARVEST tags as choppable, plus
// canopy `_top` overlays sitting over a two-cell trunk — those aren't HARVEST
// keys in their own right (only the trunk below them is), but they still
// have to char along with it.
const isTreeOverlay = overlay => typeof overlay === 'string' &&
  (HARVEST[overlay]?.tool === 'chop' || overlay.endsWith('_top'))

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

// Mirrors game.js's dropInventoryItem: the elder's gift lands on a free
// orthogonal walkable tile beside the player and floats in.
function dropGift(state, contents) {
  const { player, map } = state
  const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x === t.x && e.y === t.y))
  if (!adj) return
  state.entities.push({
    type: 'floating_item', contents, x: adj.x, y: adj.y,
    startPx: player.px, startPy: player.py,
    targetPx: adj.x * S + S / 2, targetPy: adj.y * S + S / 2,
    px: player.px, py: player.py, progress: 0, duration: 0.35,
  })
  sfx(state, 'pickup', { px: player.px, py: player.py })
}

function tickBurn(ctx, delta) {
  const { state, mapData, flags } = ctx
  if (flags.fleece_shown) return
  const burn = flags.burn ?? 0
  if (burn >= BURN_STAGES) return
  state.burnT = (state.burnT ?? 0) + delta
  if (state.burnT < BURN_INTERVAL) return
  state.burnT = 0
  const next = burn + 1
  ctx.set('burn', next)
  const keys = burnBand(state.map, mapData, next)
  ctx.set('burnt', [...(flags.burnt ?? []), ...keys])
  const spot = poiCell(mapData, `burn ${next}`)
  sfx(state, 'fire-burst', spot ? { px: spot.x * S + S / 2, py: spot.y * S + S / 2 } : undefined)
  think(state, "Smoke on the ridge — they've lit another band.")
  if (next === BURN_STAGES) {
    setVillageHostile(state, true)
    announce(state, 'The village turns on you!')
  }
  ctx.persist()
}

function tickMaahinen(ctx) {
  const { state, flags } = ctx
  if (!flags.maahinen_spawned || flags.maahinen_dead) return
  if (state.entities.some(e => e.type === 'maahinen')) return
  ctx.set('maahinen_dead')
  ctx.persist()
  ctx.resolve()
}

// Arrival: re-stamp any burnt band from a prior session, and (re)spawn the
// Maahinen at the lair unless it's already dead — mirrors ferry.js's
// spawnNakki-on-arrival so the fight survives a cave dive/return or a fresh
// load. maahinen_spawned only needs setting (and persisting) once.
export function onArrive(ctx) {
  const { state, mapData, flags } = ctx
  applyBurnt(state.map, flags.burnt)
  if (flags.maahinen_dead) return
  const spot = poiCell(mapData, 'lair')
  if (!spot) return
  ctx.spawn([{ kind: 'creature', creature: 'maahinen', x: spot.x, y: spot.y }])
  if (!flags.maahinen_spawned) { ctx.set('maahinen_spawned'); ctx.persist() }
}

export function tick(ctx, delta) {
  const { state } = ctx

  // Delivering the fleece on the same frame a burn tier would land stops
  // that burn: tickBurn checks fleece_shown first thing.
  const delivered = checkDeliveries(ctx, DELIVERIES)
  if (delivered) {
    setVillageHostile(state, false)
    dropGift(state, delivered.gives)
    sfx(state, 'talent-learned', { px: state.player.px, py: state.player.py })
    ctx.refreshInventory()
    ctx.persist()
  }

  tickBurn(ctx, delta)
  tickMaahinen(ctx)
}
