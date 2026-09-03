// One episode per leap map (docs/superpowers/specs/2026-08-29-leap-episodes-design.md).
// Villagers speak `villagerLines` while the episode is open; the Echo speaks
// the first `lines` entry whose `when(flags, ctx)` holds (last entry = fallback);
// `rule(flags, ctx)` is when the runestone wakes. ctx = { wolvesAlive }.
export const EPISODES = {
  'lake-1-ferry': {
    persona: 'Toivo',
    missing: { species: 'villager' },
    kit: {},   // fixed per-episode loadout (arena player-override shape); {} = plain new-game kit
    items: [{ kind: 'clapper', fromPoi: 'islet cache' }],
    houses: { "Toivo's hut": { room: 'toivo_kitchen', pickups: [
      { type: 'meat', count: 3 },
      { type: 'weapon', weaponType: 'hatchet', name: 'Hatchet', damage: 1, chop: 1 },
      { type: 'lumber', count: 3 },
    ] } },
    villagerLines: {
      villager: ["Toivo! The lake gave you back?", 'The orchard rots over there and we eat seed grain.', 'Ring the bell like you used to — nobody dares the pier.'],
      elder:    ['You always rang it at dusk, Toivo, and the water lay flat after.', 'It was never the lake that took you. It was what lives in it.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.nakki_gone, text: "The lake's gone flat. Oh boy — that's a wrap." },
        { when: f => f.bell_hung, text: "Ziggy says whatever's out there isn't angry. It's hungry." },
        { when: f => f.clapper, text: "The bell's been silent a long time. Toivo never let it." },
        { when: () => true, text: 'Oh boy. They call you Toivo. Ferryman. Something out on that pier has stopped.' },
      ] },
      { fromPoi: 'bell', lines: [
        { when: f => f.fed >= 1 && !f.nakki_gone, text: 'It liked that. Ziggy says Toivo never served anything raw.' },
        { when: f => f.bell_hung, text: "It's watching the end of the pier. It looks hungry." },
        { when: () => true, text: 'No clapper. Ziggy is oddly fond of the islet.' },
      ] },
      { fromPoi: "Toivo's hut", lines: [
        { when: () => true, text: 'A fish rack, and a cold hearth. He fed the lake every dusk.' },
      ] },
    ],
    resolvedLines: {
      villager: ['Toivo rings the bell at dusk again.', 'The orchard is ours — try an apple.'],
    },
    rule: f => !!f.nakki_gone,
  },
  'highland-2-fold': {
    persona: 'Aino',
    missing: { species: 'villager' },
    kit: {},   // fixed per-episode loadout (arena player-override shape); {} = plain new-game kit
    tame: ['wolf'],   // spawn non-hostile here: the wolves are innocent
    items: [{ kind: 'fleece', fromPoi: 'fleece cache' }],
    houses: { "Aino's house": { room: 'aino_larder', pickups: [
      { type: 'meat', count: 2 },
    ] } },
    villagerLines: {
      villager: ['Aino! Back from the city — the lambs are gone again.', 'We burn the forest tomorrow. The wolves have had their chance.', 'Your father would have shot every wolf on the ridge.'],
      elder:    ['The wolves never took lambs before the prospector came, Aino.', 'Bring me proof and I will call the torches off.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: (f, c) => f.maahinen_dead && c.wolvesAlive < 1, text: "It's gone, and so are they. Ziggy's at 0 %, Sam. That isn't the fix." },
        { when: f => f.maahinen_dead, text: 'Quiet night at the fold. Oh boy.' },
        { when: f => f.fleece_shown, text: "Torches are down. Whatever's under the ridge keeps to its own ground — Ziggy thinks it dislikes company." },
        { when: f => f.burn >= 3, text: "They're burning toward the den. Ziggy gives the wolves 40 %." },
        { when: () => true, text: "Oh boy. You're Aino. They blame the wolves. Ziggy puts that at 12 %." },
      ] },
      { fromPoi: 'den', lines: [
        { when: () => true, text: "Wolves. No bones, no wool. Ziggy says they'd fight anything that came near their pups." },
      ] },
      { fromPoi: 'burrow', lines: [
        { when: f => f.fleece_shown, text: "Break the rocks and it'll come up after you. Somewhere with teeth would be nice." },
        { when: () => true, text: "Lamb's fleece, and the prospector's mess. The elder should see this." },
      ] },
    ],
    resolvedLines: {
      villager: ['Aino brought the torches down. The wolves can keep the ridge.', 'The lambs sleep through the night now.'],
    },
    rule: (f, c) => !!f.maahinen_dead && (c?.wolvesAlive ?? 0) >= 1,
  },
  'marsh-3-hermit': {
    persona: 'Lauri',
    missing: { species: 'villager' },
    kit: {},   // fixed per-episode loadout (arena player-override shape); {} = plain new-game kit
    houses: { 'hermit hut': { room: 'hermit_woodpile', pickups: [
      { type: 'weapon', weaponType: 'hatchet', name: 'Hatchet', damage: 1, chop: 1 },
      { type: 'deadwood', count: 3 },
    ] } },
    villagerLines: {
      villager: ['Lauri. So you came back after all.', 'Every hearth went cold the night you two quarrelled.', 'The old man sits up on the knoll and says nothing.'],
      elder:    ['Fires light and something puts them out again, Lauri. Something that walks.', 'Only his own wood ever burned on that hearth.'],
      hermit:   ['…'],
    },
    // Set as state.villagerLines once wraith_dead resolves the episode (see
    // resolveEpisode/arriveOnMap in game.js, and hermit.js's own onArrive) —
    // the silent hermit finally has something to say.
    resolvedLines: { hermit: ['You came back.', 'The fire held. I was wrong, Lauri.'] },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.wraith_dead, text: 'Hearths are lit. The old man is talking again. Oh boy.' },
        { when: f => f.hearth_lit, text: "That fire it can't put out. It hates it, and it can't leave a flame alone." },
        { when: () => true, text: "Oh boy. You're Lauri. Something walks through here and eats the fires. Ziggy says only his own wood ever burned on that hearth." },
      ] },
      { fromPoi: 'hearth', lines: [
        { when: f => f.hearth_lit, text: "Stay in the light. Out there you can't touch it, and it drains you." },
        { when: () => true, text: 'His hearth. The grey trees on the knoll were his woodpile.' },
      ] },
      { fromPoi: 'mushroom ring', lines: [
        { when: () => true, text: 'The ring. A trance shows you where it walks, even in the dark.' },
      ] },
    ],
    rule: f => !!f.wraith_dead,
  },
}
