import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cityFor } from '../renderer/wilds/city/build.js'
import { rollTownsfolk, rollWatch, NAMED, JOBS } from '../renderer/wilds/city/folk.js'
import { PLAN } from '../renderer/wilds/city/plan.js'
import { LOOKS, WATCH_LOOKS } from '../renderer/data/townsfolk-looks.js'

const SEEDS = [1, 7, 4242]

test('about 120 people and 20 watchmen, the same for a seed', () => {
  const f = rollTownsfolk(7, cityFor(7))
  assert.equal(f.length, 120)
  assert.equal(f.filter(p => p.id.startsWith('named:')).length, 8)
  assert.deepEqual(f, rollTownsfolk(7, cityFor(7)))
  assert.equal(new Set(f.map(p => p.id)).size, 120)
  assert.equal(rollWatch(7, cityFor(7)).length, 20)
  assert.deepEqual(rollWatch(7, cityFor(7)), rollWatch(7, cityFor(7)))
  for (const p of f) assert.ok(['cheerful', 'gruff', 'shy', 'chatty'].includes(p.temperament))
  for (const p of f.filter(p => p.id.startsWith('tf:'))) assert.ok(JOBS.includes(p.job), p.job)
})

test('every person has a home door that exists; every shop has its keeper', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const doors = new Map(city.doors.map(d => [d.label, d]))
    const f = rollTownsfolk(seed, city)
    const perHome = new Map()
    for (const p of f) {
      assert.ok(doors.has(p.home), `${p.id} home`)
      if (p.id.startsWith('tf:')) {
        assert.equal(doors.get(p.home).kind, 'home')
        perHome.set(p.home, (perHome.get(p.home) ?? 0) + 1)
      }
      if (p.work !== null) assert.ok(doors.has(p.work) || city.spots[p.work], `${p.id} work ${p.work}`)
      assert.ok(LOOKS.some(l => l.id === p.look && l.age === p.age) || p.id.startsWith('named:'))
    }
    for (const n of perHome.values()) assert.ok(n >= 1 && n <= 3)
    for (const d of city.doors.filter(d => d.kind === 'shop')) assert.ok(f.some(p => p.work === d.label), `shop ${d.label}`)
    for (const p of f.filter(p => p.age === 'adult')) assert.notEqual(p.work, null, `${p.id} has work`)
    for (const p of f.filter(p => p.job === 'child' || p.job === 'elder')) assert.equal(p.work, null)
    // a keeper does not live in the shop
    for (const p of f.filter(p => p.id.startsWith('tf:'))) assert.notEqual(p.home, p.work)
  }
})

test('the named characters live where the story needs them', () => {
  for (const seed of SEEDS) {
    const city = cityFor(seed)
    const f = rollTownsfolk(seed, city)
    const by = id => f.find(p => p.id === `named:${id}`)
    const door = k => city.doors.find(d => d.kind === k).label
    assert.equal(by('seppo').work, door('smithy'))
    assert.equal(by('seppo').home, door('smithy'))
    assert.equal(by('pohjanen').work, 'fish-market')
    assert.equal(by('count').home, door('castle'))
    assert.equal(by('count').work, door('castle'))
    assert.equal(by('innkeeper').home, door('inn'))
    assert.equal(by('vaino').work, door('church'))
    assert.equal(by('crier').work, 'crier')
    assert.equal(by('captain').work, door('barracks'))
    assert.equal(NAMED.length, 8)
  }
})

test('the watch: twelve by day, eight by night, patrols in pairs', () => {
  const city = cityFor(7)
  const w = rollWatch(7, city)
  const day = w.filter(p => p.shift === 'day'), night = w.filter(p => p.shift === 'night')
  assert.equal(day.length, 12); assert.equal(night.length, 8)
  assert.deepEqual(day.map(p => p.post).filter(Boolean).sort(), PLAN.posts.map(p => p.id).sort())
  assert.equal(night.filter(p => p.post).length, 6)
  for (const p of night.filter(p => p.post)) assert.match(p.post, /^gate-[NWE]-/)
  for (const s of [day, night]) {
    const pair = s.filter(p => p.patrol)
    assert.equal(pair.length, 2)
    assert.ok(PLAN.patrols.some(r => r.id === pair[0].patrol))
    assert.equal(pair[0].patrol, pair[1].patrol)
  }
  for (const p of w) { assert.equal(p.job, 'watch'); assert.match(p.id, /^watch:\d+$/); assert.ok(WATCH_LOOKS.some(l => l.id === p.look)) }
  for (const p of w.filter(p => p.post)) assert.ok(city.spots[p.post])
})
