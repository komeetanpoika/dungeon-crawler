// Dungeon gates on open maps: each dungeon_entrance POI is stamped (by
// openmap.js) as a sealed 2-wide vined arch flanked by gargoyle fountains.
// A gate opens when its trigger fires and stays open for the rest of the
// run — latched, so un-flowing a fountain afterwards changes nothing.
//
// Triggers are pluggable. 'fountains' (every gargoyle of the gate flowing)
// is the only type so far; a future mechanism either adds a type here or
// calls openGate directly.

export function openGate(state, gateId) {
  const gate = state.gates?.[gateId]
  if (!gate || gate.open) return
  gate.open = true
  for (const c of gate.cells) state.map[c.y][c.x].overlay = c.overlay
}

export function updateGates(state) {
  for (const [id, gate] of Object.entries(state.gates ?? {})) {
    if (gate.open || gate.trigger !== 'fountains') continue
    const walls = state.entities.filter(e => e.isFountainWall && e.gateId === id)
    if (walls.length && walls.every(w => w.flowing)) openGate(state, id)
  }
}
