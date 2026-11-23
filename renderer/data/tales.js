// The tales of the Wilds (docs/superpowers/specs/2026-11-15-wilds-tales-design.md):
// stories that belong to villages, whose places turn up for the player who
// goes looking. A tale's kind is how much its village knows:
//   'need'   something hurts the village now; they say exactly where
//   'story'  everyone has heard it; they say roughly where
//   'old'    an old-wives' tale; working out where and what is the quest
// `land` is the country its place appears in; `module` is the key of the
// quest module (systems/quests/index.js) that plays it; `rule(flags)` is when
// it is done. Pure data: nothing here imports the game.
//
// `lines` are what the village says, as in data/quests.js: stages read
// top-down, the first whose `when(flags)` holds speaks, the last is the
// catch-all and the first is the done stage, which no longer tells the tale.
// Placeholders are filled by wilds/tales.js fillLines:
//   {side}   a compass side ("north-east"): promised until the place is found, true after
//   {where}  an exact phrase ("a good walk east"), for an immediate need
//   {land}   the tale's `landWord`
// `hermit` lines are spoken by the hermit at the Kivihiisi's place.
//
// `newsWord` is what Kalevanlinna's crier calls safe again once the tale is
// done (city/crier.js), where the `landWord` would read oddly; else the landWord.
//
// Step 2 (the Timewarp stories, 2026-11-15) adds:
//   engine       'quest' (systems/quests/) or 'episode' (systems/episodes/)
//   creatureAt   where the tale's creature lives and dies: 'place' (default) or 'village'
//   arriveOn     which piece entering the window re-runs the module's onArrive
//   villageBorne the trouble plays out in the village itself; two such villages
//                near enough to share a window never carry the same kind
//   missing      the villager who comes home when the tale is done
//   rule(flags, rc)  rc = { wolvesAlive, night } from the runner
function foldPack({ point, free, spawn, think, wolves, away }) {
  if (wolves() > 0) return
  const den = point('den')
  if (!den || !away(den, 12)) return
  spawn(free(den, 2).map((at, i) => ({ kind: 'npc', species: 'wolf', hostile: false, id: `wolf:${i}`, ...at })))
  think('The pack is back on the ridge.')
}

export const TALES = {
  elk: {
    id: 'elk', title: 'Hiiden hirvi', kind: 'story', land: ['forest', 'autumn'],
    creature: 'hirvi', module: 'forest-1-clearings', engine: 'quest', arriveOn: 'both',
    rule: f => !!f.hide_given,
    landWord: 'the deep wood',
    // what the stranger thinks on first coming near a thing (`at`: a point of the place, or 'village')
    remarks: [
      { at: 'forest shrine', within: 4, text: 'Fresh offerings. And hoofprints the size of plates, leading off through the trees.' },
    ],
    lines: [
      { when: f => f.hide_given, by: {
        villager: ['The barley will stand this year.', 'Hiisi hide makes boots that run like weather.'],
        elder:    ['Hiisi keeps his herd. This one he lent us, and you sent it back.'],
      } },
      { when: f => f.hirvi_dead, by: {
        villager: ['You brought it down? Take the hide to the elder — he tanned for my father.'],
        elder:    ['Bring me the hide and I will see you right for it.'],
      } },
      { when: f => (f.flush ?? 0) >= 1, by: {
        villager: ['It runs when it is pushed. It always runs.', 'Nobody walks that one down. Nobody ever has.'],
        elder:    ['Hiisi hunts on skis, they say. You have no skis, so you have running. Follow where it breaks the ground.'],
      } },
      { when: () => true, by: {
        villager: ['Something has been through the barley again. Hooves the size of plates.', 'It keeps to {land}, {side} of here. There is an old shrine in there, and it stands in the offerings at dusk.'],
        elder:    ["That is Hiisi's elk, and it eats where it likes. Go {side} into {land} and pick up its trail at the shrine."],
      } },
    ],
  },
  tar: {
    id: 'tar', title: 'Tervahauta', kind: 'need', land: ['sea', 'marsh'],
    creature: null, module: 'forest-2-river', engine: 'quest', arriveOn: 'place',
    rule: f => !!f.bridge_done,
    landWord: 'the water',
    newsWord: 'the deck to the fish racks',
    lines: [
      { when: f => f.bridge_done, by: {
        villager: ['Tarred and true. That deck will outlast the both of us.', 'Fish on the racks again. Take one as you pass.'],
        elder:    ['The crew left you something by their hut at the water. It is yours.'],
      } },
      { when: f => f.pit_lit, by: {
        villager: ['Smell that? Pine tar. The deck wants three pots of it.', 'Stand at the broken end with a pot in your sack and the planks go down.'],
        elder:    ['Three pots, three planks. Lay them from the end of the deck, one after the other.'],
      } },
      { when: () => true, by: {
        villager: ['The deck out to the fish racks went in the spring storm. No fish since, and we will not lay planks that rot by autumn.', "It is {where}, where the road meets the lake. Six logs into the pit by the crew's hut — they burn down to tar."],
        elder:    ['No deck on that water ever held without tar. Go {where} from the well; you cannot miss the lake.'],
      } },
    ],
  },
  kivihiisi: {
    id: 'kivihiisi', title: 'Kivihiisi', kind: 'old', land: ['mountain'],
    creature: 'kivihiisi', module: 'forest-3-autumn', engine: 'quest', arriveOn: 'place',
    rule: f => !!f.hiisi_dead,
    landWord: 'the high ground',
    lines: [
      { when: f => f.hiisi_dead, by: {
        villager: ['The goats came back on their own. They know.'],
        elder:    ["Ukko's own hammer. Do not swing it near the houses."],
        hermit:   ['Quiet under the stones now. I can hear the wind again.'],
      } },
      { when: f => f.hiisi_woken, by: {
        villager: ['You woke it? Grandmother said it cannot leave its oven while its stones stand.'],
        elder:    ['It reaches with what it has for arms, and it sees through its own stones. Mine each one with it squarely at your back — a step to the side and it will drag you in.'],
        hermit:   ['It sees through its own stones. Keep one squarely between you and it while you mine the next.', 'Break all six. It is nothing without its skin.'],
      } },
      { when: () => true, by: {
        villager: ['Goats go missing up in {land}. Wolves, my husband says.', "Grandmother told of a giant's oven up there with something asleep in it. She also told of a pike that talked."],
        elder:    ['A hermit went up into {land} years ago, to be near the old oven. If he lives, he knows more than our stories do.'],
        hermit:   ['Something breathes under that capstone. Nothing opens it but a pick.', 'My pick is by the door. I am too old to swing it.'],
      } },
    ],
  },
  // ---- the Timewarp stories, told to a stranger (lines and the rest come with each tale) ----
  nakki: {
    id: 'nakki', title: "The ferryman's bell", kind: 'need', land: ['forest', 'autumn', 'marsh'],
    creature: 'nakki', module: 'lake-1-ferry', engine: 'episode', arriveOn: 'place',
    rule: f => !!f.nakki_gone,
    missing: { species: 'villager', name: 'Toivo' },
    landWord: 'the lake',
    reward: 'lake_breath',
    remarks: [
      { at: 'bell', within: 3, when: f => !f.bell_hung, text: 'A bell with no clapper. Nobody has rung it in a long while.' },
      { at: "Toivo's hut", within: 3, text: 'A fish rack and a cold fire pit. Someone fed the lake from here every dusk.' },
      { at: 'islet cache', within: 2, when: f => !f.bell_hung, text: 'So this is where he kept the spare.' },
      { at: 'pier end', within: 1, when: f => f.bell_hung && !f.fed, text: 'It is watching the end of the pier. It is not angry. It is hungry.' },
      { at: 'pier end', within: 1, when: f => f.fed >= 1 && !f.nakki_gone, text: 'It liked that. I would not offer it anything raw.' },
    ],
    // interiors that hold the tale's things, as data/leaps.js declares them
    houses: { "Toivo's hut": { room: 'toivo_kitchen', pickups: [
      { type: 'meat', count: 3 },
      { type: 'weapon', weaponType: 'hatchet', name: 'Hatchet', damage: 1, chop: 1 },
      { type: 'lumber', count: 3 },
    ] } },
    lines: [
      { when: f => f.nakki_gone, by: {
        villager: ['Toivo rings the bell at dusk again.', 'The orchard is ours again — try an apple.'],
        elder:    ['The lake gave him back. I do not ask it why.'],
      } },
      { when: f => f.bell_hung, by: {
        villager: ['You rang it? Then feed it, as he did. Cooked — Toivo never served the lake anything raw.'],
        elder:    ['He rang at dusk and laid meat at the end of the pier, and the water lay flat after.'],
      } },
      { when: () => true, by: {
        villager: ['Toivo our ferryman is gone. The lake took him, the night the bell went quiet.', 'Nobody dares the pier now. The orchard rots out on its island and we eat seed grain. The lake is {where}.'],
        elder:    ['It was never the lake that took him. It was what lives in it, and nobody has rung for it since.', 'The clapper went with him. He kept a spare on the little islet, off the south bank.'],
      } },
    ],
  },
  fold: {
    id: 'fold', title: 'Wolves at the fold', kind: 'need', land: ['forest', 'autumn', 'mountain'],
    creature: 'maahinen', module: 'highland-2-fold', engine: 'episode', arriveOn: 'place', villageBorne: true,
    rule: (f, rc) => !!f.maahinen_dead && (rc?.wolvesAlive ?? 0) >= 1,
    missing: { species: 'villager', name: 'Aino' },
    landWord: 'the ridge',
    reward: 'tapio_peace',
    begins: 'village',     // the burning starts when the stranger first stands in the village
    // the village never attacks a stranger: after the last band it shuts them out until the fleece is shown
    shut: f => (f.burn ?? 0) >= 4 && !f.fleece_shown && !f.maahinen_dead,
    shutLines: {
      villager: ['Go. You have done enough.', 'The den is ash and still the lambs go. We have nothing to say to you.'],
      elder:    ['Unless you carry proof it was not the wolves, we are done talking.'],
    },
    // The pack is never gone for good: an empty den fills again when nobody
    // is near to see it, whether or not the thing under the ridge still
    // lives, so the tale can always end. Asked on arrival and every second.
    arrive: api => foldPack(api),
    tend: api => foldPack(api),
    remarks: [
      { at: 'den', within: 5, when: f => !f.maahinen_dead, text: 'Wolves. No bones here, no wool. They are watching me, not hunting.' },
      { at: 'fleece cache', within: 2, when: f => !f.fleece_shown, text: "Lamb's fleece, and a prospector's diggings. The elder should see this." },
      { at: 'burrow', within: 3, when: f => f.fleece_shown && !f.maahinen_spawned, text: 'Something breathes behind these rocks. If I break in it comes out — and the wolves are just down the slope.' },
    ],
    lines: [
      { when: f => f.maahinen_dead, by: {
        villager: ['Aino brought the torches down. The wolves can keep the ridge.', 'The lambs sleep through the night now.'],
        elder:    ['The pack did what we could not. Leave them be.'],
      } },
      { when: f => f.fleece_shown, by: {
        villager: ['The torches are down. The elder says it was never the wolves.'],
        elder:    ['Whatever is under that ridge keeps to its own dark. Break its door and it comes up after you — then lead it to something with teeth.', 'That pick opens rock. Do not fight the thing yourself.'],
      } },
      { when: () => true, by: {
        villager: ['The lambs are gone again. Three this week.', 'It is the wolves. Their den is {where}, up on {land}. We burn the wood between us and them, a band at a time, until they have nowhere to lie up.'],
        elder:    ['Aino went up to that den to prove the wolves had no part in it. She has not come back.', 'The wolves never took lambs before the prospector dug up there. Bring me proof and I will call the torches off.'],
      } },
    ],
  },
  flame: {
    id: 'flame', title: 'The flame-thief', kind: 'old', land: ['marsh', 'autumn', 'forest'],
    creature: 'sammunut', creatureAt: 'village', module: 'marsh-3-hermit', engine: 'episode', arriveOn: 'village', villageBorne: true,
    rule: f => !!f.wraith_dead,
    missing: { species: 'villager', name: 'Lauri' },
    landWord: 'the wild country',   // the knoll may stand in fen or in wood
    reward: 'sinituli',
    houses: { 'hermit hut': { room: 'hermit_woodpile', pickups: [
      { type: 'weapon', weaponType: 'hatchet', name: 'Hatchet', damage: 1, chop: 1 },
      { type: 'greywood', count: 3 },
    ] } },
    remarks: [
      { at: 'knoll', within: 6, text: 'Grey trees, cold to the touch. Nothing else out here grows like this.' },
      { at: 'hermit hut', within: 3, text: 'His hearth is cold, but the woodpile by it is grey as ash.' },
      { at: 'hearth 1', within: 6, when: f => f.seen_snuff && !f.wood_1, text: 'It ate the fire. Ordinary wood only feeds it.' },
    ],
    lines: [
      { when: f => f.wraith_dead, by: {
        villager: ['Blue on every hearth. It will not walk in again.', 'The old man came down to see them burn.'],
        elder:    ['His wood, our hearths. That is how it should have been.'],
        hermit:   ['The fire held. I was wrong to keep it to myself.'],
      } },
      { when: f => f.wood_1, by: {
        villager: ['Blue. Like his. It could not put that one out.', 'Bring more of his wood. Every hearth wants it.'],
        elder:    ['It cannot snuff the blue and it cannot leave it alone. Light all three.'],
        hermit:   ['…'],
      } },
      { when: f => f.seen_snuff, by: {
        villager: ['You saw it? Nobody has seen it. The fires just go out.'],
        elder:    ['Something walks in and puts them out. Only the old hermit\'s wood ever held — grey stuff, off his knoll, somewhere out in {land}. It burned blue.', 'Not any dead tree. His.'],
        hermit:   ['…'],
      } },
      { when: () => true, by: {
        villager: ['We light the hearths at dusk. By midnight they are cold again.', 'Lauri walked out one night to see what does it. He did not come back.'],
        elder:    ['Stay till dark and watch the hearths, stranger. Then tell me what you saw.', 'There was a hermit out in {land} whose hearth never went out, they say. An old tale.'],
        hermit:   ['…'],
      } },
    ],
  },
  // ---- step 3: a tale of this world's own (wilds/tale-lalli.js plays it) ----
  // After the legend of Lalli and the bishop: he took the bishop's hat, the
  // hat stuck, and the mice chased him up a tree.
  lalli: {
    id: 'lalli', title: "Lalli and the bishop's hat", kind: 'need', land: ['forest', 'autumn', 'marsh'],
    creature: null, module: 'lalli', engine: 'wilds', arriveOn: 'both',
    rule: f => !!f.lalli_down,
    missing: { species: 'lalli', name: 'Lalli' },
    landWord: 'the wood',
    // his house stands in the village, not at the tale's place
    houses: { "Lalli's house": { in: 'village', room: 'aino_larder', pickups: [{ type: 'beer' }] } },
    remarks: [
      { at: 'lalli tree', within: 5, when: f => !f.lalli_down, text: "A man up a pine, in a bishop's hat. And mice at the bottom of it. A great many mice." },
      { at: 'piper camp', within: 3, when: f => !f.flute_given, text: 'An empty barrel, and a man looking into it sadly.' },
      { at: 'pier end', within: 1, when: f => !f.lalli_down, text: 'Deep water on three sides. Anything small that followed me out here would have nowhere to go.' },
    ],
    lines: [
      { when: f => f.lalli_down, by: {
        villager: ['Lalli is home. The hat is not coming off, mind.', 'We do not mention the bishop. Or the mice.'],
        elder:    ["A man comes home in a bishop's hat and asks for his supper. I have stopped asking questions."],
        kerttu:   ['He is home, and that is your doing. He will not say where the hat came from.', 'It will not come off. He sleeps in it.'],
        lalli:    ['It will not come off. Do not ask.', 'I am never going near a bishop again. Or a mouse.', 'Keep the axe. I have had enough of what axes get a man into.'],
        piper:    ['Eight mice, one pond. Good work. Keep the flute.', 'In Hameln they did not pay me. Here I get beer. A better country.'],
      } },
      { when: f => f.flute_given, by: {
        villager: ['A flute? For mice? Well. Nothing else has worked.'],
        elder:    ['Mice follow a tune, the old people said. Lead them somewhere they will not come back from.'],
        kerttu:   ['The piper gave you that? Then play it by the tree, and do not stop until they are in the pond.'],
        lalli_treed: ['Play it! Play it and walk away!', 'They follow the tune. Take them off the end of the pier!'],
        piper:    ['Hold it and strike, like a sword. It plays. Play, and they follow; stop, and they forget.', 'Walk them out on the pier, ja? To the very end. A mouse does not swim so good as it thinks.'],
      } },
      { when: f => f.sausage_made, by: {
        villager: ["Kerttu's sausage? There is no better. Do not ask what is in it."],
        elder:    ['The piper wants paying before he will lift a finger. Beer and sausage, they say.'],
        kerttu:   ['That sausage is for the piper, mind. He wants a pint with it: there is one in our larder. Go in, go in.', 'Lose it and I will make another. Two cuts of raw meat, same as before.'],
        lalli_treed: ['Get them away from me!', 'The piper! Ask the piper, down by the pond!'],
        piper:    ['Is that sausage I smell? And the beer? Both, or no flute.', 'A proper pint. Not the thin stuff.'],
      } },
      { when: () => true, by: {
        villager: ['Lalli has not been home since the bishop came through. Ask Kerttu: theirs is the house by the field.', 'They say there is a man up a pine {where}, shouting at mice.'],
        elder:    ['Lalli went out after the bishop with his axe, and came back without the bishop, and then did not come back at all. Ask Kerttu.'],
        kerttu:   ["My Lalli is up a pine {where}, with the bishop's hat stuck on his head and the mice at the foot of it. They ate our larder bare once and now they want him.", 'There is a foreign piper camped by that tree who says he can shift mice. He wants a pint and a boar sausage first. The pint is in our larder: go in. Bring me two cuts of raw meat and I will make the sausage.', 'It is all boar once it is in the skin.'],
        lalli_treed: ['Get them away from me!', 'It is not my hat! It is stuck!', 'The piper says he can shift them. He wants paying first. Kerttu will know!'],
        piper:    ['Mice, ja, I do mice. Rats also. Children, once; we do not speak of it.', 'For a proper pint of beer and a wild boar sausage, the flute is yours. Not before.'],
      } },
    ],
  },
}
export const TALE_IDS = ['elk', 'tar', 'kivihiisi', 'nakki', 'fold', 'flame', 'lalli']

// What a village with no tale talks about: its own country.
export const PLAIN_LINES = {
  forest:   { villager: ['Good timber this year. Mind the wolves past the second ridge.', 'The mushrooms are up early.', 'Kalevanlinna has walls and a harbour. Guards, too. Behave there.'], elder: ['Every road out of here ends in trees. That suits us.'] },
  autumn:   { villager: ['The leaves turn early here and stay late.', 'Boar in the red wood. Loud, mostly.'], elder: ['My father cleared this ground. The wood wants it back.'] },
  marsh:    { villager: ['Keep to the planks. The fen keeps what it takes.', 'Cloudberries, if you know where.'], elder: ['Wet feet and long lives. That is the fen.'] },
  mountain: { villager: ['Thin soil, good stone.', 'The pass was open when I was a girl.'], elder: ['Up here the weather tells you first.'] },
  desert:   { villager: ['Water at the well only. Nowhere else.', 'Walk at dusk. The sand keeps the day.'], elder: ['Caravans came through once. The sand took the road.'] },
  sea:      { villager: ['Herring when the wind is west.', 'Mend nets in winter, curse them in summer.', 'The herring goes to Kalevanlinna. So does everyone, sooner or later.'], elder: ['The sea gives. It also keeps count.'] },
}
