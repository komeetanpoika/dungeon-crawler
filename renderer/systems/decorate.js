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

// Default smoothing for direct adjacencyScore callers that have no candidate set
// to size a floor against (the overlay pass).
export const ADJACENCY_ALPHA = 0.5

// Share of a context's observed mass reserved for pairings the painting never
// showed — the "loose" model's escape hatch. Held FIXED as the candidate set
// grows: a flat per-candidate floor let the unobserved group's mass scale with
// the number of tiles in the ruleset, so adding sprites quietly destroyed the
// adjacency signal (a 20-tile wall set put over half its probability on
// combinations the painting never contained).
export const ADJACENCY_EPSILON = 0.02

// Total weight of every tile carrying `tag`. Memoized per ruleset — this sits in
// the innermost decoration loop, and the editor keeps one ruleset object alive
// across weight edits, so decorateMap drops the cache at the start of each pass.
const tagMassCache = new WeakMap()
function tagMass(ruleset, tag) {
  let byTag = tagMassCache.get(ruleset)
  if (!byTag) { byTag = new Map(); tagMassCache.set(ruleset, byTag) }
  const hit = byTag.get(tag)
  if (hit !== undefined) return hit
  let mass = 0
  for (const def of Object.values(ruleset.tiles)) {
    if ((def.tags ?? []).includes(tag)) mass += def.weight ?? 1
  }
  byTag.set(tag, mass)
  return mass
}

// Observed count for placing `tileName` next to the decided neighbor `nb`
// ({ dir, skin } where skin is the neighbor's tile name).
//
// A tile the painting covered carries its own exact per-sprite table, and that
// wins outright: an absent entry there is a real "never seen", not a reason to
// consult the coarser tag table. Without this, sprites sharing a tag are
// indistinguishable to the scorer — every wall in a 17-sprite `castle.wall` tag
// scores identically and the pick collapses to weight-only noise.
//
// A tile the painting never covered (hand-added in the Draw tab, say) falls back
// to its tag's table, scaled by the tile's share of the tag so within-tag weights
// still decide between its siblings.
export function adjacencyCount(ruleset, tileName, nb) {
  const perTile = ruleset.tiles?.[tileName]?.neighbors?.[nb.dir]
  if (perTile) return perTile[nb.skin] ?? 0

  const nbTags = tagsOf(ruleset, nb.skin)
  let count = 0
  for (const t of tagsOf(ruleset, tileName)) {
    const dirMap = ruleset.tags[t]?.adjacency?.[nb.dir]
    if (!dirMap) continue
    const mass = tagMass(ruleset, t)
    const share = mass > 0 ? (ruleset.tiles[tileName]?.weight ?? 1) / mass : 1
    for (const u of nbTags) count += (dirMap[u] ?? 0) * share
  }
  return count
}

// Multiplicative adjacency score for placing `tileName` given decided neighbors.
// `alphas` is the per-neighbor smoothing floor, parallel to `neighbors`; callers
// that know the candidate set size it against the context (see pickByAdjacency),
// everyone else gets the flat ADJACENCY_ALPHA. Returns 1 (neutral) with no
// neighbors.
export function adjacencyScore(ruleset, tileName, neighbors, alphas = null) {
  let score = 1
  neighbors.forEach((nb, i) => {
    score *= adjacencyCount(ruleset, tileName, nb) + (alphas ? alphas[i] : ADJACENCY_ALPHA)
  })
  return score
}

// Adjacency-weighted pick among `names`.
//
// The observed counts are the posterior already: a tile painted often has
// proportionally larger counts, so they REPLACE `weight` rather than multiply it.
// Multiplying squared the frequency prior and let a frequently-painted sprite
// outbid the correct answer in contexts where it had never once appeared.
// `weight` still decides when the painting is silent about a context.
export function pickByAdjacency(ruleset, names, neighbors, rng) {
  // Per neighbor: how much evidence the painting offers for this context across
  // the candidate set. Zero mass means it is silent, so that neighbor must not
  // steer the pick at all — otherwise it multiplies every candidate by the same
  // floor and only adds rounding noise.
  const informative = [], alphas = []
  for (const nb of neighbors) {
    const mass = names.reduce((s, n) => s + adjacencyCount(ruleset, n, nb), 0)
    if (mass <= 0) continue
    informative.push(nb)
    alphas.push(ADJACENCY_EPSILON * mass / names.length)
  }
  if (informative.length === 0) return pickWeighted(ruleset, names, rng)

  const weights = names.map(n => adjacencyScore(ruleset, n, informative, alphas))
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return pickWeighted(ruleset, names, rng)
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
        const members = overlayTilesByTag[tag] ?? []
        // Candidate mass for this tag must sum to the observed count `c`
        // regardless of how many tiles carry the tag — otherwise a tag with
        // multiple member tiles fans out into `c` per member and amplifies
        // overlay density far beyond what the source painting showed.
        const memberW = members.reduce((s, n) => s + (ruleset.tiles[n].weight ?? 1), 0)
        if (memberW <= 0) continue
        for (const name of members) {
          const w = (ruleset.tiles[name].weight ?? 1) / memberW * c * adjacencyScore(ruleset, name, neighbors)
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
  tagMassCache.delete(ruleset)   // weights may have been edited since the last pass
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
