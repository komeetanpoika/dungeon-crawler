// Pure store helpers for Build-tab painted maps. No DOM.
// Store shape: { [ruleset]: { active: string|null, maps: { [name]: SerializedMap } } }
// SerializedMap: { w, h, base, overlay }; grids are grid[row][col] = tileName | null.

export function serializeGrid(base, overlay) {
  const copy = (g) => g.map(row => row.slice())
  return { w: base[0]?.length ?? 0, h: base.length, base: copy(base), overlay: copy(overlay) }
}

function bucket(store, ruleset) {
  store[ruleset] = store[ruleset] ?? { active: null, maps: {} }
  return store[ruleset]
}

export function applyMap(store, ruleset, name, serialized) {
  const b = bucket(store, ruleset)
  b.maps[name] = serialized
  b.active = name
  return store
}

export function renameMap(store, ruleset, from, to) {
  const b = store[ruleset]
  if (!b || !b.maps[from] || from === to || b.maps[to]) return store
  // Rebuild to preserve insertion order with the key swapped in place.
  const rebuilt = {}
  for (const [k, v] of Object.entries(b.maps)) rebuilt[k === from ? to : k] = v
  b.maps = rebuilt
  if (b.active === from) b.active = to
  return store
}

export function deleteMap(store, ruleset, name) {
  const b = store[ruleset]
  if (!b || !b.maps[name]) return store
  delete b.maps[name]
  if (b.active === name) b.active = Object.keys(b.maps)[0] ?? null
  return store
}

export function listMaps(store, ruleset) {
  return Object.keys(store[ruleset]?.maps ?? {})
}

export function getActive(store, ruleset) {
  const b = store[ruleset]
  if (!b) return null
  if (b.active && b.maps[b.active]) return b.active
  return Object.keys(b.maps ?? {})[0] ?? null
}

export function getMap(store, ruleset, name) {
  return store[ruleset]?.maps?.[name] ?? null
}
