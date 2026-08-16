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

function adjRow({ tag, count, frac }) {
  const row = document.createElement('div')
  row.className = 'adj-row'
  const name = document.createElement('span')
  name.className = 'adj-name'
  name.textContent = tag
  const bar = document.createElement('span')
  bar.className = 'adj-bar'
  bar.style.width = Math.round(frac * 100) + '%'
  const num = document.createElement('span')
  num.className = 'adj-count'
  num.textContent = count
  row.append(name, bar, num)
  return row
}

function dirBlock(label, rows) {
  const wrap = document.createElement('div')
  wrap.className = 'adj-dir'
  const lab = document.createElement('span')
  lab.className = 'adj-dirlabel'
  lab.textContent = label
  wrap.appendChild(lab)
  const list = document.createElement('div')
  list.className = 'adj-rows'
  for (const r of rows) list.appendChild(adjRow(r))
  wrap.appendChild(list)
  return wrap
}

// Render the read-only learned section for `tagDef` into `container` (cleared).
// The explainer line that used to sit here existed only to distinguish the
// learned bias from the hand-authored hard gate above it; with the gate gone
// from the UI there is nothing left to disambiguate.
export function renderLearned(container, tagDef) {
  container.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'grp'
  head.textContent = 'Learned from painting'
  container.appendChild(head)

  const adj = adjacencyViewModel(tagDef)
  if (!['n', 'e', 's', 'w'].some(d => adj[d].length)) {
    const none = document.createElement('div')
    none.className = 'adj-empty'
    none.textContent = 'No learned data — derive from a painting (Build tab).'
    container.appendChild(none)
  } else {
    for (const d of ['n', 'e', 's', 'w']) {
      if (adj[d].length) container.appendChild(dirBlock(d.toUpperCase(), adj[d]))
    }
  }

  const ov = overlaysViewModel(tagDef)
  if (ov && ov.length) {
    const cap = document.createElement('div')
    cap.className = 'cap'
    cap.style.marginTop = '8px'
    cap.textContent = 'overlays'
    container.append(cap, dirBlock('', ov))
  }
}
