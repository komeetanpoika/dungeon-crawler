// cutout-rig: written by tools/monster-cutter
// Rig for "pullopete", built from its cut-out pieces. Safe to delete and re-install.
import { makeCutoutRig } from './cutout.js'
import { PARTS } from '../../assets/monsters/pullopete-parts.js'

const rig = makeCutoutRig({
  id: 'pullopete',
  parts: PARTS,
  imageUrl: new URL('../../assets/monsters/pullopete-parts.png', import.meta.url).href,
})

export const { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage } = rig
