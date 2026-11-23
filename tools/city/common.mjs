// Shared by the city tile tools: Tiny Town's palette, shading ramps and the
// source tiles the art is built on.
import { hex, ramps, T } from './lib.mjs'

// ---- Tiny Town's palette ------------------------------------------------------
export const INK = '#3f2631', NAVY = '#262b44'
export const S1 = '#c0cbdc', S2 = '#8b9bb4', S3 = '#5a6988', S4 = '#52607c'
export const R1 = '#fcbc8f', R2 = '#f28462', R3 = '#c34b35'
export const W1 = '#eaa56c', W2 = '#bd6c4a', W3 = '#763b36'
export const G1 = '#84c669', G2 = '#479f4a', G3 = '#65a556'
export const RED = '#e84537', YEL = '#fdbe53', ORA = '#e38628', WHITE = '#ffffff', CYAN = '#76e4ff', BLUE = '#009adc'
// a darker step for each, to shade a curved or turned surface
export const shade = ramps(
  [S1, S2, S3, S4, NAVY], [R1, R2, R3, '#8a3328', '#5e2420'], [W1, W2, W3, INK],
  [G1, G3, G2, '#2f6b3a'], [YEL, ORA, W2], [CYAN, BLUE, '#1a5f8a'],
)

export const RED_ROOF = [R1, R2, R3, '#8a3328', '#5e2420']
export const DARK_ROOF = ['#7a7f9e', '#4f5577', '#3a3f5c', '#2a2e47', '#1c1f33']

// the source tiles (make-city-tiles.mjs loads them), sampled with wrap-round
let SRC = {}
export const setSources = s => { SRC = s }
export const srcTile = n => { if (!SRC[n]) throw new Error(`source tile ${n} not loaded`); return SRC[n] }
export const tex = (p, x, y) => p.get(((x % T) + T) % T, ((y % T) + T) % T)
export const brickAt = (x, y) => tex(srcTile('ow_brick'), x, y)
