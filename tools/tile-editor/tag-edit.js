// Pure ruleset mutations behind the Rules tab's tag editor. No DOM —
// unit-tested with node --test.
//
// The editor is single-tag-per-tile: assigning a tag REPLACES every tag the
// tile had. The schema's `tags` array is honoured on read — memberTiles
// matches any position, removeTileFromTag drops one tag at a time — so a
// hand-edited rulesets.json survives being viewed and edited tag-by-tag, but
// a reassignment collapses it to one tag by design.
//
// `assignTileToTag` requires `ruleset` to be an object — it writes containers
// into it. The readers (`memberTiles`, `brushStatus`) and `removeTileFromTag`
// all tolerate undefined. Every planned caller guards on an active ruleset
// before reaching any of them.

// Tiles carrying `tag`, in ruleset insertion order: [[name, def], ...].
export function memberTiles(ruleset, tag) {
  return Object.entries(ruleset?.tiles ?? {})
    .filter(([, def]) => (def.tags ?? []).includes(tag))
}

// Median weight across `tag`'s current members, or 1 for an empty tag. Used to
// seed a tile added by hand: weights are paint frequencies, so a fresh tile at
// weight 1 beside tag-mates at 160 would effectively never be picked.
export function medianMemberWeight(ruleset, tag) {
  const weights = memberTiles(ruleset, tag).map(([, def]) => def.weight ?? 1).sort((a, b) => a - b)
  if (weights.length === 0) return 1
  const mid = Math.floor(weights.length / 2)
  return weights.length % 2 ? weights[mid] : (weights[mid - 1] + weights[mid]) / 2
}

// A tag the editor invents on demand: permissive gate, no learned data yet.
// Exported so every "make me a fresh tag" path in the editor produces the same
// shape that deriveRules does.
export function blankTag(role) {
  return {
    role, allow: ['*'], forbid: [], directional: {},
    adjacency: { n: {}, e: {}, s: {}, w: {} },
  }
}

// Put `tileName` in `tag`. Keeps an existing weight (and any derived
// `neighbors` table — the next ⚙ Derive rules regenerates those wholesale);
// seeds any tile that has no weight of its own at `weight`, which defaults to 1
// — a brand-new one, or a hand-edited entry missing the key. `tag` is created
// only if missing, so a hand-authored allow/forbid/directional on an existing
// tag survives. Returns the tag the tile came from, or null if it was untagged
// or already there — the caller uses this to report a move.
export function assignTileToTag(ruleset, tileName, tag, role = 'floor', weight = 1) {
  ruleset.tiles ??= {}
  ruleset.tags ??= {}
  const existing = ruleset.tiles[tileName]
  const previous = existing?.tags?.[0] ?? null
  if (!Object.hasOwn(ruleset.tags, tag)) ruleset.tags[tag] = blankTag(role)
  ruleset.tiles[tileName] = { ...existing, tags: [tag], weight: existing?.weight ?? weight }
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
