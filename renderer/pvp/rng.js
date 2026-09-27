// The match's seeded randomness (2b spec §2): mulberry32, a tiny 32-bit
// PRNG. makeMatch({ seed }) keeps one as match.rng, so a buff spot's rolls
// are repeatable for a seed and never touch Math.random. Pure.
import { BUFF_KINDS } from '../data/pvp.js'

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A seed for a new match, from any [0, 1) source (Math.random, a lobby's).
export const randomSeed = (random = Math.random) => Math.floor(random() * 4294967296) >>> 0

// One of the five buffs, uniformly.
export const rollBuff = rng => BUFF_KINDS[Math.min(BUFF_KINDS.length - 1, Math.floor(rng() * BUFF_KINDS.length))]
