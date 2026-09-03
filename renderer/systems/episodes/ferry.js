// The Ferryman's Bell — lake-1-ferry episode (docs/superpowers/specs/
// 2026-08-29-leap-episodes-design.md §3.1). Pure — no browser/Electron
// imports; game.js wires onArrive/tick through the epCtx.
import { poiCell, checkDeliveries } from '../leap.js'
import { feedNakki } from '../monsters/nakki.js'
import { sfx } from '../sfx.js'
import { think } from '../feedback.js'
import { TILE } from '../entities.js'

export const DELIVERIES = [{ item: 'clapper', to: { poi: 'bell' }, sets: 'bell_hung' }]

const FEEDS_TO_CLEAR = 3
const GAP_LABELS = ['pier gap 1', 'pier gap 2']

const onCell = (entity, c) => !!c && entity.x === c.x && entity.y === c.y

// The pier's last two cells: water (WALL, losClear) while the Näkki lives,
// walkable pier planks once it's fed off.
function openGaps(ctx) {
  const { state, mapData } = ctx
  for (const label of GAP_LABELS) {
    const spot = poiCell(mapData, label)
    if (!spot) continue
    const cell = state.map[spot.y]?.[spot.x]
    if (!cell) continue
    cell.tile = TILE.FLOOR
    cell.skin = 'ow_pier_log'
    cell.overlay = null
    delete cell.losClear
  }
}

function spawnNakki(ctx) {
  const { state, mapData } = ctx
  const spot = poiCell(mapData, 'nakki')
  if (!spot) return
  ctx.spawn([{ kind: 'nakki', x: spot.x, y: spot.y }])
  const nakki = state.entities.find(e => e.type === 'nakki')
  if (nakki) nakki.pierEnd = poiCell(mapData, 'pier end')
}

function removeNakki(ctx) {
  ctx.state.entities = ctx.state.entities.filter(e => e.type !== 'nakki')
}

// Arrival — a fresh load or a waystone journey; a cave dive stashes the
// surface state whole and never re-runs this. A resolved episode just
// re-opens the gaps (the Näkki is long gone); an open one with the bell
// already rung re-spawns the Näkki so the fight survives a reload.
export function onArrive(ctx) {
  if (ctx.flags.nakki_gone) { openGaps(ctx); return }
  if (ctx.flags.bell_hung) spawnNakki(ctx)
}

// delta is unused here — the Näkki's own submerge/surface timer runs off
// the main story-creature update loop (CREATURE_UPDATE), not this tick.
export function tick(ctx, delta) {
  const { state, mapData, flags } = ctx

  const delivered = checkDeliveries(ctx, DELIVERIES)
  if (delivered) {
    sfx(state, 'bell', { px: state.player.px, py: state.player.py })
    spawnNakki(ctx)
  }

  const pierEnd = poiCell(mapData, 'pier end')
  if (!onCell(state.player, pierEnd)) return
  const nakki = state.entities.find(e => e.type === 'nakki')
  if (!nakki || nakki.state !== 'surfaced') return
  if (!feedNakki(nakki, state.player)) return

  const fed = (flags.fed ?? 0) + 1
  ctx.set('fed', fed)
  sfx(state, 'sizzle', { px: state.player.px, py: state.player.py })
  ctx.refreshInventory()
  ctx.persist()

  if (fed >= FEEDS_TO_CLEAR) {
    ctx.set('nakki_gone')
    removeNakki(ctx)
    openGaps(ctx)
    think(state, 'The lake lies still.')
    ctx.resolve()
  }
}
