// The Sampo of Kalevanlinna: the city's long story, in story order. This
// file is the story as data and rules, pure and DOM-free; sampo-run.js plays
// it in the city, sampo-places.js out in the Wilds.
//   Part 1: the luck has run out (the Count's reward, the dim lid in the
//           great hall) and the smith (Seppo made it; where its pieces went).
//   Part 2: the three pieces (PIECES): each lies at a place of its own that
//           the Wilds admits on that side of the city once Seppo has spoken,
//           kept by a guardian; brought to Seppo one by one. The great pike's
//           jawbone goes to Väinö.
//   Part 3: the words (Väinö sends the player down the crypt's crack into
//           the giant Vipunen's belly, where a lit forge and five blows on the
//           anvil make him sing them), the Sampo made whole (Seppo), the great
//           hall (the Count turns it and gets herring; Granny Pohjanen is
//           Louhi, and takes it up to the battlements as an eagle), and the
//           player's choice of where it ends up: under its lid for the Count,
//           or in the fountain on the square for everyone. sampo-end.js plays it.
//
//   world.sampo = { flags }     in the Wilds record (world.js), kept across a
//                               GEN bump like the tales. Flags, each set once:
//     heard   the Count has told of the lid and his reward
//     mark    the player has seen the maker's mark under the lid's rim
//     smith   Seppo has owned up and named the three places
//     gift    Seppo's sword has been handed over
//     won_sea / won_mountain / won_marsh   that piece's guardian is beaten
//     sea / mountain / marsh               that piece is in Seppo's hands
//     three   Seppo has said what the Sampo still wants: its words
//     jaw     Väinö has the pike's jawbone
//     crack   Väinö has told of Vipunen: the crypt's crack lets the player down
//     words   Vipunen has sung the Sampo's words
//     whole / forged   Seppo has made it whole / and handed it over
//     set / turned / flood / stolen   the great hall: the Sampo under its lid,
//             the Count's turn at it, the herring on the floor, Louhi away with it
//     eagle   the eagle is beaten on the battlements
//     castle / fountain   where the player set it, for good; paid: the thanks for it
//   stageOf(world) -> 'luck' | 'heard' | 'mark' | 'pieces' | 'words' | 'forge' | 'whole' | 'eagle' | 'choice' | 'castle' | 'fountain'
//     what the town knows the player knows; null for a world without the
//     record (tests' stand-ins): then nothing here changes anything
//   questKey(world) -> the stage, and after a slash what else the lines turn
//     on ('pieces/sea,jaw'): the mood the town's lines are kept by (lines.js)
//   namedLines(id, quest) -> string[] | null
//     what a named character says at that quest key (null: their everyday lines)
//   luckLine(temperament, quest) -> string
//     what any grown townsperson adds: of the dim Sampo, or of how it ended
//   tellingFor(id, world) -> { lines, sets } | null
//     a speech in order, begun by talking to that person (ids as the folk's:
//     'named:count'); `sets` is the flag its last line sets
//   crierItem(world) -> string | null     the crier's call for the stage
//   crierDeeds(world) -> string[]         what the player did out there, for his round
//   firstCall(world) -> bool              is it his first call of the day (until the Count is heard)
//   PIECES, PIECE_KINDS, SAMPO_PLACES, kindOfPlace(id), handover(kind), JAW, JAW_LINE
//   passageFor(world, line) -> { to, say } | null   a shut cell of a building (by its line) the story has opened
//   guardWaves(world, guardId) -> bool              a stair's guard the story has moved aside
//   goneFrom(world) -> ids                          townsfolk the story has taken out of the city
//   VIPUNEN, BLOWS, SAMPO, HERRING, ENDINGS         the belly's lines; the things; the two ends
//   LID_REMARK, LID_TILE, GIFT, GIFT_TOAST
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

// The three lost pieces: the place the Wilds makes for each (a tale-style
// place id, sites.js), the country it lies in, the side of the city it is on
// (as Seppo says), the thing in the sack, and who keeps it.
export const PIECES = {
  sea: { place: 'sampo_sea', land: 'sea', side: 'south', item: 'sampo_sea', guardian: 'ikuturso' },
  mountain: { place: 'sampo_mountain', land: 'mountain', side: 'north', item: 'sampo_mountain', guardian: 'pohjanvahti' },
  marsh: { place: 'sampo_marsh', land: 'marsh', side: 'west', item: 'sampo_marsh', guardian: 'hauki' },
}
export const PIECE_KINDS = Object.keys(PIECES)
export const SAMPO_PLACES = PIECE_KINDS.map(k => PIECES[k].place)
export const kindOfPlace = id => PIECE_KINDS.find(k => PIECES[k].place === id) ?? null
export const JAW = 'pike_jaw'

export const SAMPO_FLAGS = ['heard', 'mark', 'smith', 'gift', ...PIECE_KINDS.map(k => `won_${k}`), ...PIECE_KINDS, 'three', 'jaw',
  'crack', 'words', 'whole', 'forged', 'set', 'turned', 'flood', 'stolen', 'eagle', 'castle', 'fountain', 'paid']
export const makeSampo = () => ({ flags: {} })
// from a save: only the flags this file knows, only true ones
export function loadSampo(saved) {
  const out = makeSampo()
  if (isObj(saved) && isObj(saved.flags)) for (const f of SAMPO_FLAGS) if (saved.flags[f] === true) out.flags[f] = true
  return out
}
export const exportSampo = sampo => ({ flags: { ...sampo?.flags } })

export function stageOf(world) {
  const f = world?.sampo?.flags
  if (!f) return null
  return f.fountain ? 'fountain' : f.castle ? 'castle' : f.eagle ? 'choice' : f.stolen ? 'eagle' : f.whole ? 'whole' : f.words ? 'forge'
    : f.three ? 'words' : f.smith ? 'pieces' : f.mark ? 'mark' : f.heard ? 'heard' : 'luck'
}
export function questKey(world) {
  const stage = stageOf(world)
  if (!stage) return null
  const f = world.sampo.flags
  const more = stage === 'pieces' ? PIECE_KINDS.filter(k => f[k]) : []
  if (f.jaw) more.push('jaw')
  if (stage === 'words' && f.crack) more.push('crack')
  return more.length ? `${stage}/${more.join(',')}` : stage
}

// ---- what the named say ---------------------------------------------------------------

const WHERE = { sea: 'the sea, south of here', mountain: 'the copper mountain, north', marsh: 'the marsh, west' }
const cap = t => t.charAt(0).toUpperCase() + t.slice(1)
const NAMED = {
  count: {
    // before he is heard he has his telling; these are for a second word
    luck: ['Well? I am told you looked at it. Looking is free.'],
    heard: ['Does it shine? No. Then why are you standing here?', 'Look at it. Do not touch it. It has been touched enough.'],
    mark: ['A mark under the rim? I pay for a lid that shines, not for marks.', 'Does it shine? No. Then why are you standing here?'],
    pieces: ['Three pieces. Then bring me three pieces.', 'Whole, mind. I want it whole, and I want it here.'],
    words: ['The smith has all of it but the lid, I hear. Then why does my lid not shine?', 'Whole, mind. I want it whole, and I want it here.'],
    forge: ['They tell me the smith is at it. Good. It comes here when it is done. Here!'],
    whole: ['Is that it? Under the lid with it. Now. I have waited long enough.'],
    eagle: ['She took it! My Sampo! Up the stairs with you! After her!'],
    choice: ['You have it? Under the lid with it. I will not turn it. Much.'],
    castle: ['Herring. Herring for breakfast. But it is my herring, and it shines.', 'Name your reward, I said. Within reason. You have had it.'],
    fountain: ['In the fountain. Where anyone can turn it. I have never been so robbed.', 'The soup is better. I admit that. Do not tell the cook.'],
  },
  seppo: {
    heard: ['The Count\'s lid? Never seen it. I make horseshoes.', 'Ask someone who makes lids.', 'Mind the sparks. And no, I don\'t make jewellery.'],
    words: ['It wants its words. Ask old Väinö at the organ.', 'Iron I can join. Words I never had.'],
    whole: ['It grinds what is in the heart of whoever turns it. Mind who turns it.', 'The Count wants it under his lid. I only make things.'],
    eagle: ['Louhi. I knew that herring smelled of the north. Get it back.'],
    choice: ['You have it back. The castle, or the fountain. I know where I would put it.'],
    castle: ['The Count has it. Herring for ever, then. I have eaten worse.', 'I don\'t make jewellery. I made that. Twice.'],
    fountain: ['In the fountain, where I should have put it three hundred years ago.', 'I don\'t make jewellery. I made that. Twice.'],
  },
  pohjanen: {
    luck: ['Herring, dear? Salted this morning. Well. This week.', 'The fountain is dry, dear, and the Count has a reward out. Go up to the castle and ask him.'],
    heard: ['Whoever makes a thing leaves a mark on it, dear. Makers cannot help it. Look under the rim.', 'A reward! And you with that kind face.'],
    mark: ['A hammer over a spark? Well now. Who do we know with a hammer, dear?', 'You have a kind face. Kind faces get the good herring.'],
    pieces: ['Three pieces! The sea, the mountain and the marsh. What a long way for a kind face.', 'You will bring them all back here, won\'t you, dear. All three. Good.'],
    words: ['All three! Oh, you clever dear. And now it only wants its words.', 'Words are easy, dear. Somebody always knows them.'],
    forge: ['The words too! Oh, clever, clever dear. Hurry to the smith now.'],
    whole: ['Is that it? Oh, let me look. No, no. You take it up to the Count, dear. I will be along.'],
  },
  vaino: {
    heard: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    mark: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    pieces: ['When you have your three pieces, come and see me. A thing like that wants singing together.', 'If you meet a great pike out there, bring me its jawbone. I have a mind to make something.'],
    words: ['The words? I had them once. I still have the tune.', 'If you meet a great pike out there, bring me its jawbone. I have a mind to make something.'],
    forge: ['I have them. Every word. Go to the smith: they are on you like smoke.'],
    whole: ['Hm-hm-hmm. No, I will not sing it again. Once is enough for one town.'],
    eagle: ['A bird that size over my church. I said the tune had a north wind in it.'],
    choice: ['Hm-hm-hmm. No, I will not sing it again. Once is enough for one town.'],
    castle: ['Herring from the castle, every day. The tune was for more than that.'],
    fountain: ['The fountain hums, if you stand close. It is my tune. I do not mind.'],
  },
  vicar: {
    pieces: ['The bell rings at the same hour every day. People still come late.', 'The crypt is warm this year. Warm! In a crypt.'],
    words: ['The bell rings at the same hour every day. People still come late.', 'The crypt is warm this year. Warm! In a crypt.'],
    fountain: ['The fountain runs. I had a sermon ready about patience. It will keep.'],
  },
}
for (const who of Object.values(NAMED)) for (const k of Object.keys(who)) Object.freeze(who[k])
const VAINO_JAW = Object.freeze(['Listen. Five strings on a pike\'s jaw. It has the tune already.', 'A kantele wants words as a mill does. I had them once.'])
const VAINO_CRACK = Object.freeze(['Down in the crypt, through the crack. Wake him. Make him sing. I will be listening.', 'He swallowed a smith once, and has hated hammers ever since.'])

// `quest` is questKey's: the stage, and after a slash what is in hand.
const madeLines = new Map()
export function namedLines(id, quest) {
  if (!quest) return null
  const [stage, more = ''] = quest.split('/')
  const had = more ? more.split(',') : []
  if (id === 'seppo' && stage === 'pieces') {
    let lines = madeLines.get(quest)
    if (!lines) {
      const left = PIECE_KINDS.filter(k => !had.includes(k))
      const still = left.length === 3 ? `${cap(WHERE.sea)}. ${cap(WHERE.mountain)}. ${cap(WHERE.marsh)}. Three pieces.`
        : left.length ? `Still wanted: the one in ${left.map(k => WHERE[k]).join(', and the one in ')}.` : 'All three. Give me a moment with them.'
      madeLines.set(quest, lines = Object.freeze([still, 'Bring them here. Not to the castle. Here.', 'I don\'t make jewellery. I made that. Once.']))
    }
    return lines
  }
  if (id === 'vaino' && had.includes('crack')) return VAINO_CRACK
  if (id === 'vaino' && had.includes('jaw') && (stage === 'pieces' || stage === 'words')) return VAINO_JAW
  return NAMED[id]?.[stage] ?? null
}

const LUCK = {
  cheerful: 'The fountain is dry, but the Count has a reward out. Things are looking up!',
  gruff: 'Fountain\'s dry. Herring\'s thin. The Count\'s Sampo has gone dim. Ask him.',
  shy: 'They say the Sampo has gone dim. I would not know. I only heard.',
  chatty: 'Have you heard? The Count\'s Sampo has gone dim! There is a reward. Go up to the castle!',
}
const AFTER = {
  eagle: {
    cheerful: 'A great bird went over the square with something shining! What a day!',
    gruff: 'Bird the size of a barn went over. Nobody tells me anything.',
    shy: 'There was an eagle. I hid. I am not ashamed.',
    chatty: 'Did you see it? An eagle! With the Sampo! And Granny Pohjanen\'s stall standing empty!',
  },
  castle: {
    cheerful: 'Herring again! Lovely. I do like herring. Mostly.',
    gruff: 'Herring. Every day. From the castle. At a price.',
    shy: 'They say the Count sleeps beside it. With a spoon.',
    chatty: 'Have you heard? The Count grinds herring day and night. The cats have never been happier.',
  },
  fountain: {
    cheerful: 'The fountain runs! Bread out of a fountain. I have seen everything now.',
    gruff: 'Fountain runs. Bread\'s free. Still rains.',
    shy: 'I turned it yesterday. It gave me a ribbon. I did not know I wanted one.',
    chatty: 'Have you turned it? Everyone gets something different! The baker got a day off!',
  },
}
AFTER.choice = AFTER.eagle
export function luckLine(temperament, quest = null) {
  const by = AFTER[quest?.split('/')[0]] ?? LUCK
  return by[temperament] ?? by.cheerful
}

// ---- the tellings ---------------------------------------------------------------------

const TELLINGS = {
  'named:count': {
    when: f => !f.heard, sets: 'heard',
    lines: [
      'You. Stranger. You have the look of someone with nothing to do.',
      'That is the Sampo. The lid of it. It has kept this city fed for three hundred years, and my family with it.',
      'Now it has gone dim. The fountain is dry. The herring come in thin.',
      'Make it shine again and name your reward. Within reason. My reason.',
      'Somebody made the thing. Look at it if you must, and find out who.',
    ],
  },
  'named:seppo': {
    when: f => f.mark && !f.smith, sets: 'smith',
    lines: [
      'A hammer over a spark. So you looked under the rim.',
      'Yes. I made it. Long ago, in the north, for a woman who paid badly.',
      'It is a mill, not a lid. Flour, salt and coin, as much as anyone could carry off.',
      'It broke the day it was stolen. A lid is no use without the rest.',
      'One piece went into the sea, south of here. One into the copper mountain, north. One into the marsh, west.',
      'Bring me the three and I will make it whole. Take this. You will want iron out there.',
    ],
  },
}
TELLINGS['named:vaino'] = {
  when: f => f.three && !f.crack, sets: 'crack',
  lines: [
    'The words. I had them. I had all of them, once.',
    'There is one who never forgets a word: old Vipunen, asleep under this town since before it was a town.',
    'That warm breath in the crypt is him snoring.',
    'Go down through the crack. Light a fire in him and hammer. He swallowed a smith once, and has hated hammers since.',
    'Make him sing, and I will have the words off him from up here.',
  ],
}
// the great hall: the Count's turn at the mill, and Granny Pohjanen's thanks
const TURN = {
  when: f => f.set && !f.turned, sets: 'turned',
  lines: [
    'It shines. It shines! Stand back, all of you. It is mine, and I shall turn it.',
    'Turn, mill! Grind me gold! Gold enough to pave the harbour!',
    '...Herring?',
    'Why is it grinding herring? Stop it. Stop it! Somebody stop it!',
  ],
}
const THANKS = {
  when: f => f.turned && !f.stolen, sets: 'stolen',
  lines: [
    'Oh, well done, dear. All three pieces, and the words, and it turns.',
    'I have waited three hundred years for somebody to put it together again.',
    'It was mine, you know. I paid for it. Badly, the smith says. I paid.',
    'Thank you, dear. Louhi of Pohjola will not forget your kind face.',
  ],
}
const FORGE = {
  when: f => f.words && !f.whole, sets: 'whole',
  lines: [
    'You have the words. I can hear them on you. Stand back.',
    'Wheel to stone. Stone to hopper. The lid goes over it when it is home.',
    'There. Three hundred years, and it fits as if I had made it this morning.',
    'It grinds what is in the heart of whoever turns it. Mind who turns it.',
    'The Count wants it under his lid. Take it, then. I only make things.',
  ],
}
// what Seppo says when he has all three (begun as the third changes hands, or by asking)
const THREE = {
  when: f => PIECE_KINDS.every(k => f[k]) && !f.three, sets: 'three',
  lines: [
    'Wheel, stone and hopper. And the lid up at the castle. All of it, after all these years.',
    'I can join iron to iron. Any smith can.',
    'But it will not turn without its words, and the words were never mine. I only made the thing.',
    'Ask old Väinö at the organ. If anyone has them, he has. Or had.',
  ],
}
for (const t of [...Object.values(TELLINGS), THREE, FORGE, TURN, THANKS]) Object.freeze(t.lines)

export function tellingFor(id, world) {
  const f = world?.sampo?.flags
  if (!f) return null
  const more = { 'named:seppo': [THREE, FORGE], 'named:count': [TURN], 'named:pohjanen': [THANKS] }[id] ?? []
  const t = [TELLINGS[id], ...more].find(t => t?.when(f))
  return t ? { lines: t.lines, sets: t.sets } : null
}

// ---- the pieces change hands ----------------------------------------------------------

const HANDOVER = {
  sea: 'The wheel. Still wet. It has been grinding salt, by the taste of it.',
  mountain: 'The stone. Copper-bound, as I bound it. Who lit your way up there?',
  marsh: 'The hopper. It smells of bog and pike. It will wash.',
}
export const handover = kind => HANDOVER[kind]
export const JAW_LINE = 'A pike\'s jawbone! And such a pike. Leave it with me. It wants strings, and I know an old horse.'

// ---- the lid --------------------------------------------------------------------------

export const LID_TILE = 'in_sampo_lid'
export const LID_REMARK = 'A lid of many colours, gone grey as ash. Under the rim, a maker\'s mark: a hammer over a spark.'

// ---- the smith's gift -----------------------------------------------------------------

export const GIFT = 'sword'
export const GIFT_TOAST = {
  title: 'The Sampo',
  lines: ['Three pieces are lost: one in the sea to the south,', 'one in the copper mountain to the north,', 'one in the marsh to the west.'],
}

// ---- the crier ------------------------------------------------------------------------

const CRY = {
  luck: 'Hear ye! The Count\'s Sampo has gone dim! A reward to whoever makes it shine! Ask at the castle!',
  heard: 'Hear ye! The Count\'s Sampo is still dim! The reward stands! Who made the thing? Nobody knows!',
  mark: 'Hear ye! The Count\'s Sampo is still dim! The reward stands! Who made the thing? Nobody knows!',
  pieces: 'Hear ye! The Sampo wants its three lost pieces! A stranger has gone to fetch them. So the stranger says.',
  words: 'Hear ye! The Sampo has its three pieces and still will not turn! It wants its words! Who has them?',
  forge: 'Hear ye! The ground sang under the church last night! The vicar says it was the wind. It was not.',
  whole: 'Hear ye! The smith has made the Sampo whole! It goes to the castle today!',
  eagle: 'Hear ye! A great eagle has the Sampo! She was last seen on the castle battlements!',
  choice: 'Hear ye! The eagle is beaten! The Sampo is in a stranger\'s sack! Where will it go?',
  castle: 'Hear ye! The Sampo shines in the great hall! Herring from the castle, every morning, at a fair price!',
  fountain: 'Hear ye! The Sampo is in the fountain! Turn it yourself and see what you get! One turn each!',
}
export const crierItem = world => CRY[stageOf(world)] ?? null
export const firstCall = world => stageOf(world) === 'luck'
const DEEDS = {
  won_sea: 'Hear ye! The fishers say the south sea is less salt this week. They cannot say why.',
  won_mountain: 'Hear ye! The sun is back over the copper mountain, they say, thanks to a stranger.',
  won_marsh: 'Hear ye! The great pike of the west marsh is caught! By a stranger! With meat!',
}
export const crierDeeds = world => Object.keys(DEEDS).filter(f => world?.sampo?.flags?.[f]).map(f => DEEDS[f])

// ---- the words, under the church ------------------------------------------------------

export const BLOWS = 5
// what Vipunen bellows at each blow on the anvil in his belly; the last is his song
export const VIPUNEN = [
  'WHO HAMMERS IN MY BELLY?',
  'I HAVE SWALLOWED A HUNDRED HEROES. NONE WAS SO NOISY.',
  'STOP! WHAT DO YOU WANT? WORDS? I HAVE EVERY WORD THERE IS.',
  'THE SAMPO\'S? THOSE OLD THINGS. LISTEN, THEN, AND GET OUT.',
  'HE SINGS. THE DARK RINGS WITH IT.',
]
export const BELLY = {
  cold: 'An anvil, of all things, and a cold forge beside it. Somebody was here before.',
  lit: 'The forge catches. Far overhead, something enormous stops snoring.',
  words: 'Every word of it. A kantele answers from far above, string for string.',
  out: 'He coughs.',
}

// ---- doors the story opens ------------------------------------------------------------

// A building's shut cell is known by its line (interior/buildings/church.js CRACK,
// castle.js BATTLEMENTS): once its flag is set, walking onto it goes through.
const PASSAGES = [
  { line: 'Warm air breathes up through the crack.', flag: 'crack', to: { floor: 'belly', stair: 'out' },
    say: 'Down, and down, and warm. You are standing in something that breathes.' },
  { line: 'The door to the battlements is barred.', flag: 'stolen', to: { floor: 'battlements', stair: 'door' },
    say: 'Wind, and the whole town below. And wings.' },
]
export function passageFor(world, line) {
  const f = world?.sampo?.flags
  const p = f && PASSAGES.find(p => p.line === line && f[p.flag])
  return p ? { to: p.to, say: p.say } : null
}
// the keep's stair guard lets the player up once the eagle has gone that way
export const guardWaves = (world, guardId) => guardId === 'castle:stair-guard' && !!world?.sampo?.flags?.stolen
// Granny Pohjanen is Louhi: once she has flown she keeps no stall
const GONE = Object.freeze(['named:pohjanen'])
export const goneFrom = world => world?.sampo?.flags?.stolen ? GONE : []

// ---- the things, and the two ends -----------------------------------------------------

export const SAMPO = 'sampo'
export const HERRING = 'herring'
export const FLOOD = 12        // herring on the hall floor when the Count has had his turn
export const HALL = {
  set: 'It goes under its lid as if it had never left. The lid takes colour like a sunrise.',
  eagle: 'She is an eagle before the last word is out, and the Sampo is in her claws.',
  up: 'Up. She went up.',
}
export const EAGLE_WON = 'She lets it fall and is gone north over the sea, smaller and smaller.'
export const ENDINGS = {
  castle: {
    ask: { title: 'Under its lid?', lines: ['The Sampo would stay in the great hall,', 'and the Count would turn it.'], yes: 'Set it here', no: 'Not yet' },
    toast: { title: 'The Sampo', lines: ['It sits under its lid in the great hall,', 'and grinds herring for the Count.'] },
    said: 'Mine. Name your reward, I said, and here it is. Within reason.',
    loot: 3,
  },
  fountain: {
    ask: { title: 'In the fountain?', lines: ['The Sampo would stand on the square,', 'and anyone could turn it.'], yes: 'Set it here', no: 'Not yet' },
    toast: { title: 'The Sampo', lines: ['It stands in the fountain on the square,', 'and gives whoever turns it what they want most.', 'The water is good to rest by.'] },
    loot: 2,
  },
}
export const FOUNTAIN_REST = { tiles: 2, every: 3 }   // by the running fountain: a heart every so many seconds
