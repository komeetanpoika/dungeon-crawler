// Which picture each thing a character wears shows on the hero. The hero is
// drawn from three overlays laid on each other (render/hero-look.js): feet
// (rows 14-15 of the 16x16 figure), a body (rows 10-13) and a head (rows
// 0-9). The overlays are tiles `hero_<zone>_<name>.png`, built by
// tools/gear-art/build.mjs. Plain data.

// What an outfit shows where nothing is worn over it. The Knight's Tabard
// (outfit key `plate`) has no headgear of its own.
export const OUTFIT_HEAD = { ranger: 'hood', robe: 'hat' }
export const OUTFIT_BODY = { ranger: 'coat', robe: 'robe', plate: 'tabard' }

// What a worn piece shows, by its key in entities.js WORN_TYPES.
export const PIECE_HEAD = { cap: 'cap', helm: 'helm', horned: 'horned', cloth: 'cloth' }
export const PIECE_BODY = { leather: 'leather', chain: 'chain', plate: 'plate' }
export const PIECE_FEET = { elk: 'elk', ironshod: 'ironshod', wayfarer: 'wayfarer' }

// A long body reaches the ground (rows 10-15): it has no feet under it, and
// boots worn with it show as two toe pixels at its hem, in the boots' colour.
export const LONG_BODY = { robe: { toes: [[4, 15], [10, 15]], ring: [13, 12] } }
export const TOE_COLOUR = { elk: '#f4f1e6', ironshod: '#c0cbdc', wayfarer: '#3e8948' }
// Where a ring's one pixel sits: the hand at the figure's right side.
export const RING_AT = [13, 13]

const names = (zone, ...tables) => [...new Set(tables.flatMap(t => Object.values(t)))].map(n => `hero_${zone}_${n}`)
// Every overlay tile the hero can be drawn from (render/sprites.js loads them).
export const HERO_PART_TILES = [
  'hero_head_bare', ...names('head', OUTFIT_HEAD, PIECE_HEAD),
  'hero_body_bare', ...names('body', OUTFIT_BODY, PIECE_BODY),
  'hero_feet_bare', ...names('feet', PIECE_FEET),
]
