// 16-bit pixel quadruped rig. Draws rect-only art on an integer art-px grid
// (TILE_ART_PX per map tile) through the shared pixel stage: facing snaps to
// 8 directions, animation steps in frames (4-frame gait, 2-frame attack,
// white-flash hit, 2-step death collapse). Same contract as every rig:
// pure drawMonster(ctx, params, pose, S), origin at the monster's centre,
// -y forward before rotation. PARAM_SCHEMA is unchanged from v1, so saved
// monsters and the lab keep working; lengths quantize to art px at draw time.
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'quadruped'

export const PARAM_SCHEMA = [
  { key: 'bodyLength', label: 'Body length', group: 'body', type: 'range', min: 0.8, max: 3.0, step: 0.05, default: 1.6 },
  { key: 'bodyWidth',  label: 'Body width',  group: 'body', type: 'range', min: 0.5, max: 2.0, step: 0.05, default: 0.9 },
  { key: 'bulge',      label: 'Belly bulge', group: 'body', type: 'range', min: 0.0, max: 0.6, step: 0.02, default: 0.2 },
  { key: 'legLength',  label: 'Leg length',  group: 'legs', type: 'range', min: 0.3, max: 1.6, step: 0.05, default: 0.7 },
  { key: 'legThick',   label: 'Leg thickness', group: 'legs', type: 'range', min: 0.08, max: 0.5, step: 0.02, default: 0.18 },
  { key: 'headSize',   label: 'Head size',   group: 'head', type: 'range', min: 0.3, max: 1.2, step: 0.05, default: 0.55 },
  { key: 'snout',      label: 'Snout length', group: 'head', type: 'range', min: 0.0, max: 0.9, step: 0.05, default: 0.35 },
  { key: 'eyeSize',    label: 'Eye size',    group: 'head', type: 'range', min: 0.04, max: 0.3, step: 0.01, default: 0.1 },
  { key: 'horns',      label: 'Horns',       group: 'head', type: 'toggle', default: false },
  { key: 'tailLength', label: 'Tail length', group: 'tail', type: 'range', min: 0.0, max: 2.0, step: 0.05, default: 0.8 },
  { key: 'tailTaper',  label: 'Tail taper',  group: 'tail', type: 'range', min: 0.1, max: 1.0, step: 0.05, default: 0.5 },
  { key: 'hideColor',  label: 'Hide',        group: 'skin', type: 'color', default: '#7c4a24' },
  { key: 'bellyColor', label: 'Belly',       group: 'skin', type: 'color', default: '#c9a06a' },
  { key: 'eyeColor',   label: 'Eyes',        group: 'skin', type: 'color', default: '#ffd23a' },
  { key: 'scales',     label: 'Scale texture', group: 'skin', type: 'toggle', default: false },
  { key: 'gaitFreq',   label: 'Gait frequency', group: 'motion', type: 'range', min: 2, max: 14, step: 0.5, default: 7 },
  { key: 'bob',        label: 'Body bob',    group: 'motion', type: 'range', min: 0.0, max: 0.3, step: 0.01, default: 0.08 },
]

const R = Math.round
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)
const WHITE = '#f8f8f8'

// Per-frame leg swing (art px along y) for the 4-frame gait, per leg
// (frontL, frontR, backL, backR) — classic alternating trot.
const GAIT = [[2, -2, -2, 2], [0, 0, 0, 0], [-2, 2, 2, -2], [0, 0, 0, 0]]

// All art-px dimensions derive here so the stage is sized to fit them.
// Body width/length are forced even so the centre splits on whole pixels.
// The stage is centred on the body, so its height covers the LARGER of the
// forward reach (head + snout + horns) and the backward reach (tail).
function dims(p) {
  const bw = 2 * Math.max(2, R(p.bodyWidth * 6))
  const bl = 2 * Math.max(3, R(p.bodyLength * 6))
  const legLen = Math.max(2, R(p.legLength * 8))
  const legThick = Math.max(1, R(p.legThick * 6))
  const headW = 2 * Math.max(2, R(p.headSize * 5))
  const headH = Math.max(3, R(p.headSize * 9))
  const snout = R(p.snout * 8)
  const tailLen = R(p.tailLength * 10)
  const hornW = Math.max(2, R(headW * 0.25))
  const hornH = Math.max(4, headH - 1)
  const forward = bl / 2 + headH + Math.max(snout, hornH) + 3
  const back = bl / 2 + tailLen + 3
  return { bw, bl, legLen, legThick, headW, headH, snout, tailLen, hornW, hornH,
           artW: ceilTile(bw + 2 * legLen + 6),
           artH: ceilTile(2 * Math.max(forward, back)) }
}

// Collision half-size (screen px at 32-px tiles) derived from the drawn
// body + head so the hitbox tracks the visuals. 0.6 keeps it a touch inside
// the sprite (player-fair); clamped to the nav-supported clearance range —
// 28 is the cyclops-tested 2-tile ceiling.
export function hitHalf(p) {
  const d = dims(p)
  const halfLen = (d.bl + d.headH + d.snout + 2) / 2
  const halfW = (d.bw + 2 * d.legLen + 2) / 2
  return Math.max(8, Math.min(28, Math.round((halfLen + halfW) / 2 * 2 * 0.6)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state, stateT, seed } = pose
  withPixelStage(ctx, d.artW, d.artH, pose.facing + Math.PI / 2, S, c => {
    const pal = state === 'hit'
      ? { outline: WHITE, base: WHITE, light: WHITE }
      : palette(p.hideColor)
    const belly = state === 'hit' ? WHITE : palette(p.bellyColor).base
    const eye = state === 'hit' ? WHITE : palette(p.eyeColor).light

    const walking = state === 'walk'
    const F = walking ? frameOf(pose.t, p.gaitFreq, 4) : 0
    const attackF = state === 'attack' ? frameOf(stateT, 8, 2) : 0
    const deathF = state === 'death' ? Math.min(1, Math.floor(stateT / 0.25)) : 0

    c.save()
    if (state === 'death') { c.globalAlpha *= deathF ? 0.5 : 1; c.scale(1, deathF ? 0.5 : 0.8) }
    if (state === 'attack') c.translate(0, attackF ? -3 : -1)
    const bobPx = R(p.bob * 8)
    if (walking && bobPx) c.translate(0, (F % 2) ? bobPx : 0)

    const bw2 = d.bw / 2, bl2 = d.bl / 2
    const jit = (seed * 7) % 3 - 1          // ±1 art px per-individual length variance
    const bl2j = bl2 + jit

    // tail: contiguous segmented strip stepping back (+y), wiggling by frame
    if (d.tailLen > 0) {
      c.fillStyle = pal.outline
      const segs = Math.max(2, Math.floor(d.tailLen / 3))
      const wig = walking || state === 'idle' ? [0, 1, 0, -1][F] : 0
      let ty = bl2j
      for (let i = 0; i < segs && ty < bl2j + d.tailLen; i++) {
        const size = Math.max(2, R((d.bw * 0.35) * (1 - (i / segs) * (1 - p.tailTaper))))
        c.fillRect((i % 2 ? wig : 0) - Math.floor(size / 2), ty, size, size)
        ty += size
      }
    }

    // legs: stubs out the sides, swinging along y with the gait frame
    c.fillStyle = pal.outline
    const anchors = [[-1, -bl2 + 2, 0], [1, -bl2 + 2, 1], [-1, bl2 - 2 - d.legThick, 2], [1, bl2 - 2 - d.legThick, 3]]
    for (const [sx, y, li] of anchors) {
      const swing = (walking ? GAIT[F][li] : 0) + (state === 'death' ? (sx > 0 ? 2 : -2) : 0)
      const x = sx > 0 ? bw2 : -bw2 - d.legLen
      c.fillRect(x, y + swing, d.legLen, d.legThick)
    }

    // body: 1px outline ring, base fill, lighter belly, optional bulge strips
    c.fillStyle = pal.outline
    c.fillRect(-bw2 - 1, -bl2j - 1, d.bw + 2, d.bl + 2)
    c.fillStyle = pal.base
    c.fillRect(-bw2, -bl2j, d.bw, d.bl)
    const bulgePx = R(p.bulge * 5)
    if (bulgePx > 0) {
      c.fillStyle = pal.base
      c.fillRect(-bw2 - bulgePx, -2, bulgePx, 6)
      c.fillRect(bw2, -2, bulgePx, 6)
    }
    c.fillStyle = belly
    c.fillRect(-Math.floor(bw2 / 2), -Math.floor(bl2 / 2) + 1, Math.floor(bw2), d.bl - Math.floor(bl2) - 1)
    if (p.scales) {
      c.fillStyle = pal.outline
      for (let y = -bl2j + 2; y < bl2j - 2; y += 3)
        for (let x = -bw2 + 2 + (((y + bl2j) / 3) % 2); x < bw2 - 1; x += 3)
          c.fillRect(R(x), y, 1, 1)
    }

    // head block + snout + horns + eyes at the front (-y)
    const hw2 = d.headW / 2, headTop = -bl2j - d.headH
    if (p.horns) {
      c.fillStyle = pal.light
      c.fillRect(-hw2 - d.hornW, headTop - d.hornH, d.hornW, d.hornH + 3)
      c.fillRect(hw2, headTop - d.hornH, d.hornW, d.hornH + 3)
    }
    c.fillStyle = pal.outline
    c.fillRect(-hw2 - 1, headTop - 1, d.headW + 2, d.headH + 2)
    c.fillStyle = pal.base
    c.fillRect(-hw2, headTop, d.headW, d.headH)
    if (d.snout > 0) {
      c.fillStyle = pal.outline
      c.fillRect(-Math.floor(hw2 / 2) - 1, headTop - d.snout - 1, Math.floor(hw2) + 2, d.snout + 2)
      c.fillStyle = pal.light
      c.fillRect(-Math.floor(hw2 / 2), headTop - d.snout, Math.floor(hw2), d.snout)
    }
    const eyePx = Math.max(1, R(p.eyeSize * 8))
    c.fillStyle = eye
    c.fillRect(-hw2 + 1, headTop + 1, eyePx, eyePx)
    c.fillRect(hw2 - 1 - eyePx, headTop + 1, eyePx, eyePx)

    c.restore()
  })
}
