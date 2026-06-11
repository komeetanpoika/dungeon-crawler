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
  return ruleset.tiles[tileName]?.tags ?? []
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
