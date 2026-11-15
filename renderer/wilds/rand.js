// Randomness for the Wilds. Everything here is a pure function of its
// arguments: the world is generated from (seed, coordinates), never from a
// stream whose position depends on what was generated before, so any piece
// can be made at any time, in any order, on any machine.
export { mulberry32 } from '../terrain/lib.js'

// A 32-bit mix of four integers. Negative coordinates are fine.
export function hashInt(seed, x, y, salt = 0) {
  let h = Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(x | 0, 0x85EBCA6B) ^ Math.imul(y | 0, 0xC2B2AE35) ^ Math.imul(salt | 0, 0x27D4EB2F)
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D)
  h ^= h >>> 12; h = Math.imul(h, 0x297A2D39)
  h ^= h >>> 15
  return h >>> 0
}

// The same, as a float in [0, 1).
export function hash(seed, x, y, salt = 0) {
  return hashInt(seed, x, y, salt) / 4294967296
}

const fade = t => t * t * (3 - 2 * t)

function valueAt(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const a = hash(seed, xi, yi, 91), b = hash(seed, xi + 1, yi, 91)
  const c = hash(seed, xi, yi + 1, 91), d = hash(seed, xi + 1, yi + 1, 91)
  const u = fade(xf), v = fade(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// Value noise with fBm in [0, 1]. `freq` is cycles per unit of x/y.
export function noise2(seed, x, y, { freq = 0.08, octaves = 3 } = {}) {
  let sum = 0, amp = 1, tot = 0, f = freq
  for (let o = 0; o < octaves; o++) {
    sum += valueAt(seed + o * 101, x * f, y * f) * amp
    tot += amp; amp *= 0.5; f *= 2
  }
  return sum / tot
}
