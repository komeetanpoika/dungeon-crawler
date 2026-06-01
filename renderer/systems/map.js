import { TILE, isWalkable } from './entities.js'
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH, DEPTH_THEMES } from '../data/levels.js'

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

function carveAlcove(map, spawnRoom) {
  const sc = center(spawnRoom)
  const ay = spawnRoom.y - 3
  if (ay < 1) return null  // spawn room too close to map top

  const ax = Math.max(1, sc.x - 2)
  const axEnd = Math.min(map[0].length - 2, ax + 5)

  // Carve 5×3 floor area above spawn room
  for (let row = ay; row < ay + 3; row++)
    for (let col = ax; col < axEnd; col++)
      if (map[row]?.[col]) { map[row][col].tile = TILE.FLOOR; map[row][col].roomId = spawnRoom.id }

  // Stairs up on top row of alcove (back wall)
  if (map[ay]?.[sc.x]) map[ay][sc.x].tile = TILE.STAIRS_UP

  // Open spawn room's top wall to connect alcove
  if (map[spawnRoom.y]?.[sc.x]) map[spawnRoom.y][sc.x].tile = TILE.FLOOR

  // Player spawns in middle of alcove
  return { x: sc.x, y: ay + 1 }
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

function placeTemplate(map, template, ox, oy, roomId) {
  const spawns = []
  template.tiles.forEach((row, dy) => {
    ;[...row].forEach((ch, dx) => {
      const tx = ox + dx, ty = oy + dy
      if (!map[ty]?.[tx]) return
      if (ch === '#') {
        map[ty][tx].tile = TILE.WALL
      } else if (ch === '.') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
      } else if (ch === 'D') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'dragon', x: tx, y: ty, roomId })
      } else if (ch === 'T') {
        map[ty][tx].tile = TILE.TREASURE
        map[ty][tx].roomId = roomId
      } else if (ch === 'S') {
        map[ty][tx].tile = TILE.SHRINE
        map[ty][tx].roomId = roomId
      } else if (ch === 'W') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'weapon', x: tx, y: ty })
      } else if (ch === 'P') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'potion', x: tx, y: ty })
      } else if (ch === 'L') {
        map[ty][tx].tile = TILE.FLOOR
        map[ty][tx].roomId = roomId
        spawns.push({ kind: 'door', x: tx, y: ty })
      } else if (ch === 'X') {
        map[ty][tx].tile = TILE.SNARE
        map[ty][tx].roomId = roomId
      } else if (ch === 'C') {
        map[ty][tx].tile = TILE.COLUMN
        map[ty][tx].roomId = roomId
      }
    })
  })
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

export function generateLevel(depth, width = MAP_W, height = MAP_H) {
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

    // Spawn room: BSP room whose center is closest to map top-left (0,0)
    const spawnRoom = rooms.reduce((best, r) => {
      const c = center(r), bc = center(best)
      return (c.x + c.y) < (bc.x + bc.y) ? r : best
    }, rooms[0])
    const spawnC = center(spawnRoom)

    // Stairs-down room: farthest from spawn
    const nonSpawn = rooms.filter(r => r !== spawnRoom)
    const stairsRoom = nonSpawn.reduce((best, r) => {
      const c = center(r), bc = center(best)
      const d  = Math.abs(c.x  - spawnC.x) + Math.abs(c.y  - spawnC.y)
      const bd = Math.abs(bc.x - spawnC.x) + Math.abs(bc.y - spawnC.y)
      return d > bd ? r : best
    }, nonSpawn[0] ?? rooms[0])

    // Landmark room: random, not spawn, not stairs
    const landmarkCandidates = rooms.filter(r => r !== spawnRoom && r !== stairsRoom)
    const landmarkRoom = landmarkCandidates.length > 0
      ? landmarkCandidates[Math.floor(Math.random() * landmarkCandidates.length)]
      : null

    if (cfg.landmark && TEMPLATES[cfg.landmark] && landmarkRoom) {
      const tmpl = TEMPLATES[cfg.landmark]
      const lc = center(landmarkRoom)
      const ox = Math.max(0, Math.min(width  - tmpl.width,  lc.x - Math.floor(tmpl.width  / 2)))
      const oy = Math.max(0, Math.min(height - tmpl.height, lc.y - Math.floor(tmpl.height / 2)))
      entitySpawns.push(...placeTemplate(map, tmpl, ox, oy, roomId++))
      const tlc = { x: ox + Math.floor(tmpl.width / 2), y: oy + Math.floor(tmpl.height / 2) }
      carveCorridor(map, lc.x, lc.y, tlc.x, tlc.y)
    } else if (cfg.landmark && TEMPLATES[cfg.landmark]) {
      // Fallback: bottom-right corner
      const tmpl = TEMPLATES[cfg.landmark]
      const ox = width - tmpl.width - 2
      const oy = height - tmpl.height - 2
      entitySpawns.push(...placeTemplate(map, tmpl, ox, oy, roomId++))
      const lc = { x: ox + Math.floor(tmpl.width / 2), y: oy + Math.floor(tmpl.height / 2) }
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

    if (depth < FINAL_DEPTH) map[center(stairsRoom).y][center(stairsRoom).x].tile = TILE.STAIRS_DOWN

    // Entrance alcove above spawn room — sets stairs-up and returns player spawn position
    const alcoveSpawn = carveAlcove(map, spawnRoom)
    if (!alcoveSpawn) map[spawnC.y][spawnC.x].tile = TILE.STAIRS_UP  // fallback if alcove OOB

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

    const playerSpawn = alcoveSpawn ?? spawnC
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

    // Scatter props based on depth theme
    const roomProps = theme?.props?.room ?? []
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

    return { map, entitySpawns, playerSpawn, rooms }
  }

  return generateFallback(depth, width, height)
}

function generateFallback(depth, width, height) {
  const map = createMap(width, height)
  const rooms = [
    { x: 2,  y: 2,  w: 14, h: 10, id: 0 },
    { x: 28, y: 10, w: 20, h: 15, id: 1 },
    { x: 58, y: 32, w: 16, h: 12, id: 2 },
  ]
  rooms.forEach(r => carveRoom(map, r))
  carveCorridor(map, 9, 7, 38, 17)
  carveCorridor(map, 38, 17, 66, 38)
  map[7][9].tile = TILE.STAIRS_UP
  if (depth < FINAL_DEPTH) {
    map[38][66].tile = TILE.STAIRS_DOWN
  } else {
    map[38][66].tile = TILE.TREASURE
  }
  return { map, entitySpawns: [], playerSpawn: { x: 9, y: 8 }, rooms }
}
