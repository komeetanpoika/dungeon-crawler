// The Sampo of Kalevanlinna: the city's long story, in story order. This
// file is the story as data and rules, pure and DOM-free; sampo-run.js plays
// it in the city, sampo-places.js out in the Wilds.
//   Part 1: the luck has run out (the Count's reward, the dim lid in the
//           great hall) and the smith (Seppo made it; where its pieces went).
//   Part 2: the three pieces (PIECES): each lies at a place of its own that
//           the Wilds admits on that side of the city once Seppo has spoken,
//           kept by a guardian; brought to Seppo one by one. The great pike's
//           jawbone goes to Väinö.
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
//   stageOf(world) -> 'luck' | 'heard' | 'mark' | 'pieces' | 'words'
//     what the town knows the player knows; null for a world without the
//     record (tests' stand-ins): then nothing here changes anything
//   questKey(world) -> the stage, and after a slash what else the lines turn
//     on ('pieces/sea,jaw'): the mood the town's lines are kept by (lines.js)
//   namedLines(id, quest) -> string[] | null
//     what a named character says at that quest key (null: their everyday lines)
//   luckLine(temperament) -> string
//     what any grown townsperson adds while the Sampo is dim
//   tellingFor(id, world) -> { lines, sets } | null
//     a speech in order, begun by talking to that person (ids as the folk's:
//     'named:count'); `sets` is the flag its last line sets
//   crierItem(world) -> string | null     the crier's call for the stage
//   crierDeeds(world) -> string[]         what the player did out there, for his round
//   firstCall(world) -> bool              is it his first call of the day (until the Count is heard)
//   PIECES, PIECE_KINDS, SAMPO_PLACES, kindOfPlace(id), handover(kind), JAW, JAW_LINE
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

export const SAMPO_FLAGS = ['heard', 'mark', 'smith', 'gift', ...PIECE_KINDS.map(k => `won_${k}`), ...PIECE_KINDS, 'three', 'jaw']
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
  return f.three ? 'words' : f.smith ? 'pieces' : f.mark ? 'mark' : f.heard ? 'heard' : 'luck'
}
export function questKey(world) {
  const stage = stageOf(world)
  if (!stage) return null
  const f = world.sampo.flags
  const more = [...PIECE_KINDS.filter(k => f[k]), ...(f.jaw ? ['jaw'] : [])]
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
  },
  seppo: {
    heard: ['The Count\'s lid? Never seen it. I make horseshoes.', 'Ask someone who makes lids.', 'Mind the sparks. And no, I don\'t make jewellery.'],
    words: ['It wants its words. Ask old Väinö at the organ.', 'Iron I can join. Words I never had.'],
  },
  pohjanen: {
    luck: ['Herring, dear? Salted this morning. Well. This week.', 'The fountain is dry, dear, and the Count has a reward out. Go up to the castle and ask him.'],
    heard: ['Whoever makes a thing leaves a mark on it, dear. Makers cannot help it. Look under the rim.', 'A reward! And you with that kind face.'],
    mark: ['A hammer over a spark? Well now. Who do we know with a hammer, dear?', 'You have a kind face. Kind faces get the good herring.'],
    pieces: ['Three pieces! The sea, the mountain and the marsh. What a long way for a kind face.', 'You will bring them all back here, won\'t you, dear. All three. Good.'],
    words: ['All three! Oh, you clever dear. And now it only wants its words.', 'Words are easy, dear. Somebody always knows them.'],
  },
  vaino: {
    heard: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    mark: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    pieces: ['When you have your three pieces, come and see me. A thing like that wants singing together.', 'If you meet a great pike out there, bring me its jawbone. I have a mind to make something.'],
    words: ['The words? I had them once. I still have the tune.', 'If you meet a great pike out there, bring me its jawbone. I have a mind to make something.'],
  },
  vicar: {
    pieces: ['The bell rings at the same hour every day. People still come late.', 'The crypt is warm this year. Warm! In a crypt.'],
    words: ['The bell rings at the same hour every day. People still come late.', 'The crypt is warm this year. Warm! In a crypt.'],
  },
}
for (const who of Object.values(NAMED)) for (const k of Object.keys(who)) Object.freeze(who[k])
const VAINO_JAW = Object.freeze(['Listen. Five strings on a pike\'s jaw. It has the tune already.', 'A kantele wants words as a mill does. I had them once.'])

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
  if (id === 'vaino' && had.includes('jaw')) return VAINO_JAW
  return NAMED[id]?.[stage] ?? null
}

const LUCK = {
  cheerful: 'The fountain is dry, but the Count has a reward out. Things are looking up!',
  gruff: 'Fountain\'s dry. Herring\'s thin. The Count\'s Sampo has gone dim. Ask him.',
  shy: 'They say the Sampo has gone dim. I would not know. I only heard.',
  chatty: 'Have you heard? The Count\'s Sampo has gone dim! There is a reward. Go up to the castle!',
}
export const luckLine = temperament => LUCK[temperament] ?? LUCK.cheerful

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
for (const t of [...Object.values(TELLINGS), THREE]) Object.freeze(t.lines)

export function tellingFor(id, world) {
  const f = world?.sampo?.flags
  if (!f) return null
  const t = [TELLINGS[id], id === 'named:seppo' ? THREE : null].find(t => t?.when(f))
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
}
export const crierItem = world => CRY[stageOf(world)] ?? null
export const firstCall = world => stageOf(world) === 'luck'
const DEEDS = {
  won_sea: 'Hear ye! The fishers say the south sea is less salt this week. They cannot say why.',
  won_mountain: 'Hear ye! The sun is back over the copper mountain, they say, thanks to a stranger.',
  won_marsh: 'Hear ye! The great pike of the west marsh is caught! By a stranger! With meat!',
}
export const crierDeeds = world => Object.keys(DEEDS).filter(f => world?.sampo?.flags?.[f]).map(f => DEEDS[f])
