// Beach terrain for the sea maps: sand that frays into the grass behind it
// and a sand-coloured shoreline where the sand meets the water.
//
// The pond rim tiles (ow_pond_*) carry a grass-green bank, right for a lake
// in the woods and a green stripe on a beach. ow_shore_* are the same rims
// with the green recoloured to sand (tools/synth-shore-tiles.mjs); shoreline()
// in lib.mjs picks them where every land side of a water cell is sandy.
// ow_sand_edge_M_D_V fray the beach into the grass like the mountain floor's
// ow_mtn_edge tiles (tools/synth-ground-edges.mjs, edges.mjs).
import { edgeTileName, edgeTileNames, stampEdges } from './edges.mjs'
import { isSandySkin } from './lib.mjs'
export { isSandySkin }

export const SAND_EDGE_VARIANTS = 3
export const sandEdgeName = (M, D, V) => edgeTileName('ow_sand_edge', M, D, V)
export const SAND_EDGES = edgeTileNames('ow_sand_edge', SAND_EDGE_VARIANTS)
export const SHORE = ['00', '01', '02', '10', '12', '20', '21', '22'].map(k => `ow_shore_${k}`)

const isSand = n => !!n && n.startsWith('ow_sand')

// Fray the sand into the grass — only the grass: the edge tile is sand over
// grass_0, so beside water (the shoreline rim is that edge), stone, dirt or
// a floor the beach keeps its straight tile. Run after every carve and
// before shoreline().
export function stampSandEdge(b) {
  return stampEdges(b, { base: isSand, inside: n => !n?.startsWith('ow_grass'), prefix: 'ow_sand_edge', variants: SAND_EDGE_VARIANTS, plain: () => 'ow_sand_0' })
}
