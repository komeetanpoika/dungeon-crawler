// cutout-rig: written by tools/monster-cutter
// Rig for "manticore", built from its cut-out pieces. Safe to delete and re-install.
import { makeCutoutRig } from './cutout.js'
import { PARTS } from '../../assets/monsters/manticore-parts.js'

const rig = makeCutoutRig({
  id: 'manticore',
  parts: PARTS,
  imageUrl: new URL('../../assets/monsters/manticore-parts.png', import.meta.url).href,
})

export const { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage } = rig
