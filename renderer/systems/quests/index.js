// Registry of per-map quest modules, keyed by OPEN_MAPS map name. Each module
// exposes onArrive(ctx) — called once from game.js arriveOnMap — and
// tick(ctx, delta) — called once per surface frame. game.js guards every
// lookup with `?.`, so a declared quest with no module here is inert.
import { onArrive as clearingsArrive, tick as clearingsTick } from './clearings.js'
import { onArrive as riverArrive, tick as riverTick } from './river.js'
import { onArrive as passArrive, tick as passTick } from './pass.js'

export const QUEST_MODULES = {
  'forest-1-clearings': { onArrive: clearingsArrive, tick: clearingsTick },
  'forest-2-river':     { onArrive: riverArrive,     tick: riverTick },
  'forest-3-autumn':    { onArrive: passArrive,      tick: passTick },
}
