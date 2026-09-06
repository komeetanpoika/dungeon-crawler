// Hand-drawn house interiors. Every house door on the open maps opens into
// one of these five floor plans (systems/interior.js stamps one at random),
// so a cottage reads as a cottage and not as a 44x28 dungeon wing.
//
// Legend: `#` wall, `.` floor, `@` the entry tile (becomes the stairs back
// out), space = solid rock outside an L-shaped footprint. Every layout is at
// most 40x40 cells.
//
// `slot` is the top-left of the 9x7 story-prefab footprint (structures.json
// rooms toivo_kitchen / aino_larder / hermit_woodpile): 2 wall rows, four
// floor rows 7 wide, then a wall row with a doorway at column 4. Each layout
// draws that silhouette as a plain room, so placing a prefab there only
// changes skins and adds its furniture and pickups. A slot `y` of -1 puts the
// prefab's first wall row off the map, so the room's top wall is the house
// wall itself (placeStructure skips cells off the grid).
export const STORY_SLOT_W = 9
export const STORY_SLOT_H = 7

export const HOUSE_LAYOUTS = [
  { name: 'cottage', slot: { x: 0, y: -1 }, rows: [
    '###############',
    '#.......#.....#',
    '#.......#.....#',
    '#.......#.....#',
    '#.......#.....#',
    '####.####.....#',
    '#.............#',
    '#.............#',
    '#.............#',
    '#......@......#',
    '###############',
  ] },
  { name: 'longhouse', slot: { x: 14, y: -1 }, rows: [
    '#######################',
    '#.............#.......#',
    '#.............#.......#',
    '#.............#.......#',
    '#@............#.......#',
    '#.............####.####',
    '#.....................#',
    '#.....................#',
    '#######################',
  ] },
  { name: 'farmhouse', slot: { x: 0, y: -1 }, rows: [
    '###################',
    '#.......#.........#',
    '#.......#.........#',
    '#.......#.........#',
    '#.......#.........#',
    '####.####.........#',
    '#.................#',
    '#.......@.........#',
    '#.................#',
    '#########.........#',
    '        #.........#',
    '        #.........#',
    '        #.........#',
    '        #.........#',
    '        ###########',
  ] },
  { name: 'hall', slot: { x: 13, y: -1 }, rows: [
    '######################',
    '#.....#......#.......#',
    '#.....#......#.......#',
    '#.....#......#.......#',
    '#.....#..@...#.......#',
    '##.####......####.####',
    '#....................#',
    '#....................#',
    '#....................#',
    '#....................#',
    '######################',
  ] },
  { name: 'manor', slot: { x: 17, y: -1 }, rows: [
    '##########################',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '#...#######.....#####.####',
    '#........................#',
    '#...#............#.......#',
    '#...#.....@......#.......#',
    '#...#............#.......#',
    '#........................#',
    '####.########.#######.####',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '#........#.......#.......#',
    '##########################',
  ] },
]
