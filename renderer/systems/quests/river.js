// Tervahauta, the Tar Pit — the River Split quest (docs/superpowers/specs/
// 2026-09-10-adventure-quests-design.md §3). Six lumber into the pit for
// three Pine Tar; three tar into the south bridge's three missing deck
// cells; the crew's Tervajousi when the deck is whole. The pit's fire is
// permanent from the moment it is lit.
//
// The map is baked with the bridge whole. onArrive breaks the gap cells that
// no plank flag covers — the ferry episode's pier-gap treatment, inverted —
// so the bridge stands, permanently, from the flags on every future arrival.
// onArrive is idempotent; it runs on a fresh load and a waystone arrival, not
// on a cave return (game.js restores the stashed surface whole and gates the
// tick on !state.cave). Pure — no browser/Electron imports.
import { poiCell } from '../quests.js'
import { markTileDirty } from '../tile-dirty.js'
import { TILE } from '../entities.js'
import { makeCampfire, spendLumber } from '../campfire.js'
import { makeItem, addItem, removeItem } from '../inventory.js'
import { queueToast, think } from '../feedback.js'
import { sfx } from '../sfx.js'

export const PIT = 'tar pit'
export const CAMP = 'lumber camp'
export const GAPS = ['bridge gap 1', 'bridge gap 2', 'bridge gap 3']
export const TAR_PIT_COST = 6    // lumber per firing — this module's own, never CAMPFIRE_COST
export const TAR_YIELD = 3       // Pine Tar per firing
export const BOW = 'tervajousi'

const plankFlag = i => `plank_${i + 1}`
const onCell = (p, c) => !!c && p.x === c.x && p.y === c.y
const beside = (p, c) => !!c && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) === 1
const count = (player, kind) => player.inventory.filter(i => i.kind === kind).reduce((n, i) => n + (i.count ?? 1), 0)
const fireAt = (state, c) => state.entities.some(e => e.type === 'campfire' && e.x === c.x && e.y === c.y)
const hasBow = player => player.ranged?.weaponType === BOW || player.inventory.some(i => i.kind === 'ranged' && i.payload?.weaponType === BOW)
const bowOnGround = state => state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === BOW)

// A gap cell is baked as a walkable pier-log prop over a water skin. Broken,
// it is water: WALL and losClear, no log art, the skin untouched.
export function breakGap(map, c) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.WALL
  cell.overlay = null
  cell.losClear = true
  markTileDirty(map, c.x, c.y)
}

export function plankGap(map, c) {
  const cell = map[c.y]?.[c.x]
  if (!cell) return
  cell.tile = TILE.FLOOR
  cell.overlay = 'ow_pier_log'
  delete cell.losClear
  markTileDirty(map, c.x, c.y)
}

// The pit's permanent cookfire — an eternal campfire entity on the pit cell.
function lightPit(ctx) {
  const { state } = ctx
  const c = poiCell(ctx.mapData, PIT)
  if (c && !fireAt(state, c)) state.entities.push(makeCampfire(c.x, c.y, { eternal: true }))
}

// The crew's bow waits at the camp until the player has it. Re-dropped on
// arrival if it was lost before it was ever picked up; never duplicated, and
// never again once `bow_given` records it in the player's hands.
function dropBow(ctx) {
  const { state } = ctx
  if (hasBow(state.player) || bowOnGround(state)) return
  const c = poiCell(ctx.mapData, CAMP)
  if (c) ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'ranged', weaponType: BOW }, x: c.x, y: c.y }])
}

export function onArrive(ctx) {
  const { state, flags } = ctx
  if (!flags.bridge_done) GAPS.forEach((label, i) => {
    const c = poiCell(ctx.mapData, label)
    if (!c) return
    if (flags[plankFlag(i)]) plankGap(state.map, c); else breakGap(state.map, c)
  })
  if (flags.pit_lit) lightPit(ctx)
  if (flags.bridge_done && !flags.bow_given) dropBow(ctx)
}

export function tick(ctx, delta) {
  const { state, flags } = ctx
  const { player } = state

  if (flags.bridge_done) return   // Task 7 adds the bow beat here

  if (!flags.bridge_seen) {
    ctx.set('bridge_seen')
    think(state, 'The middle planks are gone. No bridge holds without tar.')
    ctx.persist()
  }

  // Burn: stand on the pit with the lumber. It re-fires for more tar while
  // the deck is unfinished; the cost is paid every time.
  const pit = poiCell(ctx.mapData, PIT)
  if (onCell(player, pit) && count(player, 'lumber') >= TAR_PIT_COST) {
    spendLumber(player, 'lumber', TAR_PIT_COST)
    if (!addItem(player, makeItem('tar', TAR_YIELD)).ok)
      ctx.spawn([{ kind: 'floating_pickup', contents: { type: 'tar', count: TAR_YIELD }, x: pit.x, y: pit.y }])
    sfx(state, 'campfire-light', { px: pit.x * 32 + 16, py: pit.y * 32 + 16 })
    if (!flags.pit_lit) {
      ctx.set('pit_lit')
      lightPit(ctx)
      queueToast(state, { title: 'The pit is burning', lines: ['Pine tar, three pots of it.', 'Now the deck.'] })
    } else {
      think(state, 'Three more pots of tar.')
    }
    ctx.refreshInventory()
    ctx.persist()
    return
  }
}
