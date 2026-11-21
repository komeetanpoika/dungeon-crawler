// Kalevanlinna's people, rolled per world from the city seed (pure; same seed,
// same people). Person = { id, name, age, look, job, home, work, temperament,
// post, patrol, shift }, `look` a LOOKS id, `home` a door label, `work` a door
// label (indoor jobs), a spot id (outdoor jobs) or null; post/patrol/shift
// are for the watch only (null elsewhere).
//
// Households: 1-3 people per `home` door, a lead (an adult, or an elder when
// the adults run out) with the children first. A household takes the free
// home door nearest its lead's workplace out of twelve drawn at random.
// Keepers: every shop door gets its keeper, who lives in a home door elsewhere
// (never in the shop itself); the workshops nearest the fountain take the
// people left over. The named characters live where NAMED says; those without
// a `home` take a home door like anyone.
import { hash, hashInt } from '../rand.js'
import { LOOKS, NAMED_LOOKS, WATCH_LOOKS } from '../../data/townsfolk-looks.js'
import { PLAN } from './plan.js'

export const NAMED = [
  { id: 'seppo', name: 'Seppo', job: 'smith', home: 'smithy', work: 'smithy' },
  { id: 'vaino', name: 'Väinö', job: 'organist', work: 'church' },
  { id: 'pohjanen', name: 'Granny Pohjanen', job: 'herring', work: 'fish-market' },
  { id: 'vicar', name: 'Vicar Eero', job: 'vicar', work: 'church' },
  { id: 'crier', name: 'Heikki', job: 'crier', work: 'crier' },
  { id: 'innkeeper', name: 'Taavetti', job: 'innkeeper', home: 'inn', work: 'inn' },
  { id: 'captain', name: 'Captain Tuomas', job: 'captain', work: 'barracks' },
  { id: 'count', name: 'Count Ahnas', job: 'count', home: 'castle', work: 'castle' },
]

export const JOBS = ['stallholder', 'baker', 'butcher', 'fisher', 'net-mender', 'sailor', 'porter', 'apprentice', 'weaver', 'dyer', 'tanner', 'miller', 'carter', 'washer', 'lamplighter', 'bell-ringer', 'server', 'beggar', 'child', 'elder']

const TEMPERAMENTS = ['cheerful', 'gruff', 'shy', 'chatty']
const NAMES_F = ['Aino', 'Helmi', 'Kaisa', 'Liisa', 'Maija', 'Sofia', 'Anni', 'Elsa', 'Hilda', 'Tyyne', 'Aili', 'Impi', 'Saara', 'Venla', 'Lyyli', 'Selma', 'Reeta', 'Ilona', 'Siiri', 'Tilda', 'Elina', 'Mirjam', 'Katri', 'Vappu']
const NAMES_M = ['Eino', 'Juho', 'Matti', 'Kaarlo', 'Antti', 'Aatu', 'Veikko', 'Toivo', 'Lauri', 'Otto', 'Pekka', 'Urho', 'Yrjö', 'Eemeli', 'Onni', 'Jaakko', 'Risto', 'Tapio', 'Niilo', 'Oskari', 'Ukko', 'Paavo', 'Kalle', 'Tuukka']
const WATCH_NAMES = ['Aarne', 'Heikki', 'Ilmari', 'Jussi', 'Kustaa', 'Leevi', 'Mauno', 'Nestori', 'Osmo', 'Pentti', 'Reino', 'Sakari', 'Taneli', 'Unto', 'Verner', 'Ahti', 'Esko', 'Henrik', 'Jooseppi', 'Kosti']
const CARRY = { fisher: 'fish', 'net-mender': 'fish', baker: 'bread', porter: 'bucket', washer: 'bucket', stallholder: 'basket', butcher: 'bucket' }

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
function shuffled(arr, seed, salt) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(hash(seed, i, 0, salt) * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function pickLook(seed, n, age, job) {
  const pool = LOOKS.filter(l => l.age === age)
  const want = CARRY[job]
  const pref = want ? pool.filter(l => l.carry === want) : []
  const from = pref.length && hash(seed, n, 1, 51) < 0.6 ? pref : pool
  return from[Math.floor(hash(seed, n, 2, 51) * from.length)]
}
function nameFor(seed, n, sex) {
  const l = sex === 'f' ? NAMES_F : NAMES_M
  return l[Math.floor(hash(seed, n, 3, 51) * l.length)]
}

// the door or spot a NAMED entry's `home`/`work` means
function resolvePlace(city, ref) {
  if (city.spots[ref]) return ref
  return city.doors.find(d => d.kind === ref)?.label ?? null
}

export function rollTownsfolk(seed, city) {
  const doorOf = Object.fromEntries(city.doors.map(d => [d.label, d]))
  const fountain = city.spots.fountain
  const posOf = ref => ref ? (doorOf[ref] ?? city.spots[ref] ?? null) : null
  const byFountain = list => list.slice().sort((a, b) => dist(a, fountain) - dist(b, fountain) || a.x - b.x || a.y - b.y)
  const homes = shuffled(city.doors.filter(d => d.kind === 'home'), seed, 60).map(d => d.label)
  const shops = byFountain(city.doors.filter(d => d.kind === 'shop')).map(d => d.label)
  const workshops = byFountain(city.doors.filter(d => d.kind === 'workshop')).map(d => d.label)
  const warehouses = city.doors.filter(d => d.kind === 'warehouse').map(d => d.label)
  const stalls = Object.keys(city.spots).filter(k => /^stall-\d+$/.test(k)).sort((a, b) => a.slice(6) - b.slice(6))
  const quays = Object.keys(city.spots).filter(k => /^quay-\d+$/.test(k)).sort()
  const benches = Object.keys(city.spots).filter(k => /^bench-\d+$/.test(k)).sort()
  const doorKind = k => city.doors.find(d => d.kind === k)?.label ?? null

  // the rolled 112: [job, age, work] first, then names, looks and homes
  const slots = []
  const add = (job, age, work) => slots.push({ job, age, work })
  const SHOP_JOBS = ['baker', 'butcher', 'weaver']
  shops.forEach((w, i) => add(SHOP_JOBS[i % 3], 'adult', w))
  stalls.slice(0, 10).forEach(w => add('stallholder', 'adult', w))
  for (let i = 0; i < 8; i++) add('fisher', 'adult', quays[i % quays.length])
  for (let i = 0; i < 4; i++) add('net-mender', i % 2 ? 'elder' : 'adult', quays[(i + 1) % quays.length])
  for (let i = 0; i < 4; i++) add('sailor', 'adult', quays[i % quays.length])
  for (let i = 0; i < 4; i++) add('porter', 'adult', warehouses[i % warehouses.length])
  for (let i = 0; i < 3; i++) add('washer', 'adult', quays[(i + 2) % quays.length])
  for (let i = 0; i < 3; i++) add('server', 'adult', doorKind('inn'))
  add('lamplighter', 'adult', 'fountain')
  add('bell-ringer', 'adult', doorKind('church'))
  add('apprentice', 'adult', doorKind('smithy'))
  for (let i = 0; i < 3; i++) add('beggar', i === 2 ? 'elder' : 'adult', ['church-steps', benches[0], benches[1]][i] ?? 'church-steps')
  const WS_JOBS = ['dyer', 'tanner', 'miller', 'carter', 'weaver']
  const room = 112 - slots.length
  const nElder = 14, nChild = 14
  const nShopFill = Math.max(0, room - nElder - nChild)
  workshops.slice(0, nShopFill).forEach((w, i) => add(WS_JOBS[i % WS_JOBS.length], 'adult', w))
  while (slots.length < 112 - nElder - nChild) add('carter', 'adult', null)
  for (let i = 0; i < nChild; i++) add('child', 'child', null)
  while (slots.length < 112) add('elder', 'elder', null)

  const rolled = slots.map((s, n) => {
    const look = pickLook(seed, n, s.age, s.job)
    const person = {
      id: `tf:${n}`, name: nameFor(seed, n, look.sex), age: s.age, look: look.id, job: s.job, home: null, work: s.work,
      temperament: TEMPERAMENTS[hashInt(seed, n, 0, 52) % 4], post: null, patrol: null, shift: null,
    }
    return person
  })

  // households
  const used = new Set()
  const named = NAMED.map(e => {
    const look = NAMED_LOOKS[e.id]
    const p = {
      id: `named:${e.id}`, name: e.name, age: look.age, look: look.id, job: e.job, home: null,
      work: resolvePlace(city, e.work), temperament: TEMPERAMENTS[hashInt(seed, e.id.length, e.id.charCodeAt(0), 53) % 4],
      post: null, patrol: null, shift: null,
    }
    if (e.home) { p.home = resolvePlace(city, e.home); used.add(p.home) }
    return p
  })
  const freeHome = near => {
    const cand = []
    for (const h of homes) { if (!used.has(h)) cand.push(h); if (cand.length >= 12) break }
    if (!cand.length) return null
    const target = near ?? fountain
    return cand.reduce((best, h) => dist(doorOf[h], target) < dist(doorOf[best], target) ? h : best)
  }
  for (const p of named) if (!p.home) {
    const h = freeHome(posOf(p.work)); p.home = h; used.add(h)
  }
  const pool = {
    adult: rolled.filter(p => p.age === 'adult'), child: rolled.filter(p => p.age === 'child'), elder: rolled.filter(p => p.age === 'elder'),
  }
  let hh = 0
  while (pool.adult.length + pool.child.length + pool.elder.length) {
    const size = [1, 2, 2, 3, 3][Math.floor(hash(seed, hh++, 0, 54) * 5)]
    const lead = pool.adult.shift() ?? pool.elder.shift() ?? pool.child.shift()
    const members = [lead]
    while (members.length < size) {
      const m = pool.child.shift() ?? pool.elder.shift() ?? pool.adult.shift()
      if (!m) break
      members.push(m)
    }
    const home = freeHome(posOf(lead.work)); if (!home) throw new Error('out of home doors')
    used.add(home)
    for (const m of members) m.home = home
  }
  return [...rolled, ...named]
}

// the shifts: day 12 (the ten posts and a patrol pair), night 8 (the six land
// gate posts and a pair). `patrol` is the route a pair starts on; the pair
// takes the four PLAN.patrols routes in turn from there (the schedule's work).
export function rollWatch(seed, city) {
  const barracks = city.doors.find(d => d.kind === 'barracks')?.label ?? null
  const land = PLAN.posts.filter(p => /^gate-[NWE]-/.test(p.id)).map(p => p.id)
  const day = PLAN.posts.map(p => p.id)
  const out = []
  const mk = (shift, post, patrol) => {
    const n = out.length
    const look = WATCH_LOOKS[n % WATCH_LOOKS.length]
    out.push({
      id: `watch:${n}`, name: WATCH_NAMES[(n + Math.floor(hash(seed, 0, 0, 55) * 20)) % 20], age: 'adult', look: look.id, job: 'watch',
      home: barracks, work: null, temperament: n % 3 === 0 ? 'chatty' : 'gruff', post, patrol, shift,
    })
  }
  for (const id of day) mk('day', id, null)
  mk('day', null, PLAN.patrols[0].id); mk('day', null, PLAN.patrols[0].id)
  for (const id of land) mk('night', id, null)
  mk('night', null, PLAN.patrols[2].id); mk('night', null, PLAN.patrols[2].id)
  return out
}
