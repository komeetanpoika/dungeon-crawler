// Per-map weather (docs/superpowers/specs/2026-09-04-weather-day-cycle-design.md).
// Keyed by map name like EPISODES — open-maps.js is generated and would drop
// a flag. `dayCycle` advances the clock and draws the night pass; `fog` lays
// mist on the open-water cells within `radius` tiles of the POI `at`.
export const DAY_LENGTH = 360               // seconds per in-game day
export const DAY_START = 0.30 * DAY_LENGTH  // a fresh save wakes mid-morning

export const WEATHER = {
  'lake-1-ferry': { dayCycle: true, fog: { at: 'pier gap 2', radius: 9 } },
}

export const weatherFor = mapData => (mapData && WEATHER[mapData.name]) || null
