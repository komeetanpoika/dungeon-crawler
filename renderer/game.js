import { generateLevel } from './systems/map.js'
import { ROAD_TILES } from './systems/overworld.js'
import { OPEN_MAPS, OPEN_MAP_SPRITES } from './data/open-maps.js'
import { maybeComputeFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, makeExitDoor, WEAPON_TYPES, RANGED_WEAPON_TYPES, makeRangedContents, weaponContents, TILE, isWalkable } from './systems/entities.js'
import { makeCyclops, updateCyclops } from './systems/cyclops.js'
import { makeWizard, updateWizard } from './systems/wizard.js'
import { makeCrab, updateCrab } from './systems/crab.js'
import { makeDragonBoss, updateDragonBoss, PIXEL_SKIN } from './systems/dragonboss.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta, firstTime } from './systems/meta.js'
import { decorateMap, pruneMissingTiles, rulesetHasOverlays } from './systems/decorate.js'
import { Renderer } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
import { tickWalk } from './systems/walk.js'
import { FINAL_DEPTH, DEPTH_THEMES, LEVEL_CONFIG, OVERWORLD_DEPTH, ADVENTURE_DEPTH } from './data/levels.js'
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
import { makeFeedback, tickFeedback, addFloat, speak, think, speakFrom, announce, queueToast, drainToasts } from './systems/feedback.js'
import { makeSfx, sfx, drainSfx } from './systems/sfx.js'
import { makeAudio, playCues } from './render/audio.js'
import { openGate, updateGates } from './systems/gates.js'
import { itemFromContents, contentsFromItem, autoEquipOnPickup, addItem, removeItem, equipItem, canEquip, findQuickUseIndex, EQUIP_FAIL_MESSAGES } from './systems/inventory.js'
import { showInventory, hideInventory, refreshInventory } from './ui/inventory-panel.js'
import { buildCaveState, restoreSurface, tickCaveInstances, adventureRespawn } from './systems/cave.js'
import { dungeonLabels, markCleared, isMapComplete, nextMapDepth, normalizeAdventureSave, npcRecordFor, recordNpcState, resetNpcs } from './systems/adventure.js'
import { makeNpc, updateNpc, onNpcHit, interactNpc, nearestPeacefulNpc, rollNpcDrop } from './systems/npc.js'
import { npcSpawnsForMap } from './systems/openmap.js'
import { episodeFor, isMapUnlocked, isResolved, missingSpawn, echoSpawns, echoAdjacent, echoLine, ruleCtx, makeEpCtx } from './systems/leap.js'
import { EPISODE_MODULES } from './systems/episodes/index.js'
import { felledCells, findHarvestHit, harvest } from './systems/lumber.js'
import { canBuildCampfire, spendLumber, buildSpot, makeCampfire, tickCampfires, cookMeat } from './systems/campfire.js'
import { isEnemy, isHittable, isDead } from './systems/factions.js'
import { isCreature, strikeCreature, updateCreature, makeCreature } from './systems/creatures.js'
import './systems/nakki.js'
import './systems/maahinen.js'
import './systems/sammunut.js'
import { NPC_SPECIES } from './data/npcs.js'
import { applyShockwave, SHOCK_RADIUS } from './systems/shockwave.js'
import { startStanceSwitch, tickStanceSwitch, tryFire, FIRE_FAIL_MESSAGES } from './systems/ranged.js'
import { tryGust, GUST_CHARGE, GUST_TIERS, resolveGustTier, shouldAutoReleaseGust, affordableGustTier } from './systems/magic.js'
import { rollChestLoot } from './systems/loot.js'
import { TALENTS, grantTalent, hasTalent, RUSH_TALENT_LADDER, MAP_CLEAR_TALENTS } from './systems/talents.js'
import { startTrance, tickTrance, riteConditionMet, RITE_DURATION, riteVisuals } from './systems/rites.js'
import { signNearby } from './systems/signs.js'
import { showSign, hideSign } from './ui/sign-panel.js'
import { showToast, hideToast } from './ui/toast.js'
import { getAttack, meleeHit, getSwingArc, inSwing, isChargeWeapon, resolveCharge, chargeMoveFactor, shouldAutoRelease, tierMods } from './systems/melee.js'
import { computeBlastTiles, applyBurst, makeFireZone, updateFireZones, BURST_DAMAGE, FIREBALL_RANGE_TILES } from './systems/fire.js'
import { meleeCost, canAfford, spendStamina, tickStamina, sprintProfile, makeSprintDetector } from './systems/stamina.js'

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

const keys = {}
const audio = makeAudio()

function loadMutedPref() {
  try { return localStorage.getItem('dc-muted') === '1' } catch { return false }
}
function saveMutedPref(m) {
  try { localStorage.setItem('dc-muted', m ? '1' : '0') } catch {}
}
window.addEventListener('keydown', e => { keys[e.key] = true })
window.addEventListener('keyup',   e => { keys[e.key] = false })

// Desktop sprint: double-tap a direction and hold. Touch sprint arrives as
// the synthetic 'sprint' key from the stick rim (ui/touch-controls.js).
const SPRINT_DIR_KEYS = { ArrowUp: 'w', w: 'w', ArrowDown: 's', s: 's',
  ArrowLeft: 'a', a: 'a', ArrowRight: 'd', d: 'd' }
const sprintDetector = makeSprintDetector()
// isTrusted gates out the touch layer's synthetic KeyboardEvents (stick
// press() dispatches real `new KeyboardEvent(...)` on window) — the
// double-tap detector is desktop-only; touch sprint arrives separately as
// the synthetic 'sprint' key.
window.addEventListener('keydown', e => {
  if (!e.isTrusted) return
  const dir = SPRINT_DIR_KEYS[e.key]
  if (dir && !e.repeat) sprintDetector.press(dir, performance.now() / 1000)
})
window.addEventListener('keyup', e => {
  if (!e.isTrusted) return
  const dir = SPRINT_DIR_KEYS[e.key]
  if (dir) sprintDetector.release(dir)
})

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (inventoryOpen) closeInventory()
    else if (phase === PHASE.PLAYING) pauseGame()
    else if (phase === PHASE.PAUSED) resumeGame()
  }
})

// I toggles the inventory panel: open while playing, close while it's open.
window.addEventListener('keydown', e => {
  if ((e.key !== 'i' && e.key !== 'I') || e.repeat) return
  if (phase === PHASE.PLAYING) openInventory()
  else if (inventoryOpen) closeInventory()
})

// M toggles sound. The muted flag lives on state.sfx; the audio engine
// ramps its master gain when it sees the flag change in playCues.
window.addEventListener('keydown', e => {
  if ((e.key !== 'm' && e.key !== 'M') || e.repeat) return
  if (!state?.sfx) return
  state.sfx.muted = !state.sfx.muted
  saveMutedPref(state.sfx.muted)
  think(state, state.sfx.muted ? 'Sound muted.' : 'Sound on.')
})

// Q quick-uses the first consumable in the sack (potion or mushroom)
// without opening the panel — also the green diamond button on touch.
window.addEventListener('keydown', e => {
  if ((e.key !== 'q' && e.key !== 'Q') || e.repeat) return
  if (phase !== PHASE.PLAYING || !state) return
  const i = findQuickUseIndex(state.player.inventory)
  if (i === -1) { think(state, 'Nothing left to use.'); return }
  useInventoryItem(i)
})

// Shift starts a stance switch. Edge-triggered: e.repeat filters the
// held-key auto-repeat so holding Shift doesn't flap the mode. The switch
// takes a moment (see STANCE_SWITCH_DURATION) — the mode lands in update().
window.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || e.repeat) return
  if (phase !== PHASE.PLAYING || !state) return
  const target = startStanceSwitch(state.player)
  if (target === null) { think(state, 'I know no other ways to fight.'); return }
  if (target) state.player.charging = null    // false = switch already running
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
    state.player.weapon = weaponContents(wt)
    announce(state, `The ${def.name} answers your call! (${def.damage} dmg)`)
  }
})

let state = null
// Tooling hook (verify-npcs.mjs etc.): only wired up when launched with
// --dcdebug (main.cjs passes it through as a ?dcdebug query param), so a
// normal run never exposes internal state.
if (new URLSearchParams(location.search).has('dcdebug')) {
  window.__dc = { get state() { return state } }
}
let inventoryOpen = false
let meta = null
let renderer = null
let lastTime = 0
let rafId = null
let rulesets = {}
let structures = {}
let phase = PHASE.TITLE
// An NPC was hurt (or the village roused) since the last save — the frame
// that ends with this set flushes the record, so kills and wrath survive a
// map change or a quit rather than waiting for some unrelated save.
let npcDirty = false
// Adventure save: cave instances (map name -> label -> instance) plus the
// progression record (furthest map, permanently-cleared dungeons).
let savedAdventure = normalizeAdventureSave(null)

function persistAdventure() {
  const surface = state?.cave ? state.cave.surface : state
  const mapName = surface ? OPEN_MAPS[surface.level]?.name : null
  if (mapName) savedAdventure.caves[mapName] = surface.caveInstances ?? {}
  if (mapName) savedAdventure.gates[mapName] =
    Object.entries(surface.gates ?? {}).filter(([, g]) => g.open).map(([id]) => id)
  if (mapName) recordNpcState(savedAdventure, mapName, surface.npcSpawnIds ?? [], surface.entities, surface.npcWrath)
  if (mapName) savedAdventure.felled[mapName] = felledCells(surface.map)
  if (mapName && state.player) {
    savedAdventure.talents = [...(state.player.talents ?? [])]
    savedAdventure.body = {
      weapon: state.player.weapon ? { ...state.player.weapon } : null,
      ranged: state.player.ranged ? { ...state.player.ranged } : null,
      inventory: state.player.inventory.map(i => i.payload ? { ...i, payload: { ...i.payload } } : { ...i }),
    }
  }
  window.saveAPI.saveCaves?.(savedAdventure)
}

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

// A blow landed on an npc: hurt cue + species reaction + village wrath (once).
// An animal that survives yelps; villagers keep the human cue the hit site
// already plays. `alive` is passed explicitly by the splash path, where the
// snapshot entity still carries its pre-blast hp.
// Drops rolled for NPCs that died this frame. Damage sites run inside
// state.entities rebuilds, so pushing a pickup there would be lost — they
// queue here and land after the frame's final cull.
let pendingDrops = []
function npcStruck(e, alive = e.hp > 0) {
  if (e.type !== 'npc') return
  npcDirty = true
  if (alive && !NPC_SPECIES[e.species]?.walker) sfx(state, 'npc-hurt', { px: e.px, py: e.py })
  if (!alive) {
    const contents = rollNpcDrop(e)
    if (contents) pendingDrops.push({
      type: 'floating_item', contents, x: e.x, y: e.y,
      startPx: e.px, startPy: e.py, targetPx: e.x * TILE_SIZE + TILE_SIZE / 2, targetPy: e.y * TILE_SIZE + TILE_SIZE / 2,
      px: e.px, py: e.py, progress: 0, duration: 0.3,
    })
  }
  const r = onNpcHit(e, state)
  if (r.wrath) { announce(state, 'The village turns on you!'); sfx(state, 'npc-wrath') }
}

// Animals die with their own small cue; villagers keep the human one.
const deathCue = e => e.type === 'npc' && !NPC_SPECIES[e.species]?.walker ? 'npc-death' : 'enemy-death'

// Splash damage (shockwave, fireball burst, lingering flames) hands back fresh
// entity copies with the dead already culled, so the hits are found by diffing
// an id-keyed snapshot taken before the blast. A killed NPC reacts too — a
// villager who dies to a stray fireball still has to rouse the village.
const npcSnapshot = () => state.entities.filter(e => e.type === 'npc').map(e => ({ e, hp: e.hp }))
function npcsStruckSince(snap) {
  if (!snap.length) return
  const live = new Map(state.entities.filter(e => e.type === 'npc').map(e => [e.id, e]))
  for (const { e, hp } of snap) {
    const now = live.get(e.id)
    if (!now) npcStruck(e, false)          // culled: the splash killed it
    else if (now.hp < hp) npcStruck(now)
  }
}

// Fireball detonation: flood-fill the blast, burst everyone standing in it
// (player included — full friendly fire), light the tiles, flash a ring.
function detonateFireball(px, py) {
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE)
  const tiles = computeBlastTiles(state.map, tx, ty)
  if (!tiles.length) return
  sfx(state, 'fire-burst', { px, py })
  const before = state.entities
  const npcSnap = npcSnapshot()
  const burst = applyBurst(state.entities, state.player, tiles)
  // applyBurst hands back a fresh copy for everything it burned and culls the
  // dead, so positional indices shift the moment one entity dies. Diff by
  // identity instead, the way npcsStruckSince does: an entity from the before
  // list that is no longer in the after list by reference was burned — copied
  // if it survived, dropped if the blast killed it.
  const untouched = new Set(burst.entities)
  for (const e of before) {
    if (!isHittable(e) || e.hp <= 0 || untouched.has(e)) continue
    addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${BURST_DAMAGE}`, kind: 'dealt' })
    if (e.hp - BURST_DAMAGE <= 0) sfx(state, deathCue(e), { px: e.px, py: e.py })
  }
  state.entities = burst.entities
  npcsStruckSince(npcSnap)
  if (burst.playerBurned) damagePlayer(state, BURST_DAMAGE, 'hit', `The blast engulfs you! (-${BURST_DAMAGE} HP)`)
  state.fireZones.push(makeFireZone(tiles))
  state.shockwaves.push({ px: tx * TILE_SIZE + TILE_SIZE / 2, py: ty * TILE_SIZE + TILE_SIZE / 2,
    t: 0, dur: 0.35, maxRadius: TILE_SIZE * 2.5, color: '#f97316' })
  state.log = [...state.log, 'The fireball erupts!'].slice(-5)
}

// Walk-onto item grant: hand if free, else sack. Returns false when the sack
// is full so the caller can leave the item in the world.
function grantContents(contents) {
  const item = itemFromContents(contents)
  if (!item) return true
  const r = autoEquipOnPickup(state.player, item)
  if (!r.ok) {
    state.packMsgCooldown = state.packMsgCooldown ?? 0
    if (state.packMsgCooldown <= 0) { think(state, 'My pack is full.'); state.packMsgCooldown = 2 }
    return false
  }
  sfx(state, 'pickup')
  return true
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
      case 'weapon':
        return [makeChest(s.x, s.y, { type: 'weapon', ...weaponContents(s.weaponType ?? 'dagger') })]
      case 'ranged':  return [makeChest(s.x, s.y, makeRangedContents(s.weaponType))]
      case 'potion': return [makeChest(s.x, s.y, { type: 'potion', amount: 4 })]
      case 'door':    return [makeDoor(s.x, s.y)]
      case 'exit_door': return [makeExitDoor(s.x, s.y)]
      case 'chest':   return [makeChest(s.x, s.y, rollChestLoot(depth))]
      case 'cyclops': return [hpOverride({ ...makeCyclops(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'wizard':  return [hpOverride({ ...makeWizard(s.x, s.y),  px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'crab':    return [hpOverride({ ...makeCrab(s.x, s.y),    px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'dragon_boss': return [hpOverride({ ...makeDragonBoss(s.x, s.y), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'dragon_boss_pixel': return [hpOverride({ ...makeDragonBoss(s.x, s.y, { skin: PIXEL_SKIN }), px: cx, py: cy, ...(s.isBoss && { isBoss: true }) })]
      case 'prop':           return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y }]
      // Inert until the transitions spec makes it functional. buildEntities
      // drops unknown kinds silently, so this case is what keeps the marker
      // from vanishing without a warning.
      case 'dungeon_entrance': return [{ type: 'prop', propType: 'prop_grave', x: s.x, y: s.y, isDungeonEntrance: true }]
      case 'fountain_wall':  return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y,
        isFountainWall: true, flowing: false, fountainTime: 0, pairX: s.pairX, pairY: s.pairY, gateId: s.gateId }]
      case 'fountain_basin': return [{ type: 'prop', propType: s.propType, x: s.x, y: s.y,
        isFountainBasin: true, flowing: false, fountainTime: 0, pairX: s.pairX, pairY: s.pairY, gateId: s.gateId }]
      case 'talent_trigger': return [{ type: 'talent_trigger', x: s.x, y: s.y, talent: s.talent, rite: s.rite }]
      case 'wild_mushroom':  return [{ type: 'wild_mushroom', x: s.x, y: s.y, hueT: (s.x * 7 + s.y * 13) % 10 }]
      case 'echo':    return [{ type: 'echo', id: `echo:${s.spot}`, x: s.x, y: s.y, spot: s.spot, px: cx, py: cy }]
      case 'npc': { const n = makeNpc(s); return n ? [n] : [] }
      case 'creature': { const c = makeCreature(s.creature, s.x, s.y); return c ? [{ ...c, px: cx, py: cy }] : [] }
      default:               return []
    }
  })
}

// Ids of the npcs a build actually placed (the sampler drops any it could
// not home, and those must not be tombstoned as dead).
const npcSpawns = spawns => spawns.filter(s => s.kind === 'npc').map(s => s.id)

// Groundhog Day: every NPC on the current surface returns, alive and calm.
// A resolved leap map's missing person is not part of the declared roster
// (their spawn id must never be tombstoned by recordNpcState), so they are
// re-added separately and left out of npcSpawnIds.
function respawnNpcs() {
  const data = OPEN_MAPS[state.level]
  if (!data) return
  const spawns = npcSpawnsForMap(data)
  state.entities = state.entities.filter(e => e.type !== 'npc')
  state.entities.push(...buildEntities(spawns, state.map, state.level))
  if (episodeFor(data) && isResolved(savedAdventure, data)) {
    state.entities.push(...buildEntities([missingSpawn(data)], state.map, state.level))
  }
  state.npcSpawnIds = npcSpawns(spawns)
  state.npcWrath = false
}

// Leap maps: install the persona while the episode is open, or bring the
// missing person home if it is already resolved.
function arriveOnMap() {
  const mapData = OPEN_MAPS[state.level]
  const ep = episodeFor(mapData)
  state.episode = ep
  state.villagerLines = null
  state.episodeResolved = false
  state.epCtx = null
  state.echoHold = null
  if (!ep) return
  state.epCtx = makeEpCtx({
    getState: () => state, save: savedAdventure, mapData,
    persist: persistAdventure, resolve: resolveEpisode, refreshInventory: afterInventoryChange,
    spawn: spawns => state.entities.push(...buildEntities(spawns, state.map, state.level)),
  })
  state.entities.push(...buildEntities(echoSpawns(mapData), state.map, state.level))
  if (isResolved(savedAdventure, mapData)) {
    state.episodeResolved = true
    state.entities.push(...buildEntities([missingSpawn(mapData)], state.map, state.level))
  } else {
    state.villagerLines = ep.villagerLines
  }
}

// Fires the moment an episode's rule is first satisfied: the missing person
// walks back into the village and the runestone hums. Idempotent per visit
// via `state.episodeResolved` — episode modules (Task 5) call this through ctx
// right after setting the flag that might complete the rule.
function resolveEpisode() {
  const mapData = OPEN_MAPS[state.level]
  if (!state.episode || state.episodeResolved || !isResolved(savedAdventure, mapData)) return
  state.episodeResolved = true
  state.villagerLines = null
  state.entities.push(...buildEntities([missingSpawn(mapData)], state.map, state.level))
  sfx(state, 'leap', { px: state.player.px, py: state.player.py })
  announce(state, `${state.episode.persona} walks back into the village. The runestone hums.`)
  persistAdventure()
}

function startNewRun(depth = 1, arenaCfg = null) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[0]
  const openMap = OPEN_MAPS[depth]
  const npcRecord = openMap ? npcRecordFor(savedAdventure, openMap.name) : null
  const felledRecord = openMap ? savedAdventure.felled[openMap.name] ?? [] : null
  const { map, entitySpawns, playerSpawn, caveEntrances, gates, mapExit, signs } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures, arena: arenaCfg,
      npcs: npcRecord, felled: felledRecord })
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
  if (OPEN_MAPS[depth]) {
    player.talents = [...savedAdventure.talents]
    if (savedAdventure.body) {
      // Melee payloads are re-derived from the weapon table rather than
      // copied: saves written before lumber landed carry no `chop`, and a
      // hatchet or axe out of one of those must still fell trees. Ranged
      // payloads are copied as-is — their `ammo` is run state, not table data.
      player.weapon = savedAdventure.body.weapon ? weaponContents(savedAdventure.body.weapon.weaponType) : null
      player.ranged = savedAdventure.body.ranged ? { ...savedAdventure.body.ranged } : null
      player.inventory = savedAdventure.body.inventory.map(i => {
        if (!i.payload) return { ...i }
        if (i.kind === 'weapon') return { ...i, payload: weaponContents(i.payload.weaponType) }
        return { ...i, payload: { ...i.payload } }
      })
    }
  }
  if (depth === 0 && arenaCfg?.player) {
    const po = arenaCfg.player
    const def = WEAPON_TYPES[po.weaponType]
    if (def) player.weapon = weaponContents(po.weaponType)
    else if (po.weaponType !== undefined) console.warn(`arena: unknown player weaponType "${po.weaponType}" — keeping current weapon`)
    const rdef = RANGED_WEAPON_TYPES[po.rangedType]
    if (rdef) player.ranged = makeRangedContents(po.rangedType)
    else if (po.rangedType !== undefined) console.warn(`arena: unknown player rangedType "${po.rangedType}" — no ranged weapon`)
    if (Number.isFinite(po.hp) && po.hp >= 1) {
      player.maxHp = Math.max(player.maxHp, Math.round(po.hp))
      player.hp = Math.round(po.hp)
    }
    if (Array.isArray(po.talents)) {
      for (const t of po.talents) {
        if (TALENTS[t]) player.talents.push(t)
        else console.warn(`arena: unknown talent "${t}" — skipped`)
      }
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
    fireZones: [],
    shockwaves: [],
    log: [],
    feedback: makeFeedback(),
    hitEffects: [],
    shake: 0,
    run: { deepestLevel: depth, won: false },
    gameOver: false,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
    fireMsgCooldown: 0,
    caveEntrances: caveEntrances ?? [],
    caveInstances: OPEN_MAPS[depth] ? { ...savedAdventure.caves[OPEN_MAPS[depth].name] } : {},
    gates: gates ?? {},
    gateMsgCooldown: 0,
    mapExit: mapExit ?? null,
    exitMsgCooldown: 0,
    entranceHold: false,
    signs: signs ?? [],
    npcWrath: !!npcRecord?.hostile,
    // The ids actually built, plus the ones already tombstoned — a dead npc
    // must stay recorded as dead on the next persist rather than be forgotten.
    npcSpawnIds: npcRecord ? [...npcSpawns(entitySpawns), ...npcRecord.dead] : [],
  }
  if (OPEN_MAPS[depth]) arriveOnMap()
  // Gates opened on an earlier visit stay open: swap in the open art and
  // set their fountains flowing before the first frame.
  for (const id of savedAdventure.gates[OPEN_MAPS[depth]?.name] ?? []) {
    openGate(state, id)
    for (const e of state.entities) {
      if (e.gateId !== id || !(e.isFountainWall || e.isFountainBasin)) continue
      e.flowing = true
      e.propType = e.isFountainWall ? 'prop_gargoyle_flow' : 'prop_fountain_full'
    }
  }
  announce(state, depth >= OVERWORLD_DEPTH ? 'You step out into the open…' : 'You enter the dungeon…')
}

function setPhase(to) {
  if (canTransition(phase, to)) phase = to
}

function goTitle() {
  phase = PHASE.TITLE
  menu.showTitle(meta, {
    onAdventure: () => beginRun(OPEN_MAPS[savedAdventure.progress.mapDepth] ? savedAdventure.progress.mapDepth : ADVENTURE_DEPTH),
    onRush: () => beginRun(1),
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
  keys[' '] = false   // swallow the confirming Space so update() can't read it as an attack
  startNewRun(depth, arenaCfg)
}

function resumeGame() {
  setPhase(PHASE.PLAYING)
  menu.hide()
  keys[' '] = false
}

function pauseGame() {
  setPhase(PHASE.PAUSED)
  const restartDepth = state?.cave ? state.cave.surface.level : state?.level ?? 1
  menu.showPause({ onResume: resumeGame, onRestart: () => beginRun(restartDepth), onQuitToTitle: goTitle })
}

function openInventory() {
  if (phase !== PHASE.PLAYING || !state) return
  setPhase(PHASE.PAUSED)
  inventoryOpen = true
  sfx(state, 'ui-open')
  showInventory(state, {
    onEquip: (i) => {
      const r = equipItem(state.player, i)
      if (!r.ok) think(state, EQUIP_FAIL_MESSAGES[r.reason] ?? "Can't equip that.")
      else sfx(state, 'equip')
      afterInventoryChange()
    },
    onUse: (i) => useInventoryItem(i),
    onDrop: (i) => dropInventoryItem(i),
    onBuild: () => buildCampfire(),
    onClose: closeInventory,
  })
}

function closeInventory() {
  sfx(state, 'ui-close')
  inventoryOpen = false
  hideInventory()
  setPhase(PHASE.PLAYING)
  keys[' '] = false
}

// Signpost panel: pauses like the inventory; the panel's own capture-phase
// key handler (F/Escape/Enter) routes back through closeSign.
function openSign(sign) {
  if (phase !== PHASE.PLAYING) return
  setPhase(PHASE.PAUSED)
  sfx(state, 'ui-open')
  showSign(sign, closeSign)
}

function closeSign() {
  keys['f'] = false; keys['F'] = false   // swallow the closing press so update() can't reopen
  keys[' '] = false
  sfx(state, 'ui-close')
  hideSign()
  setPhase(PHASE.PLAYING)
}

// Toast panel: pauses like the sign, but systems queue toasts (queueToast)
// rather than the player triggering one directly; update() drains one per
// PLAYING frame below.
function openToast(t) {
  if (phase !== PHASE.PLAYING) { state.feedback.toasts.unshift(t); return }  // re-queue; drained next PLAYING frame
  setPhase(PHASE.PAUSED)
  sfx(state, 'ui-open')
  showToast(t, closeToast)
}

function closeToast() {
  keys[' '] = false; keys['f'] = false   // swallow the dismissing press
  sfx(state, 'ui-close')
  hideToast()
  setPhase(PHASE.PLAYING)
}

function afterInventoryChange() {
  refreshInventory(state)
  updateHUD(state)
  if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
}

function useInventoryItem(i) {
  const item = state.player.inventory[i]
  if (!item) return
  if (item.kind === 'potion' || item.kind === 'meat' || item.kind === 'cooked_meat') {
    const healed = Math.min(state.player.maxHp - state.player.hp, item.kind === 'potion' ? item.amount : item.heal)
    if (healed <= 0) { think(state, 'Already full.'); return }
    removeItem(state.player, i)
    state.player.hp += healed
    addFloat(state.feedback, { px: state.player.px, py: state.player.py, text: `+${healed}`, kind: 'heal' })
    sfx(state, 'heal')
    if (inventoryOpen) closeInventory()   // see the effect land
  }
  if (item.kind === 'mushroom') {
    removeItem(state.player, i)
    startTrance(state.player)
    think(state, 'It tastes… strange.')
    if (inventoryOpen) closeInventory()
  }
  afterInventoryChange()
}

function dropInventoryItem(i) {
  const { player, map } = state
  const adj = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: player.x+dx, y: player.y+dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x===t.x && e.y===t.y))
  if (!adj) { think(state, 'No room to drop here.'); return }
  const item = removeItem(player, i)
  state.entities.push({
    type: 'floating_item', contents: contentsFromItem(item),
    x: adj.x, y: adj.y,
    startPx: player.px, startPy: player.py,
    targetPx: adj.x * TILE_SIZE + TILE_SIZE / 2, targetPy: adj.y * TILE_SIZE + TILE_SIZE / 2,
    px: player.px, py: player.py, progress: 0, duration: 0.35,
  })
  sfx(state, 'drop')
  afterInventoryChange()
}

function buildCampfire() {
  const gate = canBuildCampfire(state.player)
  if (!gate.ok) { think(state, 'Not enough lumber.'); return }
  const spot = buildSpot(state.map, state.entities, state.player)
  if (!spot) { think(state, 'No room for a fire here.'); return }
  spendLumber(state.player)
  const fire = makeCampfire(spot.x, spot.y)
  state.entities.push(fire)
  sfx(state, 'campfire-light', { px: fire.px, py: fire.py })
  if (inventoryOpen) closeInventory()
  afterInventoryChange()
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
  // Drain sound cues every frame — UI cues fire while PAUSED too.
  if (state?.sfx) playCues(audio, drainSfx(state), state.player, state.sfx.muted)
  rafId = requestAnimationFrame(gameLoop)
}

function update(delta) {
  if (!state) return
  if (!state.sfx) state.sfx = makeSfx(loadMutedPref())
  // A running rite is a short cutscene: the world holds its breath.
  if (state.rite) {
    state.rite.t += delta
    if (state.rite.t >= state.rite.dur) {
      const talent = state.rite.talent
      state.rite = null
      state.player.trance = 0
      // Talent-less anchors (e.g. the marsh's mushroom ring) still play the
      // trance and ceremony but grant nothing — skip grantTalent entirely.
      if (talent && grantTalent(state, talent) && OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
    }
    tickFeedback(state.feedback, delta)
    return
  }
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
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(player.attackMode)
  const sprinting = moving && !player.charging && player.stamina > 0 && !wasGrabbed &&
    (keys['sprint'] || sprintDetector.sprinting())
  const chargeFactor = player.charging
    ? (player.charging.kind === 'gust' ? GUST_CHARGE.moveFactor
                                       : chargeMoveFactor(player.weapon?.weaponType))
    : 1
  const speed = PLAYER_SPEED * chargeFactor * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(player, profile.drain * delta)
  if (!wasGrabbed) moveEntity(player, vx * speed * delta, vy * speed * delta, map, PLAYER_HALF, boss)

  // Chest interaction (walk onto chest tile)
  const chestIdx = state.entities.findIndex(e =>
    e.type === 'chest' && !e.opening && e.x === player.x && e.y === player.y)
  if (chestIdx !== -1) {
    const chest = state.entities[chestIdx]
    // Open chest — item jumps to adjacent floor tile
    const adj = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: chest.x+dx, y: chest.y+dy }))
      .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !state.entities.some(e => e.x===t.x && e.y===t.y))
    // With no free adjacent tile, the item grants straight into hand/sack —
    // only mark the chest open if that grant actually lands; a full sack
    // (plus occupied hand and no floor space) must leave it closed and
    // re-triggerable rather than silently destroying the contents.
    const directGrant = !adj && grantContents(chest.contents)
    const granted = adj || directGrant
    if (directGrant && OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
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
    }
    if (granted) state.entities = state.entities.map((e, i) => i === chestIdx ? { ...e, opening: true, frame: 2 } : e)
  }

  // Floating item pickup (step onto landing tile once arc completes)
  const floatIdx = state.entities.findIndex(e =>
    e.type === 'floating_item' && e.progress >= 1 && e.x === player.x && e.y === player.y)
  if (floatIdx !== -1) {
    const item = state.entities[floatIdx]
    if (grantContents(item.contents)) {
      state.entities = state.entities.filter((_, i) => i !== floatIdx)
      if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
    }
  }

  // Leap episodes: the Echo speaks when approached; the episode module runs.
  // Gated off underground — epCtx/mapData describe the surface, not the cave.
  if (state.epCtx && !state.cave) {
    const echo = echoAdjacent(state.entities, player)
    if (echo && state.echoHold !== echo) {
      const line = echoLine(state.episode, echo.spot, state.epCtx.flags, ruleCtx(savedAdventure, state.epCtx.mapData))
      if (line) { speakFrom(state, echo, line); sfx(state, 'echo', { px: echo.px, py: echo.py }) }
    }
    state.echoHold = echo
    EPISODE_MODULES[state.epCtx.mapData.name]?.tick(state.epCtx, delta)
  }

  // Campfire cooking — standing on a fire cooks every raw meat carried.
  // cookMeat empties the raw stack, so it can't fire twice for the same meat.
  const fire = state.entities.find(e => e.type === 'campfire' && e.x === player.x && e.y === player.y)
  if (fire) {
    const n = cookMeat(player)
    if (n) {
      sfx(state, 'sizzle', { px: fire.px, py: fire.py })
      think(state, 'You cook the meat.')
      afterInventoryChange()
    }
  }

  // Cave entrance — walking into an arch descends; the hold flag set on
  // emerging keeps the arch from swallowing the player again until they
  // step off it. Inside a cave, returning to the entry stairs retreats.
  const arch = state.caveEntrances?.find(e => e.x === player.x && e.y === player.y)
  if (arch && !state.entranceHold) {
    const gate = state.gates?.[arch.label]
    if (gate && !gate.open) {
      // Sealed: stay on the cell and explain on a cooldown, like the waystone.
      state.gateMsgCooldown = (state.gateMsgCooldown ?? 0) - delta
      if (state.gateMsgCooldown <= 0) {
        think(state, 'The vined gate is sealed. The gargoyles beside it are dry…')
        state.gateMsgCooldown = 2
      }
    } else { enterCave(arch); return }
  }
  if (!arch) state.entranceHold = false
  if (state.cave) {
    const onStairs = player.x === state.cave.stairs.x && player.y === state.cave.stairs.y
    if (!onStairs) state.cave.offStairs = true
    else if (state.cave.offStairs) { exitCave(); return }
  }

  // Waystone: standing on the exit arch travels onward once the map is
  // unlocked — every dungeon here finished, or (leap maps) the episode
  // resolved; sealed, it explains itself on a cooldown.
  if (!state.cave && state.mapExit && player.x === state.mapExit.x && player.y === state.mapExit.y) {
    const mapData = OPEN_MAPS[state.level]
    if (mapData && isMapUnlocked(savedAdventure, mapData)) {
      const next = nextMapDepth(state.level)
      if (next) { travelToMap(next); return }
    } else if (mapData) {
      state.exitMsgCooldown = (state.exitMsgCooldown ?? 0) - delta
      if (state.exitMsgCooldown <= 0) {
        if (mapData.leap) {
          think(state, 'The runestone is dark. Something here is still wrong.')
        } else {
          const done = savedAdventure.progress.cleared[mapData.name] ?? []
          const remain = dungeonLabels(mapData).filter(l => !done.includes(l)).length
          think(state, `The waystone is silent — ${remain} dungeon${remain === 1 ? '' : 's'} remain${remain === 1 ? 's' : ''}.`)
        }
        state.exitMsgCooldown = 2
      }
    }
  }

  // Key pickup — walk onto the key the boss dropped
  const keyIdx = state.entities.findIndex(e => e.type === 'key' && e.x === player.x && e.y === player.y)
  if (keyIdx !== -1) {
    state.entities = state.entities.filter((_, i) => i !== keyIdx)
    state.hasKey = true
    speak(state, 'You picked up the key!')
    sfx(state, 'key-pickup')
  }

  // Wild mushrooms: walk-onto pickup into the sack
  const shroomIdx = state.entities.findIndex(e => e.type === 'wild_mushroom' && e.x === player.x && e.y === player.y)
  if (shroomIdx !== -1 && grantContents({ type: 'mushroom' })) {
    state.entities = state.entities.filter((_, i) => i !== shroomIdx)
    if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
  }

  // Rite triggers: silent unless the rite's condition holds
  tickTrance(player, delta)
  const trigger = state.entities.find(e => e.type === 'talent_trigger' && e.x === player.x && e.y === player.y)
  if (trigger && (!trigger.talent || !hasTalent(player, trigger.talent)) && riteConditionMet(trigger.rite, state)) {
    state.rite = { t: 0, dur: RITE_DURATION, talent: trigger.talent, cx: player.px, cy: player.py }
    sfx(state, 'rite', { px: player.px, py: player.py })
  }

  // Exit door — open and descend with the key, otherwise it stays locked
  const exitDoor = state.entities.find(e => e.type === 'door' && e.isExit && e.x === player.x && e.y === player.y)
  if (exitDoor) {
    if (state.hasKey) {
      exitDoor.opening = true; exitDoor.frame = 3
      state.hasKey = false
      if (state.cave) exitCave()
      else descendLevel()
      return
    }
    state.lockedMsgCooldown = Math.max(0, (state.lockedMsgCooldown ?? 0) - delta)
    if (state.lockedMsgCooldown <= 0) {
      think(state, 'The door is locked — defeat the boss for its key.')
      sfx(state, 'door-locked')
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
    const sign = basin ? null : signNearby(state.signs, player.x, player.y)
    const npc = (basin || sign) ? null : nearestPeacefulNpc(state)
    if (npc) { interactNpc(state, npc); return }
    if (sign) { openSign(sign); return }
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
      // Overworld gate fountains: all of a gate's gargoyles flowing opens it.
      const gate = state.gates?.[basin.gateId]
      const wasOpen = gate?.open
      updateGates(state)
      if (gate && !wasOpen && gate.open) {
        // basin.gateId is a POI label ("cave 1") that repeats across overworld
        // maps — qualify with the map so opening one map's gate doesn't
        // suppress the same-labeled gate's toast on another map.
        const gateId = `${state.level}:${basin.gateId}`
        if (firstTime(meta.gateToastsSeen, gateId)) {
          window.saveAPI.saveMeta(meta)
          queueToast(state, { title: 'A new area opens!', lines: ['Water flows — the vined gate grinds open.'] })
        }
        sfx(state, 'gate-open')
        persistAdventure()
      }
    }
  }

  // Combat cooldowns
  player.meleeCooldown  = Math.max(0, player.meleeCooldown  - delta)
  player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)
  player.attackTimer    = Math.max(0, player.attackTimer    - delta)
  player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - delta)
  player.magicCooldown = Math.max(0, (player.magicCooldown ?? 0) - delta)
  tickStamina(player, delta)
  player.staminaRefusedT = Math.max(0, (player.staminaRefusedT ?? 0) - delta)
  const landedStance = tickStanceSwitch(player, delta)
  if (landedStance) {
    sfx(state, 'stance-switch')
  }
  // Mid-switch the old stance is still set but every attack is dead.
  const attacking = keys[' '] && !player.stanceSwitch

  // Melee (Space): light blades swing the instant the key lands; charge
  // weapons wind up while held and swing on release, tiered by hold time.
  const meleeWT = player.weapon?.weaponType
  const swing = (mods) => {
    const cost = meleeCost(meleeWT, mods.tier)
    if (!canAfford(player, cost)) {
      mods = tierMods('tap')                     // starved: weak swing
      player.staminaRefusedT = 0.4
      spendStamina(player, player.stamina)        // starved swing drains all remaining stamina
    } else {
      spendStamina(player, cost)
    }
    const atk = getAttack(meleeWT)
    player.meleeCooldown = atk.cooldown * mods.cooldownMul
    player.attackTimer = atk.duration
    player.attackDuration = atk.duration
    player.attackStyle = atk.style
    player.attackFacing = player.facing
    sfx(state, 'melee-swing', { px: player.px, py: player.py })
    player.attackReachMul = mods.reachMul
    const dmg = Math.max(1, Math.round((player.weapon?.damage ?? 1) * mods.dmgMul))
    const fa = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.facing] ?? 0
    const arc = getSwingArc(atk.style)
    const hitAt = (dx, dy) => inSwing(arc.reach * mods.reachMul, arc.halfAngle, fa, dx, dy)
    const miekka = meleeWT === 'maunonmiekka'
    const struck = []   // enemies hit this swing (for the Maunonmiekka's shockwave)
    state.entities = state.entities
      .map(e => {
        if (!isHittable(e)) return e
        if (e.type === 'dragon_boss') {
          const swingHit = (cx, cy) => hitAt(cx - player.px, cy - player.py)
          const raw = meleeDamageToDragon(player, e, swingHit)
          if (raw <= 0) return e
          const bossDmg = Math.max(1, Math.round(raw * mods.dmgMul))
          const bossHit = { ...e, hp: e.hp - bossDmg, inCombat: true }
          addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${bossDmg}`, kind: 'dealt' })
          sfx(state, 'melee-hit', { px: e.px, py: e.py })
          if (miekka) struck.push(bossHit)
          return bossHit
        }
        if (!hitAt(e.px - player.px, e.py - player.py)) return e
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        if (isCreature(e)) {
          const r = strikeCreature(e, state, dmg)
          if (r.cue) sfx(state, r.cue, { px: e.px, py: e.py })
          if (!r.absorbed) addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${dmg}`, kind: 'dealt' })
          return r.entity
        }
        const hitEnemy = { ...e, hp: e.hp - dmg, inCombat: true }
        npcStruck(hitEnemy)
        addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${dmg}`, kind: 'dealt' })
        sfx(state, hitEnemy.hp <= 0 ? deathCue(hitEnemy) : 'melee-hit', { px: e.px, py: e.py })
        startKnockback(hitEnemy, hitEnemy.px - player.px, hitEnemy.py - player.py, atk.knockback * mods.kbMul)
        if (miekka) struck.push(hitEnemy)
        return hitEnemy
      })
      .filter(e => !isDead(e))
    // Maunonmiekka magic: a crimson shockwave bursts from every struck enemy,
    // splashing damage + knockback onto its neighbours.
    if (struck.length) {
      const exclude = new Set(struck)
      let pulsed = false
      for (const s of struck) {
        const snap = npcSnapshot()
        const res = applyShockwave(state.entities, s.px, s.py, exclude)
        state.entities = res.entities
        npcsStruckSince(snap)
        state.shockwaves.push({ px: s.px, py: s.py, t: 0, dur: 0.35, maxRadius: SHOCK_RADIUS })
        sfx(state, 'shockwave', { px: s.px, py: s.py })
        pulsed = pulsed || res.hitCount > 0
      }
      if (pulsed) state.log = [...state.log, 'The Maunonmiekka pulses!'].slice(-5)
    }
    state.hitEffects = [{ x: player.x, y: player.y }]
    // Harvesting: a hatchet/axe swing lands on the nearest tree in the
    // wedge, a pick's mine also lands on the nearest rock. Damage is silent
    // bar-less chopHp on the cell; the fall/clear is what you hear and see,
    // and the lumber (trees only) arcs onto the stump for a walk-onto
    // pickup.
    const tool = { chop: player.weapon?.chop, mine: player.weapon?.mine }
    if (tool.chop || tool.mine) {
      const spot = findHarvestHit(state.map, player, hitAt, arc.reach * mods.reachMul, tool)
      if (spot) {
        const res = harvest(state.map, spot.x, spot.y, tool)
        state.hitEffects.push({ x: spot.x, y: spot.y })
        const spx = spot.x * TILE_SIZE + TILE_SIZE / 2, spy = spot.y * TILE_SIZE + TILE_SIZE / 2
        const cue = res.kind === 'rock' ? 'wall-slam' : res.felled ? 'tree-fall' : 'chop'
        sfx(state, cue, { px: spx, py: spy })
        if (res.felled) {
          if (res.yield > 0) {
            state.entities.push({
              type: 'floating_item', contents: { type: 'lumber', count: res.yield }, x: spot.x, y: spot.y,
              startPx: spx, startPy: spy - TILE_SIZE, targetPx: spx, targetPy: spy,
              px: spx, py: spy - TILE_SIZE, progress: 0, duration: 0.35,
            })
          }
          if (OPEN_MAPS[state.cave ? state.cave.surface.level : state.level]) persistAdventure()
        }
      }
    }
  }
  if (player.attackMode === 'melee' && !player.weapon) {
    // Truly unarmed: no swing at all — like the empty ranged slot, the fix
    // is finding a weapon, and the game says so instead of doing nothing.
    player.charging = null
    state.meleeMsgCooldown = Math.max(0, (state.meleeMsgCooldown ?? 0) - delta)
    if (attacking && state.meleeMsgCooldown <= 0) {
      think(state, 'Unarmed — you need a weapon.')
      state.meleeMsgCooldown = 2
    }
  } else if (player.attackMode === 'melee' && isChargeWeapon(meleeWT)) {
    if (player.charging) {
      if (keys[' '] && !shouldAutoRelease(meleeWT, player.charging.t)) {
        player.charging.t += delta
      } else {
        const held = player.charging.t
        player.charging = null
        swing(resolveCharge(meleeWT, held))
        keys[' '] = false     // an auto-release must not instantly re-wind
      }
    } else if (attacking && player.meleeCooldown <= 0) player.charging = { t: 0 }
  } else {
    if (player.charging && player.charging.kind !== 'gust') player.charging = null   // weapon swapped mid-wind-up
    if (attacking && player.attackMode === 'melee' && player.meleeCooldown <= 0) swing(resolveCharge(meleeWT, 0))
  }

  // Ranged (Space while in ranged stance). tryFire gates on weapon presence,
  // ammo, and the per-weapon cooldown; failures (except cooldown) get a
  // throttled HUD message so holding Space doesn't spam the log.
  state.fireMsgCooldown = Math.max(0, (state.fireMsgCooldown ?? 0) - delta)
  state.packMsgCooldown = Math.max(0, (state.packMsgCooldown ?? 0) - delta)
  // Magic (Space in magic stance): hold to charge the gust; release casts
  // at the reached tier. Overlong holds auto-release.
  if (player.attackMode === 'magic') {
    if (player.charging?.kind === 'gust') {
      if (keys[' '] && !shouldAutoReleaseGust(player.charging.t)) {
        player.charging.t += delta
      } else {
        const reached = resolveGustTier(player.charging.t)
        // A reached tier the tank can't cover degrades to the highest
        // affordable one instead of refusing the whole cast outright.
        const tier = affordableGustTier(player.stamina, reached) ?? 'tap'
        player.charging = null
        keys[' '] = false
        const cast = tryGust(state, tier)
        if (cast.ok) {
          const mul = GUST_TIERS[tier].mul
          const fa = { east: 0, south: Math.PI/2, west: Math.PI, north: -Math.PI/2 }[player.facing] ?? 0
          state.shockwaves.push({
            px: player.px + Math.cos(fa) * 44 * mul, py: player.py + Math.sin(fa) * 44 * mul,
            t: 0, dur: 0.3, maxRadius: 44 * mul, color: '#a5f3fc',
          })
          sfx(state, 'magic-cast', { px: player.px, py: player.py })
          state.log = [...state.log,
            tier === 'over' ? 'A raging gale!' : tier === 'full' ? 'A strong gust!' : 'A gust of wind!',
          ].slice(-5)
        } else if (cast.reason === 'stamina') {
          player.staminaRefusedT = 0.4
          state.magicMsgCooldown = Math.max(0, (state.magicMsgCooldown ?? 0) - delta)
          if (state.magicMsgCooldown <= 0) {
            think(state, 'Too winded to shape the wind.')
            state.magicMsgCooldown = 2
          }
        }
      }
    } else if (attacking && (player.magicCooldown ?? 0) <= 0 && hasTalent(player, 'magic_stance')) {
      player.charging = { t: 0, kind: 'gust' }
    }
  }

  if (attacking && player.attackMode === 'ranged') {
    const shot = tryFire(player)
    if (shot.ok) {
      const dir = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] }[player.facing]
      const proj = { px: player.px, py: player.py,
        dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED,
        damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true }
      if (shot.explodes) {
        proj.explodes = true
        proj.maxDist = FIREBALL_RANGE_TILES * TILE_SIZE
        proj.distTraveled = 0
        proj.lastPx = player.px; proj.lastPy = player.py   // last walkable spot, for wall detonations
      }
      state.projectiles.push(proj)
      sfx(state, 'ranged-shot', { px: player.px, py: player.py })
    } else if (FIRE_FAIL_MESSAGES[shot.reason] && state.fireMsgCooldown <= 0) {
      think(state, FIRE_FAIL_MESSAGES[shot.reason])
      state.fireMsgCooldown = 1.5
    }
  }

  // Update projectiles
  const liveProjectiles = []
  for (const p of state.projectiles) {
    const stepDist = Math.hypot(p.dx, p.dy) * delta
    p.px += p.dx * delta
    p.py += p.dy * delta
    if (p.maxDist !== undefined) {
      p.distTraveled = (p.distTraveled ?? 0) + stepDist
      if (p.distTraveled >= p.maxDist) {
        if (p.explodes) detonateFireball(p.lastPx ?? p.px, p.lastPy ?? p.py)
        continue
      }
    }
    const tile = map[Math.floor(p.py / TILE_SIZE)]?.[Math.floor(p.px / TILE_SIZE)]
    if (!tile || !isWalkable(tile.tile, tile)) {
      if (p.explodes) detonateFireball(p.lastPx ?? p.px, p.lastPy ?? p.py)
      continue
    }
    if (p.explodes) { p.lastPx = p.px; p.lastPy = p.py }
    let hit = false
    if (p.friendly) {
      state.entities = state.entities.map(e => {
        if (!isHittable(e) || hit) return e
        if (e.type === 'dragon_boss') return e          // immune to ranged; projectile passes over
        const hitR = 8
        if (Math.hypot(e.px - p.px, e.py - p.py) < hitR) {
          if (e.type === 'wizard' && e.shieldTimer > 0) { hit = true; return e }
          hit = true
          if (isCreature(e)) {
            const r = strikeCreature(e, state, p.damage)
            if (r.cue) sfx(state, r.cue, { px: e.px, py: e.py })
            if (!r.absorbed) addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${p.damage}`, kind: 'dealt' })
            return r.entity
          }
          addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${p.damage}`, kind: 'dealt' })
          const struck = { ...e, hp: e.hp - p.damage, inCombat: true }
          npcStruck(struck)
          sfx(state, struck.hp <= 0 ? deathCue(struck) : 'projectile-hit', { px: e.px, py: e.py })
          return struck
        }
        return e
      })
      state.entities = state.entities.filter(e => !isDead(e))
      if (hit && p.explodes) detonateFireball(p.px, p.py)
    } else {
      if (Math.hypot(player.px - p.px, player.py - p.py) < 10) {
        damagePlayer(state, p.damage, 'hit', `Hit for ${p.damage} damage!`)
        hit = true
      }
    }
    if (!hit) liveProjectiles.push(p)
  }
  state.projectiles = liveProjectiles

  // Lingering fireball flames — tick everyone standing in them
  if (state.fireZones?.length) {
    const snap = npcSnapshot()
    const fz = updateFireZones(state.fireZones, state.entities, player, delta)
    state.fireZones = fz.zones
    state.entities = fz.entities
    npcsStruckSince(snap)
    if (fz.playerDamage > 0) damagePlayer(state, fz.playerDamage, 'dot', "You're burning! (-1 HP)")
  }

  // Enemy AI — iterate a snapshot so wizard summons don't re-enter this frame
  for (const e of [...state.entities]) {
    // updateNpc drives peaceful AND hostile NPCs (the hostile ones run the
    // enemy brain inside their attack_hostile goal) — never both paths.
    if (e.type === 'npc') { updateNpc(e, state, delta); continue }
    if (isCreature(e)) { updateCreature(e, state, delta); continue }
    if (!isEnemy(e)) continue

    if (e.stunTimer > 0) { e.stunTimer -= delta; continue }
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
    if (!(e.stunTimer > 0)) tryStartEnemyAttack(e, state)
  }

  // Footfall screenshake — dragon boss stomps
  const stomper = state.entities.find(e => e.type === 'dragon_boss' && e.footfall)
  if (stomper) state.shake = 6

  // Advance fountain animation timers
  for (const e of state.entities) {
    if (e.type === 'prop' && e.flowing) {
      e.fountainTime = (e.fountainTime ?? 0) + delta
    }
    if (e.type === 'wild_mushroom') e.hueT = (e.hueT ?? 0) + delta
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

  // Campfires burn out after a minute.
  const fires = tickCampfires(state.entities, delta)
  state.entities = fires.entities
  for (const f of fires.expired) sfx(state, 'campfire-out', { px: f.px, py: f.py })

  // Walk animation — player + humanoid enemies (guard, wizard)
  tickWalk(player, delta)
  tickFeedback(state.feedback, delta)
  if (!state.cave && tickCaveInstances(state, delta)) persistAdventure()
  for (const e of state.entities) {
    if (e.type === 'guard' || e.type === 'wizard' || (e.type === 'npc' && NPC_SPECIES[e.species]?.walker)) tickWalk(e, delta)
  }

  // Player death: in Adventure it is a setback — wake at the village spawn;
  // in the dungeon rush it ends the run as ever.
  if (player.hp <= 0) {
    sfx(state, 'player-death')
    const surfaceLevel = state.cave ? state.cave.surface.level : state.level
    const mapData = OPEN_MAPS[surfaceLevel]
    if (mapData) {
      resetNpcs(savedAdventure)
      npcDirty = false
      state = adventureRespawn(state, mapData.playerSpawn)
      respawnNpcs()
      persistAdventure()
      queueToast(state, { title: 'You awaken back in Aspengrove…', lines: ['The dark took its toll — but you are alive.'] })
      return
    }
    state.gameOver = true
    endRun(false)
  }

  // Boss gating: remember the living boss's tile; when it dies, materialize the exit
  if (state.gameOver) return
  if (countBosses(state.entities) > 0) {
    const boss = state.entities.find(e => e.isBoss)
    state.lastBossTile = { x: boss.x, y: boss.y }
    state.lastBossType = boss.type
  } else if (state.lastBossTile && !state.dropSpawned) {
    // A cave boss always drops the key home — the campaign-ending treasure
    // belongs to Dungeon Rush's final depth alone.
    const isFinal = !state.cave && state.level >= FINAL_DEPTH
    const cfg = LEVEL_CONFIG.find(c => c.depth === state.level) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
    state.entities.push(spawnBossDrop(state.lastBossTile, isFinal, cfg.weapons))
    state.dropSpawned = true
    sfx(state, 'boss-death', { px: state.lastBossTile.x * TILE_SIZE + TILE_SIZE / 2, py: state.lastBossTile.y * TILE_SIZE + TILE_SIZE / 2 })
    const bossType = state.lastBossType
    if (bossType && !meta.bossToastsSeen.includes(bossType)) {
      meta.bossToastsSeen.push(bossType)
      window.saveAPI.saveMeta(meta)
      queueToast(state, { title: isFinal ? 'The dragon falls!' : 'The boss falls!', lines: [isFinal ? 'Treasure gleams…' : 'It drops a key.'] })
    } else {
      announce(state, isFinal ? 'The dragon falls — treasure gleams!' : 'The boss drops a key!')
    }
    if (!state.cave && !OPEN_MAPS[state.level] && RUSH_TALENT_LADDER[state.level]) {
      grantTalent(state, RUSH_TALENT_LADDER[state.level])
    }
    if (state.cave) {
      const mapData = OPEN_MAPS[state.cave.surface.level]
      const before = isMapComplete(savedAdventure.progress, mapData)
      markCleared(savedAdventure.progress, mapData.name, state.cave.label)
      const reward = MAP_CLEAR_TALENTS[mapData.name]
      if (reward) grantTalent(state, reward)
      if (!before && isMapComplete(savedAdventure.progress, mapData)) state.cave.mapJustCompleted = true
      persistAdventure()
    }
  }

  // Advance in-flight enemy melee attacks (windup → strike → swing)
  for (const e of state.entities) stepEnemyAttack(e, state, delta)

  // Resolve knockback slides after AI has moved everything this frame.
  // An overcharged gust (or the Maunonmiekka shockwave) can flag a slam:
  // a one-shot wall-collision hit, applied only to enemies.
  for (const e of state.entities) {
    const slam = stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
    if (slam && isHittable(e) && !isCreature(e) && !(e.type === 'wizard' && e.shieldTimer > 0)) {
      e.hp -= slam.damage
      e.inCombat = true
      npcStruck(e)
      addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${slam.damage}`, kind: 'dealt' })
      sfx(state, e.hp <= 0 ? deathCue(e) : 'wall-slam', { px: e.px, py: e.py })
    }
  }
  state.entities = state.entities.filter(e => !isDead(e))
  stepKnockback(player, delta, (px, py) => canMoveTo(map, px, py, PLAYER_HALF))

  // Flush NPC deaths and wrath. It has to sit after the cull above, because
  // recordNpcState reads `dead` as "declared id with no entity left".
  if (npcDirty && !state.cave && OPEN_MAPS[state.level]) { npcDirty = false; persistAdventure() }
  if (pendingDrops.length) { state.entities.push(...pendingDrops); pendingDrops = [] }

  // Clear hit flash — it fires once per swing
  if (state.hitEffects?.length > 0) state.hitEffects = []

  // Tier-A toasts: open one pausing panel per frame; the rest stay queued.
  const pending = drainToasts(state)
  if (pending.length) { openToast(pending[0]); state.feedback.toasts.push(...pending.slice(1)) }
}

function render() {
  // Open country sees almost twice as far as a dungeon or cave — 14 tiles
  // matches the audio falloff edge, so what you hear you can usually see.
  maybeComputeFOV(state.map, state.player, !state.cave && OPEN_MAPS[state.level] ? 14 : 8)
  const fx = riteVisuals(state)
  renderer.updateCamera(state.player, state.shake ?? 0, fx)
  renderer.render(state, fx)
  updateHUD(state)
}

function enterCave(entrance) {
  // A stored instance means the cave is exactly as it was left — killed
  // enemies dead, loot looted; cleared instances vanish on their reset timer
  // (tickCaveInstances), so missing here means generate fresh.
  const inst = state.caveInstances?.[entrance.label]
  if (inst) {
    state = buildCaveState(state, entrance, {
      map: inst.map, entities: inst.entities, playerSpawn: inst.stairs, theme: inst.theme,
      dropSpawned: inst.dropSpawned, lastBossTile: inst.lastBossTile, hasKey: inst.hasKey,
    })
    announce(state, inst.cleared ? 'The cave lies silent.' : 'You descend into the dark…')
    sfx(state, 'descend')
    return
  }
  const depth = entrance.caveDepth
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[1]
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const { map, entitySpawns, playerSpawn } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures })
  decorateMap(map, rulesets[theme.ruleset])
  state = buildCaveState(state, entrance, {
    map, entities: buildEntities(entitySpawns, map, depth), playerSpawn, theme,
  })
  announce(state, 'You descend into the dark…')
  sfx(state, 'descend')
}

function exitCave() {
  const mapJustCompleted = state.cave.mapJustCompleted
  const next = nextMapDepth(state.cave.surface.level)
  state = restoreSurface(state)
  persistAdventure()
  if (mapJustCompleted) {
    announce(state, next ? 'The waystone stirs — the way onward is open.'
                         : 'The wilds are conquered — your adventure is complete!')
  } else announce(state, 'You emerge into the light.')
  sfx(state, 'emerge')
}

// Waystone travel: a fresh open map, the player carried over to its spawn.
function travelToMap(depth) {
  // The map being left still owns its npc record — write it before `state`
  // becomes the new map and the departing kills/wrath are out of reach.
  if (OPEN_MAPS[state.level]) { npcDirty = false; persistAdventure() }
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const mapName = OPEN_MAPS[depth].name
  const npcRecord = npcRecordFor(savedAdventure, mapName)
  const felledRecord = savedAdventure.felled[mapName] ?? []
  const { map, entitySpawns, playerSpawn, caveEntrances, mapExit, signs } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures,
      npcs: npcRecord, felled: felledRecord })
  decorateMap(map, rulesets[theme.ruleset])
  state = {
    ...state,
    level: depth, map, theme,
    entities: buildEntities(entitySpawns, map, depth),
    projectiles: [], fireZones: [], shockwaves: [], hitEffects: [],
    log: [], feedback: makeFeedback(),
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    hasKey: false, dropSpawned: false, lastBossTile: null,
    lockedMsgCooldown: 0, fireMsgCooldown: 0, exitMsgCooldown: 0,
    caveEntrances: caveEntrances ?? [],
    caveInstances: { ...savedAdventure.caves[mapName] },
    mapExit: mapExit ?? null,
    entranceHold: false,
    signs: signs ?? [],
    npcWrath: npcRecord.hostile,
    npcSpawnIds: [...npcSpawns(entitySpawns), ...npcRecord.dead],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, depth) },
  }
  savedAdventure.progress.mapDepth = depth
  persistAdventure()
  arriveOnMap()
  announce(state, `You arrive in ${OPEN_MAPS[depth].title}.`)
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
    entities: buildEntities(entitySpawns, map, next),
    projectiles: [],
    fireZones: [],
    shockwaves: [],
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    log: [],
    feedback: makeFeedback(),
    hitEffects: [],
    shake: 0,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    lockedMsgCooldown: 0,
    fireMsgCooldown: 0,
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
  }
  announce(state, `Level ${next}. Deeper…`)
  sfx(state, 'descend')
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
  await renderer.loadSprites([...rulesetTileNames(rulesets), ...structureTileNames(structures), ...ROAD_TILES, ...OPEN_MAP_SPRITES])
  pruneMissingTiles(rulesets, renderer.sprites)
  savedAdventure = normalizeAdventureSave(await window.saveAPI.loadCaves?.())
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
