// Baseline top-down quadruped rig. Pure: draws around origin from
// (params, pose, S) only. -y is forward after rotating by pose.facing + PI/2
// (same convention as render/dragonboss.js). Every pose.state renders:
// hit = white flash, death = collapse + fade.
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

function hash(i, j) { const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s) }
function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16)
  const c = v => Math.max(0, Math.min(255, v + d))
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`
}

export function drawMonster(ctx, p, pose, S) {
  const { t, state, stateT, seed } = pose
  const jit = 0.92 + 0.16 * hash(seed, 1)
  const bl = p.bodyLength * S * jit, bw = p.bodyWidth * S * jit
  const dead = state === 'death'
  const deathK = dead ? Math.min(1, stateT / 0.5) : 0
  const gait = dead ? 0 : pose.speed01

  ctx.save()
  ctx.rotate(pose.facing + Math.PI / 2)
  ctx.globalAlpha *= 1 - deathK * 0.8
  ctx.scale(1, 1 - deathK * 0.6)
  ctx.translate(0, Math.sin(t * p.gaitFreq) * p.bob * S * gait)
  const lunge = state === 'attack' ? -Math.sin(Math.min(stateT, 0.3) / 0.3 * Math.PI) * S * 0.35 : 0

  // legs first (under the body): stubs out the sides, swinging along y with the gait
  const ll = p.legLength * S, lw = Math.max(1, p.legThick * S)
  ctx.strokeStyle = shade(p.hideColor, -30); ctx.lineWidth = lw; ctx.lineCap = 'round'
  const anchors = [[-1, -bl * 0.3, 0], [1, -bl * 0.3, Math.PI], [-1, bl * 0.32, Math.PI], [1, bl * 0.32, 0]]
  for (const [sx, y, phase] of anchors) {
    const swing = Math.sin(t * p.gaitFreq + phase) * 0.6 * gait
    const x0 = sx * bw * 0.45
    ctx.beginPath(); ctx.moveTo(x0, y)
    ctx.lineTo(x0 + sx * ll * 0.55, y + swing * ll * 0.5); ctx.stroke()
  }

  // tail: chain of shrinking discs swinging behind (+y)
  const segs = 5, tl = p.tailLength * S
  let tx = 0, ty = bl * 0.48, ang = Math.PI / 2
  ctx.fillStyle = shade(p.hideColor, -15)
  for (let i = 0; i < segs && tl > 0; i++) {
    ang += dead ? 0 : Math.sin(t * 2.1 - i * 0.8) * 0.25
    tx += Math.cos(ang) * tl / segs; ty += Math.sin(ang) * tl / segs
    const r = Math.max(1, bw * 0.22 * (1 - (i / segs) * (1 - p.tailTaper)))
    ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill()
  }

  // body + belly
  ctx.fillStyle = p.hideColor
  ctx.beginPath(); ctx.ellipse(0, lunge * 0.3, bw * (1 + p.bulge * 0.4), bl * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = p.bellyColor
  ctx.beginPath(); ctx.ellipse(0, bl * 0.08 + lunge * 0.3, bw * 0.55 * (1 + p.bulge), bl * 0.3, 0, 0, Math.PI * 2); ctx.fill()
  if (p.scales) {
    ctx.strokeStyle = shade(p.hideColor, -40); ctx.lineWidth = 1
    for (let i = 0; i < 14; i++) {
      const sx = (hash(seed, i * 2) - 0.5) * bw * 1.4
      const sy = (hash(seed, i * 2 + 1) - 0.5) * bl * 0.8
      ctx.beginPath(); ctx.arc(sx, sy + lunge * 0.3, bw * 0.12, 0.2, Math.PI - 0.2); ctx.stroke()
    }
  }

  // head at the front (-y), lunging forward on attack
  const hs = p.headSize * S, hy = -bl * 0.5 - hs * 0.4 + lunge
  if (p.horns) {
    ctx.strokeStyle = '#d8c8a6'; ctx.lineWidth = Math.max(1.5, hs * 0.14); ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * hs * 0.5, hy)
      ctx.quadraticCurveTo(s * hs * 1.1, hy - hs * 0.3, s * hs * 0.9, hy - hs * 1.0); ctx.stroke()
    }
  }
  ctx.fillStyle = p.hideColor
  ctx.beginPath(); ctx.ellipse(0, hy, hs * 0.8, hs * 0.7, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = shade(p.hideColor, 12) // snout
  ctx.beginPath(); ctx.ellipse(0, hy - hs * 0.5 - p.snout * S * 0.5, hs * 0.35, hs * 0.35 + p.snout * S * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = p.eyeColor
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(s * hs * 0.4, hy - hs * 0.15, p.eyeSize * S, p.eyeSize * S * 0.7, 0, 0, Math.PI * 2); ctx.fill()
  }

  // hit flash on top of everything
  if (state === 'hit') {
    ctx.globalAlpha *= 0.7; ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 1.1, bl * 0.55, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}
