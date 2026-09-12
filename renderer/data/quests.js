// One quest per Adventure map (docs/superpowers/specs/2026-09-10-adventure-quests-design.md).
// Villagers are the quest log: `villagerLines` is read top-down and the first
// stage whose `when(flags)` holds supplies the lines for every species, so the
// village's answers move with the story. The last stage must be the catch-all.
// `rule(flags)` is the one done-predicate. Quests are optional — nothing here
// touches the waystone.
export const QUESTS = {
  'forest-1-clearings': {
    title: 'Hiiden hirvi',
    villagerLines: [
      { when: f => f.hide_given, by: {
        villager: ['The barley will stand this year.', 'Boots out of Hiisi hide. You will run like weather in those.'],
        elder:    ['Hiisi keeps his herd. This one he lent us, and you sent it back.'],
      } },
      { when: f => f.hirvi_dead, by: {
        villager: ['You brought it down? Take the hide to the elder — he tanned for my father.'],
        elder:    ['Bring me the hide and I will cut you something to run in.'],
      } },
      { when: f => (f.flush ?? 0) >= 1, by: {
        villager: ['It runs when it is pushed. It always runs.', 'Nobody walks that one down. Nobody ever has.'],
        elder:    ['Hiisi hunts on skis, they say. You have no skis, so you have running.'],
      } },
      { when: () => true, by: {
        villager: ['Something has been through the barley again. Hooves the size of plates.', 'Do not go up to the shrine at dusk. It stands in the offerings.'],
        elder:    ["That is Hiisi's elk, and it eats where it likes. Pick up its trail at the shrine."],
      } },
    ],
    rule: f => !!f.hide_given,
  },
  'forest-2-river': {
    title: 'Tervahauta',
    villagerLines: [
      { when: f => f.bridge_done, by: {
        villager: ['Tarred and true. That deck will outlast the both of us.', 'A tarred bow. Mind where you loose it — it burns what it lands in.'],
      } },
      { when: f => f.pit_lit, by: {
        villager: ['Smell that? Pine tar. The deck wants three pots of it.', 'Stand at the broken end with a pot in your sack and the planks go down.'],
      } },
      { when: () => true, by: {
        villager: ['The middle of the south bridge went in the spring flood. We will not lay planks that rot by autumn.', 'No bridge on this river ever held without tar. Six logs into the pit east of camp — it burns down to tar.'],
      } },
    ],
    rule: f => !!f.bridge_done,
  },
}
