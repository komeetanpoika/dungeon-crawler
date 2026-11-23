import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cityFor } from '../renderer/wilds/city/build.js'
import { rollTownsfolk, rollWatch } from '../renderer/wilds/city/folk.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { DAY, ACTS, scheduleFor, entryAt } from '../renderer/wilds/city/schedule.js'

const SEEDS = [1, 7, 4242]
const DAYS = [0, 1, 2, 5]
const worlds = SEEDS.map(seed => {
  const city = cityFor(seed)
  return { seed, city, folk: [...rollTownsfolk(seed, city), ...rollWatch(seed, city)] }
})
const key = w => w.door ? `d:${w.door}` : w.spot ? `s:${w.spot}` : `p:${w.patrol}`
const sig = s => JSON.stringify(s.map(e => [e.where, e.act]))
const EPS = 1e-9

test('DAY matches the weather clock', () => {
  assert.deepEqual(DAY, { dawn: 0.20, morning: 0.28, noon: 0.45, afternoon: 0.52, bell: 0.60, dusk: 0.72, night: 0.82 })
})

test('every schedule covers the whole day and starts at home', () => {
  for (const { seed, city, folk } of worlds) {
    const doors = new Set(city.doors.map(d => d.label))
    for (const day of DAYS) for (const p of folk) {
      const s = scheduleFor(p, city, seed, day)
      assert.deepEqual(s, scheduleFor(p, city, seed, day), 'pure')
      assert.equal(s[0].at, 0, p.id)
      // the night watch starts the day on duty (their relief came at dusk); everyone else at home
      if (p.job === 'watch' && p.shift === 'night') assert.ok(s[0].act === 'post' || s[0].act === 'patrol', p.id)
      else { assert.equal(s[0].act, p.job === 'watch' ? 'barracks' : 'home', p.id); assert.equal(s[0].where.door, p.home) }
      for (let i = 0; i < s.length; i++) {
        const e = s[i]
        assert.ok(ACTS.includes(e.act), `${p.id} ${e.act}`)
        assert.ok(e.at >= 0 && e.at < 1)
        if (e.where.door) assert.ok(doors.has(e.where.door), `${p.id} door`)
        else if (e.where.spot) assert.ok(city.spots[e.where.spot], `${p.id} spot ${e.where.spot}`)
        else assert.ok(PLAN.patrols.some(r => r.id === e.where.patrol), `${p.id} patrol`)
        if (i) {
          assert.ok(e.at > s[i - 1].at, 'sorted')
          assert.ok(e.at - s[i - 1].at >= 0.03 - EPS, `${p.id} gap ${e.at - s[i - 1].at}`)
          assert.ok(key(e.where) !== key(s[i - 1].where) || e.act !== s[i - 1].act, 'consecutive entries differ')
        }
      }
      assert.equal(entryAt(s, 0), 0)
      assert.equal(entryAt(s, 0.9999), s.length - 1)
      assert.equal(entryAt(s, 1.0), 0)
      for (let i = 0; i < s.length; i++) assert.equal(entryAt(s, s[i].at), i)
      // the end of the day meets the start of the next at the same place
      if (p.job !== 'watch') assert.equal(s[s.length - 1].act, 'home', p.id)
    }
  }
})

test('everyone has at least three different places in a day, and no one stays put outdoors all day', () => {
  for (const { seed, city, folk } of worlds) for (const day of DAYS) for (const p of folk) {
    if (p.job === 'watch') continue // a post is a post by design
    if (p.job === 'count') continue // the Count keeps to his keep but for the church, by design (below)
    const s = scheduleFor(p, city, seed, day)
    const time = new Map()
    s.forEach((e, i) => time.set(key(e.where), (time.get(key(e.where)) ?? 0) + ((s[i + 1]?.at ?? 1) - e.at)))
    assert.ok(time.size >= 3, `${p.id} (${p.job}) has ${time.size} places`)
    for (const [k, t] of time) {
      if (!k.startsWith('s:')) continue
      if (p.job === 'stallholder') continue // a stall is stood at by design; they still go to the inn or the church
      assert.ok(t <= 0.4, `${p.id} (${p.job}) spends ${t.toFixed(3)} at ${k}`)
    }
    if (p.job === 'stallholder') assert.ok(s.some(e => e.act === 'inn' || e.act === 'church'), p.id)
  }
})

test('stalls open at dawn and close at dusk, the lamplighter starts at dusk', () => {
  for (const { seed, city, folk } of worlds) for (const day of DAYS) {
    const holders = folk.filter(p => p.job === 'stallholder')
    const actsAt = f => holders.map(p => { const s = scheduleFor(p, city, seed, day); return s[entryAt(s, f)].act })
    assert.ok(actsAt(DAY.dawn - 0.04).every(a => a === 'home'))
    assert.ok(actsAt(DAY.dawn + 0.06).every(a => a === 'stall'))
    assert.ok(actsAt(DAY.dusk + 0.03).every(a => a === 'home' || a === 'inn'))
    const lamp = folk.find(p => p.job === 'lamplighter')
    const s = scheduleFor(lamp, city, seed, day)
    assert.equal(s[entryAt(s, DAY.dusk + 0.02)].act, 'lamps')
  }
})

test('the bell fills the church door and the square empties toward it', () => {
  for (const { seed, city, folk } of worlds) for (const day of DAYS) {
    const at = DAY.bell + 0.02
    const atChurch = p => { const s = scheduleFor(p, city, seed, day); const w = s[entryAt(s, at)].where; return w.spot === 'church-steps' || w.door === city.doors.find(d => d.kind === 'church').label }
    const adults = folk.filter(p => p.age === 'adult' && p.job !== 'watch')
    const elders = folk.filter(p => p.age === 'elder')
    assert.ok(adults.filter(atChurch).length >= adults.length * 0.25, `adults at the bell, day ${day}`)
    assert.ok(elders.every(atChurch), 'every elder')
    // and ten minutes before, the church steps are bare of them
    const before = DAY.bell - 0.04
    const n = folk.filter(p => { const s = scheduleFor(p, city, seed, day); return s[entryAt(s, before)].where.spot === 'church-steps' }).length
    assert.ok(n < 5, `${n} on the steps before the bell`)
    // and it is over by the time the afternoon is half gone
    assert.ok(folk.filter(p => { const s = scheduleFor(p, city, seed, day); return s[entryAt(s, DAY.bell + 0.09)].where.spot === 'church-steps' }).length < 5)
  }
})

// The church is open by day, so most of the bell crowd goes in; elders,
// beggars and the crier keep the steps (Väinö plays the organ inside).
test('at the bell most churchgoers go inside; elders, beggars and the crier keep the steps', () => {
  let inside = 0, going = 0
  for (const seed of [1, 2, 3, 4, 5]) {
    const city = cityFor(seed)
    const door = city.doors.find(d => d.kind === 'church').label
    const folk = rollTownsfolk(seed, city)
    for (const day of [0, 1, 2]) for (const p of folk) {
      const bell = scheduleFor(p, city, seed, day).find(e => e.act === 'church')
      if (!bell) continue
      if (p.age === 'elder' || p.job === 'beggar' || p.job === 'crier') {
        if (p.job !== 'organist') assert.equal(bell.where.spot, 'church-steps', `${p.id} (${p.job}, ${p.age}) on the steps`)
        continue
      }
      if (p.age !== 'adult') continue
      going++
      if (bell.where.door === door) inside++
    }
  }
  const share = inside / going
  assert.ok(share >= 0.55 && share <= 0.85, `${inside}/${going} = ${share.toFixed(2)} of the adults at the bell go in`)
})

// The Count keeps to the keep by day, so his chair in the great hall is not
// empty (interior/buildings/castle.js): no errand, no lunch at the inn, no
// evening out; the bell takes him into the church and home after.
test('the Count is only ever at the castle or in the church', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const city = cityFor(seed)
    const castle = city.doors.find(d => d.kind === 'castle').label, church = city.doors.find(d => d.kind === 'church').label
    const count = rollTownsfolk(seed, city).find(p => p.job === 'count')
    assert.ok(count, `seed ${seed} has a Count`)
    for (const day of [0, 1, 2]) {
      const s = scheduleFor(count, city, seed, day)
      for (const e of s) {
        const ok = (e.where.door === castle && (e.act === 'home' || e.act === 'work')) || (e.where.door === church && e.act === 'church')
        assert.ok(ok, `seed ${seed} day ${day}: the Count ${e.act} at ${JSON.stringify(e.where)} at ${e.at.toFixed(3)}`)
      }
      // at the castle from dawn, at church through the service, home after it
      const at = f => s[entryAt(s, f)]
      assert.equal(at(DAY.dawn + 0.05).where.door, castle)
      assert.equal(at(DAY.noon).where.door, castle)
      assert.equal(at(DAY.bell + 0.03).where.door, church)
      assert.equal(at(DAY.dusk + 0.02).where.door, castle)
      assert.equal(at(DAY.night + 0.05).where.door, castle)
    }
  }
})

test('lunch at the inn: about a third of workers round noon; children play and go to school in the church on even days', () => {
  const { seed, city, folk } = worlds[1]
  const innDoor = city.doors.find(d => d.kind === 'inn').label
  const churchDoor = city.doors.find(d => d.kind === 'church').label
  const workers = folk.filter(p => p.age === 'adult' && p.job !== 'watch' && p.job !== 'child')
  const inn = workers.filter(p => { const s = scheduleFor(p, city, seed, 1); return s[entryAt(s, DAY.noon + 0.03)].where.door === innDoor }).length
  assert.ok(inn >= workers.length * 0.2 && inn <= workers.length * 0.55, `${inn}/${workers.length}`)
  const kids = folk.filter(p => p.age === 'child')
  const at = (day, f) => kids.map(p => { const s = scheduleFor(p, city, seed, day); return s[entryAt(s, f)] })
  assert.ok(at(0, 0.34).every(e => e.where.door === churchDoor), 'school on even days')
  assert.ok(at(1, 0.34).every(e => e.act === 'play' && e.where.spot), 'play on odd days')
  assert.ok(at(1, 0.56).every(e => e.act === 'play'))
  assert.ok(at(0, DAY.dusk + 0.03).every(e => e.act === 'home'))
})

test('two days in a row differ for at least a third of the town', () => {
  for (const { seed, city, folk } of worlds) for (const day of [0, 1, 2, 3]) {
    const changed = folk.filter(p => sig(scheduleFor(p, city, seed, day)) !== sig(scheduleFor(p, city, seed, day + 1))).length
    assert.ok(changed >= folk.length / 3, `day ${day}: ${changed}/${folk.length}`)
  }
})

test('the night: the inn takes some in the evening, nearly everyone else is home', () => {
  const { seed, city, folk } = worlds[1]
  const innDoor = city.doors.find(d => d.kind === 'inn').label
  const f = DAY.night + 0.04
  const states = folk.filter(p => p.job !== 'watch').map(p => { const s = scheduleFor(p, city, seed, 2); return s[entryAt(s, f)] })
  const atInn = states.filter(e => e.where.door === innDoor && (e.act === 'inn' || e.act === 'work')).length
  const home = states.filter(e => e.act === 'home').length
  assert.ok(atInn >= 6 && atInn <= 40, `${atInn} at the inn`)
  assert.ok(home >= states.length * 0.6, `${home} home`)
  assert.ok(states.every(e => !e.where.patrol))
})

test('the land gates are manned round the clock, the harbour and castle by day', () => {
  for (const { seed, city, folk } of worlds) for (const day of [0, 3]) {
    const watch = folk.filter(p => p.job === 'watch')
    const scheds = watch.map(p => ({ p, s: scheduleFor(p, city, seed, day) }))
    const manned = (f, id) => scheds.some(({ s }) => { const e = s[entryAt(s, f)]; return e.act === 'post' && e.where.spot === id })
    const land = PLAN.posts.filter(p => /^gate-[NWE]-/.test(p.id)).map(p => p.id)
    const dayOnly = PLAN.posts.filter(p => !/^gate-[NWE]-/.test(p.id)).map(p => p.id)
    for (let f = 0; f < 1; f += 0.005) {
      for (const id of land) assert.ok(manned(f, id), `${id} at ${f.toFixed(3)}`)
      if (f >= DAY.dawn && f <= DAY.dusk) for (const id of dayOnly) assert.ok(manned(f, id), `${id} at ${f.toFixed(3)}`)
    }
    // off duty they are in the barracks
    const barracks = city.doors.find(d => d.kind === 'barracks').label
    for (const { p, s } of scheds.filter(x => x.p.shift === 'day')) {
      const e = s[entryAt(s, 0.95)]
      assert.deepEqual([e.where.door, e.act], [barracks, 'barracks'], p.id)
    }
  }
})

test('a patrol pair walks the four routes in turn, together', () => {
  const rot = start => PLAN.patrols.map((_, i) => PLAN.patrols[(start + i) % PLAN.patrols.length].id)
  const dedupe = list => list.filter((r, i) => i === 0 || r !== list[i - 1])
  for (const { seed, city, folk } of worlds) for (const day of [0, 1, 4]) for (const shift of ['day', 'night']) {
    const pairs = folk.filter(p => p.job === 'watch' && p.patrol && p.shift === shift)
    assert.equal(pairs.length, 2)
    const [a, b] = pairs.map(p => scheduleFor(p, city, seed, day))
    assert.deepEqual(a, b, 'identical entries')
    const start = PLAN.patrols.findIndex(r => r.id === pairs[0].patrol)
    const walks = a.filter(e => e.where.patrol)
    assert.ok(walks.every(e => e.act === 'patrol'))
    // duty order from the relief: the evening entries first, then (night) those after midnight, the one at 0 being the route still in force
    const evening = walks.filter(e => e.at > 0.5).map(e => e.where.patrol)
    const morning = walks.filter(e => e.at <= 0.5).map(e => e.where.patrol)
    const seq = dedupe(shift === 'day' ? walks.map(e => e.where.patrol) : [...evening, ...morning])
    assert.deepEqual(seq, rot(start), `${shift} pair starting ${pairs[0].patrol}`)
    if (shift === 'night') {
      assert.equal(a[0].where.patrol, rot(start)[2], 'at 0 the third route is in force')
      assert.equal(a[0].at, 0)
    }
  }
})
