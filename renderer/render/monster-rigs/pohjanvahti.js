// Pohjan vahti, the watch over the Sampo's grindstone at the copper mountain
// (the Sampo's story: systems/monsters/pohjanvahti.js): a winged beast made
// of the dark, its eyes and claws embers. The winged beast's cut-out pieces
// (assets/monsters/manticore-parts.js: the same cuts, joints and gait) with
// its own picture, renderer/assets/monsters/pohjanvahti-parts.png, repainted
// piece for piece by tools/make-sampo-creatures.mjs.
import { makeCutoutRig } from './cutout.js'
import { PARTS } from '../../assets/monsters/manticore-parts.js'

const rig = makeCutoutRig({
  id: 'pohjanvahti',
  parts: PARTS,
  imageUrl: new URL('../../assets/monsters/pohjanvahti-parts.png', import.meta.url).href,
})

export const { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage } = rig
