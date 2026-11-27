// The poses tools/desert-monsters/preview.mjs draws for the trolls' rig
// (render/monster-rigs/troll.js). The King with a boulder over his head is
// ten tiles of cell tall, so the sheet is drawn in two, picked by PEIKOT_ROWS:
//   PEIKOT_ROWS=band node tools/desert-monsters/preview.mjs troll <out.png> --poses tools/tribes/poses-peikot.mjs --ground '#8a8f94,#82878c'
//   PEIKOT_ROWS=king node tools/desert-monsters/preview.mjs troll <out.png> --poses tools/tribes/poses-peikot.mjs --ground '#8a8f94,#82878c' --s 48 --cell 448
// Without it every row is drawn (the King's then run into the rows above).
// Rows of { label, pose, params? }; a pose's fields are those of
// systems/monsters.js entityPose plus the rig's own channels (slab, drum,
// stirred, side, lift, rear, bellow).
const E = 0, W = Math.PI
const FIGHTER = { role: 0 }, MAGE = { role: 1 }, DRUMMER = { role: 2 }, KING = { role: 3, scale: 2.2, gaitFreq: 4 }
const cell = (label, params, pose = {}) => ({ label, params, pose: { facing: E, ...pose } })
const walk = (params, t, over = {}) => cell(`walk ${t}`, params, { state: 'walk', speed01: 1, t, ...over })

const BAND = [
  // one people: the three side by side, turned either way, and the drum's mark on one
  [cell('Möhkäle', FIGHTER, { slab: 1 }), cell('Louhija', MAGE), cell('Rumpali', DRUMMER),
   cell('Möhkäle west', FIGHTER, { slab: 1, facing: W }), cell('Louhija west', MAGE, { facing: W }), cell('Rumpali west', DRUMMER, { facing: W }),
   cell('stirred', FIGHTER, { stirred: 1, slab: 1, t: 0.1 })],
  // the fighter: slab up, coming down, down; the swing (the blow, then the club coming back); walking
  [cell('slab up', FIGHTER, { slab: 1 }), cell('slab half', FIGHTER, { slab: 0.5 }), cell('slab down', FIGHTER, { slab: 0 }),
   cell('club down', FIGHTER, { slab: 0, state: 'attack', stateT: 0.03 }), cell('club back up', FIGHTER, { slab: 0, state: 'attack', stateT: 0.22 }),
   walk(FIGHTER, 0, { slab: 1 }), walk(FIGHTER, 0.17, { slab: 1 })],
  // the mage: at rest, the staff going up, up; walking; the drum has him
  [cell('staff', MAGE), cell('raising', MAGE, { eyeGlow: 0.5, t: 0.1 }), cell('raised', MAGE, { eyeGlow: 1, t: 0.2 }),
   walk(MAGE, 0), walk(MAGE, 0.34), cell('stirred', MAGE, { stirred: 1, t: 0.3 }), cell('raised west', MAGE, { eyeGlow: 1, t: 0.2, side: -1 })],
  // the drummer: at rest, one stick, both up between, the other; on the march; struck
  [cell('sticks at rest', DRUMMER), cell('left down', DRUMMER, { drum: 1.1 }), cell('between', DRUMMER, { drum: 1.7 }), cell('right down', DRUMMER, { drum: 2.1 }),
   walk(DRUMMER, 0.17, { drum: 2.1 }), cell('hit', DRUMMER, { state: 'hit' }), cell('hit fighter', FIGHTER, { state: 'hit', slab: 1 })],
  // falling: the fighter early and late, the others fallen; the rest of the walk
  [cell('falling', FIGHTER, { state: 'death', stateT: 0.1 }), cell('fallen', FIGHTER, { state: 'death', stateT: 0.5 }),
   cell('fallen', MAGE, { state: 'death', stateT: 0.5 }), cell('fallen', DRUMMER, { state: 'death', stateT: 0.5 }),
   cell('breath', FIGHTER, { slab: 1, t: 0.5 }), walk(FIGHTER, 0.34, { slab: 1 }), walk(FIGHTER, 0.5, { slab: 1 })],
]
const KING_ROWS = [
  // the King beside a Lump; the boulder off the ground, at his chest, over his head
  [cell('the King', KING), cell('boulder off the ground', KING, { lift: 0.25, eyeGlow: 0.25 }), cell('boulder half', KING, { lift: 0.6, eyeGlow: 0.6 }), cell('boulder up', KING, { lift: 1, eyeGlow: 1 })],
  // rearing, reared; the bellow; his fist
  [cell('rearing', KING, { rear: 0.5, eyeGlow: 0.5 }), cell('reared', KING, { rear: 1, eyeGlow: 1 }), cell('bellow', KING, { bellow: 1, eyeGlow: 1, t: 0.12 }), cell('fist', KING, { state: 'attack', stateT: 0.03 })],
  // walking; the drum has him; turned west
  [walk(KING, 0), walk(KING, 0.26), cell('stirred', KING, { stirred: 1, t: 0.2 }), cell('west', KING, { facing: W })],
  // struck, falling, fallen; a Lump for his size
  [cell('hit', KING, { state: 'hit' }), cell('falling', KING, { state: 'death', stateT: 0.1 }), cell('fallen', KING, { state: 'death', stateT: 0.5 }), cell('a Lump, for size', FIGHTER, { slab: 1 })],
]

const pick = typeof process !== 'undefined' ? process.env.PEIKOT_ROWS : null
export const POSES = { troll: pick === 'band' ? BAND : pick === 'king' ? KING_ROWS : [...BAND, ...KING_ROWS] }
