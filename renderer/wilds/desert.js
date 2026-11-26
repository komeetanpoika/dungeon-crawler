// The desert's numbers and the tests every desert system shares: what
// counts as desert, the gentle ring round home where the desert stays easy,
// and how far the hero sees. DOM-free and pure.
//
// Sight in the Wilds (systems/entities.js `los: 'dunes'`): a dune crest is
// a walkable cell whose ground skin starts with DUNE_PREFIX (piece.js flags
// it `losDune`); it blocks sight to what lies behind it unless the viewer
// stands on it. A landmark is a blocked cell whose overlay starts with
// BEACON_PREFIX (`losBeacon`): seen over crests, and out to BEACON_RANGE.
import { biomeAt } from './layout.js'

export const DUNE_PREFIX = 'ow_dune_'
export const BEACON_PREFIX = 'ow_landmark_'
// The desert's tall things to steer by (features.js stands one to three in
// every desert piece; tools/make-wilds-desert-tiles.mjs draws them): a
// sandstone spire two cells tall, its top over its foot, and a cairn of one.
export const SPIRE = [`${BEACON_PREFIX}spire_top`, `${BEACON_PREFIX}spire`]
export const CAIRN = `${BEACON_PREFIX}cairn`
export const DESERT_LANDMARKS = [...SPIRE, CAIRN]

// The hero's sight radius in tiles: `base` anywhere out of doors, `desert`
// in desert country, and in a full sandstorm `storm`, or `stormVillage`
// among a village's houses.
export const SIGHT = { base: 14, desert: 20, storm: 4, stormVillage: 8 }
// How far a landmark is seen, beyond the sight radius: about half the screen.
export const BEACON_RANGE = 32

// What counts as desert, for every system: the tile's own country.
export const isDesert = (seed, X, Y) => biomeAt(seed, X, Y) === 'desert'

// The pieces round home (piece coordinates): the first minutes of play stay
// gentle there (features.js PACKS[0]; no dunes, no storms).
export const inGentleRing = (wx, wy) => Math.max(Math.abs(wx), Math.abs(wy)) <= 1

// The hero's sight radius: from the open-country or desert radius down to
// the storm's, by the storm's strength 0..1.
export function heroSight({ desert, storm = 0, village = false }) {
  const clear = desert ? SIGHT.desert : SIGHT.base
  const blind = village ? SIGHT.stormVillage : SIGHT.storm
  const s = Math.min(1, Math.max(0, storm))
  return Math.round(clear + (blind - clear) * s)
}
