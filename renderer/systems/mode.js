// The explicit game-mode seam: which of the three selectable modes (plus the
// depth-0 test arena) a run at `depth` belongs to. Title buttons pass the mode
// directly; this is for the level<N> cheat and defaults, where only the depth
// is known.
import { OPEN_MAPS } from '../data/open-maps.js'

export function modeForDepth(depth) {
  if (depth === 0) return 'arena'
  if (OPEN_MAPS[depth]?.leap) return 'timewarp'
  if (OPEN_MAPS[depth]) return 'adventure'
  return 'rush'
}
