// Rite placements per open map: which landmark POI anchors which ceremony.
// The trigger is invisible in play — the world art (the mushroom ring) is
// the only clue. See systems/rites.js for conditions and visuals.
export const MAP_RITES = {
  'forest-1-clearings': [
    { fromPoi: 'mushroom ring', outfit: 'robe', rite: 'mushroom_circle' },
  ],
  // Lauri's mushroom ring: the trance and ceremony play out, but there is
  // no outfit to give — see game.js's outfit-less handling.
  'marsh-3-hermit': [
    { fromPoi: 'mushroom ring', outfit: null, rite: 'mushroom_circle' },
  ],
}
