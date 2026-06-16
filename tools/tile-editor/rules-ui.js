// Rules tab: edit tags (role, allow, forbid, directional) and per-tile weights
// of the active ruleset. Mutates the shared state object; emits 'rules-edited'
// on every change so the sample preview can re-render.
import { textPrompt } from './text-prompt.js'
import { renderLearned } from './adjacency-view.js'
import { toast } from './toast.js'

export function initRulesUI(state) {
  const tagRows = document.getElementById('tag-rows')
  const rulePanel = document.getElementById('rule-panel')
  let selectedTag = null

  function edited() { document.dispatchEvent(new Event('rules-edited')) }

  function activeRs() { return state.rulesets[state.active] }

  function memberTiles(tag) {
    const rs = activeRs()
    return Object.entries(rs?.tiles ?? {}).filter(([, def]) => def.tags.includes(tag))
  }

  function renderTagList() {
    const rs = activeRs()
    tagRows.innerHTML = ''
    if (!rs) return
    for (const tag of Object.keys(rs.tags)) {
      const row = document.createElement('div')
      row.className = 'tag-row' + (tag === selectedTag ? ' active' : '')
      row.textContent = `${tag} (${memberTiles(tag).length})`
      row.addEventListener('click', () => { selectedTag = tag; render() })
      tagRows.appendChild(row)
    }
  }

  function chipList(parent, label, list, cls) {
    const wrap = document.createElement('div')
    const lab = document.createElement('span')
    lab.className = 'label'
    lab.textContent = label + ' '
    wrap.appendChild(lab)
    list.forEach((tag, i) => {
      const chip = document.createElement('span')
      chip.className = 'chip' + (cls ? ' ' + cls : '')
      chip.textContent = tag
      chip.title = 'click to remove'
      chip.addEventListener('click', () => { list.splice(i, 1); render(); edited() })
      wrap.appendChild(chip)
    })
    const add = document.createElement('span')
    add.className = 'add-chip'
    add.textContent = '+ add'
    add.addEventListener('click', async () => {
      const t = ((await textPrompt('Tag name ("*" = any):')) ?? '').trim()
      if (t) { list.push(t); render(); edited() }
    })
    wrap.appendChild(add)
    parent.appendChild(wrap)
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
    rule.allow ??= ['*']
    rule.forbid ??= []
    rule.directional ??= {}

    const title = document.createElement('div')
    title.className = 'label'
    title.textContent = `rules for ${selectedTag}`
    rulePanel.appendChild(title)

    const roleWrap = document.createElement('div')
    roleWrap.innerHTML = '<span class="label">role </span>'
    const roleSel = document.createElement('select')
    for (const r of ['floor', 'wall', 'overlay']) {
      const o = document.createElement('option')
      o.value = r; o.textContent = r; o.selected = rule.role === r
      roleSel.appendChild(o)
    }
    roleSel.addEventListener('change', () => { rule.role = roleSel.value; edited() })
    roleWrap.appendChild(roleSel)
    rulePanel.appendChild(roleWrap)

    chipList(rulePanel, 'may neighbor', rule.allow)
    chipList(rulePanel, 'never neighbor', rule.forbid, 'forbid')

    const dirWrap = document.createElement('div')
    dirWrap.innerHTML = '<div class="label">directional override (comma-separated tags; empty = use "may neighbor")</div>'
    for (const dir of ['n', 'e', 's', 'w']) {
      const row = document.createElement('div')
      row.textContent = dir.toUpperCase() + ' '
      const inp = document.createElement('input')
      inp.className = 'dir'
      inp.value = (rule.directional[dir] ?? []).join(', ')
      inp.addEventListener('change', () => {
        const list = inp.value.split(',').map(s => s.trim()).filter(Boolean)
        if (list.length) rule.directional[dir] = list
        else delete rule.directional[dir]
        edited()
      })
      row.appendChild(inp)
      dirWrap.appendChild(row)
    }
    rulePanel.appendChild(dirWrap)

    const wWrap = document.createElement('div')
    wWrap.innerHTML = '<div class="label">member tile weights</div>'
    for (const [name, def] of memberTiles(selectedTag)) {
      const row = document.createElement('div')
      row.textContent = name + ' '
      const inp = document.createElement('input')
      inp.className = 'small'
      inp.type = 'number'
      inp.min = '0.1'
      inp.step = '0.1'
      inp.value = def.weight ?? 1
      inp.addEventListener('change', () => { def.weight = Math.max(0.1, Number(inp.value) || 1); edited() })
      row.appendChild(inp)
      wWrap.appendChild(row)
    }
    rulePanel.appendChild(wWrap)

    const learned = document.createElement('div')
    learned.style.marginTop = '10px'
    renderLearned(learned, rule)
    rulePanel.appendChild(learned)

    const del = document.createElement('button')
    del.textContent = '🗑 delete tag'
    del.style.marginTop = '10px'
    del.addEventListener('click', () => {
      if (!confirm(`Delete tag ${selectedTag}? Tiles having only this tag will drop out of decoration entirely.`)) return
      delete rs.tags[selectedTag]
      selectedTag = null
      render(); edited()
    })
    rulePanel.appendChild(del)
  }

  document.getElementById('add-tag').addEventListener('click', async () => {
    const rs = activeRs()
    if (!rs) { toast('Create a ruleset first (+ new in the header).', 'error'); return }
    const tag = ((await textPrompt('New tag (e.g. floor.moss):')) ?? '').trim()
    if (!tag) return
    rs.tags[tag] ??= {
      role: tag.startsWith('wall') ? 'wall' : 'floor',
      allow: ['*'], forbid: [], directional: {},
    }
    selectedTag = tag
    render(); edited()
  })

  document.addEventListener('ruleset-changed', () => { selectedTag = null; render() })
  render()
}
