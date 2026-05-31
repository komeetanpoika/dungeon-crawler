import { generateLevel } from './systems/map.js'
import { computePlayerFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, WEAPON_TYPES, TILE, isWalkable } from './systems/entities.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta } from './systems/meta.js'
import { Renderer } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
import { FINAL_DEPTH } from './data/levels.js'

const TILE_SIZE = 32
const PLAYER_SPEED = 120
const ENEMY_CHASE_SPEED = 80
const ENEMY_WANDER_SPEED = 30
const CHASE_RANGE = 180
const CHASE_DROP_RANGE = 240
const MELEE_COOLDOWN = 0.4
const RANGED_COOLDOWN = 0.6
const PROJECTILE_SPEED = 280
const CONTACT_RANGE = 20
const CONTACT_DAMAGE_COOLDOWN = 0.8
const PLAYER_HALF = 6
const ENEMY_HALF = 4

const keys = {}
window.addEventListener('keydown', e => { keys[e.key] = true })
window.addEventListener('keyup',   e => { keys[e.key] = false })

let state = null
let meta = null
let renderer = null
let lastTime = 0
let rafId = null

function canMoveTo(map, px, py, half = PLAYER_HALF) {
  const corners = [
    [px - half, py - half],
    [px + half, py - half],
    [px - half, py + half],
    [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const tile = map[Math.floor(cy / TILE_SIZE)]?.[Math.floor(cx / TILE_SIZE)]
    return tile && isWalkable(tile.tile)
  })
}

function moveEntity(e, dx, dy, map, half = PLAYER_HALF) {
  if (dx !== 0 && canMoveTo(map, e.px + dx, e.py, half)) e.px += dx
  if (dy !== 0 && canMoveTo(map, e.px, e.py + dy, half)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}

function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
}

function buildEntities(spawns, map) {
  return spawns.flatMap(s => {
    const cx = s.x * TILE_SIZE + TILE_SIZE / 2
    const cy = s.y * TILE_SIZE + TILE_SIZE / 2
    const wander = () => ({ wanderTimer: Math.random() * 2, wanderDx: 0, wanderDy: 0, damageCooldown: 0 })
    switch (s.kind) {
      case 'guard':   return [{ ...makeGuard(s.x, s.y),             px: cx, py: cy, ...wander() }]
      case 'monster': return [{ ...makeMonster(s.x, s.y, s.variant), px: cx, py: cy, ...wander() }]
      case 'dragon':  return [{ ...makeDragon(s.x, s.y, s.roomId),  px: cx, py: cy, ...wander() }]
      case 'trap':    return [makeTrap(s.x, s.y)]
      case 'puzzle':  return [makePuzzle(s.x, s.y)]
      case 'weapon': {
        const wt = s.weaponType ?? 'dagger'
        const def = WEAPON_TYPES[wt] ?? WEAPON_TYPES.dagger
        return [makeChest(s.x, s.y, { type: 'weapon', weaponType: wt, name: def.name, damage: def.damage })]
      }
      case 'potion': return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
      case 'door':   return [makeDoor(s.x, s.y)]
      default:       return []
    }
  })
}

function startNewRun() {
  if (rafId) cancelAnimationFrame(rafId)
  const { map, entitySpawns, playerSpawn } = generateLevel(9)
  const player = makePlayer(playerSpawn.x, playerSpawn.y, meta.unlockedBonuses)
  player.px = playerSpawn.x * TILE_SIZE + TILE_SIZE / 2
  player.py = playerSpawn.y * TILE_SIZE + TILE_SIZE / 2
  player.facing = 'south'
  player.meleeCooldown = 0
  player.rangedCooldown = 0
  player.weapon = { weaponType: 'axe', name: 'Axe', damage: 4 }
  player.hp = 30
  player.maxHp = 30
  player.inventory.push(...getStartingItems(meta))
  state = {
    level: 9,
    map,
    player,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    log: ['You enter the dungeon…'],
    hitEffects: [],
    run: { deepestLevel: 9, won: false },
    gameOver: false,
  }
  lastTime = performance.now()
  rafId = requestAnimationFrame(gameLoop)
}

function gameLoop(timestamp) {
  const delta = Math.min(timestamp - lastTime, 100) / 1000
  lastTime = timestamp
  if (!state.gameOver) update(delta)
  render()
  rafId = requestAnimationFrame(gameLoop)
}

function update(delta) {
  const { player, map } = state

  // Player movement
  let vx = 0, vy = 0
  if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
  if (keys['ArrowRight'] || keys['d']) { vx += 1; player.facing = 'east'  }
  if (keys['ArrowUp']    || keys['w']) { vy -= 1; player.facing = 'north' }
  if (keys['ArrowDown']  || keys['s']) { vy += 1; player.facing = 'south' }
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF)

  // Chest interaction (walk onto chest tile)
  const chestIdx = state.entities.findIndex(e =>
    e.type === 'chest' && !e.opening && e.x === player.x && e.y === player.y)
  if (chestIdx !== -1) {
    const chest = state.entities[chestIdx]
    if (chest.contents.type === 'weapon') {
      const { weaponType, name, damage } = chest.contents
      player.weapon = { weaponType, name, damage }
      state.log = [...state.log, `Found ${name}!`].slice(-5)
    } else if (chest.contents.type === 'potion') {
      const healed = Math.min(player.maxHp - player.hp, chest.contents.amount)
      player.hp += healed
      state.log = [...state.log, healed > 0 ? `Healed ${healed} HP!` : 'Already full.'].slice(-5)
    }
    state.entities = state.entities.map((e, i) => i === chestIdx ? { ...e, opening: true, frame: 4 } : e)
  }

  // Stairs
  if (keys['Enter'] && map[player.y]?.[player.x]?.tile === TILE.STAIRS_DOWN) {
    keys['Enter'] = false
    descendLevel(); return
  }

  // Steal treasure
  if ((keys['x'] || keys['X']) && map[player.y]?.[player.x]?.tile === TILE.TREASURE) {
    state.gameOver = true; endRun(true); return
  }

  // Combat cooldowns
  player.meleeCooldown  = Math.max(0, player.meleeCooldown  - delta)
  player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)

  // Melee (Space)
  if (keys[' '] && player.meleeCooldown <= 0) {
    player.meleeCooldown = MELEE_COOLDOWN
    const dmg = player.weapon?.damage ?? 1
    const SW = 48, SH = 24
    let hx, hy, hw, hh
    switch (player.facing) {
      case 'east':  hx = player.px;        hy = player.py - SH/2; hw = SW; hh = SH; break
      case 'west':  hx = player.px - SW;   hy = player.py - SH/2; hw = SW; hh = SH; break
      case 'south': hx = player.px - SH/2; hy = player.py;        hw = SH; hh = SW; break
      case 'north': hx = player.px - SH/2; hy = player.py - SW;   hw = SH; hh = SW; break
    }
    state.entities = state.entities
      .map(e => isEnemy(e) && e.px >= hx && e.px <= hx+hw && e.py >= hy && e.py <= hy+hh
        ? { ...e, hp: e.hp - dmg, inCombat: true } : e)
      .filter(e => !isEnemy(e) || e.hp > 0)
    state.hitEffects = [{ x: player.x, y: player.y }]
  }

  // Ranged (Shift)
  if ((keys['Shift'] || keys['ShiftLeft'] || keys['ShiftRight']) && player.rangedCooldown <= 0) {
    player.rangedCooldown = RANGED_COOLDOWN
    const dmg = player.weapon?.damage ?? 1
    const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
    state.projectiles.push({ px: player.px, py: player.py, dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED, damage: dmg })
  }

  // Update projectiles
  const liveProjectiles = []
  for (const p of state.projectiles) {
    p.px += p.dx * delta
    p.py += p.dy * delta
    const tile = map[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile)) continue
    let hit = false
    state.entities = state.entities.map(e => {
      if (!isEnemy(e) || hit) return e
      if (Math.hypot(e.px - p.px, e.py - p.py) < 8) { hit = true; return { ...e, hp: e.hp - p.damage, inCombat: true } }
      return e
    })
    state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
    if (!hit) liveProjectiles.push(p)
  }
  state.projectiles = liveProjectiles

  // Enemy AI
  for (const e of state.entities) {
    if (!isEnemy(e)) continue
    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    e.wanderTimer    = Math.max(0, e.wanderTimer    - delta)
    const dist = Math.hypot(e.px - player.px, e.py - player.py)
    const chasing = dist < CHASE_RANGE && hasLineOfSight(map, e.y, e.x, player.y, player.x)
    if (chasing) {
      const len = dist || 1
      const speed = e.type === 'dragon' ? 60 : ENEMY_CHASE_SPEED
      moveEntity(e, (player.px - e.px) / len * speed * delta, (player.py - e.py) / len * speed * delta, map, ENEMY_HALF)
    } else if (dist < CHASE_DROP_RANGE) {
      if (e.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2
        e.wanderDx = Math.cos(angle); e.wanderDy = Math.sin(angle)
        e.wanderTimer = 1 + Math.random()
      }
      moveEntity(e, e.wanderDx * ENEMY_WANDER_SPEED * delta, e.wanderDy * ENEMY_WANDER_SPEED * delta, map, ENEMY_HALF)
    }
    // Contact damage
    if (dist < CONTACT_RANGE && e.damageCooldown <= 0) {
      const contactDmg = e.type === 'dragon' ? 2 : 1
      player.hp -= contactDmg
      e.damageCooldown = CONTACT_DAMAGE_COOLDOWN
      state.log = [...state.log, `Hit for ${contactDmg} damage!`].slice(-5)
    }
  }

  // Player death
  if (player.hp <= 0) {
    state.gameOver = true
    endRun(false)
  }

  // Clear hit flash — it fires once per swing
  if (state.hitEffects?.length > 0) state.hitEffects = []
}

function render() {
  computePlayerFOV(state.map, state.player)
  renderer.updateCamera(state.player)
  renderer.render(state)
  updateHUD(state)
}

function descendLevel() {
  if (state.level >= FINAL_DEPTH) return  // already on final level
  const next = state.level + 1
  const { map, entitySpawns, playerSpawn } = generateLevel(next)
  state = {
    ...state,
    level: next,
    map,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    log: [`Level ${next}. Deeper…`],
    hitEffects: [],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
}

async function endRun(won) {
  if (rafId) cancelAnimationFrame(rafId)
  state.run.won = won
  meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()
  const msg = won ? '🏆 Treasure stolen! Press R to play again.' : '💀 Run over. Press R.'
  state.log = [...state.log, msg].slice(-5)
  render()
  window.addEventListener('keydown', function restart(ev) {
    if (ev.key === 'r' || ev.key === 'R') { window.removeEventListener('keydown', restart); startNewRun() }
  })
}

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  await renderer.loadSprites()
  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()
  window.addEventListener('resize', () => renderer.resize())
  startNewRun()
}

init()
