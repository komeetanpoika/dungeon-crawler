// Which studio tabs a monster gets, by kind (pure, no DOM).
// kind: 'new' (a drawing not in the game yet), 'drawn' (has a cut),
// 'code' (its rig draws it) or 'story' (placedBy: "story").
export const TABS = ['drawing', 'cuts', 'movement', 'fight', 'publish']

const ON = {
  new: TABS,
  drawn: TABS,
  code: ['movement', 'fight', 'publish'],
  story: ['movement', 'publish'],
}

export function tabsFor(kind) {
  const on = ON[kind] ?? []
  return Object.fromEntries(TABS.map(t => [t, on.includes(t)]))
}

export const startTab = kind => kind === 'new' ? 'drawing' : kind === 'drawn' ? 'cuts' : 'movement'

// Why a tab is switched off for this kind, or null when it is on.
export function disabledNote(kind, tab) {
  if ((tab === 'drawing' || tab === 'cuts') && (kind === 'code' || kind === 'story')) return "Drawn by code: there's no picture to cut."
  if (tab === 'fight' && kind === 'story') return 'Fights only inside its story.'
  return null
}
