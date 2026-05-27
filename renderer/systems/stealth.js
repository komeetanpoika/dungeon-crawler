import { TILE, ALERT, DRAGON_STATE, isWalkable } from './entities.js'

export function propagateNoise(map, source, amount) {
  const noiseMap = {}
  const queue = [{ x: source.x, y: source.y, remaining: amount }]
  while (queue.length) {
    const { x, y, remaining } = queue.shift()
    if (remaining <= 0) continue
    const key = `${x},${y}`
    if ((noiseMap[key] ?? 0) >= remaining) continue
    noiseMap[key] = remaining
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = x + dx, ny = y + dy
      if (!map[ny]?.[nx] || !isWalkable(map[ny][nx].tile)) continue
      queue.push({ x: nx, y: ny, remaining: remaining - 1 })
    }
  }
  return noiseMap
}

export function mergeNoiseMaps(a, b) {
  const result = { ...a }
  for (const [key, val] of Object.entries(b)) result[key] = Math.max(result[key] ?? 0, val)
  return result
}

export function decayNoiseMap(nm, amount = 1) {
  const result = {}
  for (const [key, val] of Object.entries(nm)) if (val - amount > 0) result[key] = val - amount
  return result
}

export function hasLineOfSight(map, y1, x1, y2, x2) {
  const dy = y2 - y1, dx = x2 - x1
  const steps = Math.max(Math.abs(dy), Math.abs(dx))
  if (steps === 0) return true
  for (let i = 1; i <= steps; i++) {
    const y = Math.round(y1 + (dy * i) / steps)
    const x = Math.round(x1 + (dx * i) / steps)
    if (y === y2 && x === x2) break
    if (!map[y]?.[x] || !isWalkable(map[y][x].tile)) return false
  }
  return true
}

const FACING_ANGLE = { north: 270, south: 90, east: 0, west: 180 }

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function guardCanSeePlayer(map, guard, player) {
  const dist = Math.abs(guard.x - player.x) + Math.abs(guard.y - player.y)
  if (dist > guard.fovRange) return false
  const angle = (Math.atan2(player.y - guard.y, player.x - guard.x) * 180 / Math.PI + 360) % 360
  if (angleDiff(angle, FACING_ANGLE[guard.facing]) > guard.fovAngle / 2) return false
  return hasLineOfSight(map, guard.y, guard.x, player.y, player.x)
}

export function updateGuardAlert(guard, noiseMap, map, player) {
  if (guardCanSeePlayer(map, guard, player)) return { ...guard, alertState: ALERT.ALERTED }
  if (guard.alertState === ALERT.ALERTED) return guard

  const noise = noiseMap[`${guard.x},${guard.y}`] ?? 0
  if (noise >= guard.hearingRadius * 0.5) return { ...guard, alertState: ALERT.CURIOUS }
  if (guard.alertState === ALERT.CURIOUS) return { ...guard, alertState: ALERT.SEARCHING }
  if (guard.alertState === ALERT.SEARCHING) return { ...guard, alertState: ALERT.UNAWARE }
  return guard
}

export function updateDragonSleep(dragon, noiseMap) {
  const noise = noiseMap[`${dragon.x},${dragon.y}`] ?? 0
  const meter = Math.max(0, Math.min(100, dragon.sleepMeter + (noise > 0 ? noise * 0.5 : -1)))
  const dragonState = meter < 61 ? DRAGON_STATE.SLEEPING : meter < 91 ? DRAGON_STATE.STIRRING : DRAGON_STATE.AWAKE
  return { ...dragon, sleepMeter: meter, dragonState }
}

export function computePlayerFOV(map, player, radius = 8) {
  for (const row of map) for (const tile of row) tile.visible = false
  const { x: px, y: py } = player
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = px + dx, ty = py + dy
      if (!map[ty]?.[tx]) continue
      if (hasLineOfSight(map, py, px, ty, tx)) {
        map[ty][tx].visible = true
        map[ty][tx].explored = true
      }
    }
  }
}
