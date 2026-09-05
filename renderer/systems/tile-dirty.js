// Tile-change notices for the renderer's cached tile layer. Map cells are
// plain objects mutated in place (a felled tree, a pier gap opened), and the
// tile layer keeps baked chunk images of them — so anything that changes a
// cell's tile/overlay/skin after generation calls markTileDirty and the
// layer rebakes that chunk on its next frame. Exploration needs no mark: the
// layer notices newly explored cells itself.
const dirty = new WeakMap()   // map -> flat [x, y, x, y, ...]

export function markTileDirty(map, x, y) {
  let list = dirty.get(map)
  if (!list) dirty.set(map, list = [])
  list.push(x, y)
}

// Hand the pending notices for a map to the caller and forget them.
export function takeDirtyTiles(map) {
  const list = dirty.get(map)
  if (list) dirty.delete(map)
  return list ?? null
}
