// tools/monster-lab/params-panel.js
// Schema -> DOM controls. Groups are collapsible; range rows show the value.
export function buildParamsPanel(container, schema, params, onChange) {
  container.innerHTML = ''
  const groups = new Map()
  for (const p of schema) {
    if (!groups.has(p.group)) {
      const g = document.createElement('div'); g.className = 'group'
      const h = document.createElement('h3'); h.textContent = p.group
      const rows = document.createElement('div'); rows.className = 'rows'
      h.onclick = () => g.classList.toggle('closed')
      g.append(h, rows); container.append(g)
      groups.set(p.group, rows)
    }
    const row = document.createElement('div'); row.className = 'row'
    const label = document.createElement('label'); label.textContent = p.label
    let input, val = null
    if (p.type === 'range') {
      input = Object.assign(document.createElement('input'),
        { type: 'range', min: p.min, max: p.max, step: p.step, value: params[p.key] })
      val = document.createElement('span'); val.textContent = params[p.key]
      input.oninput = () => { val.textContent = input.value; onChange(p.key, Number(input.value)) }
    } else if (p.type === 'color') {
      input = Object.assign(document.createElement('input'), { type: 'color', value: params[p.key] })
      input.oninput = () => onChange(p.key, input.value)
    } else {
      input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: params[p.key] })
      input.onchange = () => onChange(p.key, input.checked)
    }
    row.append(label, input, val ?? document.createElement('span'))
    groups.get(p.group).append(row)
  }
}

// Plain numeric/JSON field editors for stats / behavior / spawn.
export function buildFieldEditors(container, work, markDirty) {
  container.innerHTML = ''
  const section = (title, obj, fields) => {
    const g = document.createElement('div'); g.className = 'group'
    const h = document.createElement('h3'); h.textContent = title; g.append(h)
    const rows = document.createElement('div'); rows.className = 'rows'; g.append(rows)
    for (const [key, parse] of fields) {
      const row = document.createElement('div'); row.className = 'row'
      const label = document.createElement('label'); label.textContent = key
      const input = Object.assign(document.createElement('input'),
        { type: 'text', value: obj[key] ?? '' })
      input.onchange = () => { const v = parse(input.value); if (v !== undefined) obj[key] = v; else delete obj[key]; markDirty() }
      row.append(label, input, document.createElement('span'))
      rows.append(row)
    }
    container.append(g)
  }
  const num = s => { const n = Number(s); return s !== '' && Number.isFinite(n) ? n : undefined }
  const str = s => s || undefined
  const numPair = s => { const m = s.match(/^\s*(\d+)\s*[-,]\s*(\d+)\s*$/); return m ? [Number(m[1]), Number(m[2])] : undefined }
  section('stats', work.stats, [['hp', num], ['dmg', num], ['speed', num], ['half', num]])
  section('behavior', work.behavior, [['taxon', str], ['sightRange', num], ['stopRange', num],
                                      ['combat', str], ['fleeHp', num], ['wanderSpeed', num]])
  work.spawn ??= {}
  section('spawn', work.spawn, [['depths', numPair], ['weight', num]])
}
