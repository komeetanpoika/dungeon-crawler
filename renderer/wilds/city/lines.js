// What Kalevanlinna's people say (spec "Townsfolk: who lives there"): the
// lines the player hears from someone they talk to, by job and temperament,
// the named characters' own, and the exchanges two people have in the street
// (scenes.js talk). Pure data and pure functions; English, plain, a little dry.
//
//   linesFor(person, { night, crime }) -> string[]
//     named characters say their own (project 3 replaces them; the Count is not
//     spoken to in project 1: none); by night the townsfolk have night lines;
//     a warned or wanted player hears wary ones (crime: crime.js's level)
//     with `quest` (the Sampo's stage, sampo.js; the runtime passes it) the
//     named say what the story has them say, the Count answers, and by day
//     every grown townsperson has a word about the dim Sampo
//   moodKey({ night, crime, quest })   what of the mood the lines depend on (the
//                                      runtime asks anew when it changes)
//   talkFor(a, b, { night, k })        an exchange, a first: by a's temperament,
//                                      b's trade, or the town's; at night the
//                                      inn door's. k picks (a hash of the pair)
//
// The arrays handed out are shared and frozen: one per kind of person and mood.

import { namedLines, luckLine } from './sampo.js'

const freeze = a => Object.freeze(a)

// ---- the named characters ---------------------------------------------------------

export const NAMED_LINES = {
  seppo: ['Mind the sparks. And no, I don\'t make jewellery.', 'Hammer, iron, fire. Nothing else is worth the bother.'],
  vaino: ['The organ is fine. It is the singing I worry about.'],
  pohjanen: ['Herring, dear? Salted this morning. Well. This week.', 'You have a kind face. Kind faces get the good herring.'],
  vicar: ['The bell rings at the same hour every day. People still come late.'],
  crier: ['Hear ye, hear ye. That is the job. The rest is shouting.', 'News at the bell, and more news between the bells.'],
  innkeeper: ['Beds upstairs, beer down here. Trouble outside.'],
  captain: ['Keep the peace and the peace keeps you.'],
  count: [],
}

// ---- by trade ---------------------------------------------------------------------

const JOB_LINES = {
  stallholder: ['Look all you like. Buying is extra.', 'Turnips. Again.', 'Fresh this morning. Most of it.'],
  baker: ['Fresh bread at dawn. Mostly fresh.', 'Rye, rye, or rye. Take your pick.', 'The oven does not care that I am tired.'],
  butcher: ['Good cuts today. Do not ask about the sausage.', 'Pork, mutton, or whatever the cart brought.'],
  fisher: ['The herring were in a mood this morning.', 'Wind from the east. Fish from the west. Make of that what you will.', 'Out before the gulls, back after them.'],
  'net-mender': ['A net is mostly holes. The trick is the rest.', 'Every tear has a story. The fishers tell them badly.'],
  sailor: ['Solid ground. I never trust it.', 'Three weeks at sea, and the first thing I see is turnips.'],
  porter: ['Crates in, crates out. The back hurts either way.', 'Do not ask what is in the crates. I never do.'],
  apprentice: ['Seppo says I will make a smith yet. One day.', 'I sweep, I fetch, I get shouted at. It is called learning.'],
  weaver: ['Wool from the north, blisters from me.', 'Grey, brown, or more grey. Dye costs extra.'],
  dyer: ['Blue hands. It washes off by midsummer.', 'Woad, madder, birch bark. The harbour gets all of it.'],
  tanner: ['Do not stand downwind. Everyone learns that once.', 'Good leather takes a year. Bad leather takes a week.'],
  miller: ['The wind turns the sails. I carry the sacks.', 'Flour in my hair, flour in my bed. It is a living.'],
  carter: ['Mind the wheels.', 'Market street at noon is no place for a cart. Or a person.'],
  washer: ['Sea water for the washing, rain for the rinse. When it rains.', 'Hands like boiled cod. Shirts like snow. A fair trade.'],
  lamplighter: ['One lamp at a time. There is no other way.', 'Nobody sees the lamps I light. Everybody sees the one I miss.'],
  'bell-ringer': ['My ears ring longer than the bell.', 'Up the tower, down the tower. I have counted the steps. I wish I had not.'],
  server: ['The Golden Pike. The soup is fish. So is the stew.', 'Sit where you like. Not there.'],
  beggar: ['Spare a kind word? They cost nothing.', 'I was a sailor once. Now I listen. It pays the same.'],
  child: ['You can\'t catch me!', 'Are you a knight? You look like a knight. A bit.'],
  elder: ['In my day the walls were lower and the herring bigger.', 'Sit a while. The bench does not mind.'],
  watch: ['Move along.', 'Keep your blade sheathed inside the walls.'],
  // the named trades, for anyone who is not the named one
  smith: ['Iron listens if you hit it hard enough.'],
  organist: ['The organ has one pipe that sulks.'],
  herring: ['Herring! Salted, smoked, or just looked at.'],
  vicar: ['Service at the bell.'],
  crier: ['News at the bell.'],
  innkeeper: ['Beds upstairs.'],
  captain: ['Keep the peace.'],
}
const ANYONE = ['Good day.']

// ---- by temperament ---------------------------------------------------------------

const TEMPERS = ['cheerful', 'gruff', 'shy', 'chatty']
const TEMPER_LINES = {
  cheerful: ['Lovely day for it. Whatever it is.', 'Morning! Or afternoon. Either way, hello.'],
  gruff: ['What.', 'Busy.'],
  shy: ['Oh. Hello.', 'Sorry. Was I in the way?'],
  chatty: ['Have you heard? No? Neither have I. Something is going on, though.', 'You are not from here. I can tell. It is the boots.'],
}
const CHILD_TEMPER = {
  cheerful: ['I can whistle. Listen. No, wait.'],
  gruff: ['You smell like the woods.'],
  shy: ['Mum says not to talk to strangers.'],
  chatty: ['My brother says you are a troll. Are you a troll?'],
}
const WATCH_TEMPER = {
  chatty: ['Long shift. They are all long.', 'Twenty years on the gate. I have seen everything twice.'],
  gruff: ['Eyes front, stranger.'],
}

// ---- by night ---------------------------------------------------------------------

const NIGHT_LINES = {
  cheerful: ['Lovely night. A bit dark.', 'Off home? Me too. Eventually.'],
  gruff: ['It is late. Go to bed.', 'Nothing open but the inn. Go there or go home.'],
  shy: ['Oh! You gave me a start.', 'I was just going home. Truly.'],
  chatty: ['Out late? Me too. Do not tell anyone.', 'The inn is loud tonight. It is loud every night.'],
}
const CHILD_NIGHT = ['I am not out. You did not see me.']
const WATCH_NIGHT = ['Late to be about, stranger.', 'The gates are shut till dawn. Mostly.']

// ---- wary: a warned or wanted player ----------------------------------------------

const WARY_LINES = {
  cheerful: ['Oh. It is you. We heard.', 'Put it away and we can be friends. Probably.'],
  gruff: ['Keep your distance.', 'I saw that.'],
  shy: ['Please. I have not done anything.', 'I will just go round you.'],
  chatty: ['Everyone is talking about you. Not nicely.', 'The watch knows your face now. It is not a good face.'],
}
const WANTED_LINE = 'The watch is after you. I never saw you.'
const CHILD_WARY = ['I am telling!', 'Mum says you are trouble.']
const WATCH_WARY = ['One more and it is the stocks.', 'Sheathe it. Now.']
const WATCH_WANTED = ['You are wanted, stranger. Come quietly.']

const wary = crime => crime === 'warned' || crime === 'wanted'
export const moodKey = ({ night = false, crime = 'calm', quest = null } = {}) => (night ? 'n' : 'd') + (wary(crime) ? crime : '') + (quest ? `|${quest}` : '')

function build(person, night, crime, quest) {
  const id = person.id?.startsWith('named:') ? person.id.slice(6) : null
  if (person.job === 'count') return (quest && namedLines('count', quest)) || NAMED_LINES.count
  const t = TEMPERS.includes(person.temperament) ? person.temperament : 'cheerful'
  const watch = person.job === 'watch' || person.job === 'captain'
  const child = person.age === 'child'
  if (wary(crime)) {
    if (watch) return crime === 'wanted' ? WATCH_WANTED : WATCH_WARY
    if (child) return CHILD_WARY
    return crime === 'wanted' ? [...WARY_LINES[t], WANTED_LINE] : WARY_LINES[t]
  }
  if (id && NAMED_LINES[id]) return (quest && namedLines(id, quest)) || NAMED_LINES[id]
  if (night) return person.job === 'watch' ? WATCH_NIGHT : child ? CHILD_NIGHT : NIGHT_LINES[t]
  const own = JOB_LINES[person.job] ?? ANYONE
  if (person.job === 'watch') return [...own, ...(WATCH_TEMPER[t] ?? WATCH_TEMPER.gruff)]
  if (child) return [...own, ...CHILD_TEMPER[t]]
  // while the Sampo is dim the town talks of it (the story's whole length so far)
  return quest ? [...own, ...TEMPER_LINES[t], luckLine(t)] : [...own, ...TEMPER_LINES[t]]
}

const memo = new Map()
export function linesFor(person, mood = {}) {
  const night = !!mood.night, crime = mood.crime ?? 'calm', quest = mood.quest ?? null
  const named = person.id?.startsWith('named:') ? person.id : ''
  const key = `${named || person.job}|${person.age}|${person.temperament}|${moodKey({ night, crime, quest })}`
  let lines = memo.get(key)
  if (!lines) memo.set(key, lines = freeze(build(person, night, crime, quest).slice()))
  return lines
}

// ---- street talk ------------------------------------------------------------------

// exchanges anyone has, the first speaker first
const TOWN_TALKS = [
  ['Morning.', 'Morning. Cold one.', 'They are all cold.', 'True enough.'],
  ['Your roof still leaking?', 'Only when it rains.', 'So, always.', 'So, always.'],
  ['Granny Pohjanen says it will snow.', 'She said that in June.', 'It nearly did.'],
  ['Where are you off to?', 'The market. Turnips.', 'Again?', 'They are cheap and they keep.'],
  ['Did you see the Count on the wall?', 'From a distance.', 'Best way to see him.'],
  ['Seppo was at it before dawn.', 'Everyone heard.', 'He says it is a hinge for the gate.', 'Which gate?', 'He did not say.'],
  ['The vicar went on a bit last week.', 'He always goes on a bit.', 'A bit more, then.'],
  ['My boy wants to join the watch.', 'Tell him the boots pinch.', 'He would like it all the more.'],
  ['You look tired.', 'The goat got out again.', 'Whose goat?', 'Nobody will say.'],
  ['Good day.', 'Is it?', 'It is not raining.', 'Give it time.'],
]
// asked of someone at their trade (the second speaker is of it)
const JOB_TALKS = {
  fisher: [['Catch any?', 'Some.', 'Some is good.', 'Some is some.'], ['Wind from the east.', 'Fish from the west, then.', 'So they say.']],
  'net-mender': [['Is that net mended?', 'It is a net. It is never mended.', 'Fair enough.']],
  sailor: [['Back from sea?', 'Back from sea.', 'How was it?', 'Wet.']],
  baker: [['Any bread left?', 'Yesterday\'s.', 'How much?', 'Same as today\'s. It is the same bread.']],
  butcher: [['What is in the sausage this week?', 'Meat.', 'What kind?', 'The sausage kind.']],
  stallholder: [['How much for the turnips?', 'Same as yesterday.', 'That is a lot.', 'It was a lot yesterday too.']],
  porter: [['Heavy?', 'Everything is heavy.', 'Even that one?', 'That one most of all.']],
  washer: [['Will it dry today?', 'It will try.', 'Will it manage?', 'It never has.']],
  tanner: [['You smell of the yard.', 'I am the yard.', 'Fair enough.']],
  dyer: [['Your hands are blue.', 'Last week they were red.', 'What next?', 'Yellow, if the onion skins come.']],
  carter: [['Busy on the road?', 'Ruts you could bathe in.', 'Will they mend it?', 'They said so last year.']],
  miller: [['Wind enough for the mill?', 'Enough for the mill. Not enough for my back.']],
  weaver: [['Nice cloth.', 'It is grey.', 'Nice grey cloth, then.']],
  apprentice: [['Is Seppo in a mood?', 'Seppo is a mood.', 'I will come back later.']],
  lamplighter: [['All lit last night?', 'All but one.', 'Which one?', 'Yours.']],
  'bell-ringer': [['You rang late yesterday.', 'The bell rang late. I was on time.']],
  beggar: [['Still here?', 'Where else would I be?', 'Fair point.']],
  elder: [['How are the knees?', 'Older than the walls.', 'The walls are fine.', 'The walls do not climb stairs.']],
}
// as the first speaker is
const TEMPER_TALKS = {
  cheerful: [['Lovely morning!', 'Is it?', 'The sun is out.', 'For now.']],
  gruff: [['You are in my way.', 'I was here first.', 'Then you were in my way first.']],
  shy: [['Um. Hello.', 'Hello.', 'Nice weather.', 'It is.', 'Well. Goodbye, then.']],
  chatty: [['Heard about the herring?', 'No.', 'Neither have I. That is the trouble.', 'Mm.'], ['Did you hear what the crier said?', 'I never listen to the crier.', 'Neither do I. I was hoping you had.']],
}
// at the inn door, of an evening
export const NIGHT_TALKS = freeze([
  ['Good night, then.', 'Mind the step.', 'What step?', 'That one.'],
  ['One more?', 'My wife says no.', 'She is not here.', 'She will hear of it.'],
  ['Taavetti watered the beer.', 'He says the rain got in.', 'Through the cellar?', 'It was a lot of rain.'],
  ['Who is singing?', 'Nobody you would call singing.', 'Then who is shouting?', 'Him.'],
].map(freeze))
for (const pool of [TOWN_TALKS, ...Object.values(JOB_TALKS), ...Object.values(TEMPER_TALKS)]) pool.forEach(freeze)
// every day exchange there is
export const TALKS = freeze([...TOWN_TALKS, ...Object.values(JOB_TALKS).flat(), ...Object.values(TEMPER_TALKS).flat()])

export function talkFor(a, b, { night = false, k = 0 } = {}) {
  const n = Math.abs(Math.floor(k))
  if (night) return NIGHT_TALKS[n % NIGHT_TALKS.length]
  // one in three by b's trade, one in three by a's temperament, the rest the town's
  const pool = [TOWN_TALKS, JOB_TALKS[b?.job], TEMPER_TALKS[a?.temperament]][n % 3] ?? TOWN_TALKS
  return pool[Math.floor(n / 3) % pool.length]
}

// ---- in the scenes ----------------------------------------------------------------

export const BEGGAR_LINES = freeze(['Spare a coin?', 'A coin for an old sailor?', 'Bless you anyway.', 'Even a small coin. Especially a small coin.'])
export const DRUNK_LINES = freeze(['Hic.', 'Which way is home?', 'I am not singing. That is the wind.', 'The street is moving. Tell it to stop.'])
