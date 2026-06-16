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
export function renderLearned(container, tagDef) {
  container.innerHTML = ''

  const explain = document.createElement('div')
  explain.className = 'label'
  explain.textContent = 'Rules above gate adjacency; learned values below only bias the pick.'
  container.appendChild(explain)

  const head = document.createElement('div')
  head.className = 'label'
  head.textContent = 'Learned neighbors (from painting)'
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
    const oh = document.createElement('div')
    oh.className = 'label'
    oh.textContent = 'Learned overlays'
    container.appendChild(oh)
    container.appendChild(dirBlock('', ov))
  }
}
