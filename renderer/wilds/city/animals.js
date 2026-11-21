// Kalevanlinna's animals: six dogs and six cats who keep near their home
// doors, and hens and goats in a few back yards. Pure in the city (and so in
// the seed); the runtime (runtime.js) owns them like the people, near as npc
// entities wandering round their home (the species' roam), far standing put.
//
//   Animal = { id, species, look, home: city tile, X, Y (world tiles),
//              mode: 'near'|'far', entity, animal: true }
import { hash } from '../rand.js'
import { ANIMAL_LOOKS } from '../../data/townsfolk-looks.js'
import { CITY } from './geometry.js'

const N = CITY.size
const OX = CITY.wx0 * 80, OY = CITY.wy0 * 80
const PETS = 6
const YARD_FLOCKS = [['city_chicken', 3, 'hen'], ['city_chicken', 3, 'hen'], ['city_goat', 2, 'goat']]

function shuffled(arr, seed, salt) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(hash(seed, i, 1, salt) * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export function makeAnimals(cc) {
  const { city, seed, G } = cc
  const walk = (x, y) => x >= 0 && y >= 0 && x < N && y < N && G.walk[y * N + x] === 1 && !cc.doorCells.has(y * N + x)
  const out = []
  const add = (id, species, look, home, at = home) => out.push({ id, species, look, home, X: at.x + OX, Y: at.y + OY, mode: 'far', entity: null, animal: true })
  // the pets: each at a home door of its own, by the step before it
  const homes = shuffled(city.doors.filter(d => d.kind === 'home').map(d => d.label), seed, 81)
  for (let i = 0; i < PETS * 2; i++) {
    const kind = i < PETS ? 'dog' : 'cat', n = i % PETS
    const looks = ANIMAL_LOOKS[kind]
    add(`${kind}:${n}`, kind, looks[Math.floor(hash(seed, i, 2, 82) * looks.length)].id, cc.front(homes[i]))
  }
  // the yards: the roomier ones, a flock in each, on cells of their own
  const yards = shuffled((city.yards ?? []).filter(r => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) >= 12), seed, 83)
  let f = 0
  for (const r of yards) {
    if (f >= YARD_FLOCKS.length) break
    const cells = []
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (walk(x, y)) cells.push({ x, y })
    const [species, count, tag] = YARD_FLOCKS[f]
    if (cells.length < count + 2) continue
    const pick = shuffled(cells, seed, 84 + f)
    const home = pick[0]
    for (let k = 0; k < count; k++) add(`${tag}:${f * 4 + k}`, species, null, home, pick[k + 1])
    f++
  }
  return out
}
