// Kalevanlinna's church inside: three floors laid by hand (parse.js format).
//
// It keeps the shape of the building the player walked into: the nave runs
// east to west with the door in the south wall near the west end, the bell
// tower stands at the west end, and only a north wall shows its face in this
// view, so the long north wall carries the row of coloured windows, the
// organ's pipes stand on it at the west end, and the altar is at the east
// end on its red dais. The pews are seen from the side, their backs to the
// west: who sits in them faces the altar. Two blocks of pews either side of
// an aisle two cells wide; the front pews (nearest the altar) are the school.
//
//   nave    the ground floor: pews, altar, pulpit, font, organ; stairs up to
//           the tower (west end) and down to the crypt (by the north wall)
//   tower   the bell chamber: the bell, its window, the stair down
//   crypt   tombs and columns under the chancel, and at its east end the
//           breathing crack, shut until the story opens it (project 3)
import { VERSIONS } from '../versions.js'

const CRACK = 'Warm air breathes up through the crack.'

const nave = {
  id: 'nave', palette: 'pale', entry: 'nave',
  rooms: [{ id: 'nave', x0: 1, x1: 22, y0: 1, y1: 10, floor: 'greyflags' }],
  rows: [
    '########################',
    '#uuuuuuuuuuuuuuuuuuuuuu#',
    '#llllllllllllllllllllll#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '###E####################',
  ],
  things: [
    '                        ',
    '   OO A B C A B C  XABX ',
    '   OO A B C A B C  XABX ',
    ' < b p p p p p p s Pq > ',
    ' 1   p p p p p p s    2 ',
    '     p p p p p p s      ',
    '                   iTTi ',
    '                     v  ',
    '     p p p p p p s      ',
    ' F   p p p p p p s      ',
    '     p p p p p p s      ',
    '                        ',
  ],
  legend: {
    O: { item: 'organ' },
    b: { item: 'organ_bench', spot: 'organ' },
    A: { item: 'window_glass_a' },
    B: { item: 'window_glass_b' },
    C: { item: 'window_glass_c' },
    X: { item: 'banner_blue' },
    p: { item: 'pew', spot: 'pew' },
    s: { item: 'pew', spot: 'school' },
    T: { item: 'altar' },
    i: { item: 'candle' },
    P: { item: 'pulpit' },
    q: { spot: 'pulpit' },
    v: { spot: 'altar-side' },
    F: { item: 'font' },
    '<': { stair: 'tower', to: ['tower', 'down'], dir: 'up', say: 'You climb the tower stairs.' },
    1: { land: 'tower' },
    '>': { stair: 'crypt', to: ['crypt', 'up'], dir: 'down', say: 'You go down into the crypt.' },
    2: { land: 'crypt' },
  },
  // the dais at the east end, and a runner down the aisle to it
  rugs: [{ colour: 'red', x0: 19, y0: 4, x1: 22, y1: 8 }, { colour: 'red', x0: 2, y0: 6, x1: 18, y1: 7 }],
  // nobody stands in the aisle or before the altar for want of a seat
  clear: [{ x0: 1, y0: 6, x1: 18, y1: 7 }, { x0: 19, y0: 4, x1: 22, y1: 8 }],
}

const tower = {
  id: 'tower', palette: 'grey', entry: 'belfry',
  rooms: [{ id: 'belfry', x0: 1, x1: 5, y0: 1, y1: 6, floor: 'boards' }],
  rows: [
    '#######',
    '#uuuuu#',
    '#lllll#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ],
  things: [
    '       ',
    '   W   ',
    '       ',
    '       ',
    '   B   ',
    '   r   ',
    ' >1    ',
    '       ',
  ],
  legend: {
    W: { item: 'window' },
    B: { item: 'bell' },
    r: { spot: 'bell' },
    '>': { stair: 'down', to: ['nave', 'tower'], dir: 'down' },
    1: { land: 'down' },
  },
  dress: [{ item: 'web_wall', n: [0, 1] }],
}

const crypt = {
  id: 'crypt', palette: 'grey', entry: 'vault',
  rooms: [{ id: 'vault', x0: 1, x1: 16, y0: 1, y1: 9, floor: 'greyflags' }],
  rows: [
    '##################',
    '#uuuuuuuuuuuuuuuu#',
    '#llllllllllllllll#',
    '#................#',
    '#................#',
    '#................#',
    '#................#',
    '#................#',
    '#................#',
    '#................#',
    '##################',
  ],
  things: [
    '                  ',
    '                  ',
    '                  ',
    ' [  t t t t t   ] ',
    '    t t t t t     ',
    '    o i o   o  o  ',
    ' <1             x ',
    '    o   o i o  o  ',
    '    t t t t t     ',
    '    t t t t t     ',
    '                  ',
  ],
  legend: {
    t: { item: 'tomb' },
    o: { item: 'column' },
    i: { item: 'candle' },
    '[': { item: 'web_tl' },
    ']': { item: 'web_tr' },
    '<': { stair: 'up', to: ['nave', 'crypt'], dir: 'up' },
    1: { land: 'up' },
    x: { shut: CRACK, deco: 'crack' },
  },
  // cold candles, webs and the dust of a place nobody sweeps
  dress: [
    { item: 'candle', n: [2, 3] },
    { item: 'web', n: [2, 4] },
    { item: 'web_wall', n: [1, 2] },
    { item: 'rubble', n: [1, 3] },
    { item: 'bones', n: [0, 1] },
  ],
}

// Where a person the schedules put in the church stands (buildBuilding seats
// anyone a spot has no room for on free floor of that floor).
function seat(person, act) {
  if (person.job === 'vicar') return { floor: 'nave', spot: act === 'church' ? 'altar-side' : 'pulpit' }
  if (person.job === 'organist') return { floor: 'nave', spot: 'organ' }
  if (person.job === 'bell-ringer' && act === 'ring') return { floor: 'tower', spot: 'bell' }
  if (person.age === 'child' && act === 'work') return { floor: 'nave', spot: 'school' }
  return { floor: 'nave', spot: 'pew' }
}

export const CHURCH = { floors: [nave, tower, crypt], ground: 'nave', theme: VERSIONS.home.theme, seat }
