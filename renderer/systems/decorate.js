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
      cell.skin = pickWeighted(ruleset, survivors, rng)
    }
  }
  return fallbacks
}
