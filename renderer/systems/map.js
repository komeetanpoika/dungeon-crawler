import { TILE, isWalkable } from './entities.js'
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES, TEMPLATE_LEGEND } from '../data/levels.js'

const MAP_W = 80
const MAP_H = 50

export function createMap(width = MAP_W, height = MAP_H) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ tile: TILE.WALL, dirty: true, roomId: null, visible: false, explored: false }))
  )
}

function bspSplit(rect, minSize = 8) {
  const { x, y, w, h } = rect
  if (w < minSize * 2 && h < minSize * 2) return [rect]
  const splitH = w < minSize * 2 ? true : h < minSize * 2 ? false : Math.random() < 0.5
  if (splitH) {
    const sy = Math.floor(minSize + Math.random() * (h - minSize * 2))
    return [...bspSplit({ x, y, w, h: sy }, minSize), ...bspSplit({ x, y: y + sy, w, h: h - sy }, minSize)]
  }
  const sx = Math.floor(minSize + Math.random() * (w - minSize * 2))
  return [...bspSplit({ x, y, w: sx, h }, minSize), ...bspSplit({ x: x + sx, y, w: w - sx, h }, minSize)]
}

function carveRoom(map, room) {
  for (let row = room.y + 1; row < room.y + room.h - 1; row++)
    for (let col = room.x + 1; col < room.x + room.w - 1; col++) {
      map[row][col].tile = TILE.FLOOR
      map[row][col].roomId = room.id
    }
}

function carveRoomL(map, room) {
  const { x, y, w, h, id } = room
  const hw = Math.floor(w / 2)
  const hh = Math.floor(h / 2)
  const orient = Math.floor(Math.random() * 4)
  let cx, cy

  if (orient === 0) {
    // top-full + bottom-left
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+hw; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + Math.floor(hh / 2)
  } else if (orient === 1) {
    // top-full + bottom-right
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+hw; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + Math.floor(hh / 2)
  } else if (orient === 2) {
    // bottom-full + top-left
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+1; col < x+hw; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + hh + Math.floor((h - hh) / 2)
  } else {
    // bottom-full + top-right
    for (let row = y+hh; row < y+h-1; row++)
      for (let col = x+1; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    for (let row = y+1; row < y+hh; row++)
      for (let col = x+hw; col < x+w-1; col++)
        if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
    cx = x + Math.floor(w / 2); cy = y + hh + Math.floor((h - hh) / 2)
  }
  return { x: cx, y: cy }
}

function carveRoomCross(map, room) {
  const { x, y, w, h, id } = room
  const cx = x + Math.floor(w / 2)
  const cy = y + Math.floor(h / 2)
  const hw = Math.max(1, Math.floor(w / 4))
  const hh = Math.max(1, Math.floor(h / 4))
  // Horizontal bar
  for (let row = cy - hh; row <= cy + hh; row++)
    for (let col = x+1; col < x+w-1; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
  // Vertical bar
  for (let row = y+1; row < y+h-1; row++)
    for (let col = cx - hw; col <= cx + hw; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = id }
  return { x: cx, y: cy }
}

function carveRoomSunken(map, room) {
  const { x, y, w, h, id } = room
  for (let row = y+1; row < y+h-1; row++) {
    for (let col = x+1; col < x+w-1; col++) {
      if (!map[row]?.[col]) continue
      const isRing = row === y+1 || row === y+h-2 || col === x+1 || col === x+w-2
      map[row][col].tile = isRing ? TILE.FLOOR : TILE.WALL
      map[row][col].roomId = id
    }
  }
  return { x: x + Math.floor(w / 2), y: y + 1 }
}

function carveEntrancePassage(map, rooms) {
  const col = 2
  for (let row = 1; row <= 8; row++) {
    if (!map[row]?.[col]) continue
    map[row][col].tile      = TILE.STAIR
    map[row][col].stairCol  = 0
    map[row][col].stairWidth = 1
  }
  if (map[1]?.[col]) map[1][col].tile = TILE.STAIRS_UP

  const nearest = rooms.reduce((best, r) => {
    const c = center(r), d = Math.abs(c.x - col) + Math.abs(c.y - 9)
    return d < best.d ? { d, r } : best
  }, { d: Infinity, r: rooms[0] })
  carveCorridor(map, center(nearest.r).x, center(nearest.r).y, col, 9)
  // Guarantee the connection tile at the passage foot is floor (carveCorridor stops before y2)
  if (map[9]?.[col]) map[9][col].tile = TILE.FLOOR

  return { x: col, y: 1 }
}

function carveExitPassage(map, width, rooms) {
  const WALKABLE_LEN = 4
  const VOID_LEN    = 3
  const half       = Math.floor((width - 1) / 2)
  const centerCol  = map[0].length - 3          // 77 for MAP_W=80
  const startRow   = map.length - 9             // 41 for MAP_H=50
  const endRow     = map.length - 2             // 48 for MAP_H=50

  // Connect passage to nearest room. Target is startRow so the vertical leg writes
  // floor at startRow-1 (row 40) — carveCorridor stops before y2, so row 40 gets carved
  // but row 41+ is left for the passage tiles below to fill.
  const connRow = startRow                      // row 41 — corridor writes up to row 40
  const nearest = rooms.reduce((best, r) => {
    const c = center(r), d = Math.abs(c.x - centerCol) + Math.abs(c.y - connRow)
    return d < best.d ? { d, r } : best
  }, { d: Infinity, r: rooms[0] })
  carveCorridor(map, center(nearest.r).x, center(nearest.r).y, centerCol, connRow)

  // Carve passage tiles after the corridor so they are never overwritten
  for (let row = startRow; row <= endRow; row++) {
    const depth       = row - startRow          // 0 at row 41, 7 at row 48
    const isStairsDown = depth === WALKABLE_LEN // depth 4 → row 45
    const isVoid       = depth >  WALKABLE_LEN  // depths 5–7

    for (let i = 0; i < width; i++) {
      const col = centerCol - half + i
      if (!map[row]?.[col]) continue

      if (isStairsDown && i === Math.floor((width - 1) / 2)) {
        map[row][col].tile       = TILE.STAIRS_DOWN
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
        map[row][col].voidZone   = false
      } else if (isVoid) {
        map[row][col].tile       = TILE.STAIR
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
        map[row][col].voidZone   = true
      } else {
        map[row][col].tile       = TILE.STAIR
        map[row][col].stairDepth = depth
        map[row][col].stairCol   = i
        map[row][col].stairWidth = width
        map[row][col].voidZone   = false
      }
    }
  }
}

export function carveRoomShaped(map, room) {
  switch (room.shape) {
    case 'lshape': room.center = carveRoomL(map, room);      break
    case 'cross':  room.center = carveRoomCross(map, room);  break
    case 'sunken': room.center = carveRoomSunken(map, room); break
    default:       carveRoom(map, room);                      break
  }
}

function placeColumns(map, room) {
  if (room.w < 9 || room.h < 8) return
  const positions = [
    { x: room.x + 2, y: room.y + 2 },
    { x: room.x + room.w - 3, y: room.y + 2 },
    { x: room.x + 2, y: room.y + room.h - 3 },
    { x: room.x + room.w - 3, y: room.y + room.h - 3 },
  ]
  for (const p of positions) {
    const t = map[p.y]?.[p.x]
    if (t && isWalkable(t.tile)) map[p.y][p.x].tile = TILE.COLUMN
  }
}

export function carveCorridor(map, x1, y1, x2, y2, width = 1) {
  const offsets = width === 1 ? [0] : width === 2 ? [0, 1] : [-1, 0, 1]
  let x = x1, y = y1
  while (x !== x2) {
    for (const o of offsets) if (map[y + o]?.[x]) map[y + o][x].tile = TILE.FLOOR
    x += x < x2 ? 1 : -1
  }
  while (y !== y2) {
    for (const o of offsets) if (map[y]?.[x + o]) map[y][x + o].tile = TILE.FLOOR
    y += y < y2 ? 1 : -1
  }
}

function randCorridorWidth() {
  const r = Math.random()
  return r < 0.60 ? 1 : r < 0.85 ? 2 : 3
}

function center(room) {
  if (room.center) return room.center
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) }
}

function connectRoomsMST(map, rooms) {
  if (rooms.length === 0) return
  const centers = rooms.map(center)
  const connected = new Set([0])
  while (connected.size < rooms.length) {
    let bestDist = Infinity, bestFrom = -1, bestTo = -1
    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue
        const d = Math.abs(centers[i].x - centers[j].x) + Math.abs(centers[i].y - centers[j].y)
        if (d < bestDist) { bestDist = d; bestFrom = i; bestTo = j }
      }
    }
    if (bestTo === -1) break
    carveCorridor(map, centers[bestFrom].x, centers[bestFrom].y, centers[bestTo].x, centers[bestTo].y, randCorridorWidth())
    connected.add(bestTo)
  }
}

export function placeTemplate(map, template, ox, oy, roomId) {
  const spawns = []
  let bossPlaced = false
  template.tiles.forEach((row, dy) => {
    ;[...row].forEach((ch, dx) => {
      const tx = ox + dx, ty = oy + dy
      if (!map[ty]?.[tx]) return
      const entry = TEMPLATE_LEGEND[ch]
      if (!entry) return
      if (entry.kind === 'tile') {
        map[ty][tx].tile = entry.tile
        if (entry.tile !== TILE.WALL) map[ty][tx].roomId = roomId
        return
      }
      // spawn: stands on floor
      map[ty][tx].tile = TILE.FLOOR
      map[ty][tx].roomId = roomId
      if (entry.single) {
        if (bossPlaced) return
        bossPlaced = true
      }
      const spawn = { kind: entry.spawn, x: tx, y: ty }
      if (entry.roomScoped) spawn.roomId = roomId
      if (entry.isBoss) spawn.isBoss = true
      spawns.push(spawn)
    })
  })
  return spawns
}

// Stamp a painted structure prefab onto the map with its EXACT skins. Cells are
// marked `locked` so the decoration pass leaves them untouched. Collision maps to a
// logical tile (wall blocks, walkable = floor); interactions force the cell walkable
// and emit a spawn. Returns the spawn list (door/chest), like placeTemplate.
export function placeStructure(map, structure, ox, oy, roomId) {
  const spawns = []
  for (const cell of structure.cells) {
    const tx = ox + cell.x, ty = oy + cell.y
    const m = map[ty]?.[tx]
    if (!m) continue
    m.skin = cell.skin
    m.overlay = cell.overlay ?? null
    m.locked = true
    if (cell.collision === 'wall') {
      m.tile = TILE.WALL
    } else {
      m.tile = TILE.FLOOR
      m.roomId = roomId
    }
    if (cell.interaction) {
      m.tile = TILE.FLOOR        // anything you interact with stands on floor
      m.roomId = roomId
      spawns.push({ kind: cell.interaction.type, x: tx, y: ty })
    }
  }
  return spawns
}

export function isFullyConnected(map) {
  const floors = []
  for (let y = 0; y < map.length; y++)
    for (let x = 0; x < map[y].length; x++)
      if (isWalkable(map[y][x].tile)) floors.push({ x, y })
  if (floors.length === 0) return true

  const visited = new Set()
  const queue = [floors[0]]
  visited.add(`${floors[0].x},${floors[0].y}`)
  while (queue.length) {
    const { x, y } = queue.shift()
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`
      if (!visited.has(key) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile)) {
        visited.add(key); queue.push({ x: nx, y: ny })
      }
    }
  }
  return visited.size === floors.length
}

function buildRooms(leaves, idStart, depth = 1) {
  let id = idStart
  return leaves.map(leaf => {
    const m = 2
    return {
      x: leaf.x + m, y: leaf.y + m,
      w: Math.max(6, leaf.w - m * 2),
      h: Math.max(6, leaf.h - m * 2),
      id: id++,
      shape: chooseShape(leaf, depth),
    }
  })
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

function chooseShape(leaf, depth) {
  const { w, h } = leaf
  const wts = depth <= 3 ? { rect: 65, lshape: 25, cross:  8, sunken:  2 }
            : depth <= 6 ? { rect: 50, lshape: 25, cross: 15, sunken: 10 }
            :              { rect: 35, lshape: 25, cross: 22, sunken: 18 }
  const can = {
    lshape: (w >= 10 && h >= 8) || (w >= 8 && h >= 10),
    cross:  w >= 9 && h >= 9,
    sunken: w >= 9 && h >= 9,
  }
  const pool = [
    { shape: 'rect',   w: wts.rect },
    ...(can.lshape ? [{ shape: 'lshape',  w: wts.lshape  }] : []),
    ...(can.cross  ? [{ shape: 'cross',   w: wts.cross   }] : []),
    ...(can.sunken ? [{ shape: 'sunken',  w: wts.sunken  }] : []),
  ]
  const total = pool.reduce((s, e) => s + e.w, 0)
  let r = Math.random() * total
  for (const e of pool) { r -= e.w; if (r <= 0) return e.shape }
  return 'rect'
}

function healConnectivity(map) {
  for (let pass = 0; pass < 10; pass++) {
    if (isFullyConnected(map)) return
    const floors = []
    for (let y = 0; y < map.length; y++)
      for (let x = 0; x < map[y].length; x++)
        if (isWalkable(map[y][x].tile)) floors.push({ x, y })
    if (floors.length === 0) return

    const visited = new Set()
    const queue = [floors[0]]
    visited.add(`${floors[0].x},${floors[0].y}`)
    while (queue.length) {
      const { x, y } = queue.shift()
      for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`
        if (!visited.has(key) && map[ny]?.[nx] && isWalkable(map[ny][nx].tile)) {
          visited.add(key); queue.push({ x: nx, y: ny })
        }
      }
    }
    const isolated = floors.find(f => !visited.has(`${f.x},${f.y}`))
    if (!isolated) return
    let bestDist = Infinity, bestReachable = floors[0]
    for (const key of visited) {
      const [rx, ry] = key.split(',').map(Number)
      const d = Math.abs(rx - isolated.x) + Math.abs(ry - isolated.y)
      if (d < bestDist) { bestDist = d; bestReachable = { x: rx, y: ry } }
    }
    carveCorridor(map, bestReachable.x, bestReachable.y, isolated.x, isolated.y)
  }
}

export function generateLevel(depth, width = MAP_W, height = MAP_H, { skipProps = false, structures = {} } = {}) {
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]

  for (let attempt = 0; attempt < 5; attempt++) {
    const map = createMap(width, height)
    const entitySpawns = []
    let roomId = 0

    const leaves = bspSplit({ x: 0, y: 0, w: width, h: height })
    const rooms = buildRooms(leaves, roomId, depth)
    roomId += rooms.length
    rooms.forEach(r => carveRoomShaped(map, r))
    rooms.forEach(r => { if (r.shape === 'rect' && Math.random() < 0.5) placeColumns(map, r) })

    connectRoomsMST(map, rooms)

    const staircaseWidth = cfg.staircaseWidth ?? 1

    // Spawn room: closest to top-left, used as distance origin for entity/farTile placement
    const spawnRoom = rooms.reduce((best, r) => {
      const c = center(r), bc = center(best)
      return (c.x + c.y) < (bc.x + bc.y) ? r : best
    }, rooms[0])
    const spawnC = center(spawnRoom)

    // Landmark room: random, not spawn
    const landmarkCandidates = rooms.filter(r => r !== spawnRoom)
    const landmarkRoom = landmarkCandidates.length > 0
      ? landmarkCandidates[Math.floor(Math.random() * landmarkCandidates.length)]
      : null

    // Resolve the landmark: a structure whose targetDepth matches this depth wins;
    // otherwise the depth's configured landmark name. Structures take precedence
    // over a same-named TEMPLATE. When several structures target the same depth,
    // pick one at random per level so none silently shadows the others.
    const depthMatches = Object.keys(structures).filter(n => structures[n].targetDepth === depth)
    const landmarkName = depthMatches.length
      ? depthMatches[Math.floor(Math.random() * depthMatches.length)]
      : cfg.landmark
    let landmark = null
    if (landmarkName && structures[landmarkName]) {
      const s = structures[landmarkName]
      landmark = { w: s.w, h: s.h, place: (ox, oy, rid) => placeStructure(map, s, ox, oy, rid) }
    } else if (landmarkName && TEMPLATES[landmarkName]) {
      const t = TEMPLATES[landmarkName]
      landmark = { w: t.width, h: t.height, place: (ox, oy, rid) => placeTemplate(map, t, ox, oy, rid) }
    }

    if (landmark && landmarkRoom) {
      const lc = center(landmarkRoom)
      const ox = Math.max(0, Math.min(width  - landmark.w, lc.x - Math.floor(landmark.w / 2)))
      const oy = Math.max(0, Math.min(height - landmark.h, lc.y - Math.floor(landmark.h / 2)))
      entitySpawns.push(...landmark.place(ox, oy, roomId++))
      const tlc = { x: ox + Math.floor(landmark.w / 2), y: oy + Math.floor(landmark.h / 2) }
      carveCorridor(map, lc.x, lc.y, tlc.x, tlc.y)
    } else if (landmark) {
      // Fallback: bottom-right corner
      const ox = width - landmark.w - 2
      const oy = height - landmark.h - 2
      entitySpawns.push(...landmark.place(ox, oy, roomId++))
      const lc = { x: ox + Math.floor(landmark.w / 2), y: oy + Math.floor(landmark.h / 2) }
      const nearest = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - lc.x) + Math.abs(c.y - lc.y)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearest.r).x, center(nearest.r).y, lc.x, lc.y)
    }

    healConnectivity(map)

    // Ensure every room center remains walkable after template / arena placement
    rooms.forEach(r => {
      const c = r.center ?? { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }
      if (map[c.y]?.[c.x] && !isWalkable(map[c.y][c.x].tile)) {
        map[c.y][c.x].tile = TILE.FLOOR
        map[c.y][c.x].roomId = r.id
      }
    })

    // Level 6: carve a 7×7 cyclops arena near map centre
    if (cfg.cyclopsArena) {
      const ax = Math.floor(width / 2) - 3
      const ay = Math.floor(height / 2) - 3
      for (let y = ay; y < ay + 7; y++)
        for (let x = ax; x < ax + 7; x++) {
          map[y][x].tile = TILE.FLOOR
          map[y][x].roomId = roomId
        }
      const acx = ax + 3, acy = ay + 3
      entitySpawns.push({ kind: 'cyclops', x: acx, y: acy })
      const nearestArena = rooms.reduce((best, r) => {
        const c = center(r), d = Math.abs(c.x - acx) + Math.abs(c.y - acy)
        return d < best.d ? { d, r } : best
      }, { d: Infinity, r: rooms[0] })
      carveCorridor(map, center(nearestArena.r).x, center(nearestArena.r).y, acx, acy)
      roomId++
    }

    // Exit passage going down from south wall of stairs room
    if (depth < FINAL_DEPTH) carveExitPassage(map, staircaseWidth, rooms)

    // Entrance passage going up from spawn room — returns player spawn position
    const entranceSpawn = carveEntrancePassage(map, rooms)

    if (!isFullyConnected(map)) continue

    // Apply sand floor for depths 4–6
    const theme = DEPTH_THEMES.find(t => t.depths.includes(depth))
    if (theme?.floorTile === 'sand') {
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++)
          if (map[row][col].tile === TILE.FLOOR) map[row][col].tile = TILE.SAND
    }

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR || map[y][x].tile === TILE.SAND)
          floorTiles.push({ x, y })

    const playerSpawn = entranceSpawn ?? spawnC
    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)

    const farTiles = shuffle(floorTiles.filter(t =>
      Math.abs(t.x - spawnC.x) + Math.abs(t.y - spawnC.y) > 6 &&
      !occupiedKeys.has(`${t.x},${t.y}`)
    ))

    const guardCount = Math.min(cfg.guardCount ?? 2, farTiles.length)
    const monsterCount = Math.floor(farTiles.length * (cfg.monsterDensity ?? 0))
    const trapCount = Math.floor(farTiles.length * cfg.trapDensity)
    const puzzleCount = Math.floor(farTiles.length * (cfg.puzzleDensity ?? 0))
    const weaponCount = Math.floor(farTiles.length * (cfg.weaponDensity ?? 0))
    const potionCount = Math.floor(farTiles.length * (cfg.potionDensity ?? 0))

    let idx = 0
    for (let i = 0; i < guardCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'guard', ...farTiles[idx] })
    }
    for (let i = 0; i < monsterCount && idx < farTiles.length; i++, idx++) {
      const r = Math.random()
      const variant = depth <= 5
        ? (r < 0.7 ? 'weak' : 'medium')
        : depth <= 7
          ? (r < 0.4 ? 'medium' : 'strong')
          : (r < 0.5 ? 'strong' : 'boss')
      entitySpawns.push({ kind: 'monster', variant, ...farTiles[idx] })
    }
    for (let i = 0; i < trapCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'trap', ...farTiles[idx] })
    }
    for (let i = 0; i < puzzleCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'puzzle', ...farTiles[idx] })
    }
    const weaponPool = cfg.weapons ?? ['dagger']
    for (let i = 0; i < weaponCount && idx < farTiles.length; i++, idx++) {
      const weaponType = weaponPool[Math.floor(Math.random() * weaponPool.length)]
      entitySpawns.push({ kind: 'weapon', weaponType, ...farTiles[idx] })
    }
    for (let i = 0; i < potionCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'potion', ...farTiles[idx] })
    }

    const wizardCount = cfg.wizardCount ?? 0
    const crabCount   = cfg.crabCount   ?? 0
    for (let i = 0; i < wizardCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'wizard', ...farTiles[idx] })
    }
    for (let i = 0; i < crabCount && idx < farTiles.length; i++, idx++) {
      entitySpawns.push({ kind: 'crab', ...farTiles[idx] })
    }

    // Scatter props based on depth theme (skipped when a ruleset places overlays)
    const roomProps = skipProps ? [] : (theme?.props?.room ?? [])
    if (roomProps.length > 0) {
      for (const room of rooms) {
        const count = Math.floor(Math.random() * 3)  // 0–2 props per room
        const candidates = shuffle(floorTiles.filter(t =>
          t.x > room.x && t.x < room.x + room.w - 1 &&
          t.y > room.y && t.y < room.y + room.h - 1 &&
          !occupiedKeys.has(`${t.x},${t.y}`)
        ))
        for (let i = 0; i < count && i < candidates.length; i++) {
          const propType = roomProps[Math.floor(Math.random() * roomProps.length)]
          entitySpawns.push({ kind: 'prop', propType, x: candidates[i].x, y: candidates[i].y })
          occupiedKeys.add(`${candidates[i].x},${candidates[i].y}`)
        }
      }
    }

    // Place paired gargoyle+basin fountains on stone-floor levels only
    if (theme?.floorTile !== 'sand') {
      for (const room of rooms) {
        if (Math.random() > 0.6) continue  // 60% chance per room

        // Inner top wall: room.y is the top wall row; floor is at room.y + 1
        const candidates = []
        for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
          const wy = room.y, fy = room.y + 1
          if (
            map[wy]?.[x]?.tile === TILE.WALL &&
            isWalkable(map[fy]?.[x]?.tile) &&
            !occupiedKeys.has(`${x},${wy}`) &&
            !occupiedKeys.has(`${x},${fy}`)
          ) candidates.push({ wx: x, wy, fx: x, fy })
        }

        if (candidates.length === 0) continue
        const pick = candidates[Math.floor(Math.random() * candidates.length)]

        entitySpawns.push({
          kind: 'fountain_wall', propType: 'prop_gargoyle_dry',
          x: pick.wx, y: pick.wy, pairX: pick.fx, pairY: pick.fy,
        })
        entitySpawns.push({
          kind: 'fountain_basin', propType: 'prop_fountain_empty',
          x: pick.fx, y: pick.fy, pairX: pick.wx, pairY: pick.wy,
        })
        occupiedKeys.add(`${pick.wx},${pick.wy}`)
        occupiedKeys.add(`${pick.fx},${pick.fy}`)
      }
    }

    return { map, entitySpawns, playerSpawn, rooms }
  }

  return generateFallback(depth, width, height)
}

function generateFallback(depth, width, height) {
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  const staircaseWidth = cfg.staircaseWidth ?? 1
  const map = createMap(width, height)
  const rooms = [
    { x: 2,  y: 2,  w: 14, h: 10, id: 0 },
    { x: 28, y: 10, w: 20, h: 15, id: 1 },
    { x: 58, y: 32, w: 16, h: 12, id: 2 },
  ]
  rooms.forEach(r => carveRoom(map, r))
  carveCorridor(map, 9, 7, 38, 17)
  carveCorridor(map, 38, 17, 66, 38)
  if (depth < FINAL_DEPTH) {
    carveExitPassage(map, staircaseWidth, rooms)
  } else {
    map[38][66].tile = TILE.TREASURE
  }
  const playerSpawn = carveEntrancePassage(map, rooms)
  return { map, entitySpawns: [], playerSpawn, rooms }
}
