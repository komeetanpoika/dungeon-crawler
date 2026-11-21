// House interiors: one door's house, built from its spec (versions.js
// houseSpec): a plan cut for it, walls and floors, rooms furnished for their
// purpose, the version's finish, and who lives there. Pure in spec.seed — the
// same door is the same house on every visit; only what lives and lies in it
// resets with the cave instance (systems/cave.js).
import { makePlan } from './plan.js'
import { buildCells } from './walls.js'
import { assignRoles, floorsFor, furnish, bareOf } from './furnish.js'
import { layPuzzle, findSun, solveSun } from './sunroom.js'
import { MISC } from './kit.js'
import { HOME } from './recipes.js'
import { VERSIONS, TRADE_LIST, GLASSMAKER, occupants, loot, dress } from './versions.js'
import { mulberry32, shuffle } from './rng.js'
import { TILE } from '../systems/entities.js'

export { houseSpec, VERSIONS, STORY_ROOMS } from './versions.js'
export { INTERIOR_SKINS } from './kit.js'

// Spawns other than pickups keep further than this (Manhattan) from the
// spawn, so nothing stands on the player as the door closes.
const DOOR_CLEARANCE = 3

// A spec straight from its parts, for tools and tests (the game uses houseSpec).
export function specFor({ version = 'home', size = 'medium', seed = 1, label = `house:${seed}`, tier, toughness = 1, palette, trade, story = null } = {}) {
  return {
    label, version, size, toughness, seed, story,
    tier: tier ?? (version === 'ruin' ? 'ruin' : version === 'home' || version === 'sunroom' ? 'safe' : 'hut'),
    palette: palette ?? (version === 'ruin' ? 'grey' : version === 'sunroom' ? 'pale' : 'plaster'),
    trade: trade ?? (['home', 'empty', 'sunroom'].includes(version) ? TRADE_LIST[seed % TRADE_LIST.length] : null),
  }
}

// Returns { map, entitySpawns, playerSpawn, exit, theme, version, plan, roles,
// reward }. For the puzzle house, `solved` builds it with the light already
// in, and `reward` is the alcove's cell when the reward still waits there
// (solved, not `looted`): the caller puts a chest on it.
export function generateInterior(spec, { solved = false, looted = false } = {}) {
  const rng = mulberry32(spec.seed)
  const sunroom = spec.version === 'sunroom'
  const plan = makePlan(spec.size, rng, { hall: sunroom })
  const roles = assignRoles(plan, { version: spec.version, trade: spec.trade, story: spec.story, rng })
  const floors = floorsFor(plan, roles, rng, spec.version)
  const map = buildCells(plan, { palette: spec.palette, floorOf: id => floors.get(id) })
  // a story house of one room is a cottage, with its story room's must-haves in it
  const extra = {}
  const storyRole = spec.story?.role
  if (storyRole && ![...roles.values()].includes(storyRole) && HOME[storyRole]) {
    extra[plan.entry] = { face: HOME[storyRole].face.filter(e => e.must), wall: HOME[storyRole].wall.filter(e => e.must) }
  }
  // Päivölä: the window, mirrors and seed go in before the furniture, which keeps off the beam
  const puzzle = sunroom ? layPuzzle(map, plan, plan.rooms.find(r => r.id === plan.entry), rng, bareOf(plan)) : null
  furnish(map, plan, roles, { version: spec.version, trade: spec.trade, rng, extra, reserve: puzzle?.reserve ?? new Set() })
  dress(map, plan, spec, rng)
  let reward = null
  if (puzzle && solved) {
    map.forEach(row => row.forEach(c => { if (c.mirror) { c.mirror = c.solution; c.overlay = MISC.mirror[c.mirror] } }))
    const sun = findSun(map)
    solveSun(map, sun)
    if (!looted) reward = { ...sun.alcove }
    else map[sun.alcove.y][sun.alcove.x].overlay = MISC.chestOpen
  }

  const key = c => `${c.x},${c.y}`
  const free = []
  map.forEach((row, y) => row.forEach((c, x) => {
    if (plan.grid[y][x] === '.' && c.tile !== TILE.WALL && !c.overlay && !(x === plan.spawn.x && y === plan.spawn.y)) free.push({ x, y })
  }))
  const taken = new Set()
  const take = list => { const c = list.find(c => !taken.has(key(c))); if (c) taken.add(key(c)); return c }
  const entitySpawns = []

  // a tale's things lie in the room of its role (a one-room house: anywhere)
  if (spec.story?.pickups?.length) {
    const roomId = [...roles].find(([, r]) => r === spec.story.role)?.[0] ?? plan.entry
    const pool = [...shuffle(rng, free.filter(c => map[c.y][c.x].roomId === roomId)), ...shuffle(rng, free.filter(c => map[c.y][c.x].roomId !== roomId))]
    for (const contents of spec.story.pickups) { const c = take(pool); if (c) entitySpawns.push({ kind: 'floating_pickup', x: c.x, y: c.y, contents }) }
  }
  const far = shuffle(rng, free.filter(c => Math.abs(c.x - plan.spawn.x) + Math.abs(c.y - plan.spawn.y) > DOOR_CLEARANCE))
  for (const s of occupants(spec, rng)) {
    const c = take(far)
    if (c) entitySpawns.push({ ...s, x: c.x, y: c.y, ...(s.role === 'glassmaker' && solved ? { lines: GLASSMAKER.solved } : {}) })
  }
  const anywhere = [...far, ...shuffle(rng, free)]
  for (const contents of loot(spec, rng)) { const c = take(anywhere); if (c) entitySpawns.push({ kind: 'floating_pickup', x: c.x, y: c.y, contents }) }

  return {
    map, entitySpawns, playerSpawn: { ...plan.spawn }, exit: { ...plan.exit },
    theme: (VERSIONS[spec.version] ?? VERSIONS.home).theme, version: spec.version, plan, roles, reward,
  }
}
