// Pure ruleset mutations behind the Rules tab's tag editor. No DOM —
// unit-tested with node --test.
//
// The editor has always been single-tag-per-tile: assigning a tag replaces
// whatever tag the tile had. The multi-tag shape in the ruleset schema is
// honoured on read (removeTileFromTag drops one tag at a time) so a
// hand-edited rulesets.json is never silently flattened.

// Tiles carrying `tag`, in ruleset insertion order: [[name, def], ...].
export function memberTiles(ruleset, tag) {
  return Object.entries(ruleset?.tiles ?? {})
    .filter(([, def]) => (def.tags ?? []).includes(tag))
}

// A tag the editor invents on demand: permissive gate, no learned data yet.
function blankTag(role) {
  return {
    role, allow: ['*'], forbid: [], directional: {},
    adjacency: { n: {}, e: {}, s: {}, w: {} },
  }
}

// Put `tileName` in `tag`. Keeps an existing weight (and any derived
// `neighbors` table — the next ⚙ Derive rules regenerates those wholesale);
// new tiles start at weight 1. `tag` is created only if missing, so a
// hand-authored allow/forbid/directional on an existing tag survives.
// Returns the tag the tile came from, or null if it was untagged or already
// there — the caller uses this to report a move.
export function assignTileToTag(ruleset, tileName, tag, role = 'floor') {
  ruleset.tiles ??= {}
  ruleset.tags ??= {}
  const existing = ruleset.tiles[tileName]
  const previous = existing?.tags?.[0] ?? null
  ruleset.tags[tag] ??= blankTag(role)
  ruleset.tiles[tileName] = { ...existing, tags: [tag], weight: existing?.weight ?? 1 }
  return previous === tag ? null : previous
}

// Drop `tag` from `tileName`. A tile left with no tags leaves the ruleset
// entirely: a ruleset's tile list is exactly its tagged tiles, so there is no
// orphan state to explain. Returns whether anything changed.
export function removeTileFromTag(ruleset, tileName, tag) {
  const def = ruleset?.tiles?.[tileName]
  if (!def || !(def.tags ?? []).includes(tag)) return false
  def.tags = def.tags.filter(t => t !== tag)
  if (def.tags.length === 0) delete ruleset.tiles[tileName]
  return true
}

// One-line read-out for the Build tab's brush.
export function brushStatus(ruleset, tileName) {
  if (!tileName) return { tile: null, tag: null, untagged: false, text: 'no brush selected' }
  const tag = ruleset?.tiles?.[tileName]?.tags?.[0] ?? null
  return { tile: tileName, tag, untagged: !tag, text: `${tileName} · ${tag ?? 'untagged'} →` }
}
