// 16-bit pixel viper, seen from above (kyy, the marsh's adder: Syöjätär's
// children). Rect-only art on the shared pixel stage, like the scorpion:
// facing snaps to 8 directions, -y is forward. A body in an S that wriggles
// from head to tail, a dark zigzag down a pale back, a wider head with two
// eyes and a forked tongue that flicks.
//
// Channel its hook writes (systems/monsters/kyy.js):
//   pose.eyeGlow  the bite: rising to just under 1 it coils (the S draws
//                 tight, the head comes back, the mouth opens); at 1 it is
//                 struck out straight, well past where it lay
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'viper'

export const PARAM_SCHEMA = [
  { key: 'scale',       label: 'Size',    group: 'body', type: 'range', min: 0.7, max: 2, step: 0.05, default: 1 },
  { key: 'bodyColor',   label: 'Back',    group: 'skin', type: 'color', default: '#cfc8ae' },
  { key: 'stripeColor', label: 'Zigzag',  group: 'skin', type: 'color', default: '#1e1a16' },
  { key: 'eyeColor',    label: 'Eyes',    group: 'skin', type: 'color', default: '#e02a2a' },
  { key: 'wave',        label: 'Wriggle', group: 'motion', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.8 },
  { key: 'gaitFreq',    label: 'Wriggle speed', group: 'motion', type: 'range', min: 4, max: 24, step: 0.5, default: 13 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const ROWS = 14               // rows of its body, head first
const REST_TIP = -7           // art px at scale 1, forward negative: the snout lying, coiled, struck
const COIL_TIP = -3
const STRIKE_TIP = -12
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)
const lerp = (a, b, f) => a + (b - a) * f
const widthAt = j => j === 0 ? 2 : j <= 2 ? 4 : j === 3 ? 2 : j <= 9 ? 3 : j <= 11 ? 2 : 1

// The body's rows as [x, y, w, depth], head first, by the hook's channel and
// where the wriggle is in its swing.
function spine(p, glow, phase) {
  const struck = glow >= 1, f = struck ? 0 : Math.min(1, glow * 1.4)
  const tip = struck ? STRIKE_TIP : lerp(REST_TIP, COIL_TIP, f)
  const gap = struck ? 1.15 : 1 - 0.5 * f                 // how far apart its rows lie
  const swing = p.wave * (struck ? 0.2 : 1 + 1.3 * f)
  const turn = 0.8 * (1 + 0.6 * f)                        // a coil is a tighter S
  return Array.from({ length: ROWS }, (_, j) =>
    [Math.sin(phase + j * turn) * swing * Math.min(1, j / 4), tip + j * gap, widthAt(j), gap])
}

// How far forward of the centre the snout reaches, in art px at the params'
// scale, by the hook's channel.
export function headReach(p, glow = 0) { return -spine(p, glow, 0)[0][1] * p.scale }

function dims(p) {
  return { sc: p.scale, artW: ceilTile(2 * (p.wave * 2.3 + 4) * p.scale + 2), artH: ceilTile(2 * (-STRIKE_TIP + 3) * p.scale + 2) }
}

export function hitShape(p) {
  const k = 32 / TILE_ART_PX * p.scale
  const r = Math.max(4, R(2.5 * k))
  return { r, front: Math.max(1, R(-REST_TIP * k) - r), back: Math.max(1, R(-REST_TIP * k) - r) }
}
export function hitHalf(p) { return Math.max(5, Math.min(12, R(5 * p.scale))) }

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state, stateT } = pose, t = pose.t ?? 0
  withPixelStage(ctx, d.artW, d.artH, (pose.facing ?? 0) + Math.PI / 2, S, c => {
    const hit = state === 'hit', dead = state === 'death', walking = state === 'walk'
    const body = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.bodyColor)
    const one = col => hit ? WHITE : col
    const glow = dead ? 0 : Math.max(0, Math.min(1, pose.eyeGlow ?? 0))
    const u = v => R(v * d.sc)
    const rect = (x, y, w, h) => c.fillRect(u(x), u(y), Math.max(1, u(x + w) - u(x)), Math.max(1, u(y + h) - u(y)))
    const rows = spine(p, glow, dead ? 1 : walking ? t * p.gaitFreq : Math.sin(t * 1.3) * 0.6)
    const agape = glow > 0.45                               // mouth open to bite

    c.save()
    if (dead) c.globalAlpha *= stateT >= 0.22 ? 0.55 : 1

    // Each row reaches sideways to the row behind it, so the S stays one
    // unbroken body however tight it is drawn.
    const span = j => {
      const [x, y, w, h] = rows[j], bx = j < 3 || j === ROWS - 1 ? x : rows[j + 1][0]
      const wide = w + (agape && j && j <= 2 ? 1 : 0)
      return [Math.min(x, bx) - wide / 2, y, Math.abs(x - bx) + wide, h]
    }
    // ---- the dark edge of it, tail first so the head lies on top ----------------
    c.fillStyle = body.outline
    for (let j = ROWS - 1; j >= 0; j--) {
      const [x, y, w, h] = span(j)
      rect(x - 1, y - (j === 0 ? 1 : 0), w + 2, h + (j === 0 || j === ROWS - 1 ? 1 : 0))
    }
    // ---- the back, and the zigzag down it --------------------------------------
    for (let j = ROWS - 1; j >= 0; j--) {
      const [x, y, w, h] = span(j)
      // (dead it lies belly up: pale, no pattern)
      c.fillStyle = dead ? body.light : j < 3 ? body.light : body.base
      rect(x, y, w, h)
      if (dead || j < 3) continue
      const [cx, , cw] = rows[j]
      c.fillStyle = one(p.stripeColor)
      if (cw >= 3) rect(cx - 1.5 + [0, 1, 2, 1][j % 4], y, 1, h)
      else if (cw === 2) rect(cx - 1 + (j % 2), y, 1, h)
      else if (j % 2) rect(cx - 0.5, y, 1, h)
    }
    // ---- the head: eyes at its corners, a dark mark behind them ------------------
    if (!dead) {
      const [hx, hy, , hh] = rows[1], [nx, ny] = rows[0]
      c.fillStyle = one(p.stripeColor)
      rect(rows[2][0] - 1, rows[2][1], 2, rows[2][3])
      c.fillStyle = one(p.eyeColor)
      const out = agape ? 2.5 : 2
      rect(hx - out, hy, 1, hh); rect(hx + out - 1, hy, 1, hh)
      if (agape) {
        // the mouth, and two fangs
        c.fillStyle = one('#f09aa8')
        rect(nx - 1.5, ny - 1, 3, 2)
        c.fillStyle = WHITE
        rect(nx - 2, ny - (glow >= 1 ? 2 : 1), 1, 2); rect(nx + 1, ny - (glow >= 1 ? 2 : 1), 1, 2)
      } else if (frameOf(t, 7, 6) < 2) {
        // the tongue, out and forked, then in again
        c.fillStyle = one('#e02a2a')
        rect(nx - 0.5, ny - 2, 1, 2)
        if (frameOf(t, 7, 6) === 1) { rect(nx - 1.5, ny - 3, 1, 1); rect(nx + 0.5, ny - 3, 1, 1) }
      }
    }
    c.restore()
  })
}
