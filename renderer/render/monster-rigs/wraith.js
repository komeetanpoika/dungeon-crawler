// 16-bit pixel wraith: rounded cowl, hollow face with ember eyes, a body
// that tapers into tatters fluttering on a 4-frame loop. Upright, flips
// with facing. Channels: `flicker` jitters alpha per frame (the Sammunut
// shuddering at the edge of the light), `burn` shortens the body from the
// tatters up and spreads the ember tint. Death: tatters lift off as ember
// pixels while the cowl collapses and fades.
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'wraith'

export const PARAM_SCHEMA = [
  { key: 'height',       label: 'Height',        group: 'body', type: 'range', min: 0.8, max: 2.5, step: 0.05, default: 1.6 },
  { key: 'width',        label: 'Width',         group: 'body', type: 'range', min: 0.5, max: 1.6, step: 0.05, default: 0.9 },
  { key: 'cowl',         label: 'Cowl',          group: 'body', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.6 },
  { key: 'tatterCount',  label: 'Tatters',       group: 'tatters', type: 'range', min: 2, max: 6, step: 1, default: 4 },
  { key: 'tatterLength', label: 'Tatter length', group: 'tatters', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.7 },
  { key: 'flutterFreq',  label: 'Flutter',       group: 'tatters', type: 'range', min: 2, max: 12, step: 0.5, default: 6 },
  { key: 'eyeSize',      label: 'Eye size',      group: 'face', type: 'range', min: 0.05, max: 0.3, step: 0.01, default: 0.12 },
  { key: 'cloakColor',   label: 'Cloak',  group: 'skin', type: 'color', default: '#3a3550' },
  { key: 'emberColor',   label: 'Ember',  group: 'skin', type: 'color', default: '#ff7a2a' },
  { key: 'eyeColor',     label: 'Eyes',   group: 'skin', type: 'color', default: '#ffb040' },
]

const R = Math.round
const WHITE = '#f8f8f8'
const clamp01 = v => Math.max(0, Math.min(1, v ?? 0))
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)

function dims(p) {
  const bodyW = 2 * Math.max(2, R(p.width * 6))
  const bodyH = Math.max(8, R(p.height * 14))
  const cowlH = Math.max(2, R(p.cowl * 6))
  const faceH = Math.max(3, R(bodyH * 0.3))
  const tatters = R(p.tatterCount)
  const tatLen = Math.max(2, R(p.tatterLength * 8))
  const eye = Math.max(1, R(p.eyeSize * 8))
  return { bodyW, bodyH, cowlH, faceH, tatters, tatLen, eye,
           artW: ceilTile(bodyW + 8),
           artH: ceilTile(bodyH + 2 * cowlH + 2 * tatLen + 12) }
}

export function hitHalf(p) {
  const d = dims(p)
  return Math.max(8, Math.min(28, R((d.bodyW + d.bodyH / 2) * 0.5)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state, stateT, seed } = pose
  const hit = state === 'hit'
  const cloak = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.cloakColor)
  const ember = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.emberColor)
  const eye = hit ? WHITE : palette(p.eyeColor).light
  const burn = clamp01(pose.burn)
  const flick = clamp01(pose.flicker)
  const flip = Math.cos(pose.facing ?? 0) < 0
  const F = frameOf(pose.t, p.flutterFreq, 4)

  withPixelStage(ctx, d.artW, d.artH, 0, S, c => {
    c.save()
    if (flip) c.scale(-1, 1)
    if (flick > 0) {
      const r = (((seed ?? 0) + Math.floor(pose.t * 30)) * 7919 % 13) / 13
      c.globalAlpha *= 1 - flick * (0.25 + 0.6 * r)
    }
    const top = -d.bodyH / 2
    const bottom = d.bodyH / 2

    if (state === 'death') {
      const k = Math.min(1, stateT / 0.7)
      c.fillStyle = ember.light
      for (let i = 0; i < d.tatters + 2; i++) {
        const x = -d.bodyW / 2 + R(i * d.bodyW / (d.tatters + 1))
        const y = bottom - R(k * (d.bodyH + 12)) - (i % 3) * 2
        c.fillRect(x, y, 1, 1)
      }
      c.globalAlpha *= 1 - k
      c.translate(0, R(k * d.bodyH * 0.4))
      c.scale(1, Math.max(0.05, 1 - k * 0.8))
    }

    // body: tapering rows, the lowest rows ember-tinted as it burns
    const visH = Math.max(2, R(d.bodyH * (1 - 0.5 * burn)))
    const emberRows = R(burn * 6)
    for (let y = 0; y < visH; y++) {
      const w = 2 * Math.max(1, R((d.bodyW / 2) * (1 - 0.4 * y / d.bodyH)))
      c.fillStyle = cloak.outline
      c.fillRect(-w / 2 - 1, top + y, w + 2, 1)
      c.fillStyle = (emberRows > 0 && y >= visH - emberRows) ? ember.base : cloak.base
      c.fillRect(-w / 2, top + y, w, 1)
    }

    // tatters trailing below the visible body
    const tatLen = Math.max(1, R(d.tatLen * (1 - burn)))
    for (let i = 0; i < d.tatters; i++) {
      const x = -d.bodyW / 2 + 1 + R(i * Math.max(1, d.bodyW - 3) / Math.max(1, d.tatters - 1))
      const dy = [0, 1, 0, -1][(F + i) % 4]
      c.fillStyle = i % 2 ? cloak.base : cloak.outline
      c.fillRect(x, top + visH + dy, 2, tatLen)
    }

    // cowl: rounded rows widening downward, a light rim
    for (let r = 0; r < d.cowlH; r++) {
      const w = 2 * Math.max(1, R((d.bodyW / 2 + 1) * Math.sqrt((r + 1) / d.cowlH)))
      c.fillStyle = cloak.outline
      c.fillRect(-w / 2 - 1, top - d.cowlH + r, w + 2, 1)
      c.fillStyle = cloak.light
      c.fillRect(-w / 2, top - d.cowlH + r, w, 1)
    }

    // hollow face and ember eyes
    c.fillStyle = cloak.outline
    c.fillRect(-d.bodyW / 2 + 1, top, d.bodyW - 2, d.faceH)
    c.fillStyle = eye
    c.fillRect(-R(d.bodyW / 4) - Math.floor(d.eye / 2), top + 1, d.eye, d.eye)
    c.fillRect(R(d.bodyW / 4) - Math.floor(d.eye / 2), top + 1, d.eye, d.eye)

    c.restore()
  })
}
