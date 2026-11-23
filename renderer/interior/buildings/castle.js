// Kalevanlinna's keep inside: three floors laid by hand (parse.js format).
//
// The door is in the middle of the keep's south face, as outside. Only a
// north wall shows its face in this view, so the great hall is laid across
// the north of the keep with the Count's throne on its red dais against the
// north face, under his banners and a drape, the dim Sampo lid on its stand
// beside him and a fireplace on the face each side; the way from the door
// runs straight up the middle to the throne between the two long tables.
// The entrance hall and the kitchens lie south of it.
//
//   hall    the ground floor: the entrance hall (two guards, the stair down
//           to the cells), the great hall (the throne, the stair up at its
//           east end, held by the stair guard), the kitchens (the cook and
//           the servant)
//   cells   a corridor along four cells behind barred doors (the cells are
//           sealed floor: seen through the bars, never walked in), the
//           guard's table and stool, torches
//   count   the Count's floor, not open in play (the stair guard): his
//           chamber, his study and the corridor between, at its east end the
//           door to the battlements, barred until the story opens it
//           (project 3)
//
// The household lives only in here (spec "The castle's people"): two hall
// guards, the stair guard, the cook and the servant are spawns of the
// building, not townsfolk; only the Count comes and goes by his schedule.
import { VERSIONS } from '../versions.js'

const STAIR_LINE = "The Count's rooms are private."
const BATTLEMENTS = 'The door to the battlements is barred.'

const guard = (id, look, lines) => ({ spawn: { species: 'watchman', id, look, lines } })
const servant = (id, look, lines) => ({ spawn: { species: 'townsfolk', id, look, lines } })

const hall = {
  id: 'hall', palette: 'grey', entry: 'entrance',
  rooms: [
    { id: 'great', x0: 1, x1: 15, y0: 1, y1: 7, floor: 'flags' },
    { id: 'kitchen', x0: 1, x1: 5, y0: 9, y1: 13, floor: 'flags' },
    { id: 'entrance', x0: 7, x1: 15, y0: 9, y1: 13, floor: 'greyflags' },
  ],
  rows: [
    '#################',
    '#uuuuuuuuuuuuuuu#',
    '#lllllllllllllll#',
    '#...............#',
    '#...............#',
    '#...............#',
    '#...............#',
    '#...............#',
    '########d########',
    '#uuuuu#uduuuuuuu#',
    '#lllll#ldlllllll#',
    '#.....#.........#',
    '#.....d.........#',
    '#.....#.........#',
    '########E########',
  ],
  things: [
    '                 ',
    '  BtFFtBDBtFFtB  ',
    '  B FF BDB FF B  ',
    '      i TLi    < ',
    '              G1 ',
    '   bb       bb   ',
    '   MMM     MMM   ',
    '   bb       bb   ',
    '                 ',
    ' Hphq  t t B t B ',
    ' Howwk     B   B ',
    '  c    g j     > ',
    '   v           2 ',
    ' r  en           ',
    '                 ',
  ],
  legend: {
    B: { item: 'banner_red' },
    t: { item: 'torch' },
    F: { item: 'fireplace' },
    D: { item: 'drape' },
    T: { item: 'throne', spot: 'throne' },
    L: { item: 'sampo_lid' },
    i: { item: 'candle' },
    M: { item: 'longtable' },
    b: { item: 'bench_seat' },
    H: { item: 'hearth' },
    p: { item: 'potshelf' },
    h: { item: 'hanging_pots' },
    q: { item: 'plateshelf' },
    o: { item: 'oven' },
    w: { item: 'worktop' },
    k: { item: 'sink' },
    r: { item: 'barrel' },
    e: { item: 'crate_bread' },
    n: { item: 'crate_greens' },
    '<': { stair: 'up', to: ['count', 'down'], dir: 'up' },
    1: { land: 'up' },
    '>': { stair: 'down', to: ['cells', 'up'], dir: 'down' },
    2: { land: 'down' },
    G: {
      ...guard('castle:stair-guard', 'w03', [
        "Upstairs is the Count's. Everywhere else is everyone's.",
        'Nine years on this step. It is a good step.',
      ]),
      guards: 'up', line: STAIR_LINE,
    },
    g: guard('castle:hall-guard-1', 'w01', [
      'The Count sits in the great hall. Through there, and mind your manners.',
      'Wipe your boots. The flags were scrubbed this morning.',
    ]),
    j: guard('castle:hall-guard-2', 'w02', [
      'Blades stay sheathed in the keep.',
      'Nothing happens here. That is how the Count likes it.',
    ]),
    c: servant('castle:cook', 'a05', [
      'Soup for the hall, soup for the guards, soup for me. It is always soup.',
      'Out of my kitchen, unless you can peel.',
    ]),
    v: servant('castle:servant', 'a14', [
      'The Count likes his fire high and his soup hot. I carry both.',
      'Mind the floor. I have just done it.',
    ]),
  },
  // the dais at the north end; a rug in the entrance hall
  rugs: [{ colour: 'red', x0: 6, y0: 3, x1: 10, y1: 4 }, { colour: 'blue', x0: 10, y0: 11, x1: 14, y1: 13 }],
  // nobody stands on the way to the throne or on the dais for want of a place
  clear: [{ x0: 6, y0: 3, x1: 10, y1: 4 }, { x0: 7, y0: 5, x1: 9, y1: 7 }],
}

const cells = {
  id: 'cells', palette: 'grey', entry: 'corridor',
  rooms: [
    { id: 'cell-1', x0: 1, x1: 3, y0: 1, y1: 4, floor: 'greyflags' },
    { id: 'cell-2', x0: 5, x1: 7, y0: 1, y1: 4, floor: 'greyflags' },
    { id: 'cell-3', x0: 9, x1: 11, y0: 1, y1: 4, floor: 'greyflags' },
    { id: 'cell-4', x0: 13, x1: 15, y0: 1, y1: 4, floor: 'greyflags' },
    { id: 'corridor', x0: 1, x1: 15, y0: 6, y1: 10, floor: 'greyflags' },
  ],
  rows: [
    '#################',
    '#uuu#uuu#uuu#uuu#',
    '#lll#lll#lll#lll#',
    '#...#...#...#...#',
    '#...#...#...#...#',
    '##d###d###d###d##',
    '#uduuuduuuduuudu#',
    '#ldllldllldllldl#',
    '#...............#',
    '#...............#',
    '#...............#',
    '#################',
  ],
  things: [
    '                 ',
    '                 ',
    '                 ',
    ' r         r     ',
    '  C   C   C   C  ',
    '                 ',
    '    t   t   t    ',
    '                 ',
    ' <               ',
    ' 1            sT ',
    '                 ',
    '                 ',
  ],
  legend: {
    C: { item: 'celldoor' },
    r: { item: 'bedroll' },
    t: { item: 'torch' },
    T: { item: 'table_small' },
    s: { item: 'stool' },
    '<': { stair: 'up', to: ['hall', 'down'], dir: 'up' },
    1: { land: 'up' },
  },
  // behind the bars: seen, never walked in
  sealed: [
    { x0: 1, y0: 3, x1: 3, y1: 4 }, { x0: 5, y0: 3, x1: 7, y1: 4 },
    { x0: 9, y0: 3, x1: 11, y1: 4 }, { x0: 13, y0: 3, x1: 15, y1: 4 },
  ],
  dress: [
    { item: 'web_wall', n: [1, 2] },
    { item: 'web', n: [1, 2] },
    { item: 'rubble', n: [1, 2] },
    { item: 'puddle', n: [0, 1] },
    { item: 'bones', n: [0, 1] },
  ],
}

const count = {
  id: 'count', palette: 'wood', entry: 'corridor',
  rooms: [
    { id: 'chamber', x0: 1, x1: 7, y0: 1, y1: 5, floor: 'boards' },
    { id: 'study', x0: 9, x1: 15, y0: 1, y1: 5, floor: 'boards' },
    { id: 'corridor', x0: 1, x1: 15, y0: 7, y1: 10, floor: 'planks' },
  ],
  rows: [
    '#################',
    '#uuuuuuu#uuuuuuu#',
    '#lllllll#lllllll#',
    '#.......#.......#',
    '#.......#.......#',
    '#.......#.......#',
    '####d#######d####',
    '#uuuduuuuuuuduuu#',
    '#llldllllllldlll#',
    '#...............d',
    '#...............#',
    '#################',
  ],
  things: [
    '                 ',
    ' P  w W  KQ o KQ ',
    '  n   W  KQ   KQ ',
    ' b               ',
    ' b          T    ',
    ' c          h    ',
    '                 ',
    '  t   g t e   t  ',
    '                 ',
    ' >              x',
    ' 2               ',
    '                 ',
  ],
  legend: {
    P: { item: 'portrait' },
    w: { item: 'window_curtain' },
    W: { item: 'wardrobe' },
    n: { item: 'nightstand' },
    b: { item: 'bed_v' },
    c: { item: 'chest' },
    K: { item: 'bookcase' },
    Q: { item: 'bookcase2' },
    o: { item: 'clock' },
    T: { item: 'table_books' },
    h: { item: 'chair_n' },
    t: { item: 'torch' },
    g: { item: 'painting_green' },
    e: { item: 'painting_teal' },
    '>': { stair: 'down', to: ['hall', 'up'], dir: 'down' },
    2: { land: 'down' },
    x: { shut: BATTLEMENTS, deco: 'barredDoor' },
  },
  rugs: [{ colour: 'blue', x0: 3, y0: 3, x1: 6, y1: 5 }, { colour: 'green', x0: 11, y0: 3, x1: 13, y1: 5 }],
  dress: [{ item: 'candle', n: [1, 2] }, { item: 'books_floor', n: [0, 1] }],
}

// Where a person the schedules put in the keep stands: the Count in his
// chair; anyone else on free floor of the ground floor (buildBuilding).
function seat(person) {
  if (person.job === 'count') return { floor: 'hall', spot: 'throne' }
  return { floor: 'hall' }
}

export const CASTLE = { floors: [hall, cells, count], ground: 'hall', theme: VERSIONS.home.theme, seat }
