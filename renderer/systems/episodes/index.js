// Registry of per-map leap episode modules, keyed by OPEN_MAPS map name.
// Each module (Tasks 12-14) exposes onArrive(ctx) — called once from
// game.js arriveOnMap — and tick(ctx, delta) — called once per frame from
// the update loop's leap-episode tick, alongside the Echo. Empty for now;
// game.js already guards every lookup with `?.`.
export const EPISODE_MODULES = {}
