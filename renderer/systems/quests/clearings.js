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

export const SHRINE = 'forest shrine'
export const WALLOWS = ['wallow 1', 'wallow 2', 'wallow 3']
export const DELIVERIES = [{ item: 'elk_hide', to: { species: 'elder' }, sets: 'hide_given' }]

const S = 32
const LAST = WALLOWS.length - 1

const elkOf = state => state.entities.find(e => e.type === 'hirvi') ?? null
const hideOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.type === 'elk_hide')
const carriesHide = player => player.inventory.some(i => i.kind === 'elk_hide')
const flushOf = flags => Math.min(flags.flush ?? 0, LAST)

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

// The hide waits at the last wallow until it is picked up. Re-dropped on
// arrival if it was lost, never duplicated.
function dropHide(ctx) {
  const { state } = ctx
  if (carriesHide(state.player) || hideOnGround(state)) return
  const at = wallowCell(ctx, LAST)
  if (at) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'elk_hide' }, x: at.x, y: at.y }])
}

export function onArrive(ctx) {
  const { flags } = ctx
  if (flags.hide_given) return
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
    if (!checkDeliveries(ctx, DELIVERIES)) return
    grantTalent(state, 'ski_legs')   // queues its own toast and cue
    ctx.refreshInventory()
    ctx.persist()
    return
  }

  // creatureKills is per-visit; the flag is the durable record.
  if (state.creatureKills?.hirvi) {
    ctx.set('hirvi_dead')
    dropHide(ctx)
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
