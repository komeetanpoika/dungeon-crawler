// Per-map weather (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Keyed by map name like EPISODES — open-maps.js is generated and would drop
// a flag. `dayCycle` advances the clock and draws the night pass; `fog` lays
// mist on the open-water cells within `radius` tiles of the POI `at`.
export const DAY_LENGTH = 360               // seconds per in-game day
export const DAY_START = 0.30 * DAY_LENGTH  // a fresh save wakes mid-morning

// Every open map runs the day cycle; the Adventure chain shares one clock on
// its save (time carries over a waystone hop), each Timewarp episode keeps
// its own in its mini-save. Only the lake has fog.
export const WEATHER = {
  'forest-1-clearings':     { dayCycle: true },
  'lake-1-ferry':           { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } },
  'highland-2-fold':        { dayCycle: true },
  'marsh-3-hermit':         { dayCycle: true },
  'forest-2-river':         { dayCycle: true },
  'forest-3-autumn':        { dayCycle: true },
  'desert-1-dunes':         { dayCycle: true },
  'desert-2-canyon':        { dayCycle: true },
  'desert-3-lost-city':     { dayCycle: true },
  'sea-1-suomenlinna':      { dayCycle: true },
  'sea-2-fishing-village':  { dayCycle: true },
  'sea-3-archipelago':      { dayCycle: true },
}

export const weatherFor = mapData => (mapData && WEATHER[mapData.name]) || null
