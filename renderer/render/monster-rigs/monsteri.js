// Monsteri: the user's own crayon drawing, cut into pieces by the monster
// cutter (assets/cuts/monsteri.json → renderer/assets/monsters/monsteri-
// parts.png + monsteri-parts.js) and drawn by the shared cut-out engine
// (cutout.js), so its four arms swing (the long upper pair riding out wide,
// the right one carrying its two loose claws), its legs step and its head
// nods, while the whole figure keeps the breath, the bob and lean, the
// lunge, the hit flash, the death shrink and the flip it always had: it
// faces left as drawn and mirrors when it walks east.
// Hand-written rather than generated because it adds one thing: while its
// frost breath charges (pose.eyeGlow, set by systems/monsters/monsteri.js)
// the three orbs on its stalks light up, at the cut's orb points, so the
// glow rides the nodding head. `anchor('head' | 'chest')` tells the hook
// where the mouth and chest are drawn, so the breath leaves the head and the
// grab arms reach out from the chest.
import { makeCutoutRig } from './cutout.js'
import { PARTS } from '../../assets/monsters/monsteri-parts.js'

const ORBS = ['orb1', 'orb2', 'orb3']
const ORB_CORE = '#fffbe6'
const ORB_HALO = '#bae6fd'

// A pale halo that swells with the charge and a bright core on each orb,
// flickering a screen pixel at the edge. ctx is in figure space (art px).
function drawOrbGlow(ctx, p, pose, S, { point }) {
  const glow = pose.eyeGlow ?? 0
  if (!(glow > 0) || pose.state === 'death') return
  const px = PARTS.figure.h / (p.size * S)               // one screen px in art px
  const flick = Math.floor((pose.t ?? 0) * 12) % 2
  const r = 1.5 + 2.5 * glow + flick * px, c = Math.max(px, 0.8 + glow)
  for (const name of ORBS) {
    const { x, y } = point(name)
    ctx.globalAlpha = 0.45 * glow
    ctx.fillStyle = ORB_HALO
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
    ctx.globalAlpha = Math.min(1, 0.4 + glow)
    ctx.fillStyle = ORB_CORE
    ctx.fillRect(x - c, y - c, 2 * c, 2 * c)
  }
}

const rig = makeCutoutRig({
  id: 'monsteri',
  parts: PARTS,
  imageUrl: new URL('../../assets/monsters/monsteri-parts.png', import.meta.url).href,
  extend: drawOrbGlow,
})

export const { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage } = rig
