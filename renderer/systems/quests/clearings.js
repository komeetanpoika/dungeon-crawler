// Hiiden hirvi, the Elk of Hiisi — the Clearings quest (docs/superpowers/
// specs/2026-09-10-adventure-quests-design.md §2). Three wallows, two
// flushes, one stand, one hide, one talent. The elk's own motion lives in
// systems/monsters/hirvi.js; this module owns the story: where it beds, when
// it is spooked, and what the elder does with the hide.
//
// onArrive is idempotent and rebuilds the world from the flags — it runs on a
// fresh load and on a waystone arrival. It does NOT run after a cave return:
// exitCave (game.js) restores the stashed surface state object whole instead
// of rebuilding it, which is exactly why game.js gates the quest tick on
// `!state.cave` — that guard is what keeps the quest inert while underground,
// rather than this module needing a second idempotence path of its own.
// Pure — no browser/Electron imports; game.js wires onArrive/tick through
// the quest ctx.
import { poiCell, checkDeliveries } from '../quests.js'
import { stampTrail } from './trail.js'
import { ensureHirvi, startBolt, makeStand, FLUSH_TILES } from '../monsters/hirvi.js'
import { grantTalent } from '../talents.js'
import { queueToast, think } from '../feedback.js'
import { sfx } from '../sfx.js'
import { isWalkable } from '../entities.js'

export const SHRINE = 'forest shrine'
export const WALLOWS = ['wallow 1', 'wallow 2', 'wallow 3']
export const DELIVERIES = [{ item: 'elk_hide', to: { species: 'elder' }, sets: 'hide_given' }]

const S = 32
const LAST = WALLOWS.length - 1

const elkOf = state => state.entities.find(e => e.type === 'hirvi') ?? null
const hideOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.type === 'elk_hide')
const carriesHide = player => player.inventory.some(i => i.kind === 'elk_hide')
const flushOf = flags => Math.min(flags.flush ?? 0, LAST)

const ELDER_ID = 'npc:quest:elder'
const hasElder = state => state.entities.some(e => e.type === 'npc' && e.species === 'elder')
// The village anchor, by openmap.js's own rule.
const villageCell = mapData => { const p = mapData.pois.find(q => q.kind === 'village' || q.kind === 'camp'); return p ? { x: p.x, y: p.y } : null }

const wallowCell = (ctx, i) => poiCell(ctx.mapData, WALLOWS[Math.min(i, LAST)])
const centreOf = c => c && { px: c.x * S + S / 2, py: c.y * S + S / 2 }

// The trail into wallow `i`: from the shrine for the first, from the previous
// wallow after that. A blocked path simply lays no trail (stampTrail returns 0).
function layTrail(ctx, i) {
  const from = i === 0 ? poiCell(ctx.mapData, SHRINE) : wallowCell(ctx, i - 1)
  const to = wallowCell(ctx, i)
  if (from && to) stampTrail(ctx.state.map, from, to)
}

// Idempotent like dropHide: a repeat arrival must not spawn a second elk
// on top of the one already bedded or standing here.
function bedElk(ctx, i) {
  const at = wallowCell(ctx, i)
  if (!at) return null
  let elk = elkOf(ctx.state)
  if (!elk) {
    ctx.spawn([{ kind: 'hirvi', x: at.x, y: at.y }])
    elk = elkOf(ctx.state)
    if (!elk) return null
  }
  ensureHirvi(elk)
  if (i >= LAST) makeStand(elk)   // nowhere left to run
  return elk
}

// The hide falls where the elk fell (`at`); the last wallow is only the
// fallback for a re-drop on arrival after it was lost. Never duplicated.
function dropHide(ctx, at = null) {
  const { state } = ctx
  if (carriesHide(state.player) || hideOnGround(state)) return
  at ??= wallowCell(ctx, LAST)
  if (at) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'elk_hide' }, x: at.x, y: at.y }])
}

// Nearest walkable cell to `at`, ring by ring.
function walkableNear(map, at, radius = 4) {
  for (let r = 0; r <= radius; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const c = map[at.y + dy]?.[at.x + dx]
      if (c && isWalkable(c.tile, c)) return { x: at.x + dx, y: at.y + dy }
    }
  return null
}

// The elder is the only hand the hide can go to, and he has 2 hp. A killed
// elder is tombstoned in save.npcs and skipped on every rebuild, so while
// the hide is still owed the quest stands its own in — under an id outside
// npcSpawnIds, which is what keeps recordNpcState from tombstoning him too
// (the same rule game.js uses for the missing villager).
function ensureElder(ctx) {
  const { state, mapData } = ctx
  if (hasElder(state)) return
  const anchor = villageCell(mapData)
  const at = anchor && walkableNear(state.map, anchor)
  if (at) ctx.spawn([{ kind: 'npc', species: 'elder', x: at.x, y: at.y, id: ELDER_ID }])
}

export function onArrive(ctx) {
  const { flags } = ctx
  if (flags.hide_given) return
  ensureElder(ctx)
  if (flags.hirvi_dead) { dropHide(ctx); return }
  const i = flushOf(flags)
  layTrail(ctx, i)
  bedElk(ctx, i)
}

export function tick(ctx, delta) {
  const { state, flags } = ctx

  // The elder's side of it: the hide for a pair of boots.
  if (flags.hide_given) return
  if (flags.hirvi_dead) {
    ensureElder(ctx)   // cheap, and a same-visit kill of the elder must not strand the hide
    if (!checkDeliveries(ctx, DELIVERIES)) return
    grantTalent(state, 'ski_legs')   // queues its own toast and cue
    ctx.refreshInventory()
    ctx.persist()
    return
  }

  // creatureKills is per-visit; the flag is the durable record.
  if (state.creatureKills?.hirvi) {
    ctx.set('hirvi_dead')
    const corpse = elkOf(state)   // still here this frame, dying; the hide falls where it fell
    dropHide(ctx, corpse && { x: corpse.x, y: corpse.y })
    queueToast(state, { title: 'The elk is down', lines: ['Hiisi keeps his herd.', 'Take the hide to the elder.'] })
    ctx.persist()
    return
  }

  const elk = elkOf(state)
  if (!elk) return
  const i = flushOf(flags)

  // A finished bolt: it is gone from here and beds at the next wallow.
  if (elk.bolted) {
    if (i >= LAST) return          // the standing elk never bolts
    state.entities = state.entities.filter(e => e !== elk)
    const next = i + 1
    ctx.set('flush', next)
    layTrail(ctx, next)
    bedElk(ctx, next)
    sfx(state, 'npc-deer', { px: elk.px, py: elk.py })
    think(state, next >= LAST ? 'It is blowing hard. It will not run again.' : 'Fresh tracks, and deep.')
    ctx.persist()
    return
  }

  if (i >= LAST) return            // standing: the brain drives the fight

  // Walking up spooks it; so does a hit that bounced off (hirvi.js marks
  // `spooked`). Either way it runs for the next wallow, where the trail leads.
  const near = Math.max(Math.abs(elk.x - state.player.x), Math.abs(elk.y - state.player.y)) <= FLUSH_TILES
  if (!(near || elk.spooked) || !startBolt(elk, centreOf(wallowCell(ctx, i + 1)))) return
  sfx(state, 'npc-deer', { px: elk.px, py: elk.py })
  if (!flags.hunt_seen) {
    ctx.set('hunt_seen')
    think(state, 'Hooves the size of plates.')
    ctx.persist()
  }
}
