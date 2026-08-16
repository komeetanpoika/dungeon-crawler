// Rules tab: the editor's single tag editor. Per tag it shows the role, its
// member tiles (add / remove / weight) and the read-only data derived from a
// painting. The hand-authored hard gate (allow / forbid / directional) is no
// longer editable here — it is unused by every shipped ruleset and lives on in
// decorate.js for hand-edited JSON. Mutates the shared state object; emits
// 'rules-edited' on every change so the sample preview re-renders.
import { textPrompt } from './text-prompt.js'
import { renderLearned } from './adjacency-view.js'
import { toast } from './toast.js'
import { memberTiles, assignTileToTag, removeTileFromTag, medianMemberWeight, blankTag } from './tag-edit.js'

export function initRulesUI(state, { pickTile } = {}) {
  const tagRows = document.getElementById('tag-rows')
  const rulePanel = document.getElementById('rule-panel')
  let selectedTag = null
  let assigning = null      // tile name awaiting a tag, set by the Build tab

  function edited() { document.dispatchEvent(new Event('rules-edited')) }
  function activeRs() { return state.rulesets[state.active] }

  // Single assignment path, so the "already there" guard and the move report
  // cannot drift between the tag list and + add tile. Returns whether it wrote.
  function assign(rs, tile, tag, seed = medianMemberWeight(rs, tag)) {
    if (rs.tiles[tile]?.tags?.[0] === tag) return false
    const prev = assignTileToTag(rs, tile, tag, rs.tags[tag].role, seed)
    if (prev) toast(`${tile} moved from ${prev} to ${tag}`, 'info')
    edited()
    return true
  }

  // data-URL memo: without it every re-render blanks all thumbnails for a frame
  // while the IPC round trips resolve.
  const thumbSrc = new Map()
  function thumb(name) {
    const img = document.createElement('img')
    img.className = 'thumb'
    img.title = name
    const cached = thumbSrc.get(name)
    if (cached) { img.src = cached; return img }
    window.editorAPI.readTile(name)
      .then(src => { thumbSrc.set(name, src); img.src = src })
      .catch(() => { img.title = `${name} — sprite missing`; img.style.borderColor = '#c66' })
    return img
  }
  // A redrawn tile must not keep a stale thumbnail.
  document.addEventListener('tile-saved', e => thumbSrc.delete(e.detail.name))

  function renderTagList() {
    const rs = activeRs()
    tagRows.innerHTML = ''
    if (assigning) {
      const banner = document.createElement('div')
      banner.className = 'assign-banner'
      banner.textContent = `assigning ${assigning} — pick a tag (esc to cancel)`
      tagRows.appendChild(banner)
    }
    if (!rs) return
    for (const tag of Object.keys(rs.tags)) {
      const row = document.createElement('div')
      row.className = 'tag-row' + (tag === selectedTag ? ' active' : '')
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap'
      nameEl.textContent = tag
      const countEl = document.createElement('span')
      countEl.style.color = '#889'
      countEl.textContent = memberTiles(rs, tag).length
      row.append(nameEl, countEl)
      row.addEventListener('click', () => {
        if (assigning) {
          const tile = assigning
          assigning = null
          assign(rs, tile, tag)
        }
        selectedTag = tag
        render()
      })
      tagRows.appendChild(row)
    }
  }

  function render() {
    renderTagList()
    rulePanel.innerHTML = ''
    const rs = activeRs()
    if (!rs || !selectedTag || !rs.tags[selectedTag]) {
      rulePanel.innerHTML = '<div class="label">Select a tag (or create one via + new tag)</div>'
      return
    }
    const rule = rs.tags[selectedTag]

    // --- identity: tag name, then role + delete on one row ---
    const head = document.createElement('div')
    // `ident` opts out of .grp's uppercase transform: this heading shows a
    // case-sensitive ruleset key, and CASTLE.FLOOR is not the tag's name.
    head.className = 'grp ident'
    head.textContent = selectedTag
    rulePanel.appendChild(head)

    const idRow = document.createElement('div')
    idRow.className = 'row'
    const roleLab = document.createElement('span')
    roleLab.className = 'rlab'
    roleLab.textContent = 'role'
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
    roleSel.addEventListener('change', () => { rule.role = roleSel.value; edited() })
    const spacer = document.createElement('span')
    spacer.style.flex = '1'
    const del = document.createElement('span')
    del.className = 'x'
    del.textContent = '🗑 delete'
    del.addEventListener('click', () => {
      const tag = selectedTag
      if (!confirm(`Delete tag ${tag}? Its member tiles leave the ruleset — re-add them to another tag to keep them.`)) return
      for (const [name] of memberTiles(rs, tag)) removeTileFromTag(rs, name, tag)
      delete rs.tags[tag]
      selectedTag = null
      render(); edited()
    })
    idRow.append(roleLab, roleSel, spacer, del)
    rulePanel.appendChild(idRow)

    // --- member tiles ---
    const memHead = document.createElement('div')
    memHead.className = 'grp'
    const memTitle = document.createElement('span')
    memTitle.textContent = 'Member tiles'
    const addBtn = document.createElement('span')
    addBtn.className = 'add-chip'
    addBtn.id = 'add-tile'
    addBtn.textContent = '+ add tile'
    addBtn.addEventListener('click', () => {
      if (!pickTile) return
      assigning = null                       // the two modes are mutually exclusive
      const tag = selectedTag                // capture: the list stays clickable while picking
      pickTile(`pick a tile for ${tag}`, (name) => {
        // The ruleset can be switched and the tag deleted while the strip waits.
        if (activeRs() !== rs || !rs.tags[tag]) return
        assign(rs, name, tag, medianMemberWeight(rs, tag))
        selectedTag = tag                    // show the tag that was actually written
        render()
      })
    })
    memHead.append(memTitle, addBtn)
    rulePanel.appendChild(memHead)

    for (const [name, def] of memberTiles(rs, selectedTag)) {
      const row = document.createElement('div')
      row.className = 'row'
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap'
      nameEl.textContent = name
      const w = document.createElement('input')
      w.className = 'small'
      w.type = 'number'
      w.min = '0.1'
      w.step = '0.1'
      w.value = def.weight ?? 1
      w.addEventListener('change', () => { def.weight = Math.max(0.1, Number(w.value) || 1); edited() })
      const rm = document.createElement('span')
      rm.className = 'x'
      rm.title = `remove ${name} from ${selectedTag}`
      rm.textContent = '✕'
      rm.addEventListener('click', () => {
        removeTileFromTag(rs, name, selectedTag)
        render(); edited()
      })
      row.append(thumb(name), nameEl, w, rm)
      rulePanel.appendChild(row)
    }

    // --- learned (read-only; re-paint + re-derive to change it) ---
    const learned = document.createElement('div')
    renderLearned(learned, rule)
    rulePanel.appendChild(learned)
  }

  document.getElementById('add-tag').addEventListener('click', async () => {
    const rs = activeRs()
    if (!rs) { toast('Create a ruleset first (+ new in the header).', 'error'); return }
    const tag = ((await textPrompt('New tag (e.g. floor.moss):')) ?? '').trim()
    if (!tag) return
    // blankTag, not a local literal: one shape for every "fresh tag" path.
    // Object.hasOwn, not ??=, so a tag named e.g. "constructor" is still created.
    // Infer the role from the naming convention the rulesets already follow.
    // Getting this wrong matters: role is what sorts base skins from overlays
    // when a painting is derived, and an `overlay.*` tag defaulting to floor
    // would quietly decorate the wrong layer. The role select sits in the first
    // row of the panel that opens next, so a bad guess is one click to correct.
    const role = tag.startsWith('wall') ? 'wall' : tag.startsWith('overlay') ? 'overlay' : 'floor'
    if (!Object.hasOwn(rs.tags, tag)) rs.tags[tag] = blankTag(role)
    selectedTag = tag
    if (assigning) { const tile = assigning; assigning = null; assign(rs, tile, tag) }
    render(); edited()
  })

  // The Build tab hands a brush over here to be tagged.
  document.addEventListener('assign-tile', (e) => {
    assigning = e.detail.tile
    selectedTag = e.detail.tag ?? selectedTag
    render()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && assigning) { assigning = null; render() }
  })

  // A mode must never survive leaving the tab that set it.
  document.addEventListener('tab-changed', (e) => {
    if (e.detail.tab !== 'rules' && assigning) { assigning = null; render() }
  })

  document.addEventListener('ruleset-changed', () => { selectedTag = null; assigning = null; render() })
  render()
}
