// One episode per leap map (docs/superpowers/specs/2026-08-29-leap-episodes-design.md).
// Villagers speak `villagerLines` while the episode is open; the Echo speaks
// the first `lines` entry whose `when(flags, ctx)` holds (last entry = fallback);
// `rule(flags, ctx)` is when the runestone wakes. ctx = { wolvesAlive }.
export const EPISODES = {
  'lake-1-ferry': {
    persona: 'Toivo',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ["Toivo! The lake gave you back?", 'The orchard rots over there and we eat seed grain.', 'Ring the bell like you used to — nobody dares the pier.'],
      elder:    ['You always rang it at dusk, Toivo, and the water lay flat after.', 'It was never the lake that took you. It was what lives in it.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.nakki_gone, text: 'Ziggy says the lake is quiet. Oh boy — here we go.' },
        { when: f => f.bell_hung, text: "It comes up when the bell rings. Ziggy's at 91 % you should feed it, not fight it." },
        { when: f => f.clapper, text: "That's the clapper. The bell's out on the pier." },
        { when: () => true, text: "Oh boy. They think you're Toivo, the ferryman. The bell on the pier has no clapper — Ziggy likes the islet." },
      ] },
      { fromPoi: 'bell', lines: [
        { when: f => f.fed >= 1 && !f.nakki_gone, text: `It liked that. Toivo smoked his fish, Sam — cooked, never raw.` },
        { when: f => f.bell_hung, text: 'Stand at the end with something cooked in your pack and let it come.' },
        { when: () => true, text: 'No clapper. Ziggy puts the islet cache at 72 %.' },
      ] },
      { fromPoi: "Toivo's hut", lines: [
        { when: () => true, text: 'A fish rack. He fed the lake every dusk. Ziggy is very sure that matters.' },
      ] },
    ],
    rule: f => !!f.nakki_gone,
  },
  'highland-2-fold': {
    persona: 'Aino',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ['Aino! Back from the city — the lambs are gone again.', 'We burn the forest tomorrow. The wolves have had their chance.', 'Your father would have shot every wolf on the ridge.'],
      elder:    ['The wolves never took lambs before the prospector came, Aino.', 'Bring me proof and I will call the torches off.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: (f, c) => f.maahinen_dead && c.wolvesAlive < 1, text: "The thing is dead, but so are the wolves. Ziggy's odds are 0 %, Sam. This isn't the fix." },
        { when: f => f.maahinen_dead, text: 'Ziggy says the fold will be quiet tonight. Oh boy.' },
        { when: f => f.fleece_shown, text: 'Torches are down. Whatever took the lambs is behind those rocks, and now you have a pick.' },
        { when: f => f.burn >= 3, text: "They're burning toward the den. Ziggy gives the wolves 40 % if you don't hurry." },
        { when: () => true, text: "Oh boy. You're Aino, the shepherd's girl. They blame the wolves. Ziggy puts that at 12 %. Follow the tracks." },
      ] },
      { fromPoi: 'den', lines: [
        { when: () => true, text: "Wolves, but no bones, no wool. The tracks keep going. Ziggy's at 88 % it's not them." },
      ] },
      { fromPoi: 'burrow', lines: [
        { when: f => f.fleece_shown, text: 'Break the rocks. Whatever is in there comes up from under you — watch the ground.' },
        { when: () => true, text: "Lamb's fleece, and the prospector's mess. Show the elder before the torches reach the den." },
      ] },
    ],
    rule: (f, c) => !!f.maahinen_dead && (c?.wolvesAlive ?? 0) >= 1,
  },
  'marsh-3-hermit': {
    persona: 'Lauri',
    missing: { species: 'villager' },
    villagerLines: {
      villager: ['Lauri. So you came back after all.', 'Every hearth went cold the night you two quarrelled.', 'The old man sits up on the knoll and says nothing.'],
      elder:    ['Fires light and something puts them out again, Lauri. Something that walks.', 'Only his own wood ever burned on that hearth.'],
    },
    echoSpots: [
      { fromPoi: 'runestone', lines: [
        { when: f => f.wraith_dead, text: 'Hearths are lit. Ziggy says the old man is talking again. Oh boy.' },
        { when: f => f.hearth_lit, text: "That fire it can't eat. It'll come for it anyway — that's where you fight it." },
        { when: () => true, text: "Oh boy. You're Lauri, the apprentice. Something is eating the fires. Ziggy says the dead trees on the knoll are his woodpile." },
      ] },
      { fromPoi: 'hearth', lines: [
        { when: f => f.hearth_lit, text: "It's coming. Stay in the light — outside it you can't touch it, and it drains you." },
        { when: () => true, text: 'His hearth. Build a fire here from his own wood and it stays lit.' },
      ] },
      { fromPoi: 'mushroom ring', lines: [
        { when: () => true, text: 'The ring. Ziggy says a trance shows you where it walks, even in the dark.' },
      ] },
    ],
    rule: f => !!f.wraith_dead,
  },
}
