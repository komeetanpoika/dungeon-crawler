// The Sampo of Kalevanlinna: the city's long story, in story order. This
// file is the story as data and rules, pure and DOM-free; sampo-run.js plays
// it. Part 1 (here): the luck has run out (the Count's reward, the dim lid in
// the great hall) and the smith (Seppo made it; where its three pieces went).
// Parts 2 and 3 (the three pieces in the Wilds, the words, the castle) are
// not built: the story rests at stage 'pieces'.
//
//   world.sampo = { flags }     in the Wilds record (world.js), kept across a
//                               GEN bump like the tales. Flags, each set once:
//     heard   the Count has told of the lid and his reward
//     mark    the player has seen the maker's mark under the lid's rim
//     smith   Seppo has owned up and named the three places
//     gift    Seppo's sword has been handed over
//   stageOf(world) -> 'luck' | 'heard' | 'mark' | 'pieces'
//     what the town knows the player knows; null for a world without the
//     record (tests' stand-ins): then nothing here changes anything
//   namedLines(id, stage) -> string[] | null
//     what a named character says at that stage (null: their everyday lines)
//   luckLine(temperament) -> string
//     what any grown townsperson adds while the Sampo is dim
//   tellingFor(id, world) -> { lines, sets } | null
//     a speech in order, begun by talking to that person (ids as the folk's:
//     'named:count'); `sets` is the flag its last line sets
//   crierItem(world) -> string | null     the crier's call for the stage
//   firstCall(world) -> bool              is it his first call of the day (until the Count is heard)
//   LID_REMARK, LID_TILE, GIFT, GIFT_TOAST
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

export const SAMPO_FLAGS = ['heard', 'mark', 'smith', 'gift']
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
  return f.smith ? 'pieces' : f.mark ? 'mark' : f.heard ? 'heard' : 'luck'
}

// ---- what the named say ---------------------------------------------------------------

const PLACES = 'The sea, south of here. The copper mountain, north. The marsh, west. Three pieces.'
const NAMED = {
  count: {
    // before he is heard he has his telling; these are for a second word
    luck: ['Well? I am told you looked at it. Looking is free.'],
    heard: ['Does it shine? No. Then why are you standing here?', 'Look at it. Do not touch it. It has been touched enough.'],
    mark: ['A mark under the rim? I pay for a lid that shines, not for marks.', 'Does it shine? No. Then why are you standing here?'],
    pieces: ['Three pieces. Then bring me three pieces.', 'Whole, mind. I want it whole, and I want it here.'],
  },
  seppo: {
    heard: ['The Count\'s lid? Never seen it. I make horseshoes.', 'Ask someone who makes lids.', 'Mind the sparks. And no, I don\'t make jewellery.'],
    pieces: [PLACES, 'Bring them here. Not to the castle. Here.', 'I don\'t make jewellery. I made that. Once.'],
  },
  pohjanen: {
    luck: ['Herring, dear? Salted this morning. Well. This week.', 'The fountain is dry, dear, and the Count has a reward out. Go up to the castle and ask him.'],
    heard: ['Whoever makes a thing leaves a mark on it, dear. Makers cannot help it. Look under the rim.', 'A reward! And you with that kind face.'],
    mark: ['A hammer over a spark? Well now. Who do we know with a hammer, dear?', 'You have a kind face. Kind faces get the good herring.'],
    pieces: ['Three pieces! The sea, the mountain and the marsh. What a long way for a kind face.', 'You will bring them all back here, won\'t you, dear. All three. Good.'],
  },
  vaino: {
    heard: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    mark: ['The Sampo. There was a song about it. I still have the tune. The words went years ago.', 'The organ is fine. It is the singing I worry about.'],
    pieces: ['When you have your three pieces, come and see me. A thing like that wants singing together.', 'I still have the tune. The words went years ago.'],
  },
  vicar: {
    pieces: ['The bell rings at the same hour every day. People still come late.', 'The crypt is warm this year. Warm! In a crypt.'],
  },
}
for (const who of Object.values(NAMED)) for (const k of Object.keys(who)) Object.freeze(who[k])

export const namedLines = (id, stage) => NAMED[id]?.[stage] ?? null

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
for (const t of Object.values(TELLINGS)) Object.freeze(t.lines)

export function tellingFor(id, world) {
  const f = world?.sampo?.flags, t = TELLINGS[id]
  return f && t && t.when(f) ? { lines: t.lines, sets: t.sets } : null
}

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
}
export const crierItem = world => CRY[stageOf(world)] ?? null
export const firstCall = world => stageOf(world) === 'luck'
