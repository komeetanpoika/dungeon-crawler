// The coven's hex in flight: a green wisp (a witch's, or one of Syöjätär's
// three). It flies straight at `wispSpeed` px/s for `wispLife` seconds and
// wounds nothing. It dies at a wall (open water it crosses), when its time
// is up, and on the hero: within `wispR` tiles of him it is spent, and makes
// him a frog for `frog` seconds (systems/hex.js) unless a raised shield
// faces the way it came (systems/shield.js: the block costs what any block
// costs). A hero on the coach it passes through. A sidestep dodges it.
//
// The wisps belong to who cast them (`owner.wisps`) and are ticked by her
// hook, so they go out when she dies. Pure: no browser imports.
//
//   owner.wisps   [{ px, py, dx, dy, t, life }]   world px, px/s, seconds flown / to fly
import { isWalkable } from '../entities.js'
import { tryBlock } from '../shield.js'
import { hexPlayer } from '../hex.js'
import { sfx } from '../sfx.js'

const S = 32
const GREEN = { halo: '#3fae4a', core: '#b6f36a', hot: '#f2ffd0' }

// What every caster's TUNING_SCHEMA holds for its wisps.
export const WISP_TUNING = [
  { key: 'wispSpeed', label: 'Wisp speed', group: 'hex', type: 'range', min: 40, max: 320, step: 5, default: 130, hint: 'px/s (a walk is 120)' },
  { key: 'wispLife', label: 'Wisp flies for', group: 'hex', type: 'range', min: 0.5, max: 8, step: 0.1, default: 3, hint: 'seconds' },
  { key: 'wispR', label: 'Wisp touch', group: 'hex', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.5, hint: 'tiles from the hero\'s middle' },
  { key: 'frog', label: 'Frog for', group: 'hex', type: 'range', min: 0.5, max: 12, step: 0.5, default: 4, hint: 'seconds' },
]

export function castWisp(owner, px, py, angle, T) {
  const w = { px, py, dx: Math.cos(angle) * T.wispSpeed, dy: Math.sin(angle) * T.wispSpeed, t: 0, life: T.wispLife }
  ;(owner.wisps ??= []).push(w)
  return w
}

// Once a frame, from the caster's hook. Returns how many hexes took.
export function tickWisps(state, owner, delta, T) {
  if (!owner.wisps?.length) return 0
  const { player, map } = state
  const ok = !!player && player.hp > 0 && !player.riding
  let took = 0
  owner.wisps = owner.wisps.filter(w => {
    w.t += delta
    if (w.t >= w.life) return false
    w.px += w.dx * delta; w.py += w.dy * delta
    const c = map[Math.floor(w.py / S)]?.[Math.floor(w.px / S)]
    if (!c || (!isWalkable(c.tile, c) && !c.losClear)) return false
    if (!ok || Math.hypot(player.px - w.px, player.py - w.py) > T.wispR * S) return true
    // it has reached him: from the side it flew in from
    const v = Math.hypot(w.dx, w.dy) || 1
    if (tryBlock(state, { px: player.px - w.dx / v * S, py: player.py - w.dy / v * S })) return false
    if (hexPlayer(player, T.frog)) { took++; sfx(state, 'hex-hit', { px: player.px, py: player.py }) }
    return false
  })
  return took
}

// The wisps over the hero, for the caster's drawFx: ctx sits at the caster's
// screen centre. A flickering green ball with a tail of sparks behind it.
export function drawWisps(ctx, owner, S) {
  if (!owner.wisps?.length || owner.hp <= 0) return
  const k = S / 32, u = Math.max(1, Math.round(2 * k))
  ctx.save()
  for (const w of owner.wisps) {
    const v = Math.hypot(w.dx, w.dy) || 1, ux = w.dx / v, uy = w.dy / v
    const wob = Math.sin(w.t * 16) * 2 * k
    const x = Math.round((w.px - owner.px) * k - uy * wob), y = Math.round((w.py - owner.py) * k + ux * wob)
    const fade = Math.min(1, (w.life - w.t) / 0.4), flick = Math.floor(w.t * 14) % 2
    // the tail
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha = fade * (0.5 - i * 0.1)
      ctx.fillStyle = i % 2 ? GREEN.core : GREEN.halo
      const s = Math.sin(w.t * 16 - i * 0.9) * 2 * k
      ctx.fillRect(Math.round(x - ux * (3 + i * 2.5) * u - uy * s - u), Math.round(y - uy * (3 + i * 2.5) * u + ux * s - u), 2 * u, 2 * u)
    }
    ctx.globalAlpha = fade * 0.5
    ctx.fillStyle = GREEN.halo
    ctx.fillRect(x - 4 * u, y - 3 * u, 8 * u, 6 * u)
    ctx.fillRect(x - 3 * u, y - 4 * u, 6 * u, 8 * u)
    if (flick) { ctx.fillRect(x - 6 * u, y - u / 2, 12 * u, u); ctx.fillRect(x - u / 2, y - 6 * u, u, 12 * u) }
    ctx.globalAlpha = fade
    ctx.fillStyle = GREEN.core
    ctx.fillRect(x - 3 * u, y - 2 * u, 6 * u, 4 * u)
    ctx.fillRect(x - 2 * u, y - 3 * u, 4 * u, 6 * u)
    ctx.fillStyle = GREEN.hot
    ctx.fillRect(x - u, y - u, 2 * u, 2 * u)
  }
  ctx.restore()
}
