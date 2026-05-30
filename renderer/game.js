import { generateLevel } from './systems/map.js'
import { propagateNoise, decayNoiseMap, mergeNoiseMaps, updateGuardAlert, updateDragonSleep, computePlayerFOV } from './systems/stealth.js'
import { resolvePlayerAction, stepGuard, stepMonster, stepDragon } from './systems/turn.js'
import { makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeWeapon, makePotion, makeChest, makeDoor, WEAPON_TYPES, DRAGON_STATE, ALERT, TILE } from './systems/entities.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta } from './systems/meta.js'
import { Renderer } from './render/canvas.js'
import { updateHUD, showDragonMeter, hideDragonMeter } from './render/hud.js'
import { FINAL_DEPTH } from './data/levels.js'

const DEBUG = location.search.includes('debug')

let state = null
let meta = null
let renderer = null
let inputLocked = false

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  renderer.debug = DEBUG
  await renderer.loadSprites()

  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()

  window.addEventListener('resize', () => { renderer.resize(); render() })
  window.addEventListener('keydown', onKey)

  startNewRun()
}

function makePatrol(x, y, map) {
  const candidates = []
  for (const dist of [3, 4, 5]) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const tx = x + dx * dist, ty = y + dy * dist
      if (map[ty]?.[tx]?.tile === TILE.FLOOR) candidates.push({ x: tx, y: ty })
    }
  }
  const shuffled = candidates.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 2)
}

function buildEntities(spawns, map) {
  return spawns.flatMap(s => {
    switch (s.kind) {
      case 'guard':   return [makeGuard(s.x, s.y, makePatrol(s.x, s.y, map))]
      case 'monster': return [makeMonster(s.x, s.y, s.variant)]
      case 'trap':    return [makeTrap(s.x, s.y)]
      case 'dragon':  return [makeDragon(s.x, s.y, s.roomId)]
      case 'puzzle':  return [makePuzzle(s.x, s.y)]
      case 'weapon': {
        const wt = s.weaponType ?? 'dagger'
        const def = WEAPON_TYPES[wt] ?? WEAPON_TYPES.dagger
        return [makeChest(s.x, s.y, { type: 'weapon', weaponType: wt, name: def.name, damage: def.damage })]
      }
      case 'potion':  return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
      case 'door':    return [makeDoor(s.x, s.y)]
      default:        return []
    }
  })
}

function startNewRun() {
  try {
    hideDragonMeter()
    const { map, entitySpawns, playerSpawn } = generateLevel(1)
    const player = makePlayer(playerSpawn.x, playerSpawn.y, meta.unlockedBonuses)
    player.inventory.push(...getStartingItems(meta))
    state = {
      level: 1,
      map,
      player,
      entities: buildEntities(entitySpawns, map),
      log: ['You descend into the dungeon…'],
      noiseMap: {},
      run: { deepestLevel: 1, won: false },
    }
    render()
  } catch (err) {
    inputLocked = false
    console.error('startNewRun failed:', err)
  }
}

function onKey(e) {
  if (inputLocked) return
  const dirMap = {
    ArrowUp: {dx:0,dy:-1}, w: {dx:0,dy:-1},
    ArrowDown: {dx:0,dy:1}, s: {dx:0,dy:1},
    ArrowLeft: {dx:-1,dy:0}, a: {dx:-1,dy:0},
    ArrowRight: {dx:1,dy:0}, d: {dx:1,dy:0},
  }
  const dir = dirMap[e.key]
  if (dir) { processTurn({ type: 'move', ...dir }).catch(console.error); return }
  if (e.key === 'Enter') { processTurn({ type: 'descend' }).catch(console.error); return }
  if (e.key === 'x' || e.key === 'X') { processTurn({ type: 'steal' }).catch(console.error); return }
  if (e.key === '.') { processTurn({ type: 'wait' }).catch(console.error); return }
  if (e.key === 'e' || e.key === 'E') { processTurn({ type: 'interact' }).catch(console.error); return }
}

async function processTurn(action) {
  state = resolvePlayerAction(state, action)

  if (state.won) { await endRun(true); return }
  if (state.descend) { descendLevel(); return }

  if (state.hitEffects?.length > 0) {
    render()
    await new Promise(r => setTimeout(r, 160))
    state = { ...state, hitEffects: null }
  }

  if (state.openingDoor) {
    for (let frame = 0; frame < 4; frame++) {
      state = { ...state, entities: state.entities.map(e => e.type === 'door' && e.opening ? { ...e, frame } : e) }
      render()
      await new Promise(r => setTimeout(r, 100))
    }
    state = { ...state, entities: state.entities.filter(e => !(e.type === 'door' && e.opening)), openingDoor: false }
  }

  if (state.openingChest) {
    for (let frame = 0; frame < 5; frame++) {
      state = { ...state, entities: state.entities.map(e => e.type === 'chest' && e.opening ? { ...e, frame } : e) }
      render()
      await new Promise(r => setTimeout(r, 80))
    }
    state = { ...state, entities: state.entities.filter(e => !(e.type === 'chest' && e.opening)), openingChest: false }
  }

  if (state.pendingNoise?.amount > 0) {
    const incoming = propagateNoise(state.map, state.pendingNoise.source, state.pendingNoise.amount)
    state = { ...state, noiseMap: mergeNoiseMaps(state.noiseMap, incoming), pendingNoise: null }
  }

  const alertedEntities = state.entities.map(e =>
    e.type === 'guard' ? updateGuardAlert(e, state.noiseMap, state.map, state.player) : e
  )
  const combatClearedEntities = alertedEntities.map(e =>
    e.type === 'guard' && e.alertState !== ALERT.ALERTED ? { ...e, inCombat: false } : e
  )
  const steppedEntities = combatClearedEntities.map(e => {
    if (e.type === 'guard') {
      if (e.moveTimer > 0) return { ...e, moveTimer: e.moveTimer - 1 }
      return { ...stepGuard(e, state.map, state.player), moveTimer: e.moveCooldown }
    }
    if (e.type === 'monster') return stepMonster(e, state.map)
    return e
  })

  // Alerted guards adjacent to the player deal 1 damage each
  const attackers = steppedEntities.filter(e =>
    e.type === 'guard' &&
    e.alertState === ALERT.ALERTED &&
    Math.abs(e.x - state.player.x) + Math.abs(e.y - state.player.y) === 1
  )
  let entitiesAfterGuardAttack = steppedEntities
  if (attackers.length > 0) {
    const dmg = attackers.length
    const attackerSet = new Set(attackers)
    entitiesAfterGuardAttack = steppedEntities.map(e =>
      attackerSet.has(e) ? { ...e, inCombat: true } : e
    )
    state = {
      ...state,
      player: { ...state.player, hp: state.player.hp - dmg },
      log: [...state.log, `A guard strikes you! (${dmg} damage)`].slice(-5),
    }
  }

  const dragon = entitiesAfterGuardAttack.find(e => e.type === 'dragon')
  const finalEntities = dragon
    ? entitiesAfterGuardAttack.map(e => e.type === 'dragon'
        ? stepDragon(updateDragonSleep(e, state.noiseMap), state.map, state.player)
        : e)
    : entitiesAfterGuardAttack

  state = { ...state, entities: finalEntities }

  if (dragon) {
    const updatedDragon = finalEntities.find(e => e.type === 'dragon')
    showDragonMeter(updatedDragon)
    if (updatedDragon.dragonState !== DRAGON_STATE.SLEEPING) {
      if (dragon.dragonState === DRAGON_STATE.SLEEPING && updatedDragon.dragonState === DRAGON_STATE.STIRRING) {
        state = { ...state, log: [...state.log, 'The dragon stirs… move quietly!'].slice(-5) }
      } else if (dragon.dragonState !== DRAGON_STATE.AWAKE && updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
        state = { ...state, log: [...state.log, 'The dragon AWAKENS and hunts you!'].slice(-5) }
      }
      if (updatedDragon.dragonState === DRAGON_STATE.AWAKE) {
        const dist = Math.abs(updatedDragon.x - state.player.x) + Math.abs(updatedDragon.y - state.player.y)
        if (dist <= 1) {
          state = {
            ...state,
            player: { ...state.player, hp: state.player.hp - 3 },
            log: [...state.log, 'The dragon breathes fire! (-3 HP)'].slice(-5),
          }
        }
      }
    }
  }

  if (state.player.hp <= 0) {
    state.log = [...state.log, 'You have fallen…'].slice(-5)
    render()
    await endRun(false)
    return
  }

  state = { ...state, noiseMap: decayNoiseMap(state.noiseMap) }
  render()
}

function descendLevel() {
  const next = state.level + 1
  const { map, entitySpawns, playerSpawn } = generateLevel(next)
  state = {
    ...state,
    level: next,
    map,
    entities: buildEntities(entitySpawns, map),
    player: { ...state.player, x: playerSpawn.x, y: playerSpawn.y },
    noiseMap: {},
    descend: false,
    log: [`Level ${next}. The air grows colder…`],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
  if (!state.entities.find(e => e.type === 'dragon')) hideDragonMeter()
  render()
}

async function endRun(won) {
  inputLocked = true
  meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()

  const msg = won
    ? '🏆 Treasure stolen! Press R to play again.'
    : '💀 Run over. Press R to try again.'
  state.log = [...state.log, msg].slice(-5)
  render()

  const restart = e => {
    if (e.key !== 'r' && e.key !== 'R') return
    window.removeEventListener('keydown', restart)
    inputLocked = false
    startNewRun()
  }
  window.addEventListener('keydown', restart)
}

function render() {
  computePlayerFOV(state.map, state.player)
  renderer.updateCamera(state.player)
  renderer.render(state)
  updateHUD(state)
}

init()
