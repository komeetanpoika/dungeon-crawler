// Hand-laid buildings: a kind names its floors (text maps, parse.js), the
// ground floor, the light and where a person sits. buildBuilding builds every
// floor from the seed and seats everyone exactly once. Pure in its inputs.
import { buildFloor } from './build.js'
import { hashStr, mulberry32, shuffle } from '../rng.js'
import { CHURCH } from './church.js'
import { CASTLE } from './castle.js'

export const BUILDINGS = { church: CHURCH, castle: CASTLE }

const SEAT_CLEARANCE = 2   // people off the way in/out and the stairs: farther than this (Chebyshev)

// people: [{ spawn, person, act }]. Returns { floors, ground, theme }. A person who
// does not fit throws; with `strict: false` (the game, mid-frame) they are left out and counted in a warning.
export function buildBuilding(kind, { seed, people = [], strict = true }, registry = BUILDINGS) {
  const def = registry[kind]
  if (!def) throw new Error(`buildBuilding: unknown building "${kind}"`)
  const floors = def.floors.map(f => buildFloor(f, { rng: mulberry32(hashStr(`${seed}:${kind}:${f.id}`)) }))
  const byId = new Map(floors.map(f => [f.id, f]))
  const taken = new Map(floors.map(f => [f.id, new Set(f.entitySpawns.map(s => `${s.x},${s.y}`))]))
  const seatRng = mulberry32(hashStr(`${seed}:${kind}:seats`))
  let left = 0
  for (const p of people) {
    const { floor: fid, spot } = def.seat(p.person, p.act)
    const f = byId.get(fid)
    if (!f) throw new Error(`${kind}: seat names unknown floor "${fid}"`)
    const used = taken.get(fid)
    let c = (f.spots.get(spot) ?? []).find(c => !used.has(`${c.x},${c.y}`))
    if (!c) {
      const away = [...f.stairs.flatMap(s => [s, s.land]), ...[f.playerSpawn, f.exit].filter(Boolean)]
      const far = x => away.every(a => Math.max(Math.abs(a.x - x.x), Math.abs(a.y - x.y)) > SEAT_CLEARANCE)
      c = shuffle(seatRng, f.free).find(x => !used.has(`${x.x},${x.y}`) && far(x))
    }
    if (!c) {
      if (!strict) { left++; continue }
      throw new Error(`${kind}: no free cell on floor "${fid}" for ${p.person?.id ?? 'a person'}`)
    }
    used.add(`${c.x},${c.y}`)
    // whoever is placed keeps their place: no wandering off a pew (npc.js makeNpc roam)
    f.entitySpawns.push({ ...p.spawn, x: c.x, y: c.y, roam: 0 })
  }
  if (left) console.warn(`${kind}: ${left} people left out, no free cell`)
  return { floors, ground: def.ground, theme: def.theme }
}
