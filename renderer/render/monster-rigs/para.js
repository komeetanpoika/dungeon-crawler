// The para, a witch's errand-thing: a ball of yarn on three spindle legs,
// with a cat's two eyes and a loose end trailing behind. Drawn upright (it
// is never turned with its facing, only flipped to look left or right),
// rect-only on the art-px grid (TILE_ART_PX per tile), straight onto the
// canvas. The entity's centre is the origin; its feet stand FEET art px
// below it.
//
// Channels its hook writes (systems/monsters/para.js):
//   pose.carry      it has made off with something: a tied bundle on its back
//   pose.cower      home again: sunk on its legs, eyes shut, shivering
//   pose.raspberry  nothing worth taking: eyes screwed up, tongue out
import { TILE_ART_PX, palette, frameOf } from './pixel.js'

export const RIG_ID = 'para'

export const PARAM_SCHEMA = [
  { key: 'yarnColor', label: 'Yarn',    group: 'look', type: 'color', default: '#d2324a' },
  { key: 'legColor',  label: 'Spindles', group: 'look', type: 'color', default: '#dccfa6' },
  { key: 'eyeColor',  label: 'Eyes',    group: 'look', type: 'color', default: '#eef24a' },
  { key: 'sackColor', label: 'Bundle',  group: 'look', type: 'color', default: '#c8a868' },
  { key: 'tail',      label: 'Loose end', group: 'look', type: 'range', min: 2, max: 9, step: 1, default: 6 },
  { key: 'gaitFreq',  label: 'Gait frequency', group: 'motion', type: 'range', min: 6, max: 30, step: 1, default: 18 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const FLASH = { outline: WHITE, base: WHITE, light: WHITE }
const FEET = 7
const INK = '#1a1016', TONGUE = '#f08aa0'
// The ball: half-widths of its rows, top to bottom (9 px across), its middle
// row CY art px from the origin; the legs carry it from there to the ground.
const DISC = [2, 3, 4, 4, 4, 4, 4, 3, 2]
const HALF = 4
const CY = -3

export function hitShape() { return { r: 9, oy: -4 } }
export function hitHalf() { return 6 }

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX
  const { state, stateT } = pose, t = pose.t ?? 0
  const hit = state === 'hit', dead = state === 'death', walking = state === 'walk'
  const pal = col => hit ? FLASH : palette(col)
  const one = col => hit ? WHITE : col
  const yarn = pal(p.yarnColor), wood = pal(p.legColor), sack = pal(p.sackColor)
  const carry = pose.carry > 0, cower = !dead && pose.cower > 0, rasp = !dead && !cower && pose.raspberry > 0
  const F = walking ? frameOf(t, p.gaitFreq, 4) : 0
  const rect = (x, y, w, h) => ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h)))
  const fill = (col, x, y, w, h) => { ctx.fillStyle = col; rect(x, y, w, h) }

  ctx.save()
  ctx.scale(Math.cos(pose.facing ?? 0) < -0.01 ? -k : k, k)

  // shadow
  ctx.save()
  ctx.globalAlpha *= 0.25
  ctx.fillStyle = '#000000'
  ctx.fillRect(-5, FEET - 1, 11, 2)
  ctx.restore()

  // ---- dead: unravelled, a tangle on the ground with its spindles across it ----
  if (dead && stateT >= 0.22) {
    for (let i = 0; i < 7; i++) {
      const x = -8 + ((i * 5) % 13), y = FEET - 3 + (i % 3)
      fill(i % 2 ? yarn.base : yarn.outline, x, y, 4 + (i % 3), 1)
      fill(yarn.base, x + 3 + (i % 2), y - 1, 2, 1)
    }
    fill(yarn.light, -3, FEET - 3, 3, 1); fill(yarn.light, 2, FEET - 2, 2, 1)
    fill(wood.outline, -7, FEET - 1, 5, 1); fill(wood.base, -6, FEET - 4, 1, 3); fill(wood.base, 3, FEET - 2, 5, 1)
    ctx.restore()
    return
  }

  // sunk when it cowers, shivering; a hop in its run; squashed as it dies
  const drop = cower ? 3 : dead ? 2 : 0
  const bob = walking && F % 2 ? -1 : 0
  if (cower) ctx.translate(frameOf(t, 14, 2) ? 1 : 0, 0)

  // ---- the loose end, trailing behind -------------------------------------------
  for (let i = 0; i < p.tail; i++) {
    const wave = walking ? (frameOf(t + i * 0.05, 9, 2) ? 0 : -1) + (i >> 1) * -0.5 : Math.round(Math.sin(t * 3 + i * 1.3) * 0.7) + Math.min(3, i * 0.8)
    fill(i % 3 === 2 ? yarn.light : yarn.base, -5 - i, CY + 2 + drop + wave, 1, 1)
  }

  // ---- three spindle legs: a thin stick, a whorl for a foot -----------------------
  ;[-2, 0, 2].forEach((lx, i) => {
    const ph = walking ? (F + [0, 2, 1][i]) % 4 : 3
    const reach = walking ? [2, 0, -2, 0][ph] : 0, up = walking && ph === 1 ? 1 : 0
    const fx = lx * 2 + reach
    if (cower) { fill(wood.outline, lx * 2 - 1, FEET - 1, 3, 1); return }
    const top = CY + HALF + drop, n = FEET - 1 - up - top
    for (let j = 0; j < n; j++) fill(j % 2 ? wood.base : wood.light, R(lx + (fx - lx) * (j + 1) / n), top + j, 1, 1)
    fill(wood.outline, fx - 1, FEET - 1 - up, 3, 1)                       // the whorl
    fill(wood.base, fx, FEET - 1 - up, 1, 1)
  })

  ctx.translate(0, drop + bob)

  // ---- the bundle on its back ----------------------------------------------------
  if (carry) {
    const by = CY - HALF - 5 + (walking && F % 2 ? 1 : 0) + (cower ? 1 : 0)
    fill(sack.outline, -5, by + 1, 7, 5)
    fill(sack.outline, -4, by, 5, 7)
    fill(sack.base, -4, by + 1, 5, 4)
    fill(sack.light, -3, by + 1, 2, 1)
    fill(sack.base, -3, by - 2, 1, 2); fill(sack.base, 0, by - 2, 1, 2)   // the knot's two ears
    fill(sack.outline, -2, by - 1, 2, 1)
    fill(one(INK), -3, by + 5, 4, 1)                                      // the string that holds it on
  }

  // ---- the ball ------------------------------------------------------------------
  const squash = dead ? 1 : 0
  DISC.forEach((hw, i) => fill(yarn.outline, -hw - squash, CY - HALF + i, 2 * (hw + squash) + 1, 1))
  DISC.forEach((hw, i) => { if (i > 0 && i < DISC.length - 1) fill(yarn.base, -hw + 1 - squash, CY - HALF + i, 2 * (hw + squash) - 1, 1) })
  // the winding: two sets of strands that cross, and turn as it runs
  const roll = walking ? F : 0
  for (let y = 1 - HALF; y <= HALF - 1; y++) {
    const hw = DISC[y + HALF] - 1
    for (let x = -hw; x <= hw; x++) {
      const back = x + y < 0
      if ((back ? x - y + roll + 60 : x + y - roll + 60) % 3 === 0) fill(back ? yarn.light : yarn.outline, x, CY + y, 1, 1)
    }
  }

  // ---- a cat's two eyes ----------------------------------------------------------
  const ey = CY - 2
  if (dead) {
    // crossed out
    ctx.fillStyle = one(INK)
    for (const ex of [-2, 2]) { rect(ex, ey, 1, 1); rect(ex + 2, ey, 1, 1); rect(ex + 1, ey + 1, 1, 1); rect(ex, ey + 2, 1, 1); rect(ex + 2, ey + 2, 1, 1) }
  } else if (rasp) {
    // screwed shut: > <
    ctx.fillStyle = one(INK)
    rect(-1, ey, 1, 1); rect(0, ey + 1, 1, 1); rect(-1, ey + 2, 1, 1)
    rect(4, ey, 1, 1); rect(3, ey + 1, 1, 1); rect(4, ey + 2, 1, 1)
    // and the tongue, flapping
    const flap = frameOf(t, 16, 2)
    fill(one(INK), 2, ey + 3, 3, 2)
    fill(one(TONGUE), 3, ey + 3 + flap, 5, 2)
    fill(one('#c85a78'), 4, ey + 4 + flap, 3, 1)
    if (!hit) { fill('#dff4ff', 9, ey + 2 - flap, 1, 1); fill('#dff4ff', 10, ey + 5, 1, 1); fill('#dff4ff', 9, ey + 7 - flap, 1, 1) }
  } else if (cower) {
    // shut tight
    fill(one(INK), -1, ey + 1, 2, 1); fill(one(INK), 2, ey + 1, 2, 1)
  } else {
    const blink = !walking && frameOf(t, 0.7, 5) === 4 && frameOf(t, 7, 5) === 0
    for (const ex of [-1, 2]) {
      fill(yarn.outline, ex, ey - 1, 2, 1)                                  // a brow
      fill(one(p.eyeColor), ex, ey, 2, blink ? 1 : 3)
      if (!blink) fill(one(INK), ex + 1, ey, 1, 3)                          // the slit
    }
  }
  ctx.restore()
}
