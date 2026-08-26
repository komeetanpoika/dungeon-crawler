// Bridge between the static-overworld map JSON (out/maps/*.json) and the tile
// editor's Build-tab format (renderer/data/painter-maps.json entries), so a
// finished map can be hand-touched in the editor and exported back.
//
//   toPainter(map)            -> { w, h, base, overlay, props }
//   fromPainter(painter, map) -> a new map JSON with the edits applied
//
// The editor edits tiles and collision only: name/biome/notes/pois/playerSpawn
// pass through from the original, and a resized grid is refused because every
// POI and spawn is an absolute coordinate into the original dimensions.

export function toPainter(map) {
  const base = map.ground.map(row => row.map(i => map.palette[i]))
  const overlay = map.prop.map(row => row.map(i => (i >= 0 ? map.palette[i] : null)))
  const props = map.walk.map(row =>
    [...row].map(ch => ({ collision: ch === '1' ? 'walkable' : 'wall' })))
  return { w: map.w, h: map.h, base, overlay, props }
}

export function fromPainter(painter, original) {
  if (painter.h !== original.h || painter.w !== original.w ||
      painter.base.length !== original.h || painter.base[0].length !== original.w)
    throw new Error(`refusing resized grid (${painter.base[0].length}x${painter.base.length} vs ` +
      `${original.w}x${original.h}) — POI coordinates would silently break`)

  // Rebuilt palette: original order first (names still in use keep their
  // familiar slots), then any newly painted names in first-seen order.
  const used = new Set()
  for (const row of painter.base) for (const n of row) if (n) used.add(n)
  for (const row of painter.overlay) for (const n of row) if (n) used.add(n)
  const palette = original.palette.filter(n => used.has(n))
  for (const row of [...painter.base, ...painter.overlay])
    for (const n of row) if (n && !palette.includes(n)) palette.push(n)
  const index = new Map(palette.map((n, i) => [n, i]))

  const ground = painter.base.map((row, y) => row.map((n, x) => {
    const name = n ?? original.palette[original.ground[y][x]]
    if (!index.has(name)) { index.set(name, palette.length); palette.push(name) }
    return index.get(name)
  }))
  const prop = painter.overlay.map(row => row.map(n => (n ? index.get(n) : -1)))
  const walk = painter.props.map((row, y) => row.map((p, x) =>
    p?.collision ? (p.collision === 'walkable' ? '1' : '0') : original.walk[y][x]).join(''))

  return { ...original, w: original.w, h: original.h, palette, ground, prop, walk }
}

// Repair the collision layer from the painted art, but ONLY on cells whose
// art differs from the original export — hand edits usually touch tiles, not
// the properties layer, so bridges land as walls and repainted banks as
// walkable grass. Rules (top visible layer decides): pier/bridge overlays are
// walkable, water/pond looks are walls, grass looks are walkable; anything
// else (rocks, houses…) keeps its painted collision. Pure: returns a new
// painter, input untouched.
export function deriveWalkFixes(painter, original) {
  const artClass = (base, overlay) => {
    if (overlay?.startsWith('ow_pier_') || overlay?.includes('bridge')) return 'walkable'
    const top = overlay ?? base
    if (top?.startsWith('ow_water_') || top?.startsWith('ow_pond_')) return 'wall'
    if (top?.startsWith('ow_grass')) return 'walkable'
    return null
  }
  const props = painter.props.map((row, y) => row.map((p, x) => {
    const origBase = original.palette[original.ground[y]?.[x]]
    const origOverlay = original.prop[y]?.[x] >= 0 ? original.palette[original.prop[y][x]] : null
    const changed = painter.base[y][x] !== origBase || painter.overlay[y][x] !== origOverlay
    if (!changed) return p ? { ...p } : p
    const derived = artClass(painter.base[y][x], painter.overlay[y][x])
    return derived ? { ...p, collision: derived } : (p ? { ...p } : p)
  }))
  return { ...painter, props }
}
