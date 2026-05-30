import { TILE, isWalkable } from './entities.js'
import { TEMPLATES, LEVEL_CONFIG, FINAL_DEPTH } from '../data/levels.js'

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

function carveCorridor(map, x1, y1, x2, y2) {
  let x = x1, y = y1
  while (x !== x2) { map[y][x].tile = TILE.FLOOR; x += x < x2 ? 1 : -1 }
  while (y !== y2) { map[y][x].tile = TILE.FLOOR; y += y < y2 ? 1 : -1 }
}

function center(room) {
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
    carveCorridor(map, centers[bestFrom].x, centers[bestFrom].y, centers[bestTo].x, centers[bestTo].y)
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

function buildRooms(leaves, idStart) {
  let id = idStart
  return leaves.map(leaf => {
    const m = 2
    return { x: leaf.x + m, y: leaf.y + m, w: Math.max(6, leaf.w - m * 2), h: Math.max(6, leaf.h - m * 2), id: id++ }
  })
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

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
    const rooms = buildRooms(leaves, roomId)
    roomId += rooms.length
    rooms.forEach(r => carveRoom(map, r))
    rooms.forEach(r => { if (Math.random() < 0.5) placeColumns(map, r) })

    connectRoomsMST(map, rooms)

    if (cfg.landmark && TEMPLATES[cfg.landmark]) {
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

    const firstCenter = center(rooms[0])
    const lastCenter = center(rooms[rooms.length - 1])
    map[firstCenter.y][firstCenter.x].tile = TILE.STAIRS_UP
    if (depth < FINAL_DEPTH) map[lastCenter.y][lastCenter.x].tile = TILE.STAIRS_DOWN

    if (!isFullyConnected(map)) continue

    const floorTiles = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (map[y][x].tile === TILE.FLOOR) floorTiles.push({ x, y })

    const occupiedKeys = new Set(entitySpawns.map(s => `${s.x},${s.y}`))
    let playerSpawn = { x: firstCenter.x, y: firstCenter.y + 1 }
    if (!isWalkable(map[playerSpawn.y]?.[playerSpawn.x]?.tile)) playerSpawn = firstCenter
    occupiedKeys.add(`${playerSpawn.x},${playerSpawn.y}`)

    const farTiles = shuffle(floorTiles.filter(t =>
      Math.abs(t.x - firstCenter.x) + Math.abs(t.y - firstCenter.y) > 6 &&
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
