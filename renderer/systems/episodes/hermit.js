// The Hermit's Fire — marsh-3-hermit episode (docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.3, reworked 2026-09-07). Every dusk
// the villagers walk out and light the three village hearths; in the dark
// the Sammunut drifts in and puts them out. Hand a villager three grey
// deadwood from the hermit's knoll and they light that hearth blue instead —
// an eternal fire the wraith cannot snuff. With all three burning blue the
// wraith is doomed: it is drawn into the village light and burns out, which
// records the kill that resolves the episode. Pure — no browser/Electron
// imports; game.js wires onArrive/tick through the epCtx.
import { poiCell } from '../leap.js'
import { makeCampfire, canBuildCampfire, spendLumber, CAMPFIRE_COST } from '../campfire.js'
import { isWalkable } from '../entities.js'
import { DAY_LENGTH } from '../../data/weather.js'
import { isNight } from '../weather.js'
import { sfx } from '../sfx.js'
import { think, speakFrom } from '../feedback.js'

const S = 32
export const SAMMUNUT_MIN_DIST = 20
export const HEARTH_LABELS = ['hearth 1', 'hearth 2', 'hearth 3']
export const WOOD_PER_HEARTH = CAMPFIRE_COST
export const ARRIVAL_CLOCK = 0.58 * DAY_LENGTH   // late afternoon: the first dusk is under a minute away
export const CHORE_TIMEOUT = 20                   // s before a hearth lights without its villager having got there
export const DELIVERY_COOLDOWN = 2                // s between handovers, so each one reads
export const SNUFF_SEEN_RANGE = 12                // tiles: a hearth going out this close is seen

const WORKERS = ['villager', 'elder']   // species that light the hearths
const LIT_LINES = ['There. Till it comes.', 'Another night of it.', 'Burn, then.']
const BLUE_LINES = ['Blue. Like his.', 'It holds. Look at it.', 'That colour. His hearth burned so.']
const TAKE_LINES = ['Grey wood. The old man’s.', 'Cold wood. We’ll see if it holds.', 'His wood. Give it here.']

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

export { isNight }

export const woodFlag = n => `wood_${n}`
export const allBlue = flags => HEARTH_LABELS.every((_, i) => flags[woodFlag(i + 1)])

// The first interior walkable cell at least SAMMUNUT_MIN_DIST tiles
// (Chebyshev) from the player, scanning row-major from the map's far corner
// (bottom-right) inward — deterministic, no RNG involved.
export function sammunutSpot(map, player, minDist = SAMMUNUT_MIN_DIST) {
  const h = map.length, w = map[0]?.length ?? 0
  for (let y = h - 2; y >= 1; y--) {
    for (let x = w - 2; x >= 1; x--) {
      if (cheb(x, y, player.x, player.y) < minDist) continue
      const cell = map[y][x]
      if (isWalkable(cell.tile, cell)) return { x, y }
    }
  }
  return null
}

// Switches the three cold hearth props to lit — called once the wraith is
// dead, and re-derived on every later arrival while wraith_dead holds (the
// map is rebuilt from scratch on a cave dive/return or a fresh load).
export function lightHearths(map, mapData) {
  for (const label of HEARTH_LABELS) {
    const spot = poiCell(mapData, label)
    const cell = spot && map[spot.y]?.[spot.x]
    if (cell) cell.overlay = 'prop_hearth_lit'
  }
}

// A campfire entity within Chebyshev 1 of the hearth cell, or null.
export function hearthFireAt(entities, hearth) {
  if (!hearth) return null
  return entities.find(e => e.type === 'campfire' && cheb(e.x, e.y, hearth.x, hearth.y) <= 1) ?? null
}

// The walkable cell beside the hearth (8-neighbourhood) nearest `from` — where
// a villager stands to light it — skipping any in `tried`. Orthogonal
// neighbours always win over diagonal ones (a diagonal pocket can be
// unreachable for the 4-way pathfinder). Null when nothing is left.
export function standSpot(map, hearth, from, tried = []) {
  let best = null, bestD = Infinity
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue
    const x = hearth.x + dx, y = hearth.y + dy
    const cell = map[y]?.[x]
    if (!cell || !isWalkable(cell.tile, cell)) continue
    if (tried.some(t => t.x === x && t.y === y)) continue
    const d = Math.hypot(x - from.x, y - from.y) + (dx && dy ? 100 : 0)
    if (d < bestD) { bestD = d; best = { x, y } }
  }
  return best
}

const hearths = mapData => HEARTH_LABELS.map((label, i) => ({ n: i + 1, cell: poiCell(mapData, label) })).filter(h => h.cell)
const isWorker = e => e.type === 'npc' && WORKERS.includes(e.species) && !e.hostile && e.role !== 'missing'
const pick = (lines, e) => lines[Math.abs(hashId(e.id)) % lines.length]
function hashId(id) { let h = 0; for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return h }

// The nearest worker with no chore, or null.
function freeWorker(entities, cell) {
  let best = null, bestD = Infinity
  for (const e of entities) {
    if (!isWorker(e) || e.chore) continue
    const d = Math.hypot(e.x - cell.x, e.y - cell.y)
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}

function assignChore(state, e, n, cell, blue) {
  e.chore = { hearth: n, blue, t: 0, tried: [] }
  sendToHearth(state, e, cell)
}

// Points the villager at the next untried stand spot beside the hearth; the
// npc go_to goal drops `objective` when a spot proves unpathable, and the
// chore tick then calls this again for the next one.
function sendToHearth(state, e, cell) {
  const spot = standSpot(state.map, cell, e, e.chore.tried)
  if (spot) e.chore.tried.push(spot)
  e.objective = spot
  e.ai.wanderPt = null
  e.ai.dwell = 0
}

function spawnWraith(ctx) {
  const { state, flags } = ctx
  const spot = sammunutSpot(state.map, state.player)
  if (!spot) { console.warn(`hermit: no spot ${SAMMUNUT_MIN_DIST}+ tiles from the player — the Sammunut cannot spawn`); return }
  ctx.spawn([{ kind: 'sammunut', x: spot.x, y: spot.y }])
  if (!flags.sammunut_spawned) { ctx.set('sammunut_spawned'); ctx.persist() }
}

// Lights hearth n blue: an eternal deadwood fire on the hearth cell itself,
// replacing whatever ordinary fire was burning beside it.
function lightBlue(state, cell) {
  const old = hearthFireAt(state.entities, cell)
  if (old?.eternal) return old
  if (old) state.entities = state.entities.filter(e => e !== old)
  const fire = makeCampfire(cell.x, cell.y, { eternal: true, fuel: 'deadwood' })
  state.entities.push(fire)
  return fire
}

// Fires are not saved: every delivered hearth re-derives its blue fire from
// its flag alone, unless one is already burning there (a second onArrive on
// the same session, or an arrival that hasn't rebuilt entities).
function relightBlue(ctx) {
  const { state, mapData, flags } = ctx
  for (const { n, cell } of hearths(mapData)) if (flags[woodFlag(n)]) lightBlue(state, cell)
}

// Arrival — a fresh load or a waystone journey; a cave dive stashes the
// surface state whole and never re-runs this.
export function onArrive(ctx) {
  const { state, mapData, flags, episode, save } = ctx
  state.hermit = { lit: {}, seen: {}, deliverT: 0 }
  relightBlue(ctx)
  if (flags.wraith_dead) {
    lightHearths(state.map, mapData)
    state.villagerLines = episode.resolvedLines
    return
  }
  if (!flags.arrived) {
    save.clock = ARRIVAL_CLOCK
    ctx.set('arrived')
    ctx.persist()
  }
  spawnWraith(ctx)
}

const runtime = state => state.hermit ??= { lit: {}, seen: {}, deliverT: 0 }

// Dusk: every cold hearth without a fire, a chore or a lighting already this
// night gets the nearest free villager. Dawn: the ordinary hearth fires go
// out, unfinished dusk chores are dropped and the night's record clears, so
// the next dusk starts over. A blue chore is kept — that wood was handed over.
function tickHearths(ctx) {
  const { state, mapData, flags, save } = ctx
  const rt = runtime(state)
  if (!isNight(save.clock)) {
    if (Object.keys(rt.lit).length) rt.lit = {}
    state.entities = state.entities.filter(e => !(e.type === 'campfire' && e.hearth))
    for (const e of state.entities) if (e.chore && !e.chore.blue) { delete e.chore; e.objective = null }
    return
  }
  for (const { n, cell } of hearths(mapData)) {
    if (flags[woodFlag(n)] || rt.lit[n] || hearthFireAt(state.entities, cell)) continue
    if (state.entities.some(e => e.chore?.hearth === n)) continue
    const worker = freeWorker(state.entities, cell)
    if (!worker) continue
    assignChore(state, worker, n, cell, false)
  }
}

// A villager beside their hearth (or one that has run out the timeout —
// stuck on a path, or hostile now) lights it: ordinary and snuffable for a
// dusk chore, blue and eternal for a delivered one.
function tickChores(ctx, delta) {
  const { state, mapData, flags } = ctx
  const rt = runtime(state)
  for (const e of state.entities) {
    if (!e.chore) continue
    const cell = poiCell(mapData, HEARTH_LABELS[e.chore.hearth - 1])
    // a dusk chore for a hearth that has since gone blue has nothing to do
    if (!cell || (!e.chore.blue && flags[woodFlag(e.chore.hearth)])) { delete e.chore; e.objective = null; continue }
    e.chore.t += delta
    const there = cheb(e.x, e.y, cell.x, cell.y) <= 1
    if (!there && e.chore.t < CHORE_TIMEOUT) {
      if (!e.objective) sendToHearth(state, e, cell)
      continue
    }
    if (e.chore.blue) {
      const fire = lightBlue(state, cell)
      sfx(state, 'grey-fire', { px: fire.px, py: fire.py })
      speakFrom(state, e, pick(BLUE_LINES, e))
    } else if (!hearthFireAt(state.entities, cell)) {
      const fire = makeCampfire(cell.x, cell.y, { hearth: true })
      state.entities.push(fire)
      sfx(state, 'campfire-light', { px: fire.px, py: fire.py })
      speakFrom(state, e, pick(LIT_LINES, e))
    }
    rt.lit[e.chore.hearth] = true
    delete e.chore
    e.objective = null
  }
}

// Three deadwood in the sack beside a villager: they take it and go to light
// the first cold hearth blue. One hearth per handover, a breath apart.
function tickDelivery(ctx, delta) {
  const { state, mapData, flags } = ctx
  const rt = runtime(state)
  rt.deliverT = Math.max(0, rt.deliverT - delta)
  if (rt.deliverT > 0 || allBlue(flags)) return
  const { player } = state
  if (!canBuildCampfire(player, 'deadwood').ok) return
  const v = state.entities.find(e => isWorker(e) && Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 1)
  if (!v) return
  const target = hearths(mapData).find(h => !flags[woodFlag(h.n)])
  if (!target) return
  spendLumber(player, 'deadwood')
  ctx.set(woodFlag(target.n))
  ctx.refreshInventory()
  assignChore(state, v, target.n, target.cell, true)
  speakFrom(state, v, pick(TAKE_LINES, v))
  sfx(state, 'pickup', { px: v.px, py: v.py })
  rt.deliverT = DELIVERY_COOLDOWN
  ctx.persist()
}

// The beat the player is meant to witness: a hearth fire that was burning
// last frame is gone this frame, at night, within sight. Dawn's dousing
// happens on the day branch of tickHearths, so it never reaches here.
function tickSnuffWatch(ctx) {
  const { state, mapData, flags, save } = ctx
  const rt = runtime(state)
  const now = {}
  for (const { n, cell } of hearths(mapData)) now[n] = !!hearthFireAt(state.entities, cell)?.hearth
  const was = rt.seen
  rt.seen = now
  if (flags.seen_snuff || !isNight(save.clock)) return
  for (const { n, cell } of hearths(mapData)) {
    if (!was[n] || now[n]) continue
    if (cheb(cell.x, cell.y, state.player.x, state.player.y) > SNUFF_SEEN_RANGE) continue
    ctx.set('seen_snuff')
    think(state, 'It ate the fire. Just like that.')
    ctx.persist()
    return
  }
}

// Three blue hearths and the wraith has no fire left it can put out: it is
// drawn into the village light and stays there (systems/monsters/sammunut.js
// reads `doomed` — no shun, no flee).
function tickDoom(ctx) {
  const { state, flags } = ctx
  if (!allBlue(flags)) return
  for (const e of state.entities) if (e.type === 'sammunut' && !e.doomed) e.doomed = true
}

// Death is the explicit kill game.js records on state.creatureKills, never
// the creature's absence: a Sammunut that failed to find a spawn spot, or
// one not yet spawned, must not resolve the episode for free.
function tickWraith(ctx) {
  const { state, mapData, flags } = ctx
  if (!flags.sammunut_spawned || flags.wraith_dead) return
  if (!state.creatureKills?.sammunut) return
  ctx.set('wraith_dead')
  lightHearths(state.map, mapData)
  ctx.persist()
  ctx.resolve()
}

export function tick(ctx, delta) {
  tickHearths(ctx)
  tickDelivery(ctx, delta)
  tickChores(ctx, delta)
  tickSnuffWatch(ctx)
  tickDoom(ctx)
  tickWraith(ctx)
}
