// Registry of per-map quest modules, keyed by OPEN_MAPS map name. Each module
// exposes onArrive(ctx) — called once from game.js arriveOnMap — and
// tick(ctx, delta) — called once per surface frame. game.js guards every
// lookup with `?.`, so a declared quest with no module here is inert.
export const QUEST_MODULES = {}
