import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DAY_LENGTH, DAY_START, WEATHER, weatherFor } from '../renderer/data/weather.js'
import { dayPhase, advanceClock, makeWeather, lightSources, weatherLook } from '../renderer/systems/weather.js'
import { normalizeAdventureSave } from '../renderer/systems/adventure.js'
import { makeCampfire, CAMPFIRE_DURATION } from '../renderer/systems/campfire.js'

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

// A 12×12 lake: water inside a radius-5 disc around (6,6), grass elsewhere.
// `pier gap 2` sits at the disc centre, as on the real map's pier row.
function lakeMapData({ withPoi = true, withPond = false } = {}) {
  const N = 12, palette = ['ow_grass_0', 'ow_water_0', 'ow_pond_0']
  const ground = []
  for (let y = 0; y < N; y++) {
    ground.push([])
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 6, y - 6)
      if (d <= 5) {
        // pond cell at (6,9) if requested
        ground[y].push(withPond && x === 6 && y === 9 ? 2 : 1)
      } else {
        ground[y].push(0)
      }
    }
  }
  return { name: 'lake-1-ferry', w: N, h: N, palette, ground,
    pois: withPoi ? [{ kind: 'landmark', x: 6, y: 6, label: 'pier gap 2' }] : [] }
}

describe('makeWeather', () => {
  it('is null for a map with no config', () => {
    assert.equal(makeWeather({ name: 'forest-1-aspengrove', pois: [] }), null)
  })

  it('builds a day cycle, a zero animation timer and the fog cells', () => {
    const w = makeWeather(lakeMapData())
    assert.equal(w.dayCycle, true)
    assert.equal(w.t, 0)
    assert.equal(w.fog.cx, 6)
    assert.equal(w.fog.cy, 6)
    assert.equal(w.fog.radius, 9)
    assert.ok(w.fog.cells.length > 0)
  })

  it('takes only water cells inside the radius, weighted 1 at the anchor and falling with distance', () => {
    const { fog } = makeWeather(lakeMapData())
    const at = (x, y) => fog.cells.find(c => c.x === x && c.y === y)
    assert.equal(at(6, 6).w, 1)
    assert.ok(at(8, 6).w < at(7, 6).w && at(7, 6).w < 1)
    assert.ok(at(11, 6).w > 0)                       // water, inside radius 9
    assert.equal(at(0, 0), undefined)                 // grass
    assert.equal(fog.cells.some(c => Math.hypot(c.x - 6, c.y - 6) > 5), false)   // no grass sneaks in
    for (const c of fog.cells) assert.ok(c.w > 0 && c.w <= 1)
  })

  it('includes pond cells in the fog mask, sharing the openmap water predicate', () => {
    const { fog } = makeWeather(lakeMapData({ withPond: true }))
    const at = (x, y) => fog.cells.find(c => c.x === x && c.y === y)
    assert.ok(at(6, 9), 'pond cell (6,9) is in fog')   // ow_pond_0 cell inside radius
    assert.equal(fog.cells.some(c => Math.hypot(c.x - 6, c.y - 6) > 5), false)   // no grass sneaks in
  })

  it('uses the whole disc when the radius exceeds the map, never indexing off the edge', () => {
    const data = lakeMapData()
    data.pois[0] = { kind: 'landmark', x: 11, y: 11, label: 'pier gap 2' }
    assert.doesNotThrow(() => makeWeather(data))
  })

  it('yields fog null (no throw) when the anchor POI is missing', () => {
    const warned = []
    const orig = console.warn
    console.warn = (...a) => warned.push(a.join(' '))
    try {
      const w = makeWeather(lakeMapData({ withPoi: false }))
      assert.equal(w.fog, null)
      assert.equal(w.dayCycle, true)
      assert.ok(warned.some(m => m.includes('pier gap 2')))
    } finally { console.warn = orig }
  })
})

describe('lightSources', () => {
  it('is empty with nothing burning', () => {
    assert.deepEqual(lightSources({ entities: [], fireZones: [] }), [])
    assert.deepEqual(lightSources({}), [])
  })

  it('lists campfires at their pixel centre with campfireAlpha as strength', () => {
    const fire = makeCampfire(3, 4)
    fire.t = CAMPFIRE_DURATION - 5   // in the fade
    const [l] = lightSources({ entities: [{ type: 'villager', px: 0, py: 0 }, fire] })
    assert.equal(l.px, 3 * 32 + 16)
    assert.equal(l.py, 4 * 32 + 16)
    assert.equal(l.r, 4.5)
    assert.ok(l.strength > 0.3 && l.strength < 1)
    assert.equal(l.grey, false)
  })

  it('marks a deadwood fire grey and an eternal fire full strength', () => {
    const grey = makeCampfire(1, 1, { eternal: true, fuel: 'deadwood' })
    grey.t = 9999
    const [l] = lightSources({ entities: [grey] })
    assert.equal(l.grey, true)
    assert.equal(l.strength, 1)
  })

  it('lists every burning fire-zone tile with a 2-tile radius and the zone fade', () => {
    const zone = { tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }], age: 2.65 }   // 0.35 s of the 0.7 s fade left
    const ls = lightSources({ entities: [], fireZones: [zone] })
    assert.equal(ls.length, 2)
    assert.equal(ls[0].r, 2)
    assert.ok(Math.abs(ls[0].strength - 0.5) < 1e-9)
    assert.equal(ls[1].px, 32 + 16)
  })
})

describe('weatherLook', () => {
  it('is null when the map has no weather', () => {
    assert.equal(weatherLook({ weather: null }, { clock: 0 }), null)
  })

  it('carries the phase, the animation timer and the lights', () => {
    const state = { weather: makeWeather(lakeMapData()), entities: [makeCampfire(1, 1)], fireZones: [] }
    state.weather.t = 7.5
    const look = weatherLook(state, { clock: 0 })   // midnight
    assert.equal(look.dark, 0.85)
    assert.deepEqual(look.ambient, [40, 60, 120])
    assert.equal(look.fog, 1)
    assert.equal(look.t, 7.5)
    assert.equal(look.lights.length, 1)
  })

  it('skips the light scan by day', () => {
    const state = { weather: makeWeather(lakeMapData()), entities: [makeCampfire(1, 1)], fireZones: [] }
    const look = weatherLook(state, { clock: 0.5 * DAY_LENGTH })   // noon
    assert.equal(look.dark, 0)
    assert.deepEqual(look.lights, [])
  })

  it('a fog-only map is always bright with full fog', () => {
    const w = makeWeather(lakeMapData())
    w.dayCycle = false
    const look = weatherLook({ weather: w, entities: [], fireZones: [] }, { clock: 0 })
    assert.equal(look.dark, 0)
    assert.equal(look.fog, 1)
  })
})

describe('day cycle on every open map', () => {
  it('gives each OPEN_MAPS entry a dayCycle config, fog only on the lake', async () => {
    const { OPEN_MAPS } = await import('../renderer/data/open-maps.js')
    for (const data of Object.values(OPEN_MAPS)) {
      const cfg = weatherFor(data)
      assert.equal(cfg?.dayCycle, true, `${data.name} has no day cycle`)
      assert.equal(!!cfg.fog, data.name === 'lake-1-ferry', `${data.name} fog`)
    }
    assert.equal(Object.keys(WEATHER).length, Object.keys(OPEN_MAPS).length)
  })
})
