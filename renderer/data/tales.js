// The tales of the Wilds (docs/superpowers/specs/2026-11-15-wilds-tales-design.md):
// stories that belong to villages, whose places turn up for the player who
// goes looking. A tale's kind is how much its village knows:
//   'need'   something hurts the village now; they say exactly where
//   'story'  everyone has heard it; they say roughly where
//   'old'    an old-wives' tale; working out where and what is the quest
// `land` is the country its place appears in; `module` is the key of the
// quest module (systems/quests/index.js) that plays it; `rule(flags)` is when
// it is done. Pure data: nothing here imports the game.
export const TALES = {
  elk: {
    id: 'elk', title: 'Hiiden hirvi', kind: 'story', land: ['forest', 'autumn'],
    creature: 'hirvi', module: 'forest-1-clearings',
    rule: f => !!f.hide_given,
    lines: [],
  },
  tar: {
    id: 'tar', title: 'Tervahauta', kind: 'need', land: ['sea', 'marsh'],
    creature: null, module: 'forest-2-river',
    rule: f => !!f.bridge_done,
    lines: [],
  },
  kivihiisi: {
    id: 'kivihiisi', title: 'Kivihiisi', kind: 'old', land: ['mountain'],
    creature: 'kivihiisi', module: 'forest-3-autumn',
    rule: f => !!f.hiisi_dead,
    lines: [],
  },
}
export const TALE_IDS = ['elk', 'tar', 'kivihiisi']
