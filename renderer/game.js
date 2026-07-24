import { generateLevel } from './systems/map.js'
import { maybeComputeFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, makeExitDoor, WEAPON_TYPES, RANGED_WEAPON_TYPES, makeRangedContents, TILE, isWalkable } from './systems/entities.js'
import { makeCyclops, updateCyclops } from './systems/cyclops.js'
import { makeWizard, updateWizard } from './systems/wizard.js'
import { makeCrab, updateCrab } from './systems/crab.js'
import { makeDragonBoss, updateDragonBoss } from './systems/dragonboss.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta } from './systems/meta.js'
import { decorateMap, pruneMissingTiles, rulesetHasOverlays } from './systems/decorate.js'
import { Renderer } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
import { tickWalk } from './systems/walk.js'
import { FINAL_DEPTH, DEPTH_THEMES, LEVEL_CONFIG } from './data/levels.js'
import { countBosses, spawnBossDrop } from './systems/progression.js'
import { PHASE, canTransition } from './systems/phase.js'
import * as menu from './ui/menu.js'
import { damagePlayer } from './systems/player-damage.js'
import { startKnockback, stepKnockback } from './systems/knockback.js'
import { tryStartEnemyAttack, stepEnemyAttack } from './systems/enemy-attack.js'
import { meleeDamageToDragon, coreBlocks } from './systems/capsules.js'
import { updateBrain } from './systems/brain.js'
import { act } from './systems/act.js'
import { parseWeaponCheat } from './systems/cheats.js'
import { applyShockwave, SHOCK_RADIUS } from './systems/shockwave.js'
import { toggleAttackMode, tryFire, FIRE_FAIL_MESSAGES } from './systems/ranged.js'
import { rollChestLoot } from './systems/loot.js'

const TILE_SIZE = 32
const PLAYER_SPEED = 120
const MELEE_COOLDOWN = 0.4
const PROJECTILE_SPEED = 280
const CONTACT_RANGE = 20
const PLAYER_HALF = 6
const ENEMY_HALF = 4
const SPIDER_SHOOT_RANGE = 130
const DRAGON_SHOOT_RANGE = 200
const SPIDER_SHOOT_COOLDOWN = 2.0
const DRAGON_CHARGE_DUR      = 1.0
const DRAGON_EXHALE_DUR      = 0.8
const DRAGON_BREATH_COOLDOWN = 2.5
const DRAGON_CONE_HALF       = Math.PI * 0.21

const ATTACK_STYLES = {
  dagger:       { style: 'snap',  duration: 0.12, cooldown: 0.30, knockback: 10 },
  sword:        { style: 'arc',   duration: 0.20, cooldown: 0.40, knockback: 18 },
  longsword:    { style: 'slash', duration: 0.22, cooldown: 0.50, knockback: 24 },
  axe:          { style: 'spin',  duration: 0.35, cooldown: 0.60, knockback: 34 },
  maunonmiekka: { style: 'arc',   duration: 0.20, cooldown: 0.40, knockback: 60 },
}

function getAttack(weaponType) {
  return ATTACK_STYLES[weaponType] ?? { style: 'arc', duration: 0.20, cooldown: 0.40, knockback: 18 }
}

function meleeHit(style, facingAngle, dx, dy) {
  const c = Math.cos(-facingAngle), s = Math.sin(-facingAngle)
  const rx = dx * c - dy * s   // forward component
  const ry = dx * s + dy * c   // side component
  const dist = Math.hypot(dx, dy)
  switch (style) {
    case 'snap':  return rx > 0 && rx < 28 && Math.abs(ry) < 10          // narrow stab
    case 'arc':   return dist < 52 && Math.abs(Math.atan2(ry, rx)) < Math.PI * 70/180  // 140° sweep
    case 'slash': return rx > -4 && rx < 60 && Math.abs(ry) < 14         // long thrust
    case 'spin':  return dist < 38                                          // full circle
    default:      return rx > 0 && rx < 40 && Math.abs(ry) < 20
  }
}

const keys = {}
window.addEventListener('keydown', e => { keys[e.key] = true })
window.addEventListener('keyup',   e => { keys[e.key] = false })
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (phase === PHASE.PLAYING) pauseGame()
    else if (phase === PHASE.PAUSED) resumeGame()
  }
})

// Shift toggles melee/ranged stance. Edge-triggered: e.repeat filters the
// held-key auto-repeat so holding Shift doesn't flap the mode.
window.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || e.repeat) return
  if (phase !== PHASE.PLAYING || !state) return
  const mode = toggleAttackMode(state.player)
  state.log = [...state.log, mode === 'ranged' ? 'Ranged stance.' : 'Melee stance.'].slice(-5)
})

// In-game weapon cheat: type "mauno" during a run to wield the Maunonmiekka.
let gameCheatBuffer = ''
window.addEventListener('keydown', e => {
  if (phase !== PHASE.PLAYING || !state || e.key.length !== 1) return
  gameCheatBuffer = (gameCheatBuffer + e.key).toLowerCase().slice(-12)
  const wt = parseWeaponCheat(gameCheatBuffer)
  if (wt) {
    gameCheatBuffer = ''
    const def = WEAPON_TYPES[wt]
    state.player.weapon = { weaponType: wt, name: def.name, damage: def.damage }
    state.log = [...state.log, `The ${def.name} answers your call! (${def.damage} dmg)`].slice(-5)
  }
})

let state = null
let meta = null
let renderer = null
let lastTime = 0
let rafId = null
let rulesets = {}
let structures = {}
let phase = PHASE.TITLE

// Every distinct skin/overlay used by any structure, so the renderer can draw them
// even when the active ruleset doesn't reference those tiles.
function structureTileNames(structs) {
  const names = new Set()
  for (const s of Object.values(structs)) {
    for (const c of s.cells ?? []) {
      if (c.skin) names.add(c.skin)
      if (c.overlay) names.add(c.overlay)
    }
  }
  return [...names]
}

function rulesetTileNames(rs) {
  const names = new Set()
  for (const set of Object.values(rs))
    for (const name of Object.keys(set.tiles ?? {})) names.add(name)
  return [...names]
}

function canMoveTo(map, px, py, half = PLAYER_HALF) {
  const corners = [
    [px - half, py - half],
    [px + half, py - half],
    [px - half, py + half],
    [px + half, py + half],
  ]
  return corners.every(([cx, cy]) => {
    const tile = map[Math.floor(cy / TILE_SIZE)]?.[Math.floor(cx / TILE_SIZE)]
    return tile && isWalkable(tile.tile, tile)
  })
}

function moveEntity(e, dx, dy, map, half = PLAYER_HALF, boss = null) {
  const free = (px, py) => canMoveTo(map, px, py, half) && !(boss && coreBlocks(px, py, half, boss))
  if (dx !== 0 && free(e.px + dx, e.py)) e.px += dx
  if (dy !== 0 && free(e.px, e.py + dy)) e.py += dy
  e.x = Math.floor(e.px / TILE_SIZE)
  e.y = Math.floor(e.py / TILE_SIZE)
}

function isEnemy(e) {
  return e.type === 'guard' || e.type === 'monster' || e.type === 'dragon'
      || e.type === 'cyclops' || e.type === 'wizard' || e.type === 'crab'
      || e.type === 'dragon_boss'
}

function buildEntities(spawns, map, depth) {
  return spawns.flatMap(s => {
    const cx = s.x * TILE_SIZE + TILE_SIZE / 2
    const cy = s.y * TILE_SIZE + TILE_SIZE / 2
    // Arena testing hook: spawn an enemy pre-damaged (e.g. to observe low-HP
    // fleeing) via an `hp` override, clamped to [1, maxHp].
    const aiInit = () => ({ damageCooldown: 0 })
    const hpOverride = e =>
      Number.isFinite(s.hp) ? { ...e, hp: Math.max(1, Math.min(e.maxHp, Math.round(s.hp))) } : e
    switch (s.kind) {
      case 'guard':   return [hpOverride({ ...makeGuard(s.x, s.y),  px: cx, py: cy, facing: 'east', ...aiInit() })]
      case 'monster': {
        const m = hpOverride({ ...makeMonster(s.x, s.y, s.variant), px: cx, py: cy, facing: 'east', ...aiInit() })
        if (s.variant === 'medium') m.shootCooldown = Math.random() * SPIDER_SHOOT_COOLDOWN
        return [m]
      }
      case 'dragon':  return [hpOverride({ ...makeDragon(s.x, s.y, s.roomId), px: cx, py: cy, facing: 'east',
  breathState: 'idle', breathTimer: DRAGON_BREATH_COOLDOWN, breathAngle: 0,
  breathProgress: 0, breathParticles: [], breathDamageAcc: 0, ...aiInit(), ...(s.isBoss && { isBoss: true }) })]
      case 'trap':    return [makeTrap(s.x, s.y)]
      case 'puzzle':  return [makePuzzle(s.x, s.y)]
      case 'weapon': {
        const wt = s.weaponType ?? 'dagger'
        const def = WEAPON_TYPES[wt] ?? WEAPON_TYPES.dagger
        return [makeChest(s.x, s.y, { type: 'weapon', weaponType: wt, name: def.name, damage: def.damage })]
      }
      case 'ranged':  return [makeChest(s.x, s.y, makeRangedContents(s.weaponType))]
      case 'potion': return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
      case 'door':    return [makeDoor(s.x, s.y)]
      case 'exit_door': return [makeExitDoor(s.x, s.y)]
      case 'chest':   return [makeChest(s.x, s.y, rollChestLoot(depth))]
      case 'cyclops': return [hpOverride({ ...makeCyclops(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'wizard':  return [hpOverride({ ...makeWizard(s.x, s.y),  px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'crab':    return [hpOverride({ ...makeCrab(s.x, s.y),    px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'dragon_boss': return [hpOverride({ ...makeDragonBoss(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'prop':           return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y }]
      case 'fountain_wall':  return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y,
        isFountainWall: true, flowing: false, fountainTime: 0, pairX: s.pairX, pairY: s.pairY }]
      case 'fountain_basin': return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y,
        isFountainBasin: true, flowing: false, fountainTime: 0, pairX: s.pairX, pairY: s.pairY }]
      default:               return []
    }
  })
}

function startNewRun(depth = 1, arenaCfg = null) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures, arena: arenaCfg })
  const player = makePlayer(playerSpawn.x, playerSpawn.y, meta.unlockedBonuses)
  player.px = playerSpawn.x * TILE_SIZE + TILE_SIZE / 2
  player.py = playerSpawn.y * TILE_SIZE + TILE_SIZE / 2
  player.facing = 'south'
  player.meleeCooldown = 0
  player.rangedCooldown = 0
  player.attackTimer = 0
  player.attackDuration = 0.20
  player.attackStyle = 'arc'
  player.attackFacing = 'south'
  player.inventory.push(...getStartingItems(meta))
  if (depth === 0 && arenaCfg?.player) {
    const po = arenaCfg.player
    const def = WEAPON_TYPES[po.weaponType]
    if (def) player.weapon = { weaponType: po.weaponType, name: def.name, damage: def.damage }
    else if (po.weaponType !== undefined) console.warn(`arena: unknown player weaponType "${po.weaponType}" — keeping current weapon`)
    const rdef = RANGED_WEAPON_TYPES[po.rangedType]
    if (rdef) player.ranged = makeRangedContents(po.rangedType)
    else if (po.rangedType !== undefined) console.warn(`arena: unknown player rangedType "${po.rangedType}" — no ranged weapon`)
    if (Number.isFinite(po.hp) && po.hp >= 1) {
      player.maxHp = Math.max(player.maxHp, Math.round(po.hp))
      player.hp = Math.round(po.hp)
    }
  }
  decorateMap(map, rulesets[theme.ruleset])
  state = {
    level: depth,
    map,
    player,
    theme,
    entities: buildEntities(entitySpawns, map, depth),
    projectiles: [],
    shockwaves: [],
    log: ['You enter the dungeon…'],
    hitEffects: [],
    shake: 0,
    run: { deepestLevel: depth, won: false },
    gameOver: false,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
    fireMsgCooldown: 0,
  }
}

function setPhase(to) {
  if (canTransition(phase, to)) phase = to
}

function goTitle() {
  phase = PHASE.TITLE
  menu.showTitle(meta, {
    onPlay: beginRun,
    onOpenEditor: () => window.saveAPI.openEditor(),
    onQuit: () => window.saveAPI.quitApp(),
    onCheat: (depth) => beginRun(depth),
  })
}

async function beginRun(depth = 1) {
  let arenaCfg = null
  if (depth === 0 && window.saveAPI?.loadArenaConfig) {
    const res = await window.saveAPI.loadArenaConfig()
    if (res?.error) console.warn(res.error)
    arenaCfg = res?.config ?? null
  }
  setPhase(PHASE.PLAYING)
  menu.hide()
  startNewRun(depth, arenaCfg)
}

function resumeGame() {
  setPhase(PHASE.PLAYING)
  menu.hide()
}

function pauseGame() {
  setPhase(PHASE.PAUSED)
  menu.showPause({ onResume: resumeGame, onRestart: beginRun, onQuitToTitle: goTitle })
}

function gameLoop(timestamp) {
  const delta = Math.min(timestamp - lastTime, 100) / 1000
  lastTime = timestamp
  // Only the PLAYING phase animates. While paused / on the title / game-over
  // screens the near-opaque menu overlay covers a frozen frame, so re-rendering
  // it 60×/sec is pure wasted CPU (worse here: rendering is software, GPU off).
  if (phase === PHASE.PLAYING) {
    update(delta)
    if (state) render()
  }
  rafId = requestAnimationFrame(gameLoop)
}

function update(delta) {
  if (!state) return
  const { player, map } = state
  state.shake = Math.max(0, (state.shake ?? 0) - 30 * delta)   // px/s decay

  // Player movement — skip if grabbed by a crab this frame
  const wasGrabbed = player.grabbed ?? false
  player.grabbed = false
  let vx = 0, vy = 0
  if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
  if (keys['ArrowRight'] || keys['d']) { vx += 1; player.facing = 'east'  }
  if (keys['ArrowUp']    || keys['w']) { vy -= 1; player.facing = 'north' }
  if (keys['ArrowDown']  || keys['s']) { vy += 1; player.facing = 'south' }
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  const boss = state.entities.find(e => e.type === 'dragon_boss') ?? null
  if (!wasGrabbed) moveEntity(player, vx * PLAYER_SPEED * delta, vy * PLAYER_SPEED * delta, map, PLAYER_HALF, boss)

  // Chest interaction (walk onto chest tile)
  const chestIdx = state.entities.findIndex(e =>
    e.type === 'chest' && !e.opening && e.x === player.x && e.y === player.y)
  if (chestIdx !== -1) {
    const chest = state.entities[chestIdx]
    // Open chest — item jumps to adjacent floor tile
    const adj = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: chest.x+dx, y: chest.y+dy }))
      .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x===t.x && e.y===t.y))
    if (adj) {
      state.entities.push({
        type: 'floating_item',
        contents: chest.contents,
        x: adj.x, y: adj.y,
        startPx: chest.x * TILE_SIZE + TILE_SIZE / 2,
        startPy: chest.y * TILE_SIZE + TILE_SIZE / 2,
        targetPx: adj.x * TILE_SIZE + TILE_SIZE / 2,
        targetPy: adj.y * TILE_SIZE + TILE_SIZE / 2,
        px: chest.x * TILE_SIZE + TILE_SIZE / 2,
        py: chest.y * TILE_SIZE + TILE_SIZE / 2,
        progress: 0, duration: 0.35,
      })
    } else {
      // No free adjacent tile — give directly
      if (chest.contents.type === 'weapon') {
        player.weapon = { ...chest.contents }
        state.log = [...state.log, `Found ${chest.contents.name}!`].slice(-5)
      } else if (chest.contents.type === 'ranged') {
        player.ranged = { ...chest.contents }
        state.log = [...state.log, `Found ${chest.contents.name}! (${chest.contents.ammo} shots)`].slice(-5)
      } else if (chest.contents.type === 'potion') {
        const healed = Math.min(player.maxHp - player.hp, chest.contents.amount)
        player.hp += healed
        state.log = [...state.log, healed > 0 ? `Healed ${healed} HP!` : 'Already full.'].slice(-5)
      }
    }
    state.entities = state.entities.map((e, i) => i === chestIdx ? { ...e, opening: true, frame: 2 } : e)
  }

  // Floating item pickup (step onto landing tile once arc completes)
  const floatIdx = state.entities.findIndex(e =>
    e.type === 'floating_item' && e.progress >= 1 && e.x === player.x && e.y === player.y)
  if (floatIdx !== -1) {
    const item = state.entities[floatIdx]
    if (item.contents.type === 'weapon') {
      player.weapon = { ...item.contents }
      state.log = [...state.log, `Picked up ${item.contents.name}!`].slice(-5)
    } else if (item.contents.type === 'ranged') {
      player.ranged = { ...item.contents }
      state.log = [...state.log, `Picked up ${item.contents.name}! (${item.contents.ammo} shots)`].slice(-5)
    } else if (item.contents.type === 'potion') {
      const healed = Math.min(player.maxHp - player.hp, item.contents.amount)
      player.hp += healed
      state.log = [...state.log, healed > 0 ? `Healed ${healed} HP!` : 'Already full.'].slice(-5)
    }
    state.entities = state.entities.filter((_, i) => i !== floatIdx)
  }

  // Key pickup — walk onto the key the boss dropped
  const keyIdx = state.entities.findIndex(e => e.type === 'key' && e.x === player.x && e.y === player.y)
  if (keyIdx !== -1) {
    state.entities = state.entities.filter((_, i) => i !== keyIdx)
    state.hasKey = true
    state.log = [...state.log, 'You picked up the key!'].slice(-5)
  }

  // Exit door — open and descend with the key, otherwise it stays locked
  const exitDoor = state.entities.find(e => e.type === 'door' && e.isExit && e.x === player.x && e.y === player.y)
  if (exitDoor) {
    if (state.hasKey) {
      exitDoor.opening = true; exitDoor.frame = 3
      state.hasKey = false
      descendLevel(); return
    }
    state.lockedMsgCooldown = Math.max(0, (state.lockedMsgCooldown ?? 0) - delta)
    if (state.lockedMsgCooldown <= 0) {
      state.log = [...state.log, 'The door is locked — defeat the boss for its key.'].slice(-5)
      state.lockedMsgCooldown = 2
    }
  }

  // Victory: walk onto the treasure the final boss dropped
  const treasureIdx = state.entities.findIndex(e => e.type === 'treasure' && e.x === player.x && e.y === player.y)
  if (treasureIdx !== -1) { state.gameOver = true; endRun(true); return }

  // Fountain toggle (F key — player must stand on basin tile)
  if (keys['f'] || keys['F']) {
    keys['f'] = false; keys['F'] = false
    const basin = state.entities.find(e =>
      e.type === 'prop' && e.isFountainBasin && e.x === player.x && e.y === player.y
    )
    if (basin) {
      basin.flowing = !basin.flowing
      basin.propType = basin.flowing ? 'prop_fountain_full' : 'prop_fountain_empty'
      if (!basin.flowing) basin.fountainTime = 0
      const wall = state.entities.find(e =>
        e.type === 'prop' && e.isFountainWall && e.x === basin.pairX && e.y === basin.pairY
      )
      if (wall) {
        wall.flowing = basin.flowing
        wall.propType = wall.flowing ? 'prop_gargoyle_flow' : 'prop_gargoyle_dry'
        if (!wall.flowing) wall.fountainTime = 0
      }
    }
  }

  // Combat cooldowns
  player.meleeCooldown  = Math.max(0, player.meleeCooldown  - delta)
  player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)
  player.attackTimer    = Math.max(0, player.attackTimer    - delta)
  player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - delta)

  // Melee (Space)
  if (keys[' '] && player.attackMode !== 'ranged' && player.meleeCooldown <= 0) {
    const atk = getAttack(player.weapon?.weaponType)
    player.meleeCooldown = atk.cooldown
    player.attackTimer = atk.duration
    player.attackDuration = atk.duration
    player.attackStyle = atk.style
    player.attackFacing = player.facing
    const dmg = player.weapon?.damage ?? 1
    const fa = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.facing] ?? 0
    const miekka = player.weapon?.weaponType === 'maunonmiekka'
    const struck = []   // enemies hit this swing (for the Maunonmiekka's shockwave)
    state.entities = state.entities
      .map(e => {
        if (!isEnemy(e)) return e
        if (e.type === 'dragon_boss') {
          const swingHit = (cx, cy) => meleeHit(atk.style, fa, cx - player.px, cy - player.py)
          const bossDmg = meleeDamageToDragon(player, e, swingHit)
          if (bossDmg <= 0) return e
          const bossHit = { ...e, hp: e.hp - bossDmg, inCombat: true }
          if (miekka) struck.push(bossHit)
          return bossHit
        }
        if (!meleeHit(atk.style, fa, e.px - player.px, e.py - player.py)) return e
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        const hitEnemy = { ...e, hp: e.hp - dmg, inCombat: true }
        startKnockback(hitEnemy, hitEnemy.px - player.px, hitEnemy.py - player.py, atk.knockback)
        if (miekka) struck.push(hitEnemy)
        return hitEnemy
      })
      .filter(e => !isEnemy(e) || e.hp > 0)
    // Maunonmiekka magic: a crimson shockwave bursts from every struck enemy,
    // splashing damage + knockback onto its neighbours.
    if (struck.length) {
      const exclude = new Set(struck)
      let pulsed = false
      for (const s of struck) {
        const res = applyShockwave(state.entities, s.px, s.py, exclude)
        state.entities = res.entities
        state.shockwaves.push({ px: s.px, py: s.py, t: 0, dur: 0.35, maxRadius: SHOCK_RADIUS })
        pulsed = pulsed || res.hitCount > 0
      }
      if (pulsed) state.log = [...state.log, 'The Maunonmiekka pulses!'].slice(-5)
    }
    state.hitEffects = [{ x: player.x, y: player.y }]
  }

  // Ranged (Space while in ranged stance). tryFire gates on weapon presence,
  // ammo, and the per-weapon cooldown; failures (except cooldown) get a
  // throttled HUD message so holding Space doesn't spam the log.
  state.fireMsgCooldown = Math.max(0, (state.fireMsgCooldown ?? 0) - delta)
  if (keys[' '] && player.attackMode === 'ranged') {
    const shot = tryFire(player)
    if (shot.ok) {
      const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
      state.projectiles.push({ px: player.px, py: player.py,
        dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED,
        damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true })
    } else if (FIRE_FAIL_MESSAGES[shot.reason] && state.fireMsgCooldown <= 0) {
      state.log = [...state.log, FIRE_FAIL_MESSAGES[shot.reason]].slice(-5)
      state.fireMsgCooldown = 1.5
    }
  }

  // Update projectiles
  const liveProjectiles = []
  for (const p of state.projectiles) {
    const stepDist = Math.hypot(p.dx, p.dy) * delta
    p.px += p.dx * delta
    p.py += p.dy * delta
    if (p.maxDist !== undefined) { p.distTraveled = (p.distTraveled ?? 0) + stepDist; if (p.distTraveled >= p.maxDist) continue }
    const tile = map[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile, tile)) continue
    let hit = false
    if (p.friendly) {
      state.entities = state.entities.map(e => {
        if (!isEnemy(e) || hit) return e
        if (e.type === 'dragon_boss') return e          // immune to ranged; projectile passes over
        const hitR = 8
        if (Math.hypot(e.px - p.px, e.py - p.py) < hitR) {
          if (e.type === 'wizard' && e.shieldTimer > 0) { hit = true; return e }
          hit = true
          return { ...e, hp: e.hp - p.damage, inCombat: true }
        }
        return e
      })
      state.entities = state.entities.filter(e => !isEnemy(e) || e.hp > 0)
    } else {
      if (Math.hypot(player.px - p.px, player.py - p.py) < 10) {
        damagePlayer(state, p.damage, 'hit', `Hit for ${p.damage} damage!`)
        hit = true
      }
    }
    if (!hit) liveProjectiles.push(p)
  }
  state.projectiles = liveProjectiles

  // Enemy AI — iterate a snapshot so wizard summons don't re-enter this frame
  for (const e of [...state.entities]) {
    if (!isEnemy(e)) continue

    if (e.type === 'cyclops')    { updateCyclops(e, state, delta);    continue }
    if (e.type === 'wizard')     { updateWizard(e, state, delta);     continue }
    if (e.type === 'crab')       { updateCrab(e, state, delta);       continue }
    if (e.type === 'dragon_boss') { updateDragonBoss(e, state, delta); continue }

    e.damageCooldown = Math.max(0, e.damageCooldown - delta)
    const dist = Math.hypot(e.px - player.px, e.py - player.py)
    const canMove = e.type !== 'dragon' || e.breathState === 'idle'
    const prevPx = e.px
    if (canMove) act(e, state, delta, updateBrain(e, state, delta))
    const movedX = e.px - prevPx
    if (Math.abs(movedX) > 0.1) e.facing = movedX > 0 ? 'east' : 'west'

    // Dragon fire breath state machine
    if (e.type === 'dragon') {
      e.breathTimer = Math.max(0, e.breathTimer - delta)

      if (e.breathState === 'idle') {
        if (e.breathTimer <= 0 && dist < DRAGON_SHOOT_RANGE &&
            hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
          e.breathState = 'charge'
          e.breathTimer = DRAGON_CHARGE_DUR
          e.breathProgress = 0
        }

      } else if (e.breathState === 'charge') {
        e.breathProgress = 1 - e.breathTimer / DRAGON_CHARGE_DUR
        if (e.breathTimer <= 0) {
          e.breathState = 'exhale'
          e.breathTimer = DRAGON_EXHALE_DUR
          e.breathProgress = 0
          e.breathAngle = Math.atan2(player.py - e.py, player.px - e.px)
          e.breathParticles = []
          e.breathDamageAcc = 0
        }

      } else if (e.breathState === 'exhale') {
        e.breathProgress = 1 - e.breathTimer / DRAGON_EXHALE_DUR

        // Damage: 3 HP/sec while player is inside cone
        const dx = player.px - e.px, dy = player.py - e.py
        const playerDist = Math.hypot(dx, dy)
        if (playerDist < DRAGON_SHOOT_RANGE && playerDist > 0) {
          let angleDiff = Math.atan2(dy, dx) - e.breathAngle
          while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
          if (Math.abs(angleDiff) < DRAGON_CONE_HALF) {
            e.breathDamageAcc += 3 * delta
            while (e.breathDamageAcc >= 1) {
              damagePlayer(state, 1, 'dot', 'Dragon fire! (-1 HP)')
              e.breathDamageAcc -= 1
            }
          }
        }

        // Spawn 5 particles per frame
        for (let i = 0; i < 5; i++) {
          const a = e.breathAngle + (Math.random() - 0.5) * DRAGON_CONE_HALF * 2
          const spd = 1.5 + Math.random() * 2
          const d = 8 + Math.random() * 50
          e.breathParticles.push({
            x: e.px + Math.cos(a) * d, y: e.py + Math.sin(a) * d,
            vx: Math.cos(a + (Math.random() - 0.5) * 0.6) * spd,
            vy: Math.sin(a + (Math.random() - 0.5) * 0.6) * spd,
            heat: 5 + Math.random() * 3, life: 1,
            decay: 0.04 + Math.random() * 0.06,
          })
        }

        // Advance and cull particles
        e.breathParticles = e.breathParticles
          .map(p => ({ ...p,
            x: p.x + p.vx, y: p.y + p.vy,
            vx: p.vx + (Math.random() - 0.5) * 0.2,
            vy: p.vy + (Math.random() - 0.5) * 0.2,
            life: p.life - p.decay,
            heat: Math.max(1, p.heat - 0.06),
          }))
          .filter(p => p.life > 0)

        if (e.breathTimer <= 0) {
          e.breathState = 'idle'
          e.breathTimer = DRAGON_BREATH_COOLDOWN
          e.breathParticles = []
        }
      }
    }

    // Ranged attack — spider (medium) only; dragon uses breath
    const isShooter = e.type === 'monster' && e.variant === 'medium'
    if (isShooter && e.shootCooldown !== undefined) {
      e.shootCooldown = Math.max(0, e.shootCooldown - delta)
      if (e.shootCooldown <= 0 && dist < SPIDER_SHOOT_RANGE && dist > CONTACT_RANGE && hasLineOfSight(map, e.y, e.x, player.y, player.x)) {
        e.shootCooldown = SPIDER_SHOOT_COOLDOWN
        const len = dist || 1
        const speed = 150
        const dmg = 1
        const color = '#a855f7'
        state.projectiles.push({
          px: e.px, py: e.py,
          dx: ((player.px - e.px) / len) * speed,
          dy: ((player.py - e.py) / len) * speed,
          damage: dmg, friendly: false,
          maxDist: SPIDER_SHOOT_RANGE, distTraveled: 0, color,
        })
      }
    }

    // Contact melee — weapon framework (damage/range/cooldown from the enemy's weapon)
    tryStartEnemyAttack(e, state)
  }

  // Footfall screenshake — dragon boss stomps
  const stomper = state.entities.find(e => e.type === 'dragon_boss' && e.footfall)
  if (stomper) state.shake = 6

  // Advance fountain animation timers
  for (const e of state.entities) {
    if (e.type === 'prop' && e.flowing) {
      e.fountainTime = (e.fountainTime ?? 0) + delta
    }
  }

  // Advance Maunonmiekka shockwave rings
  if (state.shockwaves?.length) {
    state.shockwaves = state.shockwaves
      .map(w => ({ ...w, t: w.t + delta }))
      .filter(w => w.t < w.dur)
  }

  // Advance floating item arcs
  for (const e of state.entities) {
    if (e.type !== 'floating_item') continue
    e.progress = Math.min(1, e.progress + delta / e.duration)
    const t = e.progress
    const arcH = TILE_SIZE * 1.5
    e.px = e.startPx + (e.targetPx - e.startPx) * t
    e.py = e.startPy + (e.targetPy - e.startPy) * t - arcH * 4 * t * (1 - t)
  }

  // Walk animation — player + humanoid enemies (guard, wizard)
  tickWalk(player, delta)
  for (const e of state.entities) {
    if (e.type === 'guard' || e.type === 'wizard') tickWalk(e, delta)
  }

  // Player death
  if (player.hp <= 0) {
    state.gameOver = true
    endRun(false)
  }

  // Boss gating: remember the living boss's tile; when it dies, materialize the exit
  if (state.gameOver) return
  if (countBosses(state.entities) > 0) {
    const boss = state.entities.find(e => e.isBoss)
    state.lastBossTile = { x: boss.x, y: boss.y }
  } else if (state.lastBossTile && !state.dropSpawned) {
    const isFinal = state.level >= FINAL_DEPTH
    const cfg = LEVEL_CONFIG.find(c => c.depth === state.level) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
    state.entities.push(spawnBossDrop(state.lastBossTile, isFinal, cfg.weapons))
    state.dropSpawned = true
    state.log = [...state.log, isFinal ? 'The dragon falls — treasure gleams!' : 'The boss drops a key!'].slice(-5)
  }

  // Advance in-flight enemy melee attacks (windup → strike → swing)
  for (const e of state.entities) stepEnemyAttack(e, state, delta)

  // Resolve knockback slides after AI has moved everything this frame.
  for (const e of state.entities) {
    stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
  }
  stepKnockback(player, delta, (px, py) => canMoveTo(map, px, py, PLAYER_HALF))

  // Clear hit flash — it fires once per swing
  if (state.hitEffects?.length > 0) state.hitEffects = []
}

function render() {
  maybeComputeFOV(state.map, state.player)
  renderer.updateCamera(state.player, state.shake ?? 0)
  renderer.render(state)
  updateHUD(state)
}

function descendLevel() {
  if (state.level >= FINAL_DEPTH) return  // already on final level
  const next = state.level + 1
  const theme = DEPTH_THEMES.find(t => t.depths.includes(next)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === next) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(next, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
  decorateMap(map, rulesets[theme.ruleset])
  state = {
    ...state,
    level: next,
    map,
    theme,
    entities: buildEntities(entitySpawns, map),
    projectiles: [],
    shockwaves: [],
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    log: [`Level ${next}. Deeper…`],
    hitEffects: [],
    shake: 0,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
}

async function endRun(won) {
  state.run.won = won
  meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()
  setPhase(PHASE.GAMEOVER)
  menu.showGameOver(
    { won, deepestLevel: state.run.deepestLevel },
    { onPlayAgain: beginRun, onQuitToTitle: goTitle },
  )
}

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  rulesets = (await window.saveAPI.loadRulesets()) ?? {}
  structures = (await window.saveAPI.loadStructures()) ?? {}
  await renderer.loadSprites([...rulesetTileNames(rulesets), ...structureTileNames(structures)])
  pruneMissingTiles(rulesets, renderer.sprites)
  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()
  // Resizing reallocates the canvas backing store (blank); repaint the current
  // frame even when not in PLAYING, since the loop no longer renders every frame.
  window.addEventListener('resize', () => { renderer.resize(); if (state) render() })
  goTitle()
  lastTime = performance.now()
  rafId = requestAnimationFrame(gameLoop)
}

init()
