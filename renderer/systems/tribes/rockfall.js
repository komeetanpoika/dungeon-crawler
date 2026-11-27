// The trolls' rockfall (Louhija calls it, the Mountain King's stomp shakes it
// loose): a mark on the ground, a shadow that grows on it for `fall` seconds,
// then a stone lands there. The hero within `stoneR` tiles of a mark takes
// `stoneDmg`: it comes from above, so no shield stops it (a 'hit' with no
// `from`). So does every troll under one (`trollDmg`, through its own hit
// hook: a slab is no roof), except the one whose stones they are, and at most
// once for the stones that land together. Nothing reaches a hero who is
// riding. One 'rockfall' cue for the stones that land together.
//
// The marks belong to the troll that called them and are ticked from its
// update, so they hang while it is stunned and are gone when it dies (its hit
// hook empties them).
//
// Also here, what every troll's hook does the same way: a blow that lands
// (trollStruck), what his rig is told every frame (trollLook: the drum's mark
// on him, and which way he faces), and one troll hurt by another's stone or
// boulder (hurtTroll).
// Pure: no browser imports.
//
//   owner.stones   [{ px, py, t, dur, r, landed }]   r: its reach in tiles (px/py: the
//                  Wilds' re-centre shifts positions by those names, wilds/shift.js)
import { damagePlayer } from '../player-damage.js'
import { hurtCreature } from '../creatures.js'
import { tribeOf } from '../tribes.js'
import { shatterBonus } from '../status.js'
import { startKnockback } from '../knockback.js'
import { addFloat } from '../feedback.js'
import { sfx } from '../sfx.js'

const S = 32
export const LAND_SHOW = 0.35      // s the stone and its dust stay drawn

// The rows a hook that drops stones adds to its TUNING_SCHEMA.
export const STONE_TUNING = [
  { key: 'fall', label: 'Shadow grows for', group: 'rockfall', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1, hint: 'seconds from the mark to the stone' },
  { key: 'stoneR', label: 'Stone reach', group: 'rockfall', type: 'range', min: 0.3, max: 2, step: 0.05, default: 0.8, hint: 'tiles round a mark' },
  { key: 'stoneDmg', label: 'Stone damage', group: 'rockfall', type: 'range', min: 0, max: 6, step: 1, default: 2, hint: 'to the hero; no shield stops it' },
  { key: 'trollDmg', label: 'Stone damage to a troll', group: 'rockfall', type: 'range', min: 0, max: 6, step: 1, default: 2 },
]

const alive = o => o.hp > 0 && !(o.dying > 0)

// A blow that lands on a troll, as on any monster: a blade breaks the rime on
// a frozen one for two more and (unless `shove` is off) pushes him back.
export function trollStruck(e, state, dmg, opts = {}, { shove = true } = {}) {
  e.hp -= dmg + (opts.via === 'melee' ? shatterBonus(e) : 0)
  e.inCombat = true
  if (shove && opts.knockback > 0 && state.player) startKnockback(e, e.px - state.player.px, e.py - state.player.py, opts.knockback)
  return { entity: e, absorbed: false, cue: opts.via === 'shot' || opts.via === 'spell' ? 'projectile-hit' : 'melee-hit' }
}

// What a troll's rig is told every frame: `stirred` while the drum's haste
// is on him, and `side`, the way he faces (1 right, -1 left): it follows his
// heading only once that leans well to one side, so one who walks straight
// up or down the screen does not flip at every step.
export function trollLook(e) {
  const c = e.channels ?? (e.channels = {})
  c.stirred = e.hasteTimer > 0 ? 1 : 0
  const lean = Math.cos(e.pose?.facing ?? 0)
  c.side = lean > 0.25 ? 1 : lean < -0.25 ? -1 : c.side ?? 1
}

// One troll hurt by another's stone or boulder: through its hit hook, with the
// cue and the float the game gives any blow.
export function hurtTroll(state, troll, dmg, source) {
  const r = hurtCreature(state, troll, dmg, { source })
  if (r.cue) sfx(state, r.cue, { px: troll.px, py: troll.py })
  if (!r.absorbed) addFloat(state.feedback, { px: troll.px, py: troll.py - 10, text: `-${dmg}`, kind: 'dealt' })
}
// The living of `owner`'s tribe, but for him.
export const kin = (state, owner) => {
  const tribe = tribeOf(owner)
  return tribe ? (state.entities ?? []).filter(o => o !== owner && alive(o) && tribeOf(o) === tribe) : []
}

// Mark `spots` ([{ px, py }]): a stone will land on each in T.fall seconds.
export function dropStones(state, owner, spots, T) {
  const list = owner.stones ?? (owner.stones = [])
  for (const s of spots) list.push({ px: s.px, py: s.py, t: 0, dur: T.fall, r: T.stoneR, landed: false })
}

// Once a frame, from the owner's update.
export function tickStones(state, owner, delta, T) {
  const list = owner.stones
  if (!list?.length) return
  const down = []
  for (const m of list) {
    m.t += delta
    if (!m.landed && m.t >= m.dur) { m.landed = true; down.push(m) }
  }
  if (down.length) land(state, owner, down, T)
  owner.stones = list.filter(m => m.t < m.dur + LAND_SHOW)
}

function land(state, owner, down, T) {
  const reach = T.stoneR * S
  const under = o => down.some(m => Math.hypot(o.px - m.px, o.py - m.py) <= reach)
  sfx(state, 'rockfall', { px: down[0].px, py: down[0].py })
  const hero = state.player
  if (hero && hero.hp > 0 && !hero.riding && under(hero)) damagePlayer(state, T.stoneDmg, 'hit')
  for (const o of kin(state, owner)) if (under(o)) hurtTroll(state, o, T.trollDmg, 'rockfall')
}

const SHADE = '#16181c', ROCK = '#9a9da6', ROCK_LIGHT = '#d2d4da', ROCK_DARK = '#4c4e56', DUST = '#ebe7dc'
// a deterministic scatter: the nth speck of a mark
const speck = (n, salt) => { const v = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v) }

// For the owner's drawFx (ctx at its screen centre, S the tile size): on each
// mark a shadow that grows inside a ring of grit showing how far the stone
// will reach, the stone coming down at the end, then the stone broken on the
// ground and its dust.
export function drawStones(ctx, owner, S) {
  const list = owner.stones
  if (!list?.length) return
  const k = S / 32, u = Math.max(2, Math.round(2 * k))
  const snap = v => Math.round(v / u) * u
  const rect = (x, y, w, h) => ctx.fillRect(snap(x), snap(y), Math.max(u, snap(w)), Math.max(u, snap(h)))
  ctx.save()
  for (const [i, m] of list.entries()) {
    const x = (m.px - owner.px) * k, y = (m.py - owner.py) * k
    const reach = m.r * S
    if (!m.landed) {
      const f = Math.max(0, Math.min(1, m.t / m.dur))
      // the ring of grit: where it will reach
      ctx.globalAlpha = 0.55 + 0.4 * f
      for (let j = 0; j < 16; j++) {
        const a = (j + 0.5) / 16 * Math.PI * 2
        ctx.fillStyle = j % 2 ? ROCK_DARK : SHADE
        rect(x + Math.cos(a) * reach - u, y + Math.sin(a) * reach * 0.8 - u / 2, 2 * u, u)
      }
      // the shadow, growing
      const rx = reach * (0.2 + 0.75 * f), ry = rx * 0.8
      ctx.globalAlpha = 0.2 + 0.35 * f
      ctx.fillStyle = SHADE
      rect(x - rx, y - ry * 0.5, rx * 2, ry)
      rect(x - rx * 0.75, y - ry * 0.8, rx * 1.5, ry * 1.6)
      rect(x - rx * 0.45, y - ry, rx * 0.9, ry * 2)
      // the stone itself, in sight for the last of its fall
      if (f > 0.7) {
        const drop = (1 - (f - 0.7) / 0.3) * 150 * k, r = reach * 0.45
        ctx.globalAlpha = 1
        stone(ctx, rect, x, y - drop - r * 0.6, r, u)
      }
    } else {
      const g = Math.max(0, Math.min(1, (m.t - m.dur) / LAND_SHOW)), r = reach * 0.45
      ctx.globalAlpha = 1 - g * 0.6
      stone(ctx, rect, x, y - r * 0.3, r, u)
      // a crack through it, shards and dust thrown out
      ctx.fillStyle = ROCK_DARK
      rect(x - u / 2, y - r * 0.9, u, r * 1.2)
      ctx.globalAlpha = 1 - g * 0.85
      for (let j = 0; j < 14; j++) {
        const a = j / 14 * Math.PI * 2 + speck(j, i) * 0.5, d = reach * (0.35 + 0.75 * g) * (0.8 + 0.4 * speck(j, i + 3))
        ctx.fillStyle = j % 3 === 0 ? ROCK_DARK : DUST
        rect(x + Math.cos(a) * d - u, y + Math.sin(a) * d * 0.8 - u - (j % 2 ? g * 8 * k : 0), j % 3 ? 2 * u : u, j % 3 ? 2 * u : u)
      }
    }
  }
  ctx.restore()
}

// A lump of rock r px in radius about (x, y).
function stone(ctx, rect, x, y, r, u) {
  ctx.fillStyle = ROCK_DARK
  rect(x - r - u, y - r * 0.5, 2 * r + 2 * u, r); rect(x - r, y - r, 2 * r, 2 * r); rect(x - r * 0.5, y - r - u, r, 2 * r + 2 * u)
  ctx.fillStyle = ROCK
  rect(x - r, y - r * 0.5, 2 * r, r); rect(x - r + u, y - r + u, 2 * r - 2 * u, 2 * r - 2 * u); rect(x - r * 0.5, y - r, r, 2 * r)
  ctx.fillStyle = ROCK_LIGHT
  rect(x - r * 0.5, y - r + u, r * 0.8, u); rect(x - r + u, y - r * 0.4, u, r * 0.6)
}
