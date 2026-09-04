import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DAY_LENGTH, DAY_START, WEATHER, weatherFor } from '../renderer/data/weather.js'
import { dayPhase, advanceClock } from '../renderer/systems/weather.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'

describe('weather config', () => {
  it('a day is six minutes and a fresh save wakes mid-morning', () => {
    assert.equal(DAY_LENGTH, 360)
    assert.equal(DAY_START, 0.30 * DAY_LENGTH)
  })

  it("Toivo's Lake has a day cycle and pier fog; other maps have nothing", () => {
    assert.deepEqual(WEATHER['lake-1-ferry'], { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } })
    assert.deepEqual(weatherFor({ name: 'lake-1-ferry' }), WEATHER['lake-1-ferry'])
    assert.equal(weatherFor({ name: 'forest-1-aspengrove' }), null)
    assert.equal(weatherFor(null), null)
  })
})

describe('advanceClock', () => {
  it('adds delta and wraps at DAY_LENGTH', () => {
    const save = { clock: 10 }
    assert.equal(advanceClock(save, 5), 15)
    assert.equal(save.clock, 15)
    save.clock = DAY_LENGTH - 1
    advanceClock(save, 2)
    assert.equal(save.clock, 1)
  })

  it('starts a clock-less save from DAY_START', () => {
    const save = {}
    advanceClock(save, 1)
    assert.equal(save.clock, DAY_START + 1)
  })
})

describe('normalizeAdventureSave clock', () => {
  it('defaults a missing clock to DAY_START and keeps an existing one', () => {
    assert.equal(normalizeAdventureSave(null).clock, DAY_START)
    const raw = normalizeAdventureSave(null)
    raw.clock = 42
    assert.equal(normalizeAdventureSave(raw).clock, 42)
  })
})

describe('dayPhase', () => {
  const at = frac => dayPhase(frac * DAY_LENGTH)

  it('is bright at noon and deep night at midnight', () => {
    assert.equal(at(0.5).dark, 0)
    assert.deepEqual(at(0.5).ambient, [255, 255, 255])
    assert.equal(at(0.5).fog, 0.15)
    assert.equal(at(0).dark, 0.85)
    assert.deepEqual(at(0).ambient, [40, 60, 120])
    assert.equal(at(0).fog, 1)
  })

  it('wraps: a full day later is the same phase', () => {
    assert.deepEqual(dayPhase(DAY_LENGTH), dayPhase(0))
    assert.deepEqual(dayPhase(DAY_LENGTH + 30), dayPhase(30))
  })

  it('darkens monotonically from evening to night and brightens from dawn to morning', () => {
    let prev = at(0.70).dark
    for (let f = 0.71; f <= 0.90; f += 0.01) { assert.ok(at(f).dark >= prev, `dark fell at ${f}`); prev = at(f).dark }
    prev = at(0.20).dark
    for (let f = 0.21; f <= 0.30; f += 0.01) { assert.ok(at(f).dark <= prev, `dark rose at ${f}`); prev = at(f).dark }
  })

  it('interpolates between keyframes', () => {
    // halfway from noon (dark 0) to evening (dark 0.10)
    assert.ok(Math.abs(at(0.6).dark - 0.05) < 1e-9)
    // fog halfway from dusk (0.8) to night (1.0)
    assert.ok(Math.abs(at(0.85).fog - 0.9) < 1e-9)
    // ambient is rounded to integers
    for (const v of at(0.6).ambient) assert.equal(v, Math.round(v))
  })

  it('reports the day fraction', () => {
    assert.equal(at(0.25).frac, 0.25)
  })
})
