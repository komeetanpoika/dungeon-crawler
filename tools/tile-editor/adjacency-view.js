// Pure view-models for the Rules-tab "learned" section, plus a thin DOM renderer.
// A Row is { tag, count, frac } where frac = count / (max count in its group),
// so the largest bar in a group is full width. No DOM in the pure builders.

const DIRS = ['n', 'e', 's', 'w']

function rowsFrom(countMap) {
  const rows = Object.entries(countMap ?? {})
    .filter(([, c]) => c > 0)
    .map(([tag, count]) => ({ tag, count }))
  rows.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  const max = rows.length ? rows[0].count : 0
  return rows.map(r => ({ tag: r.tag, count: r.count, frac: max ? r.count / max : 0 }))
}

export function adjacencyViewModel(tagDef) {
  const adj = tagDef?.adjacency
  const out = {}
  for (const d of DIRS) out[d] = rowsFrom(adj?.[d])
  return out
}

export function overlaysViewModel(tagDef) {
  if (!tagDef?.overlays) return null
  return rowsFrom(tagDef.overlays).map(r => r.tag === '' ? { ...r, tag: '(none)' } : r)
}
