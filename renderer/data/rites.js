// Rite placements per open map: which landmark POI anchors which ceremony.
// The trigger is invisible in play — the world art (the mushroom ring) is
// the only clue. See systems/rites.js for conditions and visuals.
export const MAP_RITES = {
  'forest-1-clearings': [
    { fromPoi: 'mushroom ring', talent: 'magic_stance', rite: 'mushroom_circle' },
  ],
  // Lauri's mushroom ring: the trance and ceremony play out, but there is
  // no talent to grant — see game.js's talent-less handling.
  'marsh-3-hermit': [
    { fromPoi: 'mushroom ring', talent: null, rite: 'mushroom_circle' },
  ],
}
