// Who lives in the desert: the tables the Wilds' dealing (features.js) draws
// from when a spot is desert country, in place of the forest's wolves, bears
// and spiders. A roaming pack, a camp's garrison, a nest's and old stones'
// guards and the stray pair among another country's animals are judged at
// their own spot, as the desert's dress is. DOM-free and pure.
//
//   skorpioni         the small scorpion, the desert's spider: buried by day
//   keisariskorpioni  the emperor, its bear
//   jackal            its wolf: a pack that harries, a lone one that runs
//   hiekkamato        the sand worm: feels footsteps, erupts from deep sand
//   kuoppaleuka       the antlion in its funnel: rooted, always alone
//
// The switch is for tests (the desert deals as it did before with it off);
// it is on, as wilds/desert-art.js setDesertDress is.
let cast = true
export const desertCast = () => cast
export const setDesertCast = on => { cast = !!on }

const scorp = { kind: 'skorpioni' }, emperor = { kind: 'keisariskorpioni' }, jackal = { npc: 'jackal' }
const worm = { kind: 'hiekkamato' }, pit = { kind: 'kuoppaleuka' }, bones = { kind: 'rappeluu' }
// (the clown is as rare here as anywhere: features.js RARE_ODDS)
const CLOWN = [{ kind: 'klovni' }]
export const DESERT_RARE = new Set([CLOWN])

// Roaming packs by toughness; row 0 is the ring round home and farmland.
// Every row has a pack of small scorpions only, which is all a village and
// farmland draw (isGentle): by day nothing there moves unless stepped on.
// The worm and the antlion come from toughness 2; the worm is listed twice
// where it is alone, since half its spots have no home for it (WORM_KEEP).
export const DESERT_PACKS = [
  [[scorp, scorp], [jackal], [scorp, scorp, scorp]],
  [[jackal, jackal], [jackal, jackal, jackal], [scorp, scorp], [scorp, scorp, scorp], CLOWN],
  [[jackal, jackal, jackal], [worm], [worm], [pit], [scorp, scorp, scorp], [bones, bones], CLOWN],
  [[worm], [worm], [emperor, scorp, scorp], [pit], [bones, bones, bones], [jackal, jackal, jackal, jackal], [scorp, scorp, scorp], CLOWN],
  [[worm, worm], [emperor, emperor], [pit], [{ kind: 'manticore' }], [{ kind: 'podeboo' }, bones], [scorp, scorp, scorp, scorp]],
]
export const isGentle = pack => pack.every(f => f.kind === 'skorpioni')
export const hasWorm = pack => pack.some(f => f.kind === 'hiekkamato')
export const hasPit = pack => pack.some(f => f.kind === 'kuoppaleuka')
// bound to the sand it was dealt in: never posted on a path, never a guard
export const isBound = pack => hasWorm(pack) || hasPit(pack)

// Camps by the lowest toughness they appear at, in features.js CAMPS' shape
// and with its looks (the desert's dress pitches the tents and digs the dens).
export const DESERT_CAMPS = [
  { from: 1, name: 'jackals', look: 'den', foes: [jackal, jackal, jackal] },
  { from: 1, name: 'scorpions', look: 'nest', foes: [scorp, scorp, scorp] },
  { from: 1, name: 'pete', look: 'bandits', foes: [{ kind: 'pullopete' }, scorp, scorp, scorp], lead: 1 },
  { from: 2, name: 'bandits', look: 'bandits', foes: [{ kind: 'guard' }] },
  { from: 2, name: 'bones', look: 'graves', foes: [bones, bones, scorp] },
  { from: 2, name: 'emperor', look: 'nest', foes: [emperor, scorp, scorp], lead: 1 },
  { from: 3, name: 'podeboo', look: 'graves', foes: [{ kind: 'podeboo' }, bones, bones], lead: 1 },
  { from: 4, name: 'manticores', look: 'nest', foes: [{ kind: 'manticore' }, emperor, emperor], lead: 1 },
]

// A worm's home lies this far from its piece's heart (its leash is 12, so it
// never comes up in a yard), and on a road piece that is calm this far from
// the road. An antlion's room: every cell within this many tiles free.
export const WORM_KEEP = 22
export const WORM_ROAD = 14
export const PIT_ROOM = 3
