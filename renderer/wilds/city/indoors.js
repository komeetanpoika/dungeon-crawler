// Kalevanlinna's doors from the inside. A city house is built afresh at every
// visit (game.js enterHouse keeps no instance of it): the people in it are
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
import { occupantsOf, householdOf, struckIndoors, jobLines } from './runtime.js'
import { speciesOf } from './walkers.js'

// A person as a spawn in their house (game.js buildEntities makes the npc).
export const residentOf = person => ({
  kind: 'npc', species: speciesOf(person), id: person.id, look: person.look, lines: jobLines(person), hostile: false,
})

// What to build behind a city door (door.city) at this moment.
export function cityHouseSpec(state, door, worldSeed) {
  return houseSpec(door, {
    worldSeed,
    residents: occupantsOf(state, door.label).map(residentOf),
    household: householdOf(state, door.label),
  })
}

// Leaving a city house (the cave state, before systems/cave.js restoreSurface):
// whoever the schedules had in it and is no longer standing was struck down.
export function leaveCityHouse(caveState) {
  const label = caveState.cave?.label
  if (!label) return
  const standing = new Set()
  for (const e of caveState.entities) if (e.type === 'npc' && e.hp > 0) standing.add(e.id)
  for (const p of occupantsOf(caveState, label)) if (!standing.has(p.id)) struckIndoors(caveState, p.id)
}
