// Monsteri: the user's own crayon drawing, blitted whole. One frame from
// renderer/assets/monsters/monsteri.png (built by tools/extract-monsteri.mjs
// from assets/monsteri.png); the rig gives it life by moving the picture,
// frame-stepped like the pixel rigs: a breath while idle, a stepping bob
// and side-to-side lean while walking, a lunge on attack, the white flash
// on a hit, a shrink while dying. The drawing is a front view of a
// standing creature, so it stays upright and only flips — the tail trails
// away from where it walks. Feet stand just below the entity's centre; the
// hit circle sits up on the torso. Without a DOM Image (Node tests) or
// before the picture loads it draws a plain silhouette. While its frost
// breath charges (pose.eyeGlow, set by systems/monsters/monsteri.js) the
// three orbs on its stalks light up; `anchor` tells the hook where the head
// and chest are drawn, so the breath leaves the head and the arms reach out
// from the chest.
import { SHEET } from '../../assets/monsters/monsteri-sheet.js'
import { drawSheetCell } from './pixel.js'

export const RIG_ID = 'monsteri'

export const PARAM_SCHEMA = [
  { key: 'size',     label: 'Height (tiles)',      group: 'body',   type: 'range', min: 1.5, max: 6, step: 0.25, default: 3 },
  { key: 'body',     label: 'Body radius (tiles)', group: 'body',   type: 'range', min: 0.25, max: 0.85, step: 0.05, default: 0.5 },
  { key: 'lift',     label: 'Body height (tiles)', group: 'body',   type: 'range', min: 0, max: 3, step: 0.05, default: 1.1 },
  { key: 'bob',      label: 'Bob',                 group: 'motion', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
  { key: 'wobble',   label: 'Walk lean (deg)',     group: 'motion', type: 'range', min: 0, max: 15, step: 1, default: 6 },
  { key: 'gaitFreq', label: 'Gait speed',          group: 'motion', type: 'range', min: 1, max: 12, step: 0.5, default: 6 },
  { key: 'lunge',    label: 'Attack lunge (tiles)', group: 'motion', type: 'range', min: 0, max: 0.6, step: 0.05, default: 0.2 },
]

const R = Math.round
const WHITE = '#f8f8f8'
const FOOT = 0.45            // tiles below the entity centre where the feet stand
const DEATH = 0.7            // s, systems/dying.js DEATH_TIME (not imported: dying → monsters is a cycle)
const LEAN = [-1, 0, 1, 0]   // walk cycle, one entry per gait step
const BOB = [0, -1, 0, -1]
// Points on the drawing, in sheet pixels (72x86): the three orb tips on
// their stalks, the head the breath comes from, the chest the arms grow from.
const ORBS = [{ x: 20, y: 6 }, { x: 25.5, y: 3 }, { x: 30.5, y: 3 }]
const ANCHORS = { head: { x: 29, y: 12 }, chest: { x: 28, y: 24 } }
const ORB_CORE = '#fffbe6'
const ORB_HALO = '#bae6fd'
const SHEET_URL = new URL('../../assets/monsters/monsteri.png', import.meta.url).href

let sheet = null
function sheetImage() {
  if (sheet === null && typeof Image !== 'undefined') { sheet = new Image(); sheet.src = SHEET_URL }
  return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null
}
// Test seam: swap in any drawable with naturalWidth > 0 / complete = true.
export function _setSheetImage(img) { sheet = img }

export function hitHalf(p) {
  return Math.max(8, Math.min(28, R(p.body * 32)))
}

export const hitShape = p => ({ r: hitHalf(p), oy: -R(p.lift * 32) })

// Drawn tail-right, it trails behind: facing east mirrors it (straight
// north/south: as drawn).
const mirrored = facing => Math.cos(facing ?? 0) > 0.01

// Where a named point of the drawing sits, in px from the entity centre at
// tile size S, for the pose's facing (the walk's lean and bob left out).
export function anchor(p, pose, S, name) {
  const a = ANCHORS[name]
  const h = p.size * S, w = h * SHEET.cellW / SHEET.cellH
  const x = -w / 2 + a.x / SHEET.cellW * w
  return { x: R(mirrored(pose.facing) ? -x : x), y: R(FOOT * S - h + a.y / SHEET.cellH * h) }
}

export function drawMonster(ctx, p, pose, S) {
  const t = pose.t ?? 0, state = pose.state
  const stepI = Math.floor(t * p.gaitFreq) % 4
  const walking = state === 'walk' || (pose.speed01 ?? 0) > 0.05
  const dying = state === 'death' ? Math.min(1, (pose.stateT ?? 0) / DEATH) : 0
  const breath = !walking && Math.floor(t * 2) % 4 >= 2 ? 1.02 : 1
  const grow = (state === 'attack' ? 1.08 : 1) * (1 - 0.4 * dying)
  const flip = mirrored(pose.facing)
  const h = R(p.size * S * grow * breath), w = R(h * SHEET.cellW / SHEET.cellH)
  const lean = walking ? LEAN[stepI] * p.wobble * Math.PI / 180 : 0
  const bob = walking ? R(BOB[stepI] * p.bob * S * 0.1) : 0
  const lunge = state === 'attack' ? R(Math.cos(pose.facing ?? 0) * p.lunge * S) : 0

  ctx.save()
  ctx.translate(lunge, R(FOOT * S) + bob)                // origin at the feet
  if (flip) ctx.scale(-1, 1)
  if (lean) ctx.rotate(lean)
  ctx.imageSmoothingEnabled = false
  const img = sheetImage()
  if (!img) drawSilhouette(ctx, w, h, state === 'hit')
  else drawSheetCell(ctx, img, 0, 0, SHEET.cellW, SHEET.cellH, -R(w / 2), -h, w, h,
                     state === 'hit' ? { color: WHITE, alpha: 1 } : null)
  if (pose.eyeGlow > 0 && state !== 'death') drawOrbGlow(ctx, w, h, pose.eyeGlow, t)
  ctx.restore()
}

// A pale halo that swells with the charge and a bright core on each orb,
// flickering a pixel at the edge. Origin at the feet, inside the flip.
function drawOrbGlow(ctx, w, h, glow, t) {
  const k = h / SHEET.cellH
  const flick = Math.floor(t * 12) % 2
  ctx.save()
  for (const o of ORBS) {
    const x = -w / 2 + o.x * k, y = -h + o.y * k
    const r = R((1.5 + 2.5 * glow) * k) + flick, c = Math.max(1, R((0.8 + glow) * k))
    ctx.globalAlpha = 0.45 * glow
    ctx.fillStyle = ORB_HALO
    ctx.fillRect(R(x) - r, R(y) - r, 2 * r, 2 * r)
    ctx.globalAlpha = Math.min(1, 0.4 + glow)
    ctx.fillStyle = ORB_CORE
    ctx.fillRect(R(x) - c, R(y) - c, 2 * c, 2 * c)
  }
  ctx.restore()
}

// Before the picture loads: a red torso, head and four limbs, feet at the origin.
function drawSilhouette(ctx, w, h, hit) {
  const red = hit ? WHITE : '#c0605a', dark = hit ? WHITE : '#5a1c1c'
  ctx.fillStyle = dark
  ctx.fillRect(-R(w * 0.45), -R(h * 0.75), R(w * 0.9), R(h * 0.08))    // arms
  ctx.fillRect(-R(w * 0.18), -R(h * 0.35), R(w * 0.1), R(h * 0.35))    // legs
  ctx.fillRect(R(w * 0.08), -R(h * 0.35), R(w * 0.1), R(h * 0.35))
  ctx.fillStyle = red
  ctx.fillRect(-R(w * 0.15), -R(h * 0.8), R(w * 0.3), R(h * 0.48))     // torso
  ctx.fillRect(-R(w * 0.1), -R(h * 0.95), R(w * 0.2), R(h * 0.15))     // head
}
