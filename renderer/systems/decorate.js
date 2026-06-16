import { TILE } from './entities.js'

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' }

// Which logical map tiles a rule role may skin. The decoration pass only ever
// swaps visuals within the same role, so walkability cannot change.
export function roleOf(tileId) {
  if (tileId === TILE.FLOOR || tileId === TILE.SAND) return 'floor'
  if (tileId === TILE.WALL) return 'wall'
  return null
}

export function tagsOf(ruleset, tileName) {
  return ruleset?.tiles?.[tileName]?.tags ?? []
}

// One-directional check: may a tile with `fromTags` sit with a `toTags` tile
// in direction `dir`? forbid beats allow; a non-empty directional list
// replaces `allow` for that direction; '*' matches anything.
function allowedOneWay(ruleset, fromTags, toTags, dir) {
  for (const tag of fromTags) {
    const rule = ruleset.tags[tag]
    if (!rule) continue
    if (rule.forbid?.some(t => toTags.includes(t))) return false
    const dirList = rule.directional?.[dir]
    const effective = (dirList && dirList.length > 0) ? dirList : (rule.allow ?? ['*'])
    if (effective.includes('*')) continue
    if (!toTags.some(t => effective.includes(t))) return false
  }
  return true
}

// Mutual compatibility: checked from both tiles' perspectives so no forbidden
// pairing can appear regardless of decoration scan order.
export function pairAllowed(ruleset, aName, bName, dirAtoB) {
  const aTags = tagsOf(ruleset, aName)
  const bTags = tagsOf(ruleset, bName)
  return allowedOneWay(ruleset, aTags, bTags, dirAtoB)
      && allowedOneWay(ruleset, bTags, aTags, OPPOSITE[dirAtoB])
}

export function candidatesForRole(ruleset, role) {
  return Object.entries(ruleset.tiles)
    .filter(([, def]) => (def.tags ?? []).some(t => ruleset.tags[t]?.role === role))
    .map(([name]) => name)
}

export function pickWeighted(ruleset, names, rng) {
  const total = names.reduce((s, n) => s + (ruleset.tiles[n].weight ?? 1), 0)
  let r = rng() * total
  for (const n of names) {
    r -= ruleset.tiles[n].weight ?? 1
    if (r <= 0) return n
  }
  return names[names.length - 1]
}

// Smoothing so unseen adjacencies stay possible but unlikely (the "loose" model).
export const ADJACENCY_ALPHA = 0.5

// Multiplicative adjacency score for placing `tileName` given decided neighbors.
// neighbors: [{ dir, skin }] where skin is the neighbor's tile name. Each tag of
// `tileName` contributes its observed count toward the neighbor's tags in `dir`;
// a tag with no adjacency data contributes a flat ALPHA, so the score is
// constant across candidates and cancels — reducing selection to weight-only —
// when no adjacency info exists. Returns 1 (neutral) when there are no neighbors.
export function adjacencyScore(ruleset, tileName, neighbors) {
  const tags = tagsOf(ruleset, tileName)
  let score = 1
  for (const nb of neighbors) {
    const nbTags = tagsOf(ruleset, nb.skin)
    let count = 0
    for (const t of tags) {
      const dirMap = ruleset.tags[t]?.adjacency?.[nb.dir]
      if (!dirMap) continue
      for (const u of nbTags) count += dirMap[u] ?? 0
    }
    score *= count + ADJACENCY_ALPHA
  }
  return score
}

// Weighted pick combining each tile's base weight with its adjacency score.
export function pickByAdjacency(ruleset, names, neighbors, rng) {
  const weights = names.map(n =>
    (ruleset.tiles[n].weight ?? 1) * adjacencyScore(ruleset, n, neighbors))
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return names[names.length - 1]
  let r = rng() * total
  for (let i = 0; i < names.length; i++) {
    r -= weights[i]
    if (r <= 0) return names[i]
  }
  return names[names.length - 1]
}

// Drop ruleset tiles whose sprite failed to load so decorateMap never
// assigns a skin that cannot be drawn. loadedSprites is keyed by file name.
export function pruneMissingTiles(rulesets, loadedSprites) {
  for (const [setName, set] of Object.entries(rulesets)) {
    for (const name of Object.keys(set.tiles ?? {})) {
      if (!(name in loadedSprites)) {
        console.warn(`decorate: dropping '${name}' from ruleset '${setName}' — sprite missing`)
        delete set.tiles[name]
      }
    }
  }
}

// True when some base tag offers at least one real overlay (beyond '' = none).
export function rulesetHasOverlays(ruleset) {
  if (!ruleset?.tags) return false
  return Object.values(ruleset.tags).some(t =>
    t.overlays && Object.keys(t.overlays).some(k => k !== ''))
}

// Second decoration pass: assigns cell.overlay for floor/wall cells whose base
// skin's tag carries an `overlays` distribution. A synthetic "none" candidate
// (weighted by the '' empty count) competes with overlay tiles weighted by
// base-conditional frequency × tile weight × overlay-neighbor adjacency.
function decorateOverlays(map, ruleset, rng) {
  const overlayTilesByTag = {}
  for (const [name, def] of Object.entries(ruleset.tiles ?? {})) {
    for (const t of def.tags ?? []) {
      if (ruleset.tags[t]?.role === 'overlay') (overlayTilesByTag[t] ??= []).push(name)
    }
  }
  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      const cell = map[row][col]
      if (cell.locked) continue
      cell.overlay = null
      if (!cell.skin) continue
      let dist = null
      for (const bt of tagsOf(ruleset, cell.skin)) {
        if (ruleset.tags[bt]?.overlays) { dist = ruleset.tags[bt].overlays; break }
      }
      if (!dist) continue
      // `skin` is adjacencyScore's generic "neighbor tile name" field; here it
      // carries the decided N/W overlay tile, not a base skin.
      const neighbors = [
        { dir: 'n', skin: map[row - 1]?.[col]?.overlay },
        { dir: 'w', skin: map[row]?.[col - 1]?.overlay },
      ].filter(nb => nb.skin)
      const cands = []   // { name|null, weight }
      const noneW = dist[''] ?? 0
      if (noneW > 0) cands.push({ name: null, weight: noneW })
      for (const [tag, c] of Object.entries(dist)) {
        if (tag === '' || !(c > 0)) continue
        for (const name of overlayTilesByTag[tag] ?? []) {
          const w = (ruleset.tiles[name].weight ?? 1) * c * adjacencyScore(ruleset, name, neighbors)
          cands.push({ name, weight: w })
        }
      }
      const total = cands.reduce((s, c) => s + c.weight, 0)
      if (total <= 0) continue
      let r = rng() * total
      for (const c of cands) { r -= c.weight; if (r <= 0) { cell.overlay = c.name; break } }
    }
  }
}

// Assigns cell.skin for every floor/wall cell, scanning top-left to
// bottom-right. Only the already-decided N and W neighbors constrain a cell;
// pairAllowed's mutual check guarantees no forbidden pairing survives.
// Returns the number of dead-end fallbacks (cells a covered role failed on).
export function decorateMap(map, ruleset, rng = Math.random) {
  if (!ruleset) return 0
  let fallbacks = 0
  const byRole = {
    floor: candidatesForRole(ruleset, 'floor'),
    wall:  candidatesForRole(ruleset, 'wall'),
  }
  for (let row = 0; row < map.length; row++) {
    for (let col = 0; col < map[row].length; col++) {
      const cell = map[row][col]
      if (cell.locked) continue
      const role = roleOf(cell.tile)
      if (!role) continue
      const neighbors = [
        { dir: 'n', skin: map[row - 1]?.[col]?.skin },
        { dir: 'w', skin: map[row]?.[col - 1]?.skin },
      ].filter(nb => nb.skin)
      const survivors = byRole[role].filter(name =>
        neighbors.every(nb => pairAllowed(ruleset, name, nb.skin, nb.dir)))
      if (survivors.length === 0) {
        cell.skin = null
        if (byRole[role].length > 0) {
          fallbacks++
          console.warn(`decorate: no valid tile at (${col},${row}) — using theme default`)
        }
        continue
      }
      cell.skin = pickByAdjacency(ruleset, survivors, neighbors, rng)
    }
  }
  if (rulesetHasOverlays(ruleset)) decorateOverlays(map, ruleset, rng)
  return fallbacks
}
