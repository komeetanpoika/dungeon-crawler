// The rig module the cutter writes for a monster: a thin wrapper that hands
// the generated PARTS and atlas to the shared cut-out engine and re-exports
// the rig interface monsters.js expects. The first line is the marker that
// lets the installer tell a generated module from a hand-written one.
export const CUTOUT_MARKER = '// cutout-rig: written by tools/monster-cutter'

export function rigModuleSource(name) {
  return `${CUTOUT_MARKER}
// Rig for "${name}", built from its cut-out pieces. Safe to delete and re-install.
import { makeCutoutRig } from './cutout.js'
import { PARTS } from '../../assets/monsters/${name}-parts.js'

const rig = makeCutoutRig({
  id: '${name}',
  parts: PARTS,
  imageUrl: new URL('../../assets/monsters/${name}-parts.png', import.meta.url).href,
})

export const { RIG_ID, PARAM_SCHEMA, drawMonster, hitHalf, hitShape, drawnTop, anchor, _setSheetImage } = rig
`
}
