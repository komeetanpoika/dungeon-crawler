// Hand-authored PvP arenas. buildArena makes the walled room and its
// `columns`; the sim reads `spawns` and `pickups` itself. 32×24 tiles:
// interior x 1..30, y 1..22.
const rect = (x, y, w, h) => {
  const cells = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push({ x: x + dx, y: y + dy })
  return cells
}

export const PVP_ARENAS = {
  // Four corner pillars, wall segments on each side for cover, four posts
  // ringing the exposed centre where the rune sits.
  pillars: {
    size: { w: 32, h: 24 },
    columns: [
      ...rect(6, 5, 2, 2), ...rect(24, 5, 2, 2), ...rect(6, 17, 2, 2), ...rect(24, 17, 2, 2),
      ...rect(13, 4, 6, 1), ...rect(13, 19, 6, 1),
      ...rect(4, 9, 1, 6), ...rect(27, 9, 1, 6),
      ...rect(11, 9, 2, 1), ...rect(19, 9, 2, 1), ...rect(11, 14, 2, 1), ...rect(19, 14, 2, 1),
      ...rect(9, 11, 1, 2), ...rect(22, 11, 1, 2),
    ],
    spawns: [{ x: 2, y: 2 }, { x: 29, y: 2 }, { x: 2, y: 21 }, { x: 29, y: 21 }, { x: 15, y: 2 }, { x: 16, y: 21 }],
    pickups: [
      { kind: 'flask', x: 7, y: 12 }, { kind: 'flask', x: 24, y: 11 },
      { kind: 'quiver', x: 15, y: 6 }, { kind: 'quiver', x: 16, y: 17 },
      { kind: 'rune', x: 16, y: 12 },
    ],
  },
}
