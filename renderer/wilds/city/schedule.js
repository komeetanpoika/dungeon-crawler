// Kalevanlinna's day: where every person is, and what they are doing, at each
// moment of the 360 s day (pure; no walking and no routing, Task 11 does that).
//
//   scheduleFor(person, city, seed, day) -> Entry[]
//   Entry = { at, where, act }   at: 0..1 of the day, sorted, the first is 0
//   where = { door: label }      inside that building
//         | { spot: id }         standing about that spot
//         | { patrol: id }       walking that PLAN.patrols route (watch only)
//
// An entry is in force from its `at` until the next one. For anyone who walks
// somewhere, `at` is when they set out: they should be there soon after. That
// is also how the watch changes shift: at dusk the night relief leaves the
// barracks 0.05 early and the day shift leaves its post 0.02 late; at dawn the
// day relief leaves 0.04 early and the night shift 0.02 late, so a post is
// never empty. A person's day starts and ends at home (the night watch
// starts on duty and goes on from the last night's route), so nobody jumps
// when the clock wraps and the day counter goes up.
//
// Activities: home, work, stall, shop, unload, nets, inn, church, play, bench,
// beg, cry, lamps, ring, post, patrol, barracks, wander-square. `shop` is a
// keeper at a shop door or anyone buying at a stall or the fish market;
// `wander-square` idles about a spot with no errand; `work` is anything else
// done at a workplace, the school (children, in the church) and the Captain's
// rounds of the posts.
//
// Choices come from hash(seed, personIndex, day, salt), so a day is the same
// every time it is asked for, and the next day differs: the lunch place, the
// errand, who goes to the bell, the evening at the inn. Every entry but the
// first gets a jitter of +-0.01 and entries are at least 0.03 apart.
import { hash } from '../rand.js'
import { PLAN } from './plan.js'

export const DAY = { dawn: 0.20, morning: 0.28, noon: 0.45, afternoon: 0.52, bell: 0.60, dusk: 0.72, night: 0.82 }
export const ACTS = ['home', 'work', 'stall', 'shop', 'unload', 'nets', 'inn', 'church', 'play', 'bench', 'beg', 'cry', 'lamps', 'ring', 'post', 'patrol', 'barracks', 'wander-square']

const MIN_GAP = 0.03
const BELL_LEN = 0.05

const ctxCache = new WeakMap()
function ctxOf(city) {
  let c = ctxCache.get(city)
  if (c) return c
  const spotIds = Object.keys(city.spots)
  const doorOfKind = k => city.doors.find(d => d.kind === k)?.label ?? null
  const benches = spotIds.filter(k => /^bench-\d+$/.test(k)).sort()
  const stalls = spotIds.filter(k => /^stall-\d+$/.test(k)).sort((a, b) => a.slice(6) - b.slice(6))
  c = {
    spots: new Set(spotIds),
    kindOf: new Map(city.doors.map(d => [d.label, d.kind])),
    inn: doorOfKind('inn'), church: doorOfKind('church'), barracks: doorOfKind('barracks'),
    benches, stalls, quays: spotIds.filter(k => /^quay-\d+$/.test(k)).sort(),
    errands: [...stalls, 'fish-market', 'fountain', ...benches].filter(k => city.spots[k]),
    play: ['fountain', ...benches].filter(k => k === 'fountain' ? city.spots.fountain : true),
  }
  ctxCache.set(city, c)
  return c
}

function indexOf(p) {
  const [kind, rest] = p.id.split(':')
  if (kind === 'tf') return Number(rest)
  if (kind === 'watch') return 1000 + Number(rest)
  let h = 2000
  for (const ch of rest) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const same = (a, b) => a.act === b.act && JSON.stringify(a.where) === JSON.stringify(b.where)

// raw: [at, where, act][]  ->  sorted, jittered, spaced, deduplicated Entry[]
function finish(raw, seed, key, day) {
  const jit = raw.map(([at, where, act], i) => ({ at: i === 0 ? 0 : at + (hash(seed, key, day, 200 + i) - 0.5) * 0.02, where, act }))
  jit.sort((a, b) => a.at - b.at)
  jit[0].at = 0
  const out = []
  for (const e of jit) {
    const last = out[out.length - 1]
    if (last && same(e, last)) continue
    if (last && e.at - last.at < MIN_GAP) e.at = last.at + MIN_GAP
    if (e.at >= 0.999) continue
    out.push(e)
  }
  return out
}

function watchDay(p, ctx, seed, day) {
  const barracks = { door: p.home }
  const patrolIx = p.patrol ? PLAN.patrols.findIndex(r => r.id === p.patrol) : -1
  const key = p.patrol ? 5000 + (p.shift === 'day' ? 0 : 1) : indexOf(p) // a pair shares its jitter
  const raw = []
  const route = i => ({ patrol: PLAN.patrols[(patrolIx + i) % PLAN.patrols.length].id })
  const n = PLAN.patrols.length
  if (p.shift === 'day') {
    const out = DAY.dawn - 0.04, back = DAY.dusk + 0.02
    raw.push([0, barracks, 'barracks'])
    if (p.post) raw.push([out, { spot: p.post }, 'post'])
    else for (let i = 0; i < n; i++) raw.push([out + (back - out) * i / n, route(i), 'patrol'])
    raw.push([back, barracks, 'barracks'])
  } else {
    // on duty from the relief at dusk-0.05 until dawn+0.02 of the next day, so at 0 the shift is still out
    const out = DAY.dusk - 0.05, back = DAY.dawn + 0.02
    if (p.post) raw.push([0, { spot: p.post }, 'post'], [out, { spot: p.post }, 'post'])
    else {
      const len = 1 + back - out // the stretch on duty, through midnight
      for (let i = 0; i < n; i++) {
        const s = out + len * i / n, e = out + len * (i + 1) / n
        if (s < 1 && e > 1) raw.push([s, route(i), 'patrol'], [0, route(i), 'patrol'])
        else raw.push([s >= 1 ? s - 1 : s, route(i), 'patrol'])
      }
    }
    raw.push([back, barracks, 'barracks'])
  }
  return finish(raw.sort((a, b) => a[0] - b[0]), seed, key, day)
}

export function scheduleFor(person, city, seed, day) {
  const ctx = ctxOf(city)
  const p = person
  if (p.job === 'watch') return watchDay(p, ctx, seed, day)
  const idx = indexOf(p)
  const H = salt => hash(seed, idx, day, salt)
  const pick = (arr, salt) => arr[Math.floor(H(salt) * arr.length)]
  const place = ref => ref == null ? null : ctx.spots.has(ref) ? { spot: ref } : { door: ref }
  const home = { door: p.home }
  const inn = { door: ctx.inn }
  const churchDoor = { door: ctx.church }
  const steps = { spot: 'church-steps' }
  const spotAct = id => /^stall-/.test(id) ? 'shop' : id === 'fountain' ? 'wander-square' : /^bench-/.test(id) ? 'bench' : 'shop'
  const E = [[0, home, 'home']]
  const startOff = hash(seed, idx, 0, 71) * 0.03 // a stable early or late riser
  const eveningTail = innP => {
    E.push([DAY.dusk, home, 'home'])
    if (H(40) < innP) E.push([0.78, inn, 'inn'], [0.93 + H(41) * 0.04, home, 'home'])
  }
  // the bell: who goes, and of the adults who go most step inside (the church
  // is open by day); elders keep the steps, and the beggars and the crier,
  // who go straight to the steps, never come here
  const bell = (back, o = {}) => {
    const goes = o.always || H(30) < (o.p ?? 0.6)
    if (goes) E.push([DAY.bell, o.inside ? churchDoor : (!o.noInside && p.age === 'adult' && H(31) < 0.7) ? churchDoor : steps, 'church'])
    E.push([DAY.bell + BELL_LEN, back.where, back.act])
  }
  const errandSpot = (avoid, salt) => {
    const list = ctx.errands.filter(s => s !== avoid)
    return pick(list, salt)
  }

  if (p.age === 'child') {
    const L = ctx.play
    const a = Math.floor(H(1) * L.length), b = (a + 1 + Math.floor(H(2) * (L.length - 1))) % L.length, c = (b + 1 + Math.floor(H(3) * (L.length - 1))) % L.length
    const even = day % 2 === 0
    if (even) E.push([DAY.morning, churchDoor, 'work'], [0.40, { spot: L[a] }, 'play'])
    else E.push([DAY.morning - 0.01, { spot: L[a] }, 'play'], [0.38, { spot: L[b] }, 'play'])
    E.push([DAY.noon, home, 'home'], [DAY.afternoon + 0.01, { spot: L[c] }, 'play'])
    if (H(30) < 0.3) E.push([DAY.bell, steps, 'church'], [DAY.bell + BELL_LEN, { spot: L[a] }, 'play'])
    E.push([0.67, { spot: L[b] }, 'play'], [DAY.dusk, home, 'home'])
    return finish(E, seed, idx, day)
  }

  if (p.job === 'elder' || (p.age === 'elder' && !p.work)) {
    const B = ctx.benches
    const a = Math.floor(H(1) * B.length), b = (a + 1 + Math.floor(H(2) * (B.length - 1))) % B.length
    E.push([DAY.morning - 0.01 + H(5) * 0.03, { spot: B[a] }, 'bench'])
    if (H(6) < 0.5) E.push([0.38, { spot: 'fountain' }, 'wander-square'])
    E.push([DAY.noon, home, 'home'], [DAY.afternoon, { spot: B[b] }, 'bench'], [DAY.bell, steps, 'church'], [DAY.bell + BELL_LEN, { spot: B[a] }, 'bench'], [0.69, home, 'home'])
    return finish(E, seed, idx, day)
  }

  if (p.job === 'beggar') {
    const W = place(p.work)
    const other = pick(ctx.errands.filter(s => s !== p.work && /^bench-|fountain/.test(s)), 8)
    const benchA = pick(ctx.benches.filter(s => s !== p.work && s !== other), 9)
    E.push([DAY.dawn + 0.03 + startOff, W, 'beg'], [0.38, { spot: benchA }, 'bench'], [0.50, { spot: other }, 'beg'])
    if (p.age === 'elder' || H(30) < 0.6) E.push([DAY.bell, steps, 'church'], [DAY.bell + BELL_LEN, W, 'beg'])
    else E.push([DAY.bell, W, 'beg'])
    E.push([0.67, W, 'beg'], [DAY.dusk, home, 'home'])
    return finish(E, seed, idx, day)
  }

  if (p.job === 'server') {
    E.push([0.25 + startOff, { door: ctx.inn }, 'work'], [0.34, { spot: errandSpot(null, 20) }, 'shop'], [0.40, { door: ctx.inn }, 'work'])
    if (H(30) < 0.5) E.push([DAY.bell, steps, 'church'])
    E.push([DAY.bell + BELL_LEN, { door: ctx.inn }, 'work'], [0.95 + H(41) * 0.02, home, 'home'])
    return finish(E, seed, idx, day)
  }

  if (p.job === 'lamplighter') {
    E.push([DAY.dawn - 0.01, { spot: 'fountain' }, 'lamps'], [0.27, { spot: pick(ctx.benches, 1) }, 'bench'], [DAY.noon, inn, 'inn'], [0.53, { spot: pick(ctx.benches, 2) }, 'bench'])
    E.push([DAY.bell, steps, 'church'], [DAY.bell + BELL_LEN, home, 'home'], [DAY.dusk - 0.02, { spot: 'fountain' }, 'lamps'], [0.80, inn, 'inn'], [0.94, home, 'home'])
    return finish(E, seed, idx, day)
  }

  if (p.job === 'crier') {
    const cry = { spot: 'crier' }
    E.push([0.24 + startOff, cry, 'cry'], [0.32, { spot: 'fountain' }, 'wander-square'], [0.38, cry, 'cry'], [DAY.noon, inn, 'inn'], [0.52, cry, 'cry'], [DAY.bell, steps, 'church'], [DAY.bell + BELL_LEN, cry, 'cry'], [0.69, home, 'home'])
    return finish(E, seed, idx, day)
  }

  // the worker template: home, work, an errand, lunch, the bell, work, home, an evening
  const W = place(p.work)
  const outdoor = !!W.spot
  const kind = ctx.kindOf.get(p.work)
  const wAct = outdoor ? (/^stall-/.test(p.work) ? 'stall' : p.job === 'net-mender' || p.job === 'fisher' ? 'nets' : 'work') : kind === 'shop' ? 'shop' : 'work'
  const startAct = p.job === 'fisher' || p.job === 'sailor' ? 'unload' : wAct
  const jobEvening = { fisher: 0.6, sailor: 0.6, 'net-mender': 0.35, washer: 0.15 }
  const sameHome = p.home === p.work
  const churchAlways = p.age === 'elder' || p.job === 'stallholder' || p.job === 'vicar' || p.job === 'count' || sameHome
  const indoorBell = p.job === 'organist'
  // the errand: a fisher sells at the market, a porter works the quay, the smithy's people at the anvil, the Captain rounds a post
  let errand
  if (p.job === 'stallholder') errand = null
  else if (p.job === 'smith' || p.job === 'apprentice') errand = { where: { spot: 'smithy-anvil' }, act: 'work' }
  else if (p.job === 'captain') errand = { where: { spot: pick(PLAN.posts.map(q => q.id), 21) }, act: 'work' }
  else if (p.job === 'porter' && H(22) < 0.6) errand = { where: { spot: pick(ctx.quays, 23) }, act: 'unload' }
  else if (p.job === 'fisher' && H(22) < 0.7 && p.work !== 'fish-market') errand = { where: { spot: 'fish-market' }, act: 'work' }
  else { const s = errandSpot(p.work, 20); errand = { where: { spot: s }, act: spotAct(s) } }
  const lunchInnP = p.job === 'fisher' || p.job === 'sailor' ? 0.55 : 0.33
  E.push([DAY.dawn + 0.01 + startOff, W, startAct])
  if (errand) E.push([0.34, errand.where, errand.act], [0.40, W, wAct])
  else E.push([0.40, W, wAct])
  const awayLunch = outdoor || p.job === 'stallholder'
  if (H(10) < lunchInnP) E.push([DAY.noon, inn, 'inn'], [DAY.afternoon + 0.01, W, wAct])
  else if (awayLunch) E.push([DAY.noon, home, 'home'], [DAY.afternoon + 0.01, W, wAct])
  if (p.job !== 'bell-ringer') bell({ where: W, act: wAct }, { always: churchAlways, inside: indoorBell, p: 0.6, noInside: p.age === 'elder' })
  if (p.job === 'bell-ringer') E.push([0.575, churchDoor, 'ring'], [0.64, W, wAct])
  E.push([0.67, W, wAct])
  eveningTail(jobEvening[p.job] ?? 0.2)
  return finish(E, seed, idx, day)
}

// the index of the entry in force at `frac` of the day
export function entryAt(schedule, frac) {
  let f = frac % 1
  if (f < 0) f += 1
  let lo = 0, hi = schedule.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (schedule[mid].at <= f) lo = mid; else hi = mid - 1
  }
  return lo
}
