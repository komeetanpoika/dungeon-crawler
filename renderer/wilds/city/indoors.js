// Kalevanlinna's doors from the inside. A city house is built afresh at every
// visit (game.js enterHouse keeps no instance of it), and so is a building
// laid by hand (the church, cityBuildingSpec): the people in it are
// exactly those the schedules put behind that door now (runtime.js
// occupantsOf; the clock stops indoors, so they stay put while the player is
// in), its trade comes from whose house it is, and nothing lies about to be
// taken: it all belongs to someone (interior/versions.js houseSpec reads
// door.city). Pure in the state it reads; no DOM.
//
// A resident is no entity of the street: they carry no cityKey, so a blow
// inside is not violence the watch sees (the street never sees indoors), and
// the runtime does not take them for strays. One struck down inside is out
// until the next day, as in the street: leaveCityHouse tells the runtime as
// the player walks out.
import { houseSpec } from '../../interior/versions.js'
import { hashStr } from '../../interior/rng.js'
import { occupantsOf, occupantsWithActs, householdOf, struckIndoors, moodOf } from './runtime.js'
import { speciesOf } from './walkers.js'
import { linesFor } from './lines.js'

// A person as a spawn in their house (game.js buildEntities makes the npc),
// saying what they would in the street in that mood (runtime.js moodOf).
export const residentOf = (person, mood = {}) => ({
  kind: 'npc', species: speciesOf(person), id: person.id, look: person.look, lines: linesFor(person, mood), hostile: false,
})

// What to build behind a city door (door.city) at this moment.
export function cityHouseSpec(state, door, worldSeed) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  const mood = run ? moodOf(run) : {}
  return houseSpec(door, {
    worldSeed,
    residents: occupantsOf(state, door.label).map(p => residentOf(p, mood)),
    household: householdOf(state, door.label),
  })
}

// Is this door shut now? `frac` is the time of day (0..1, schedule.js DAY).
// A door's own shut line always holds; a door that keeps hours ({ from, to,
// shut }: the church) says its line outside [from, to). Null: walk in.
export function doorShut(door, frac) {
  if (typeof door.closed === 'string') return door.closed
  const h = door.hours
  if (h && !(frac >= h.from && frac < h.to)) return h.shut
  return null
}

// What to build behind a door laid by hand (door.building: the church): its
// kind, a seed of its own, and whoever the schedules put behind it now with
// what they are there for, which says where they sit (the building's seat).
export function cityBuildingSpec(state, door, worldSeed) {
  const run = state.cityRun ?? state.cave?.surface?.cityRun
  const mood = run ? moodOf(run) : {}
  return {
    kind: door.building,
    seed: hashStr(`${worldSeed}|${door.label}`),
    people: occupantsWithActs(state, door.label).map(({ person, act }) => ({ spawn: residentOf(person, mood), person, act })),
  }
}

// Leaving a city house (the cave state, before systems/cave.js restoreSurface):
// whoever the schedules had in it and is no longer standing was struck down.
// In a building of floors (the church) those standing on the other floors
// wait in the building (interior/floors.js); the floor the player is on is
// the state's own list.
export function leaveCityHouse(caveState) {
  const label = caveState.cave?.label
  if (!label) return
  const building = caveState.cave.building
  const lists = [caveState.entities]
  if (building) for (const [id, f] of building.floors) if (id !== building.at) lists.push(f.entities)
  const standing = new Set()
  for (const list of lists) for (const e of list) if (e.type === 'npc' && e.hp > 0) standing.add(e.id)
  for (const id of caveState.cave.spared ?? []) standing.add(id)
  for (const p of occupantsOf(caveState, label)) if (!standing.has(p.id)) struckIndoors(caveState, p.id)
}

// ---- a blow inside a building (the church, the castle keep) -------------------------------------

// Inside a building of floors a blow counts as one in the street. An ordinary
// city house has no `building`: nothing indoors there is a crime.
export const struckInBuilding = caveState => !!caveState?.cave?.building

// Nobody is struck down in a building: the person hit is healed to full and
// stands, and is remembered (cave.spared) even if the blow already culled
// them, so leaveCityHouse does not send them home until tomorrow.
export function spareStruck(caveState, e) {
  if (e.maxHp) e.hp = e.maxHp
  ;(caveState.cave.spared ??= new Set()).add(e.id)
}
