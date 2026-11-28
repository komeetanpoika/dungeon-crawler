// The gong of the walrus's court (kumistin): a frame of driftwood lashed
// with rope, a great scallop shell hanging in it by two cords, hinge up, and
// a mallet leaning on one post. Upright and never turned; rect-only art on
// the art-px grid (TILE_ART_PX per tile), straight onto the canvas. The
// origin is the middle of its tile; the posts stand on the tile's lower edge.
//
// Channel its hook writes (systems/monsters/kumistin.js):
//   pose.flicker  0..1, struck: the shell swings on its cords, flashes pale
//                 and throws rings of sound, less as it dies away
import { TILE_ART_PX, frameOf } from './pixel.js'

export const RIG_ID = 'gong'

export const PARAM_SCHEMA = [
  { key: 'scale',      label: 'Size',   group: 'frame', type: 'range', min: 0.8, max: 1.4, step: 0.05, default: 1 },
  { key: 'woodColor',  label: 'Driftwood', group: 'frame', type: 'color', default: '#b3a792' },
  { key: 'shellColor', label: 'Shell',  group: 'shell', type: 'color', default: '#f0c4b0' },
  { key: 'ropeColor',  label: 'Rope',   group: 'frame', type: 'color', default: '#e9dcb8' },
  { key: 'swing',      label: 'Swing',  group: 'shell', type: 'range', min: 0, max: 5, step: 0.5, default: 3 },
]

const R = Math.round
const WHITE = '#f8f8f8', SHADOW = '#2a2418', RING = ['#ffffff', '#f5a524'], HIDE = '#c98f58', HANDLE = '#6b4a2b'
const FOOT = 7, TOP = -18             // art px: where the posts stand, where the beam lies
const POST = 9                        // the posts' distance from the middle
const SHELL = { w: 12, h: 12, y: -12 } // the shell's box, and its top
// the shell's width down its height, hinge to scalloped edge
const FAN = [6, 6, 8, 10, 12, 12, 12, 12, 12, 12, 10, 8]

function tone(hex, f) {
  const n = parseInt(hex.slice(1), 16)
  const ch = sh => { const c = (n >> sh) & 255; return Math.max(0, Math.min(255, R(f < 0 ? c * (1 + f) : c + (255 - c) * f))) }
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

// Hit extent (systems/hitbox.js): the shell, in screen px at 32-px tiles.
export function hitShape(p) {
  const k = 32 / TILE_ART_PX * p.scale
  return { r: R(7 * k), oy: R((SHELL.y + SHELL.h / 2) * k), front: 0, back: 0 }
}
export function hitHalf(p) { return Math.max(8, Math.min(16, R(11 * p.scale))) }
export function drawnTop(p, S) { return R((TOP - 3) * p.scale * S / TILE_ART_PX) }

export function drawMonster(ctx, p, pose, S) {
  const k = S / TILE_ART_PX * p.scale
  const hit = pose.state === 'hit'
  const rect = (x, y, w, h, col) => {
    ctx.fillStyle = hit ? WHITE : col
    ctx.fillRect(R(x), R(y), Math.max(1, R(w)), Math.max(1, R(h)))
  }
  const rung = Math.max(0, Math.min(1, pose.flicker ?? 0))
  const t = pose.t ?? 0
  const wood = { out: tone(p.woodColor, -0.58), dark: tone(p.woodColor, -0.28), base: p.woodColor, light: tone(p.woodColor, 0.3) }
  const shell = { out: tone(p.shellColor, -0.6), rib: tone(p.shellColor, -0.22), base: p.shellColor, light: tone(p.shellColor, 0.55) }
  // down, and it will not get up: the frame fallen, the shell on the sand
  const fallen = pose.state === 'death'

  ctx.save()
  ctx.scale(k, k)

  // ---- its shadow on the sand ------------------------------------------------------
  ctx.save()
  ctx.globalAlpha *= 0.26
  rect(-POST - 3, FOOT - 1, 2 * POST + 6, 3, SHADOW)
  ctx.restore()

  if (fallen) {
    rect(-POST - 3, FOOT - 3, 2 * POST + 6, 4, wood.out); rect(-POST - 2, FOOT - 2, 2 * POST + 4, 2, wood.base); rect(-POST - 2, FOOT - 2, 2 * POST + 4, 1, wood.light)
    drawShell(rect, shell, -6, FOOT - 9, 0.8)
    ctx.restore()
    return
  }

  // ---- the frame: two crooked posts, a beam across them, rope at the joints ------------
  for (const side of [-1, 1]) {
    const x = side * POST - 1
    rect(x - 1, TOP + 1, 4, FOOT - TOP, wood.out)
    rect(x + (side < 0 ? 1 : -1) - 1, TOP + 8, 4, 9, wood.out)              // the crook in it
    rect(x, TOP + 2, 2, FOOT - TOP - 2, wood.base)
    rect(x + (side < 0 ? 1 : -1), TOP + 9, 2, 7, wood.base)
    rect(x, TOP + 2, 1, FOOT - TOP - 2, wood.light)
    rect(x + 1, TOP + 13, 1, 2, wood.dark); rect(x, FOOT - 6, 1, 1, wood.dark)   // knots
    // a heap of stones and sand at its foot
    rect(x - 2, FOOT - 2, 6, 3, wood.out); rect(x - 1, FOOT - 1, 4, 2, tone(p.woodColor, -0.1)); rect(x - 1, FOOT - 2, 2, 1, wood.light)
  }
  rect(-POST - 4, TOP - 1, 2 * POST + 8, 4, wood.out)
  rect(-POST - 3, TOP, 2 * POST + 6, 2, wood.base)
  rect(-POST - 3, TOP, 2 * POST + 6, 1, wood.light)
  rect(-4, TOP + 1, 3, 1, wood.dark); rect(5, TOP, 2, 1, wood.dark)
  rect(-POST - 4, TOP, 1, 2, wood.dark); rect(POST + 3, TOP, 1, 2, wood.dark)
  for (const side of [-1, 1]) {
    const x = side * POST - 1
    rect(x - 1, TOP - 1, 4, 1, p.ropeColor); rect(x - 1, TOP + 2, 4, 1, p.ropeColor)
    rect(x, TOP, 1, 2, p.ropeColor); rect(x + 2, TOP + 3, 1, 1, tone(p.ropeColor, -0.3))
  }

  // ---- the mallet, leaning on the fore post -----------------------------------------------
  for (let i = 0; i < 12; i++) rect(POST + 7 - R(i * 0.34), FOOT - i, 1, 1, HANDLE)
  rect(POST + 1, FOOT - 16, 6, 5, wood.out); rect(POST + 2, FOOT - 15, 4, 3, HIDE); rect(POST + 2, FOOT - 15, 4, 1, tone(HIDE, 0.35))
  rect(POST + 3, FOOT - 15, 1, 3, tone(HIDE, -0.3))

  // ---- the shell, swinging on its cords -------------------------------------------------
  const sway = rung > 0 ? Math.sin(t * 13) * p.swing * rung : 0
  const sx = R(sway), half = R(sway / 2)
  for (const dx of [-2, 2]) {
    rect(dx, TOP + 2, 1, 2, wood.out)
    rect(dx + half, TOP + 4, 1, SHELL.y - TOP - 4, wood.out)
  }
  drawShell(rect, shell, -SHELL.w / 2 + sx, SHELL.y, rung)

  // ---- it rings: sound thrown off it in rings ------------------------------------------------
  if (rung > 0 && !hit) {
    const cy = SHELL.y + SHELL.h / 2, f = frameOf(t, 14, 3)
    ctx.save()
    ctx.globalAlpha *= Math.min(1, 0.35 + rung)
    for (let ring = 0; ring < 2; ring++) {
      const r = 10 + ring * 4 + f * 1.5
      for (let i = 0; i < 10; i++) {
        if ((i + ring + f) % 2) continue
        const a = i / 10 * Math.PI * 2 + ring * 0.3
        const x = sx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.85
        if (Math.abs(Math.sin(a)) < 0.5) rect(x, y - 1, 1, 3, RING[ring])
        else rect(x - 1, y, 3, 1, RING[ring])
      }
    }
    ctx.restore()
  }
  ctx.restore()
}

// The scallop, its top-left at (x, y): the hinge and its two ears, the fan,
// ribs spreading from the hinge, a scalloped lower edge. `rung` flashes it pale.
function drawShell(rect, shell, x, y, rung) {
  const cx = x + SHELL.w / 2
  const base = rung > 0.5 ? shell.light : shell.base, rib = rung > 0.5 ? shell.base : shell.rib
  for (const [i, w] of FAN.entries()) rect(cx - w / 2 - 1, y + i - 1, w + 2, 3, shell.out)
  rect(cx - 4, y - 1, 8, 2, shell.out)                                   // the ears
  // the fan: ribs spreading from the hinge, every other one in shade
  for (const [i, w] of FAN.entries()) for (let j = 0; j < w; j++) {
    const dx = j + 0.5 - w / 2
    const stripe = Math.floor((Math.atan2(dx, i + 1.5) + Math.PI / 2) / 0.26)
    rect(cx - w / 2 + j, y + i, 1, 1, i < 2 ? rib : stripe % 2 ? base : rib)
  }
  rect(cx - 3, y, 6, 1, base)
  rect(cx - 1, y, 2, 2, shell.out)                                       // the hinge the cords hold
  // the light on it, and the notches of its edge
  rect(cx - 5, y + 4, 1, 4, shell.light); rect(cx - 4, y + 3, 1, 2, shell.light)
  for (const dx of [-3, -1, 1]) rect(cx + dx, y + SHELL.h - 1, 1, 1, shell.out)
  rect(cx - 5, y + SHELL.h - 2, 1, 1, shell.out); rect(cx + 4, y + SHELL.h - 2, 1, 1, shell.out)
}
