// 16-bit pixel water lurker: a dome head with wide eyes breaking the
// waterline, weed hair hanging off the crown, a low body band at the surface
// and a ripple ring around it. Upright art — it never rotates with facing,
// only flips. `pose.sink` (0..1) pulls the whole figure under the waterline
// (clipped), which is how the Näkki submerges without a fade.
import { TILE_ART_PX, palette, frameOf, withPixelStage } from './pixel.js'

export const RIG_ID = 'lurker'

export const PARAM_SCHEMA = [
  { key: 'headWidth',  label: 'Head width',   group: 'head', type: 'range', min: 0.6, max: 2.0, step: 0.05, default: 1.2 },
  { key: 'headHeight', label: 'Head height',  group: 'head', type: 'range', min: 0.4, max: 1.4, step: 0.05, default: 0.7 },
  { key: 'eyeSize',    label: 'Eye size',     group: 'head', type: 'range', min: 0.06, max: 0.3, step: 0.01, default: 0.12 },
  { key: 'eyeGap',     label: 'Eye gap',      group: 'head', type: 'range', min: 0.2, max: 0.9, step: 0.05, default: 0.5 },
  { key: 'weedLength', label: 'Weed length',  group: 'weed', type: 'range', min: 0.0, max: 1.2, step: 0.05, default: 0.5 },
  { key: 'weedCount',  label: 'Weed strands', group: 'weed', type: 'range', min: 2, max: 9, step: 1, default: 5 },
  { key: 'sway',       label: 'Sway',         group: 'weed', type: 'range', min: 0.0, max: 1.0, step: 0.05, default: 0.5 },
  { key: 'rippleSize', label: 'Ripple size',  group: 'water', type: 'range', min: 0.5, max: 2.0, step: 0.05, default: 1.2 },
  { key: 'skinColor',   label: 'Skin',   group: 'skin', type: 'color', default: '#3f5a3a' },
  { key: 'weedColor',   label: 'Weed',   group: 'skin', type: 'color', default: '#2c3f26' },
  { key: 'eyeColor',    label: 'Eyes',   group: 'skin', type: 'color', default: '#d8e86a' },
  { key: 'rippleColor', label: 'Ripple', group: 'skin', type: 'color', default: '#6f9fbf' },
]

const R = Math.round
const WHITE = '#f8f8f8'
const WATER = 2   // art px below the stage centre where the surface lies
const ceilTile = v => Math.max(TILE_ART_PX, Math.ceil(v / TILE_ART_PX) * TILE_ART_PX)

function dims(p) {
  const headW = 2 * Math.max(3, R(p.headWidth * 8))
  const headH = Math.max(3, R(p.headHeight * 10))
  const eye = Math.max(1, R(p.eyeSize * 8))
  const gap = Math.max(1, R(p.eyeGap * headW / 4))
  const weedLen = R(p.weedLength * 10)
  const weeds = R(p.weedCount)
  const ripple = Math.max(3, R(p.rippleSize * 10))
  return { headW, headH, eye, gap, weedLen, weeds, ripple,
           artW: ceilTile(Math.max(headW + 6, 2 * ripple + 6)),
           artH: ceilTile(2 * (headH + 8)) }
}

export function hitHalf(p) {
  const d = dims(p)
  return Math.max(8, Math.min(28, R(d.headW * 0.6)))
}

export function drawMonster(ctx, p, pose, S) {
  const d = dims(p)
  const { state } = pose
  const hit = state === 'hit'
  const pal = hit ? { outline: WHITE, base: WHITE, light: WHITE } : palette(p.skinColor)
  const weed = hit ? WHITE : palette(p.weedColor).outline
  const eye = hit ? WHITE : palette(p.eyeColor).light
  const rippleCol = hit ? WHITE : palette(p.rippleColor).light
  const sink = Math.max(0, Math.min(1, pose.sink ?? 0))
  const flip = Math.cos(pose.facing ?? 0) < 0
  const F = frameOf(pose.t, 1 + p.sway * 4, 2)

  withPixelStage(ctx, d.artW, d.artH, 0, S, c => {
    c.save()
    if (flip) c.scale(-1, 1)

    // ripple ring on the surface — never clipped, fades once mostly under
    if (sink < 0.5) {
      const ph = frameOf(pose.t, 3.3, 4) / 3
      const rw = Math.max(3, R(d.ripple * (0.6 + 0.4 * ph)))
      c.save()
      c.globalAlpha *= 1 - ph * 0.7
      c.fillStyle = rippleCol
      c.fillRect(-rw, WATER, 2 * rw, 1)
      c.fillRect(-rw - 1, WATER + 1, 1, 1)
      c.fillRect(rw, WATER + 1, 1, 1)
      c.restore()
    }

    // everything below is clipped at the waterline and slides under with sink
    c.beginPath()
    c.rect(-d.artW / 2, -d.artH / 2, d.artW, d.artH / 2 + WATER)
    c.clip()
    c.translate(0, R(sink * (d.headH + d.weedLen + 6)))

    const hw = d.headW / 2
    const top = WATER - d.headH
    // body band at the surface
    c.fillStyle = pal.outline
    c.fillRect(-hw - 2, WATER - 2, d.headW + 4, 2)
    // head: outline ring, base fill, dome corners, a light crown row
    c.fillStyle = pal.outline
    c.fillRect(-hw - 1, top - 1, d.headW + 2, d.headH + 2)
    c.fillStyle = pal.base
    c.fillRect(-hw, top, d.headW, d.headH)
    c.fillStyle = pal.outline
    c.fillRect(-hw, top, 1, 1); c.fillRect(hw - 1, top, 1, 1)
    c.fillStyle = pal.light
    c.fillRect(-hw + 1, top + 1, d.headW - 2, 1)
    // eyes
    const ey = top + 2
    c.fillStyle = eye
    c.fillRect(-d.gap - d.eye, ey, d.eye, d.eye)
    c.fillRect(d.gap, ey, d.eye, d.eye)
    c.fillStyle = pal.outline
    c.fillRect(-d.gap - 1, ey + d.eye - 1, 1, 1)
    c.fillRect(d.gap + d.eye - 1, ey + d.eye - 1, 1, 1)
    // weed strands hanging from the crown, swaying by frame
    if (d.weedLen > 0) {
      c.fillStyle = weed
      for (let i = 0; i < d.weeds; i++) {
        const x = -hw + 1 + R(i * Math.max(1, d.headW - 3) / Math.max(1, d.weeds - 1))
        const wig = (i + F) % 2 ? 1 : 0
        c.fillRect(x + wig, top - 1, 1, d.weedLen + 2)
      }
    }
    c.restore()
  })
}
