// Kivihiisi, the Hiisi of the Pass — the Mountain Pass quest (docs/superpowers/
// specs/2026-09-10-adventure-quests-design.md §4). A giant's oven west of the
// pass, capped with a boulder and ringed with six more; mine the capstone and
// the thing under it gets up, wearing the ring as its skin. The creature's own
// cladding lives in systems/monsters/kivihiisi.js; this module owns the story:
// the arena, the standing-boulder count, the wake, the kill and the hammer.
//
// `stones` (a flag, 6 down to 0) is the truth about the ring, not the map: a
// module-stamped boulder is not in the map JSON, so applyFelled cannot restore
// its cleared state on the next build. onArrive re-stamps exactly `stones`
// boulders; the mined ones stay mined by count.
// onArrive is idempotent and does not run on a cave return (game.js gates the
// tick on !state.cave). Pure — no browser/Electron imports.
import { poiCell } from '../quests.js'
import { markTileDirty } from '../tile-dirty.js'
import { TILE, isWalkable, weaponContents } from '../entities.js'
import { ensureKivihiisi, tickClad } from '../monsters/kivihiisi.js'
import { queueToast, think } from '../feedback.js'
import { sfx } from '../sfx.js'

export const KIUAS = 'hiidenkiuas'
// Six fixed cells at radius 3 — all walkable on the real map, none on the
// mountain to the north (38,27 is a mass cell).
export const RING = [[3, 0], [-3, 0], [0, 3], [3, 3], [-3, -3], [3, -3]]
export const RING_STONES = RING.length
export const CAPSTONE = 'ow_mtn_rock_0'
export const HAMMER = 'ukonvasara'
export const PICK = 'pick'
export const FOUND_TILES = 6     // Chebyshev tiles: how close reads the oven

const S = 32
const centre = c => ({ px: c.x * S + S / 2, py: c.y * S + S / 2 })
const boulderSkin = i => `ow_mtn_rock_${1 + (i % 5)}`   // the ring never reuses the capstone's skin
const stonesOf = flags => flags.stones ?? RING_STONES
const ringCell = (kiuas, i) => ({ x: kiuas.x + RING[i][0], y: kiuas.y + RING[i][1] })
const isBoulder = cell => typeof cell?.overlay === 'string' && cell.overlay.startsWith('ow_mtn_rock_')
const hiisiOf = state => state.entities.find(e => e.type === 'kivihiisi') ?? null
const hasHammer = player => player.weapon?.weaponType === HAMMER || player.inventory.some(i => i.kind === 'weapon' && i.payload?.weaponType === HAMMER)
const hammerOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === HAMMER)
const hasPick = player => player.weapon?.weaponType === PICK || player.inventory.some(i => i.kind === 'weapon' && i.payload?.weaponType === PICK)
const pickOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === PICK)
// The hut's anchor, by openmap.js's own rule (the first village/camp POI).
const villageCell = mapData => { const p = mapData.pois.find(q => q.kind === 'village' || q.kind === 'camp'); return p ? { x: p.x, y: p.y } : null }

// Nearest walkable cell BESIDE `at`, ring by ring from radius 1: never the
// anchor itself (a village POI's cell is its house door — a step onto it
// enters the house) and never `avoid` (the player's own cell — a pickup
// under a freshly spawned player waits for a step off and back).
function walkableNear(map, at, avoid, radius = 3) {
  for (let r = 1; r <= radius; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = at.x + dx, y = at.y + dy
      if (avoid && x === avoid.x && y === avoid.y) continue
      const c = map[y]?.[x]
      if (c && isWalkable(c.tile, c)) return { x, y }
    }
  return null
}

// Adventure rolls no pick in any loot pool, so the quest's first step is
// only reachable because the hermit left his by the door. Re-dropped on
// every arrival while the Hiisi lives (the ring wants mining after the
// wake too), unless one is already carried or lying there.
function dropPick(ctx) {
  const { state, mapData } = ctx
  if (hasPick(state.player) || pickOnGround(state)) return
  const hut = villageCell(mapData)
  const at = hut && walkableNear(state.map, hut, { x: state.player.x, y: state.player.y })
  if (at) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'weapon', ...weaponContents(PICK) }, x: at.x, y: at.y }])
}

// An ordinary Mountain Pass boulder: blocked, mineable by HARVEST (tool
// 'mine'), cleared by clearRock. Any leftover `cleared`/`chopHp` from an
// earlier mining of this cell is wiped so it counts as standing again.
export function stampBoulder(map, c, skin) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.WALL
  cell.overlay = skin
  delete cell.cleared
  delete cell.chopHp
  markTileDirty(map, c.x, c.y)
}

function stampArena(ctx) {
  const { state, flags } = ctx
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return
  if (!flags.hiisi_woken && !isBoulder(state.map[kiuas.y]?.[kiuas.x])) stampBoulder(state.map, kiuas, CAPSTONE)
  const n = stonesOf(flags)
  for (let i = 0; i < n; i++) {
    const c = ringCell(kiuas, i)
    if (!isBoulder(state.map[c.y]?.[c.x])) stampBoulder(state.map, c, boulderSkin(i))
  }
  ctx.ringStamped = n
  ctx.ringCounted = new Set()
}

function spawnHiisi(ctx) {
  const { state, flags } = ctx
  if (hiisiOf(state)) return
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return
  ctx.spawn([{ kind: 'kivihiisi', x: kiuas.x, y: kiuas.y }])
  const h = hiisiOf(state)
  if (h) ensureKivihiisi(h, stonesOf(flags))
}

// The hammer falls where the Hiisi fell (`at`); the kiuas is the fallback for
// a re-drop on arrival after it was lost. Never duplicated.
function dropHammer(ctx, at = null) {
  const { state } = ctx
  if (hasHammer(state.player) || hammerOnGround(state)) return
  at ??= poiCell(ctx.mapData, KIUAS)
  if (at) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'weapon', ...weaponContents(HAMMER) }, x: at.x, y: at.y }])
}

export function onArrive(ctx) {
  const { flags } = ctx
  if (flags.hiisi_dead) { dropHammer(ctx); return }
  dropPick(ctx)
  stampArena(ctx)
  if (flags.hiisi_woken) spawnHiisi(ctx)
}

export function tick(ctx, delta) {
  const { state, flags } = ctx
  if (flags.hiisi_dead) return
  const kiuas = poiCell(ctx.mapData, KIUAS)
  if (!kiuas) return

  // creatureKills is per-visit; the flag is the durable record.
  if (state.creatureKills?.kivihiisi) {
    ctx.set('hiisi_dead')
    const corpse = hiisiOf(state)   // still here this frame, dying; the hammer falls where it fell
    dropHammer(ctx, corpse && { x: corpse.x, y: corpse.y })
    queueToast(state, { title: 'The Hiisi is down', lines: ["Ukko's own hammer lay under the oven.", 'Take it.'] })
    ctx.persist()
    return
  }

  // Standing boulders: a mined ring cell comes off the count, once per cell
  // per visit. The stamped indices are this visit's, not `stones` (which
  // shrinks as they fall). This runs whether or not the Hiisi is awake yet —
  // the ring can be mined out first, per the elder's own advice.
  ctx.ringCounted ??= new Set()
  const newlyCounted = []
  for (let i = 0; i < (ctx.ringStamped ?? 0); i++) {
    if (ctx.ringCounted.has(i)) continue
    const c = ringCell(kiuas, i)
    if (state.map[c.y]?.[c.x]?.cleared !== 'rock') continue
    ctx.ringCounted.add(i)
    newlyCounted.push(i)
  }
  if (newlyCounted.length) {
    ctx.set('stones', Math.max(0, stonesOf(flags) - newlyCounted.length))
    think(state, flags.stones === 0 ? 'Nothing left for it to hide in.' : 'One less stone for its skin.')
    ctx.persist()
  }

  if (!flags.hiisi_woken) {
    const near = Math.max(Math.abs(kiuas.x - state.player.x), Math.abs(kiuas.y - state.player.y)) <= FOUND_TILES
    if (near && !flags.kiuas_found) {
      ctx.set('kiuas_found')
      think(state, "A giant's oven. Something breathes under the capstone.")
      ctx.persist()
    }
    if (state.map[kiuas.y]?.[kiuas.x]?.cleared !== 'rock') return
    ctx.set('hiisi_woken')
    spawnHiisi(ctx)
    sfx(state, 'erupt', centre(kiuas))
    queueToast(state, { title: 'Kivihiisi', lines: ['The oven was its bed.', 'Its skin is the stones around you.'] })
    ctx.persist()
    return
  }

  const h = hiisiOf(state)
  if (h && tickClad(h, delta, stonesOf(flags))) sfx(state, 'wall-slam', { px: h.px, py: h.py })
}
