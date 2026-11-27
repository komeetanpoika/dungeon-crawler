import { generateLevel } from './systems/map.js'
import { ROAD_TILES } from './systems/overworld.js'
import { OPEN_MAPS, OPEN_MAP_SPRITES } from './data/open-maps.js'
import { maybeComputeFOV, hasLineOfSight, makePlayer, makeGuard, makeMonster, makeTrap, makeDragon, makePuzzle, makeChest, makeDoor, makeExitDoor, WEAPON_TYPES, RANGED_WEAPON_TYPES, WAND_TYPES, makeRangedContents, makeWandContents, emptyAmmo, weaponContents, isWalkable, DIRS, FACING_ANGLE, OUTFIT_TYPES, makeOutfitContents, defaultGear, SHIELD_TYPES, makeShieldContents } from './systems/entities.js'
import { makeCyclops, updateCyclops } from './systems/cyclops.js'
import { makeWizard, updateWizard } from './systems/wizard.js'
import { makeCrab, updateCrab } from './systems/crab.js'
import { makeDragonBoss, updateDragonBoss, PIXEL_SKIN } from './systems/dragonboss.js'
import { getInitialMeta, applyRunResult, getStartingItems, validateMeta, firstTime } from './systems/meta.js'
import { decorateMap, pruneMissingTiles, rulesetHasOverlays, skinFloors } from './systems/decorate.js'
import { Renderer, BLINK_DUR } from './render/canvas.js'
import { updateHUD } from './render/hud.js'
import { shadeSprites } from './render/interior-shade.js'
import { tickWalk } from './systems/walk.js'
import { FINAL_DEPTH, DEPTH_THEMES, LEVEL_CONFIG, OVERWORLD_DEPTH, ADVENTURE_DEPTH, WILDS_DEPTH } from './data/levels.js'
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
import { makeFeedback, tickFeedback, addFloat, speak, speakFrom, speakAt, think, announce, queueToast, drainToasts, ageHitEffects } from './systems/feedback.js'
import { makeSfx, sfx, drainSfx } from './systems/sfx.js'
import { makeAudio, playCues, setVolume } from './render/audio.js'
import { loadSettings, saveSettings, stepVolume } from './systems/settings.js'
import { ACTIONS, route, rebind, keysLabel, defaultBindings, bindable } from './systems/bindings.js'
import { makeLocalMatch, localInputs, viewOf, LOCAL_ID, inputFromKeys } from './pvp/local.js'
import { stepMatch, setClass } from './pvp/sim.js'
import { pvpHudModel, updatePvpHud, hidePvpHud, netHudModel, respawnLine, buffRowModel, updateBuffRow } from './ui/pvp-hud.js'
import { connect, frame as netFrameStep, sessionView, sendClass, leave as netLeave, drainEvents, drainCues } from './net/client.js'
import { netUrl, normalizeCode, validCode, errorText, errorTitle, controlHint, netViewOf } from './net/view.js'
import { validateName } from './net/protocol.js'
import { NET } from './data/net.js'
import { NEUTRAL_INPUT } from './pvp/hero.js'
import { makeNetPanels } from './ui/net-panels.js'
import { PVP_ARENAS, nextArenaIndex } from './data/pvp-arenas.js'
import { comboShake } from './render/pvp-fx.js'
import { openGate, updateGates } from './systems/gates.js'
import { itemFromContents, contentsFromItem, autoEquipOnPickup, addAmmo, removeItem, equipItem, equipOutfit, unequipOutfit, unequipMain, equipOffhand, unequipOffhand, equipBelt, unequipBelt, resolveOffhand, offhand, outfitOf, gearOf, loadoutAvailable, EQUIP_FAIL_MESSAGES } from './systems/inventory.js'
import { showInventory, hideInventory, refreshInventory } from './ui/inventory-panel.js'
import { showMap, hideMap } from './ui/map-panel.js'
import { updateMinimap } from './render/minimap.js'
import { toWorld } from './wilds/window.js'
import { isDesert, inGentleRing } from './wilds/desert.js'
import { windAt } from './wilds/desert-art.js'
import { tickStorm, calmStorm, sightNow, mapHero, mapHazed } from './wilds/storm.js'
import { clearOfTops } from './wilds/over.js'
import { makeBuilding, stairAt, shutAt, blockedBy, sayNow, sayKey, travel as travelFloor } from './interior/floors.js'
import { buildBuilding } from './interior/buildings/index.js'
import { buildCaveState, restoreSurface, tickCaveInstances, adventureRespawn, pruneClearedInstances } from './systems/cave.js'
import { INTERIOR_DEPTH, doorAt } from './systems/houses.js'
import { generateInterior, houseSpec, INTERIOR_SKINS, VERSIONS } from './systems/interior.js'
import { tickSunroom, storedSunroom } from './systems/sunroom-run.js'
import { dungeonLabels, markCleared, isMapComplete, nextMapDepth, normalizeAdventureSave, npcRecordFor, recordNpcState, resetNpcs, recordVisit, waystoneDestinations } from './systems/adventure.js'
import { modeForDepth } from './systems/mode.js'
import { cityFor } from './wilds/city/build.js'
import { enterWilds, tickWilds, snapshotWilds, wildsRespawn, asleep, capInstances, inVillage } from './wilds/session.js'
import { arriveTales, tickTales, storyEpisode } from './wilds/tale-run.js'
import { arriveCity, tickCity, noteCitySwing } from './wilds/city/runtime.js'
import { fracOf } from './wilds/city/runtime.js'
import { startTelling, tickSampo } from './wilds/city/sampo-run.js'
import { tickSampoPlaces } from './wilds/city/sampo-places.js'
import { passageFor, guardWaves } from './wilds/city/sampo.js'
import { noteSampoSwing, tickSampoEnd } from './wilds/city/sampo-end.js'
import { cityHouseSpec, cityBuildingSpec, leaveCityHouse, doorShut, struckInBuilding, spareStruck } from './wilds/city/indoors.js'
import { cityViolence, arrest, toStocks, clearCrime } from './wilds/city/law.js'
import { violenceUnseen } from './wilds/city/law.js'
import { ARREST_FADE } from './wilds/city/crime.js'
import { isShutGate, GATE_SHUT_LINE } from './wilds/city/fx.js'
import { playTune, tickTune } from './systems/tune.js'
import { makeWorld, hear } from './wilds/world.js'
import { tickCoach, refusal, REFUSAL_LINES, destinations, coachLabel } from './wilds/coach.js'
import { startRide, tickCoachRide } from './wilds/coach-ride.js'
import { WILDS_SKINS } from './wilds/terrain.js'
import { PIECE } from './wilds/layout.js'
import { randomSeed } from './pvp/rng.js'
import { normalizeTimewarpSave, enterEpisode, episodeEntries } from './systems/timewarp.js'
import { makeNpc, updateNpc, onNpcHit, interactNpc, nearestPeacefulNpc, rollNpcDrop } from './systems/npc.js'
import { npcSpawnsForMap } from './systems/openmap.js'
import { episodeFor, isMapUnlocked, isResolved, missingSpawn, echoSpawns, ruleCtx, makeEpCtx } from './systems/leap.js'
import { updateEcho } from './systems/echo.js'
import { EPISODE_MODULES } from './systems/episodes/index.js'
import { questFor, questFlags, questLines, makeQuestCtx } from './systems/quests.js'
import { QUEST_MODULES } from './systems/quests/index.js'
import { felledCells, findHarvestHit, harvest, resolveTool } from './systems/lumber.js'
import { canBuildCampfire, spendLumber, buildSpot, makeCampfire, tickCampfires, cookMeat, tickBlueRest } from './systems/campfire.js'
import { isEnemy, isHittable, isSpellTarget } from './systems/factions.js'
import { hurtCreature, CREATURE_UPDATE, CREATURE_HIT } from './systems/creatures.js'
import { registerMonsters, getMonsterDef, makeMonsterFromDef, updateMonsterPose, isStoryCreature } from './systems/monsters.js'
import { cullDead, tickDying } from './systems/dying.js'
import { NPC_SPECIES } from './data/npcs.js'
import { applyShockwave, SHOCK_RADIUS } from './systems/shockwave.js'
import { startStanceSwitch, tickStanceSwitch, nextStance, tryFire, DRAW_CHARGE, resolveDrawTier, shouldAutoReleaseDraw, FIRE_FAIL_MESSAGES, noAmmoMessage } from './systems/ranged.js'
import { castCone, GUST, GUST_CHARGE, GUST_TIERS, resolveGustTier, shouldAutoReleaseGust } from './systems/magic.js'
import { spellFor, tryCast } from './systems/spells.js'
import { tickZones } from './systems/zones.js'
import { castLightning, tickLightning } from './systems/spells/lightning.js'
import { HAMMER, applyShock, tickShock, chainNodes, applyChain, thunderclap, tickArcs, lightningMods, applyRain, tickRain, rainSlow } from './systems/hammer.js'
import { stepProjectiles } from './systems/projectiles.js'
import { nearestPoint } from './systems/hitbox.js'
import { tickStatus, shatterBonus } from './systems/status.js'
import { rollChestLoot } from './systems/loot.js'
import { TALENTS, hasTalent, grantTalent, RUSH_START_TALENTS } from './systems/talents.js'
import { RETIRED_TALENT_OUTFITS, MAP_CLEAR_OUTFITS, BOSS_DROP_OUTFITS, RUSH_START_OUTFITS, wearOutfit, ownsOutfit, outfitToast } from './systems/outfits.js'
import { startTrance, tickTrance, riteConditionMet, RITE_DURATION, riteVisuals,
  TRANCE_FADE, PULL_DURATION, PULL_TELEPORT_AT, pullTarget } from './systems/rites.js'
import { signNearby } from './systems/signs.js'
import { showSign, hideSign } from './ui/sign-panel.js'
import { showToast, hideToast } from './ui/toast.js'
import { getAttack, getSwingArc, inSwing, isChargeWeapon, resolveCharge, chargeMoveFactor, shouldAutoRelease, tierMods, OFFHAND_COOLDOWN_MUL, swingHand, nextHandAfter } from './systems/melee.js'
import { tickShield, BLOCK_SPEED_MUL } from './systems/shield.js'
import { tickBinds, playerBound, struggle } from './systems/player-bind.js'
import { computeBlastTiles, applyBurst, makeFireZone, updateFireZones, BURST_DAMAGE } from './systems/fire.js'
import { meleeCost, canAfford, spendStamina, tickStamina, sprintProfile, makeSprintDetector } from './systems/stamina.js'
import { makeWeather, advanceClock, weatherLook, isNight } from './systems/weather.js'
import { DAY_START } from './data/weather.js'
import { canMoveTo, moveEntity, PLAYER_HALF, PLAYER_SPEED } from './systems/movement.js'
import { applyLoadout, handPayload } from './systems/loadout.js'

// Fresh weather state for a depth's map — rebuilt on every surface-map
// construction so a departing map's weather (and its fog cells, keyed to
// that map's own tiles) is never inherited by the one arrived at.
// The Wilds (renderer/wilds/) has no OPEN_MAPS entry: its surface is generated
// as the player walks. Everything that asks "is this an open-map surface, and
// what is it called" goes through mapDataFor, which answers for the Wilds
// with this stand-in (no POIs: no quest, no episode, no waystone gate).
const WILDS_MAP = { name: 'wilds', title: 'the Wilds', pois: [], wilds: true }
const mapDataFor = depth => depth === WILDS_DEPTH ? WILDS_MAP : OPEN_MAPS[depth]
const weatherForDepth = depth => mapDataFor(depth) ? makeWeather(mapDataFor(depth)) : null

const TILE_SIZE = 32
const PROJECTILE_SPEED = 280
const STONES_PER_ROCK = 3      // sling ammo from a rock cracked with a pick
const CONTACT_RANGE = 20
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

// The player's settings (systems/settings.js): sound, keys, the minimap.
const settingsStore = { getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }
const settings = loadSettings(settingsStore)
const keepSettings = () => saveSettings(settingsStore, settings)
setVolume(audio, settings.volume)
const loadMutedPref = () => settings.muted
// Sound on or off, wherever the player is: a run, the arena, an online room.
function setMuted(m) {
  settings.muted = m
  keepSettings()
  if (pvp) pvp.match.sfx.muted = m
  if (net) net.muted = m
  if (state?.sfx) state.sfx.muted = m
}

// One listener ahead of every other turns the key the player pressed into
// the key the game reads for that action (systems/bindings.js). Keys the
// touch layer sends are already the game's own and pass; so does typing in a
// field, and the title's own menus, where cheats are typed. `keyGrab` takes the
// next real key for the Controls screen.
let keyGrab = null
const sentFor = new Map()   // real key held -> the key sent in its place
function routeKey(e) {
  if (!e.isTrusted || e.target?.tagName === 'INPUT') return
  const swallow = () => { e.stopImmediatePropagation(); e.preventDefault() }
  if (keyGrab) {
    swallow()
    if (e.type === 'keydown' && !e.repeat) keyGrab(e.key)
    return
  }
  if (phase === PHASE.TITLE && !pvp && !net) { sentFor.clear(); return }   // the arena and online rooms run under the title phase
  if (e.type === 'keyup' && sentFor.has(e.key)) {
    swallow()
    window.dispatchEvent(new KeyboardEvent('keyup', { key: sentFor.get(e.key) }))
    sentFor.delete(e.key)
    return
  }
  const r = route(settings.bindings, e.key)
  if (r.type === 'pass') { if (e.key === 'Tab') e.preventDefault(); return }
  swallow()
  if (r.type !== 'send') return
  if (e.type === 'keydown') sentFor.set(e.key, r.key)
  window.dispatchEvent(new KeyboardEvent(e.type, { key: r.key, repeat: e.repeat }))
}
window.addEventListener('keydown', routeKey, true)
window.addEventListener('keyup', routeKey, true)
window.addEventListener('keydown', e => { if (e.repeat && (e.key === 'f' || e.key === 'F')) return; keys[e.key] = true })   // a held F is one press (it turns Päivölä's mirrors)
window.addEventListener('keyup',   e => { keys[e.key] = false })
// Focus loss never delivers the keyup, so a key held over an Alt-Tab would
// stay down for good. Q is the one that bites: tickShield would keep the
// player blocking forever — half speed, no sprint, no attacks, and no way
// back short of pressing and releasing Q again.
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false })

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
    if (pvp) { stopPvp(); return }
    if (net) {
      // In a joined match Escape (and the touch START pill, which sends it)
      // toggles "Leave the match?" — over the death picker and the results
      // too. Before the welcome, or over a refusal, it just leaves. A held
      // key's repeats would flap the confirm open and shut.
      if (e.repeat) return
      if (net.s.status === 'open') net.panels.escape()
      else stopNet()
      return
    }
    if (inventoryOpen) closeInventory()
    else if (mapOpen) closeMap()
    else if (phase === PHASE.PLAYING) pauseGame()
    else if (phase === PHASE.PAUSED) resumeGame()
  }
})

// I toggles the inventory panel: open while playing, close while it's open.
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return
  if ((e.key !== 'i' && e.key !== 'I') || e.repeat) return
  if (pvp || net) return
  if (phase === PHASE.PLAYING) { if (!playerBound(state.player)) openInventory() }
  else if (inventoryOpen) closeInventory()
})

// M (and the touch map icon) opens and shuts the map of the Wilds; Tab
// shows and hides the corner minimap. The arena and online rooms have no
// map and no pause menu, so there the key still turns the sound on and off.
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT' || e.repeat) return
  if (pvp || net) { if (e.key === 'm' || e.key === 'M') setMuted(!settings.muted); return }
  if (e.key === 'm' || e.key === 'M') {
    if (mapOpen) closeMap()
    else if (phase === PHASE.PLAYING && state && !playerBound(state.player)) openMap()
  } else if (e.key === 'Tab' && phase === PHASE.PLAYING && state && runMode === 'wilds') {
    e.preventDefault()
    settings.minimap = !settings.minimap
    keepSettings()
  }
})

// Q (and the green touch button): use whatever the active offhand holds.
// Only the two that act on a press land here — a consumable and the offhand
// wand. A shield rises while Q is *held* (the update loop's tickShield reads
// the key itself) and an offhand blade needs no key at all.
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return
  if ((e.key !== 'q' && e.key !== 'Q') || e.repeat) return
  if (phase !== PHASE.PLAYING || !state || playerBound(state.player)) return
  useOffhand()
})

// Held in a monster's grip (systems/player-bind.js), every key press is a
// struggle against it — Escape still only pauses. The touch buttons send
// keys too, so tapping them counts the same. In Kalevanlinna's stocks a key
// press does nothing but make the crowd jeer.
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return
  if (e.repeat || e.key === 'Escape') return
  if (phase !== PHASE.PLAYING || !state) return
  if (state.player.stocks) { sfx(state, 'jeer', { px: state.player.px, py: state.player.py }); return }
  struggle(state.player)
})

function useOffhand() {
  const off = resolveOffhand(state.player)
  if (!off) { throttledThink('offhand', 'Nothing in my off hand.'); return }
  if (off.kind === 'consumable') {
    if (off.index === -1) { throttledThink('offhand', 'None left.'); return }
    useInventoryItem(off.index)
  } else if (off.kind === 'wand') {
    castOffhand()
  }
  // A shield rises while Q is held (tickShield reads the key each frame);
  // a blade needs no key — swings alternate on Space.
}

// The offhand wand: a tap cast on its own cooldown, from the shared tank.
function castOffhand() {
  const player = state.player
  if (player.attackMode !== 'magic' || player.stanceSwitch) return
  const cast = tryCast(state, spellFor(player, 'off').id, 'tap', { modules: { lightning: castLightning }, hand: 'off' })
  if (cast.ok) showCast(cast)
  else if (cast.reason === 'stamina') {
    player.staminaRefusedT = 0.4
    throttledThink('magic', 'Too winded to shape the wind.')
  }
}

// Shift starts a stance switch. Edge-triggered: e.repeat filters the
// held-key auto-repeat so holding Shift doesn't flap the mode. The switch
// takes a moment (see STANCE_SWITCH_DURATION) — the mode lands in update().
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return
  if (e.key !== 'Shift' || e.repeat) return
  if (phase !== PHASE.PLAYING || !state || playerBound(state.player)) return
  // startStanceSwitch drops any charge in progress itself (it belongs to the
  // stance being left); `false` back means a switch was already running and
  // this Shift is ignored outright.
  const target = startStanceSwitch(state.player)
  if (target === null) think(state, 'I know no other ways to fight.')
})

// In-game weapon cheat: type "mauno" during a run to wield the Maunonmiekka.
let gameCheatBuffer = ''
window.addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return
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
// A local PvP match (renderer/pvp/local.js) while one runs. `state` stays
// null meanwhile, so every single-player key handler that checks it no-ops.
let pvp = null
// An online PvP room (renderer/net/) while one is joined. Like `pvp`, it
// keeps `state` null so every single-player handler no-ops.
let net = null
// The monster bench (tools/monster-bench/, `npm run bench -- <name>`) while
// it runs: frame delta, freeze test and overlay hooks; null otherwise.
let bench = null
// Tooling hook (verify-npcs.mjs etc.): only wired up when launched with
// --dcdebug (main.cjs passes it through as a ?dcdebug query param), so a
// normal run never exposes internal state.
if (new URLSearchParams(location.search).has('dcdebug')) {
  window.__dc = { get state() { return state }, get save() { return activeSave }, get wilds() { return wildsWorld }, get sprites() { return renderer?.sprites }, get renderer() { return renderer } }
}
let inventoryOpen = false
let mapOpen = false
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
// Which of the three modes (plus the arena) this run is. Set in beginRun;
// mode decisions read this, never depth ranges.
let runMode = 'rush'
let savedTimewarp = normalizeTimewarpSave(null)
// The save the current run reads and writes: the adventure save, or — in
// timewarp — the picked episode's own adventure-shaped mini-save. Every
// map-state helper goes through this so the two modes can't cross-write.
let activeSave = savedAdventure
// The Wilds: its own adventure-shaped save carrying the world record
// (`wilds`, renderer/wilds/world.js), and the live world while a Wilds run
// is up — null in every other mode, which is what keeps its hooks quiet.
let savedWilds = normalizeAdventureSave(null)
let wildsWorld = null
const wildsBuild = (spawns, map, depth) => buildEntities(spawns, map, depth, state?.player ?? null)
const wildsHooks = {
  buildEntities: wildsBuild,
  // how far the hero sees now, for the map (wilds/storm.js sightNow)
  sight: () => wildsSight(),
  // (on the coach the arrival is the coach's to tell: arriveByCoach)
  onVillage: v => { if (state.coachRide) return; announce(state, `You reach ${v.name}.`); persistRun() },
}
// The villages' tales (wilds/tale-run.js) run the Adventure quest modules
// through these: the same seams arriveOnMap gives a quest ctx.
const taleHooks = {
  getState: () => state,
  spawn: (spawns, depth) => buildEntities(spawns, state.map, depth),
  persist: () => persistRun(),
  refreshInventory: () => afterInventoryChange(),
  rollLoot: depth => rollChestLoot(depth, Math.random, state.player),
  save: () => activeSave,
  isNight: () => isNight(activeSave.clock ?? DAY_START),
  grantTalent: id => grantTalent(state, id),
}
// Kalevanlinna's townsfolk (wilds/city/runtime.js): the clock and the day run
// their schedules, and the screen's size sets who is near enough to be a
// real entity (the visible half-width + 6 tiles).
const cityHooks = {
  spawn: spawns => buildEntities(spawns, state.map, 0),
  clock: () => activeSave.clock ?? DAY_START,
  day: () => wildsWorld?.day ?? 0,
  viewHalf: () => (renderer ? { w: renderer.viewW / (2 * TILE_SIZE), h: renderer.viewH / (2 * TILE_SIZE) } : { w: 20, h: 12 }),
  sfx: (name, pos) => sfx(state, name, pos),
  // a watchman's blow (npc.js defend) on a monster: the projectiles' hit path,
  // which is the player's melee path too (a registry monster through its own
  // hook, anything else in place), so a kill culls, drops and is recorded as
  // a player's would be. The blow sounds its own 'melee-hit'.
  hurt: (target, amount) => hurtEntity(target, amount, { source: 'watch', hitCue: null }),
  // the frame's route requests stop once a millisecond is spent (tests run without, by count)
  now: () => performance.now(),
}

// The Sampo's story (wilds/city/sampo-run.js): what it lays on the ground and when it saves.
const sampoHooks = {
  spawn: spawns => buildEntities(spawns, state.map, 0),
  persist: () => persistRun(),
  refreshInventory: () => afterInventoryChange(),
  rollLoot: depth => rollChestLoot(depth, Math.random, state.player),
  getState: () => state,
  // between the floors of a building, where the story says (out of the giant's belly)
  travel: to => { state = travelFloor(state, { id: 'story', to }) },
  // a question in the middle of play: ask = { title, lines, yes, no }
  choose: (ask, onYes) => {
    setPhase(PHASE.PAUSED)
    sfx(state, 'ui-open')
    menu.showChoice({ title: ask.title, lines: ask.lines, buttons: [
      { label: ask.yes, onSelect: () => { resumeGame(); onYes() } },
      { label: ask.no, onSelect: resumeGame },
    ] })
  },
}

function persistRun() {
  if (runMode !== 'adventure' && runMode !== 'timewarp' && runMode !== 'wilds') return
  const surface = state?.cave ? state.cave.surface : state
  const mapName = surface ? mapDataFor(surface.level)?.name : null
  // The Wilds keeps its gone things and felled trees per piece in its own
  // record (snapshotWilds); the per-map lists below are the fixed maps'.
  const wilds = runMode === 'wilds'
  // An endless world would otherwise keep every cave ever left unfinished.
  if (mapName && wilds) surface.caveInstances = capInstances(surface.caveInstances)
  if (mapName) activeSave.caves[mapName] = surface.caveInstances ?? {}
  if (mapName && !wilds) activeSave.gates[mapName] =
    Object.entries(surface.gates ?? {}).filter(([, g]) => g.open).map(([id]) => id)
  if (mapName && !wilds) recordNpcState(activeSave, mapName, surface.npcSpawnIds ?? [], surface.entities, surface.npcWrath)
  if (mapName && !wilds) activeSave.felled[mapName] = felledCells(surface.map)
  if (mapName && wilds && wildsWorld) activeSave.wilds = snapshotWilds(state, wildsWorld)
  if (mapName && state.player) {
    activeSave.talents = [...(state.player.talents ?? [])]
    activeSave.body = {
      weapon: state.player.weapon ? { ...state.player.weapon } : null,
      ranged: state.player.ranged ? { ...state.player.ranged } : null,
      wand: state.player.wand ? { ...state.player.wand } : null,
      // The quiver travels with the body, not with any one bow.
      ammo: { ...emptyAmmo(), ...(state.player.ammo ?? {}) },
      inventory: state.player.inventory.map(i => i.payload ? { ...i, payload: { ...i.payload } } : { ...i }),
      // Per-loadout gear and the shared belt travel with the body too.
      gear: structuredClone(state.player.gear ?? defaultGear()),
      belt: state.player.belt ? { ...state.player.belt } : null,
    }
  }
  if (runMode === 'timewarp') window.saveAPI.saveTimewarp?.(savedTimewarp)
  else if (wilds) window.saveAPI.saveWilds?.(savedWilds)
  else window.saveAPI.saveCaves?.(savedAdventure)
}

// Progress only persists on the open maps (Adventure/Timewarp) — a
// Dungeon Rush level, or a cave under one, saves nothing mid-run.
function persistIfSurface() {
  if (mapDataFor(state.cave ? state.cave.surface.level : state.level)) persistRun()
}

// One thought per key per `secs`, so a held key or a stood-on tile can't
// spam the bubble. Returns whether it spoke; tickMsgCooldowns runs the
// clocks down every frame.
function throttledThink(key, text, secs = 2) {
  const cd = state.msgCooldown ??= {}
  if ((cd[key] ?? 0) > 0) return false
  think(state, text)
  cd[key] = secs
  return true
}
function tickMsgCooldowns(delta) {
  const cd = state.msgCooldown
  for (const k in cd) cd[k] = Math.max(0, cd[k] - delta)
}

const isRegistryMonster = e => !!getMonsterDef(e.type)
function cullEntities() { state.entities = cullDead(state.entities, isRegistryMonster) }

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

// A blow landed on an npc: hurt cue + species reaction + village wrath (once).
// An animal that survives yelps; villagers keep the human cue the hit site
// already plays. `alive` is passed explicitly by the splash path, where the
// snapshot entity still carries its pre-blast hp. `source` is the hit path's
// (hurtEntity's meta): every blow but the watch's own ('watch') is the
// player's, and on one of Kalevanlinna's people inside the walls it is
// violence the city answers (wilds/city/law.js).
// Drops rolled for NPCs that died this frame. Damage sites run inside
// state.entities rebuilds, so pushing a pickup there would be lost — they
// queue here and land after the frame's final cull.
let pendingDrops = []
let pendingOut = null   // blows struck inside a building this frame: { hit: [npc], killed }
function npcStruck(e, alive = e.hp > 0, source = 'player') {
  if (e.type !== 'npc') return
  npcDirty = true
  if (alive && !NPC_SPECIES[e.species]?.walker) sfx(state, 'npc-hurt', { px: e.px, py: e.py })
  if (!alive) {
    const contents = rollNpcDrop(e)
    // (what falls under a roof's edge lands beside it, in sight: wilds/over.js)
    const at = clearOfTops(state.map, e.x, e.y)
    if (contents) pendingDrops.push({
      type: 'floating_item', contents, x: at.x, y: at.y,
      startPx: e.px, startPy: e.py, targetPx: at.x * TILE_SIZE + TILE_SIZE / 2, targetPy: at.y * TILE_SIZE + TILE_SIZE / 2,
      px: e.px, py: e.py, progress: 0, duration: 0.3,
    })
  }
  if (source !== 'watch' && state.cave && struckInBuilding(state)) {
    // church or castle: no one falls here; the player is put out after the frame
    pendingOut ??= { hit: [], killed: false }
    pendingOut.hit.push(e)
    if (!alive) pendingOut.killed = true
    return
  }
  const r = onNpcHit(e, state)
  if (r.wrath) { announce(state, 'The village turns on you!'); sfx(state, 'npc-wrath') }
  if (e.cityKey !== undefined && wildsWorld) cityViolence(state, wildsWorld, e, { killed: !alive, source })
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
// `fireOnly` (a tarred arrow) skips the burst and shockwave and only lays
// the burning patch.
function detonateFireball(px, py, blastTiles, { fireOnly = false } = {}) {
  const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE)
  const tiles = computeBlastTiles(state.map, tx, ty, blastTiles)
  if (!tiles.length) return
  sfx(state, 'fire-burst', { px, py })
  // A tarred arrow only burns: the patch, no burst damage, no shockwave.
  if (fireOnly) { state.fireZones.push(makeFireZone(tiles)); return }
  const before = state.entities
  const npcSnap = npcSnapshot()
  const burst = applyBurst(state.entities, state.player, tiles, { hurt: hurtEntity })
  // applyBurst hands back a fresh copy for everything it burned and culls the
  // dead, so positional indices shift the moment one entity dies. Diff by
  // identity instead, the way npcsStruckSince does: an entity from the before
  // list that is no longer in the after list by reference was burned — copied
  // if it survived, dropped if the blast killed it.
  // A registry monster is burned in place through hurtEntity (its own float
  // and cue), so it stays identical and this loop leaves it alone.
  const untouched = new Set(burst.entities)
  for (const e of before) {
    if (!isHittable(e) || e.hp <= 0 || untouched.has(e)) continue
    addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${BURST_DAMAGE}`, kind: 'dealt' })
    if (e.hp - BURST_DAMAGE <= 0) sfx(state, deathCue(e), { px: e.px, py: e.py })
  }
  state.entities = burst.entities
  npcsStruckSince(npcSnap)
  if (burst.playerBurned) damagePlayer(state, BURST_DAMAGE, 'hit')
  state.fireZones.push(makeFireZone(tiles))
  state.shockwaves.push({ px: tx * TILE_SIZE + TILE_SIZE / 2, py: ty * TILE_SIZE + TILE_SIZE / 2,
    t: 0, dur: 0.35, maxRadius: TILE_SIZE * 2.5, color: '#f97316' })
}

// The one hit path shared by projectiles, ground zones and lightning: a
// registry creature decides for itself what a hit does (hurtCreature owns the
// cue, the thought and the absorb rule), everything else takes the damage in
// place with its float, cue and npc reaction. Mutates rather than replacing,
// because the zone and lightning tickers ignore the return value — only
// stepProjectiles uses it, and there `struck === target` is a no-op swap.
// `meta` is whatever the caller had to hand (a projectile, or lightning's
// `{ source }`); only `source` is read from it, and `hitCue` (a blow that
// sounds its own hit: null) in place of the projectile's thud.
function hurtEntity(e, damage, meta) {
  const source = meta?.source ?? 'player'
  if (CREATURE_HIT[e.type] && getMonsterDef(e.type)) {
    const r = hurtCreature(state, e, damage, { source })
    if (r.cue) sfx(state, r.cue, { px: e.px, py: e.py })
    // a watchman's blow is not the player's: the creature's reaction line is no thought of theirs
    if (r.think && source !== 'watch') think(state, r.think)
    if (!r.absorbed) addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${damage}`, kind: 'dealt' })
    return e
  }
  addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${damage}`, kind: 'dealt' })
  e.hp -= damage
  e.inCombat = true
  npcStruck(e, e.hp > 0, source)
  const cue = e.hp <= 0 ? deathCue(e) : meta?.hitCue !== undefined ? meta.hitCue : 'projectile-hit'
  if (cue) sfx(state, cue, { px: e.px, py: e.py })
  return e
}

// Everything the projectile stepper needs from game.js, and nothing more.
const projectileHooks = {
  isHittable,
  hurt: hurtEntity,
  detonate: (px, py, blastTiles, opts) => detonateFireball(px, py, blastTiles, opts),
  damagePlayer: (damage, from) => damagePlayer(state, damage, 'hit', from),
  // A corpse sits at 0 hp until it is culled, and would otherwise soak a
  // second projectile arriving the same frame.
  cull: entities => cullDead(entities, isRegistryMonster),
}

const BACKWARDS = { north: 'south', south: 'north', east: 'west', west: 'east' }
// The cone ring's colour per spell — the gust's pale cyan, rime's frost blue.
const CONE_COLOR = { rime: '#bfdbfe' }
const GUST_RING = 44   // px: the ring radius a tap-tier cone draws

// Show a successful cast: spawn what it made, ring what it swept, trail what
// it moved. tryCast has already paid for it — this is feedback only.
function showCast(cast) {
  const player = state.player
  sfx(state, 'magic-cast', { px: player.px, py: player.py })
  noteCitySwing(state, wildsWorld)   // the townsfolk flinch at a spell cast near them
  if (cast.projectiles) state.projectiles.push(...cast.projectiles)
  if (cast.caught !== undefined) {
    // A cone tier states its reach either as a multiplier of the gust's
    // (gust) or in pixels (rime) — normalise so one ring serves both.
    const t = cast.spell.tiers[cast.tier] ?? {}
    const mul = t.mul ?? (t.reach ?? GUST.reach) / GUST.reach
    const fa = FACING_ANGLE[player.facing] ?? 0
    state.shockwaves.push({
      px: player.px + Math.cos(fa) * GUST_RING * mul, py: player.py + Math.sin(fa) * GUST_RING * mul,
      t: 0, dur: 0.3, maxRadius: GUST_RING * mul, color: CONE_COLOR[cast.spell.id] ?? '#a5f3fc',
    })
  }
  if (cast.from) {
    state.blinkTrail = { from: cast.from, to: cast.to, t: 0 }
    // Blink's over tier leaves a parting gust at the origin, blowing back the
    // way the player came. castCone reads the caster's own position and
    // facing, so stand them back there for the one call and put them back.
    if (cast.gustBack) {
      const { px, py, facing } = player
      player.px = cast.from.px; player.py = cast.from.py
      player.facing = BACKWARDS[facing] ?? facing
      castCone(state, GUST_TIERS.tap)
      const fa = FACING_ANGLE[player.facing] ?? 0
      state.shockwaves.push({
        px: player.px + Math.cos(fa) * GUST_RING, py: player.py + Math.sin(fa) * GUST_RING,
        t: 0, dur: 0.3, maxRadius: GUST_RING, color: '#a5f3fc',
      })
      player.px = px; player.py = py; player.facing = facing
    }
  }
}

// Walk-onto item grant: ammo straight into the quiver, otherwise hand if
// free, else sack. Returns false when the sack is full so the caller can
// leave the item in the world.
function grantContents(contents) {
  const item = itemFromContents(contents)
  if (!item) return true
  const r = autoEquipOnPickup(state.player, item)
  if (!r.ok) {
    throttledThink('pack', 'My pack is full.')
    return false
  }
  // An ammo bundle (or the quiver top-up a bow pickup brings) never reaches a
  // sack slot, so the count is all the feedback there is — float it.
  if (r.ammo > 0) addFloat(state.feedback, { px: state.player.px, py: state.player.py - 10, text: `+${r.ammo}`, kind: 'heal' })
  if (r.outfit) outfitToast(state, item.payload)
  sfx(state, 'pickup')
  return true
}

// `player` is who the loot roll is for: rollChestLoot suppresses categories
// this body has no talent for (systems/loot.js). Every caller but the initial
// build is placing entities around the player already in `state`, so that is
// the default; startNewRun passes its freshly-assembled body explicitly, since
// `state` there is still the previous run's (or nothing at all).
function buildEntities(spawns, map, depth, player = state?.player ?? null) {
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
      case 'chest':   return [makeChest(s.x, s.y, s.contents ?? rollChestLoot(depth, Math.random, player))]
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
      case 'talent_trigger': return [{ type: 'talent_trigger', x: s.x, y: s.y, outfit: s.outfit, rite: s.rite }]
      case 'wild_mushroom':  return [{ type: 'wild_mushroom', x: s.x, y: s.y, hueT: (s.x * 7 + s.y * 13) % 10 }]
      // Something lying on a floor (a house's potions, a tale's things in a
      // story house) — lands already-arrived (progress: 1) rather than arcing in.
      case 'floating_pickup': return [{ type: 'floating_item', contents: s.contents, x: s.x, y: s.y,
        startPx: cx, startPy: cy, targetPx: cx, targetPy: cy, px: cx, py: cy, progress: 1, duration: 0.3 }]
      case 'echo':    return [{ type: 'echo', id: 'echo', x: s.x, y: s.y, px: cx, py: cy, fadeA: 0, t: 0, trail: [], said: null }]
      // Tapio's peace (a tale's reward): wolves are built calm; striking one still makes it fight
      case 'npc': {
        const n = makeNpc(s.species === 'wolf' && hasTalent(player, 'tapio_peace') ? { ...s, hostile: false } : s)
        if (n && s.lines) n.lines = s.lines   // someone at home says what that household says
        if (n && s.look) n.look = s.look      // one of Kalevanlinna's people at home, as they look outside
        if (n && s.hears) n.hears = s.hears   // a traveller on the road names a town (wilds/world.js hear)
        if (n && s.coachman) n.coachman = true   // the coachman by a village's cart, who says why he will not drive (wilds/coach.js)
        return n ? [n] : []
      }
      // a Wilds camp's fire (wilds/sites.js): it never burns down, and cooks like any other
      case 'campfire': return [makeCampfire(s.x, s.y, { eternal: true })]
      default: {
        const gen = makeMonsterFromDef(s.kind, s.x, s.y, { isBoss: !!s.isBoss })
        return gen ? [hpOverride({ ...gen, px: cx, py: cy, ...aiInit() })] : []
      }
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
  if (episodeFor(data) && isResolved(activeSave, data)) {
    state.entities.push(...buildEntities([missingSpawn(data)], state.map, state.level))
  }
  state.npcSpawnIds = npcSpawns(spawns)
  state.npcWrath = false
}

// Leap maps: install the persona while the episode is open, or bring the
// missing person home if it is already resolved.
function arriveOnMap() {
  const mapData = mapDataFor(state.level)
  const ep = episodeFor(mapData)
  state.episode = ep
  state.villagerLines = null
  state.episodeResolved = false
  state.epCtx = null
  state.quest = questFor(mapData)
  state.qCtx = null

  // Adventure quests: the same story engine as the episodes, on the maps that
  // have no episode. A map never has both (questFor skips leap maps).
  if (state.quest) {
    state.qCtx = makeQuestCtx({
      getState: () => state, save: activeSave, mapData,
      persist: persistRun, refreshInventory: afterInventoryChange,
      spawn: spawns => state.entities.push(...buildEntities(spawns, state.map, state.level)),
      // The villagers are the quest log: every flag write restages their lines.
      onFlag: () => { state.villagerLines = questLines(state.quest, state.qCtx.flags) },
    })
    state.villagerLines = questLines(state.quest, questFlags(activeSave, mapData.name))
    QUEST_MODULES[mapData.name]?.onArrive?.(state.qCtx)
  }

  if (!ep) return
  state.epCtx = makeEpCtx({
    getState: () => state, save: activeSave, mapData,
    persist: persistRun, resolve: resolveEpisode, refreshInventory: afterInventoryChange,
    spawn: spawns => state.entities.push(...buildEntities(spawns, state.map, state.level)),
  })
  state.entities.push(...buildEntities(echoSpawns(mapData, { x: state.player.x, y: state.player.y }), state.map, state.level))
  if (isResolved(activeSave, mapData)) {
    state.episodeResolved = true
    state.entities.push(...buildEntities([missingSpawn(mapData)], state.map, state.level))
    state.villagerLines = ep.resolvedLines ?? null
  } else {
    state.villagerLines = ep.villagerLines
  }
  EPISODE_MODULES[mapData.name]?.onArrive?.(state.epCtx)
}

// Fires the moment an episode's rule is first satisfied: the missing person
// walks back into the village and the runestone hums. Idempotent per visit
// via `state.episodeResolved` — episode modules (Task 5) call this through ctx
// right after setting the flag that might complete the rule.
function resolveEpisode() {
  const mapData = OPEN_MAPS[state.level]
  if (!state.episode || state.episodeResolved || !isResolved(activeSave, mapData)) return
  state.episodeResolved = true
  state.villagerLines = state.episode.resolvedLines ?? null
  state.entities.push(...buildEntities([missingSpawn(mapData)], state.map, state.level))
  sfx(state, 'leap', { px: state.player.px, py: state.player.py })
  announce(state, `${state.episode.persona} walks back into the village. The runestone hums.`)
  if (runMode === 'timewarp') savedTimewarp.episodes[mapData.name].resolved = true
  persistRun()
}

// Which stance owns each kind of charge. startStanceSwitch already drops a
// charge on the way out of its stance; the update loop re-checks against this
// as the backstop for any other path that could move attackMode under a live
// charge, so the move-speed penalty and the charge ring can never outlive the
// stance that can release them. A melee wind-up carries no `kind` and is
// governed by its own branch instead.
const CHARGE_STANCE = { draw: 'ranged', spell: 'magic' }

function startNewRun(depth = 1, arenaCfg = null) {
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[0]
  // The Wilds builds its own map once `state` exists (enterWilds below).
  const wilds = depth === WILDS_DEPTH
  const openMap = mapDataFor(depth)
  const npcRecord = openMap && !wilds ? npcRecordFor(activeSave, openMap.name) : null
  const felledRecord = openMap && !wilds ? activeSave.felled[openMap.name] ?? [] : null
  const { map, entitySpawns, playerSpawn, caveEntrances, houseDoors, gates, mapExit, signs } = wilds
    ? { map: [], entitySpawns: [], playerSpawn: { x: 0, y: 0 } }
    : generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures, arena: arenaCfg,
      npcs: npcRecord, felled: felledRecord })
  // Timewarp is fully mode-independent of the rush meta: no unlocked
  // bonuses, no meta starting items — episodes run on their fixed kit only.
  const player = makePlayer(playerSpawn.x, playerSpawn.y, runMode === 'timewarp' ? [] : meta.unlockedBonuses)
  player.px = playerSpawn.x * TILE_SIZE + TILE_SIZE / 2
  player.py = playerSpawn.y * TILE_SIZE + TILE_SIZE / 2
  player.facing = 'south'
  player.meleeCooldown = 0
  player.rangedCooldown = 0
  player.attackTimer = 0
  player.attackDuration = 0.20
  player.attackStyle = 'arc'
  player.attackFacing = 'south'
  if (runMode !== 'timewarp') player.inventory.push(...getStartingItems(meta))
  if (runMode === 'rush') {
    player.talents = [...RUSH_START_TALENTS]
    for (const ot of RUSH_START_OUTFITS) { const { type, ...payload } = makeOutfitContents(ot); wearOutfit(player, payload) }
  }
  if (openMap) {
    player.talents = [...activeSave.talents]
    if (activeSave.body) {
      // Hand payloads are re-derived from their tables rather than copied.
      // For melee: saves written before lumber landed carry no `chop`, and a
      // hatchet or axe out of one of those must still fell trees. For ranged
      // and wands the same now holds — since ammo moved off the weapon into
      // the shared pool, a bow's payload is pure table data with no run state
      // left on it, so re-deriving repairs a stale one instead of preserving
      // it. (normalizeBody has already done this once on load; doing it here
      // too keeps the seam honest for any body that reaches us another way.)
      player.weapon = activeSave.body.weapon ? weaponContents(activeSave.body.weapon.weaponType) : null
      player.ranged = activeSave.body.ranged ? handPayload(makeRangedContents(activeSave.body.ranged.weaponType)) : null
      player.wand = activeSave.body.wand ? handPayload(makeWandContents(activeSave.body.wand.weaponType)) : null
      player.ammo = { ...emptyAmmo(), ...(activeSave.body.ammo ?? {}) }
      // Gear was normalised (outfits rebuilt from the table) by normalizeBody on load.
      player.gear = structuredClone(activeSave.body.gear ?? defaultGear())
      player.belt = activeSave.body.belt ? { ...activeSave.body.belt } : null
      player.inventory = activeSave.body.inventory.map(i => {
        if (!i.payload) return { ...i }
        if (i.kind === 'weapon') return { ...i, payload: weaponContents(i.payload.weaponType) }
        if (i.kind === 'ranged') return { ...i, payload: handPayload(makeRangedContents(i.payload.weaponType)) }
        if (i.kind === 'wand') return { ...i, payload: handPayload(makeWandContents(i.payload.weaponType)) }
        // Shields are table data like the hands: rebuilt so a stale blockCost
        // is retuned, and an unknown type dropped rather than minted as a
        // buckler by makeShieldContents' fallback.
        if (i.kind === 'shield')
          return SHIELD_TYPES[i.payload.weaponType] ? { ...i, payload: handPayload(makeShieldContents(i.payload.weaponType)) } : null
        return { ...i, payload: { ...i.payload } }
      }).filter(Boolean)
    }
  }
  if (depth === 0 && arenaCfg?.player) applyLoadout(player, arenaCfg.player)
  // First entry into an episode: the fixed kit, not the adventure body.
  // A mid-episode resume has a body in the mini-save and restored it above.
  if (runMode === 'timewarp' && !activeSave.body) applyLoadout(player, episodeFor(OPEN_MAPS[depth])?.kit)
  if (!wilds) decorateMap(map, rulesets[theme.ruleset])
  state = {
    level: depth,
    mode: runMode,
    map,
    player,
    theme,
    entities: buildEntities(entitySpawns, map, depth, player),
    projectiles: [],
    fireZones: [],
    // Ground zones (bramble), lightning marks, the strikes they became and
    // the white flash of the last one — per-map like every other effect list.
    zones: [],
    lightning: [],
    strikes: [],
    flash: 0,
    blinkTrail: null,
    shockwaves: [],
    arcs: [],
    feedback: makeFeedback(),
    hitEffects: [],
    shake: 0,
    run: { deepestLevel: depth, won: false },
    gameOver: false,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    caveEntrances: caveEntrances ?? [],
    houseDoors: houseDoors ?? [],
    caveInstances: openMap ? { ...activeSave.caves[openMap.name] } : {},
    gates: gates ?? {},
    mapExit: mapExit ?? null,
    entranceHold: false,
    signs: signs ?? [],
    npcWrath: !!npcRecord?.hostile,
    // Weather (day clock + pier fog) for maps with a config entry; null
    // elsewhere. Cave/interior states spread this along — look is nulled
    // underground and the clock only moves on surface frames.
    weather: weatherForDepth(depth),
    // Creature kills are per-visit: an episode's own flags carry the story
    // forward, this only reports what died on this map since arriving.
    creatureKills: {},
    // The ids actually built, plus the ones already tombstoned — a dead npc
    // must stay recorded as dead on the next persist rather than be forgotten.
    npcSpawnIds: npcRecord ? [...npcSpawns(entitySpawns), ...npcRecord.dead] : [],
  }
  // The Wilds: load (or begin) the world and build the window around where
  // the player was — or the last village, or home on a fresh world.
  wildsWorld = null
  if (wilds) {
    const fresh = !activeSave.wilds
    wildsWorld = makeWorld(activeSave.wilds, { seed: randomSeed() })
    cityFor(wildsWorld.seed)   // the city's one-time build is paid here, not mid-walk
    enterWilds(state, wildsWorld, wildsWorld.pos ?? wildsWorld.lastVillage, wildsHooks)
    arriveTales(state, wildsWorld, taleHooks, { fresh: true })
    arriveCity(state, wildsWorld, cityHooks, { fresh: true })
    clearCrime(state)   // a load starts calm with Kalevanlinna's watch (never saved)
    if (fresh) persistRun()
  }
  if (runMode === 'adventure' && OPEN_MAPS[depth]) recordVisit(activeSave.progress, OPEN_MAPS[depth].name)
  if (openMap) arriveOnMap()
  // Gates opened on an earlier visit stay open: swap in the open art and
  // set their fountains flowing before the first frame.
  for (const id of activeSave.gates[openMap?.name] ?? []) {
    openGate(state, id)
    for (const e of state.entities) {
      if (e.gateId !== id || !(e.isFountainWall || e.isFountainBasin)) continue
      e.flowing = true
      e.propType = e.isFountainWall ? 'prop_gargoyle_flow' : 'prop_fountain_full'
    }
  }
  announce(state, wilds ? 'The wilds lie open in every direction…'
    : depth >= OVERWORLD_DEPTH ? 'You step out into the open…' : 'You enter the dungeon…')
}

function setPhase(to) {
  if (canTransition(phase, to)) phase = to
}

function goTitle() {
  // The bench has no title: its never-die hero, lit map and overlay must
  // not carry into a real Adventure or Rush, so Quit to Title starts the
  // bench over (unsaved panel values survive the reload).
  if (bench) { location.reload(); return }
  if (mapOpen) { mapOpen = false; hideMap() }
  updateMinimap(null, null, false)
  phase = PHASE.TITLE
  menu.showTitle(meta, {
    // Adventure is the Wilds. The old Adventure chain and Timewarp have no
    // title entry any more; the level<N> cheats (onCheat) still reach their maps.
    onWilds: () => beginRun(WILDS_DEPTH, 'wilds'),
    onRush: () => beginRun(1, 'rush'),
    onPvpArena: () => (window.saveAPI?.isWeb ? goOnline() : goPvpPicker()),
    onSettings: openSettings,
    onOpenEditor: () => window.saveAPI.openEditor(),
    onQuit: () => window.saveAPI.quitApp(),
    onCheat: (depth) => beginRun(depth),
    onPvp: goPvpPicker,
    onNet: goNet,
  })
}

function goEpisodeSelect() {
  phase = PHASE.TITLE
  menu.showEpisodeSelect(episodeEntries(savedTimewarp), {
    onPick: depth => beginRun(depth, 'timewarp'),
    onBack: goTitle,
  })
}

function goPvpPicker() {
  phase = PHASE.TITLE
  menu.showClassPicker({ onPick: startPvp, onBack: goTitle })
}

// arenaIndex: this match's place in PVP_ARENA_ORDER; "Next match" plays the
// one after it (4b spec §1).
function startPvp(cls, arenaIndex = 0) {
  const match = makeLocalMatch({ cls, sfx: makeSfx(loadMutedPref()), arenaIndex })
  const { theme } = match.arena
  decorateMap(match.map, rulesets[theme.ruleset])
  skinFloors(match.map, theme.floorSkins)
  pvp = { match, theme, cls, arenaIndex: match.arenaIndex, picking: false }
  state = null
  setPhase(PHASE.PLAYING)
  menu.hide()
  keys[' '] = false
  document.body?.classList.add('net-match')
}

function stopPvp() {
  pvp = null
  hidePvpHud()
  document.body?.classList.remove('net-match')
  goTitle()
}

function pvpFrame(delta) {
  const { match } = pvp
  for (const ev of stepMatch(match, localInputs(match, keys, sprintDetector.sprinting()), delta)) {
    if (ev.type === 'kill' && ev.victim === LOCAL_ID) {
      pvp.picking = true
      keys[' '] = false
      pvp.backLine = respawnLine(match.heroes.find(h => h.id === LOCAL_ID)?.respawnT)
      menu.showClassPicker({ title: 'Down!', subtitle: pvp.backLine, lines: ['Class for your next life'],
        onPick: cls => { setClass(match, LOCAL_ID, cls); pvp.cls = cls; pvp.picking = false; menu.hide(); keys[' '] = false } })
    }
    if (ev.type === 'respawn' && ev.hero === LOCAL_ID && pvp.picking) { pvp.picking = false; menu.hide() }
    if (ev.type === 'matchEnd') {
      keys[' '] = false
      menu.showPvpResults(ev.standings, { onNext: () => startPvp(pvp.cls, nextArenaIndex(pvp.arenaIndex)), onQuit: stopPvp })
      pvp.done = true
    }
  }
  // The death picker counts the respawn down live (4b spec §5).
  if (pvp.picking) {
    const line = respawnLine(match.heroes.find(h => h.id === LOCAL_ID)?.respawnT)
    if (line !== pvp.backLine) { pvp.backLine = line; menu.setSubtitle(line) }
  }
  // Once the results panel is up the match world is frozen (stepMatch stops
  // advancing it), so one more frame paints its final state under the panel
  // and every frame after that skips FOV/render/HUD work entirely.
  if (pvp.done && pvp.rendered) return
  const view = viewOf(match, pvp.theme)
  maybeComputeFOV(view.map, view.player, 12, { los: true })
  renderer.updateCamera(view.player, comboShake(view.player), null)
  renderer.render(view, null)
  updateHUD(view)
  updatePvpHud(pvpHudModel(match, LOCAL_ID))
  updateBuffRow(buffRowModel(view.player))
  playCues(audio, drainSfx(match), view.player, match.sfx.muted)
  if (pvp.done) pvp.rendered = true
}

const loadName = () => { try { return localStorage.getItem('dc-pvp-name') ?? '' } catch { return '' } }
const saveName = n => { try { localStorage.setItem('dc-pvp-name', n) } catch {} }

// The seat token of the online match this tab is in (4b spec §2): per tab,
// gone with the tab, so a reload can take the same hero back.
const SEAT_KEY = 'dc-pvp-seat'
const loadSeat = () => { try { return sessionStorage.getItem(SEAT_KEY) } catch { return null } }
const saveSeat = t => { try { if (t) sessionStorage.setItem(SEAT_KEY, t) } catch {} }
const clearSeat = () => { try { sessionStorage.removeItem(SEAT_KEY) } catch {} }

const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// Checked before ever opening a socket, so a mistyped name/code shows the
// same one-line refusal the server would give, without a round trip.
function rejectEntry(kind, code, onOk) {
  menu.showMessage({ title: errorTitle(code, kind), lines: [errorText(code)], onOk })
}

// The web title's Online button: a public room with bot fill, or friends.
function goOnline() {
  phase = PHASE.TITLE
  menu.showOnline({ onQuick: () => goNet('quick'), onFriends: goFriends, onBack: goTitle })
}

function goFriends() {
  phase = PHASE.TITLE
  menu.showFriends({ onHost: () => goNet('host'), onJoin: () => goNet('join'), onBack: goOnline })
}

const ENTRY_TITLE = { quick: 'Quick match', host: 'Host a room', join: 'Join with code' }

// kind: 'quick' | 'host' | 'join'. The hidden host/join title cheats land
// here too. Name (prefilled) → [code] → class → the match.
function goNet(kind) {
  phase = PHASE.TITLE
  if (!window.saveAPI?.isWeb) {
    menu.showMessage({ title: 'Online play', lines: ['Online play is in the web build.'], onOk: goTitle })
    return
  }
  const title = ENTRY_TITLE[kind]
  const back = kind === 'quick' ? goOnline : goFriends
  menu.showTextEntry({ title, subtitle: 'Your name', value: loadName(), maxLength: NET.nameMax, onBack: back,
    onSubmit: name => {
      if (!validateName(name)) { rejectEntry(kind, 'bad_name', () => goNet(kind)); return }
      saveName(name)
      const pick = room => menu.showClassPicker({ title, subtitle: controlHint(coarsePointer()), onBack: back,
        onPick: cls => startNet({ name, cls, kind, room }) })
      if (kind !== 'join') pick(null)
      else menu.showTextEntry({ title, subtitle: 'Room code', maxLength: NET.codeLength + 2, autocapitalize: 'characters', onBack: back,
        onSubmit: code => {
          const c = normalizeCode(code)
          if (!validCode(c)) { rejectEntry(kind, 'bad_hello', () => goNet(kind)); return }
          pick(c)
        } })
    } })
}

// menu.js draws what net.panels decides. Every panel drops a held Space, so
// the press that opened it can neither confirm its first button nor keep the
// hero swinging once it closes.
function netPanelUi(s) {
  const drop = () => { keys[' '] = false }
  return {
    hide: () => { drop(); menu.hide() },
    picker: () => {
      drop()
      if (net) net.backLine = respawnLine(net.respawnT)
      menu.showClassPicker({ title: 'Down!', subtitle: net?.backLine ?? respawnLine(0), lines: ['Class for your next life'],
        onPick: cls => { sendClass(s, cls); net?.panels.picked() } })
    },
    results: rows => { drop(); menu.showPvpResults(rows, { onQuit: stopNet, quitLabel: 'Leave' }) },
    wait: () => { drop(); menu.showMessage({ title: 'Next match starting…', onOk: stopNet, okLabel: 'Leave' }) },
    confirm: () => { drop(); menu.showLeaveConfirm({ onStay: () => net?.panels.stay(), onLeave: stopNet }) },
  }
}

// resume: a stored seat token — a reloaded tab going back to its hero.
function startNet({ name, cls, kind, room, resume }) {
  const hello = resume ? { resume }
    : kind === 'quick' ? { name, cls, quick: true }
    : kind === 'host' ? { name, cls, create: true }
    : { name, cls, room }
  const s = connect({ url: netUrl(location), hello })
  // net.map: the session map last decorated; netFrame decorates each new one.
  // respawnT / backLine: the local hero's last respawnT and the death
  // picker's subtitle as last drawn, for the live countdown.
  net = { s, theme: PVP_ARENAS.pillars.theme, map: null, muted: loadMutedPref(), kind, panels: makeNetPanels(netPanelUi(s)),
    respawnT: 0, backLine: null }
  state = null
  if (resume) showReconnecting()
  else menu.showMessage({ title: kind === 'quick' ? 'Finding a match…' : 'Connecting…', onOk: stopNet, okLabel: 'Cancel' })
  setPhase(PHASE.PLAYING)
  keys[' '] = false
  document.body?.classList.add('net-match')
}

const showReconnecting = () => menu.showMessage({ title: 'Reconnecting…', onOk: stopNet, okLabel: 'Leave' })

// The refusal or loss that ends an online session. A drop that could not be
// resumed is "Connection lost" — with the reload line when the server turned
// out to be a newer build.
function showNetEnd(ev) {
  clearSeat()
  const lost = ev.type === 'closed' || ev.reconnect || ev.code === 'resume_failed'
  const lines = ev.type === 'closed' || ev.code === 'resume_failed' ? [] : [errorText(ev.code)]
  menu.showMessage({ title: lost ? 'Connection lost' : errorTitle(ev.code, net.kind), lines, onOk: stopNet })
}

function stopNet() {
  if (net) netLeave(net.s)
  clearSeat()
  net = null
  hidePvpHud()
  document.body?.classList.remove('net-match')
  goTitle()
}

function netFrame() {
  const now = performance.now()
  const { s, panels } = net
  // Under the leave confirm you stand still (4a spec §3); inputs keep
  // flowing, so the server's stale-input rule never kicks in.
  netFrameStep(s, panels.confirming ? NEUTRAL_INPUT : inputFromKeys(keys, sprintDetector.sprinting()), now)
  for (const ev of drainEvents(s)) {
    if (ev.type === 'welcome') {
      saveSeat(ev.token)
      // Back from a drop: whatever the overlay covered (the picker, the
      // results, the leave confirm) comes back.
      if (ev.resumed) panels.refresh()
      else menu.hide()
    }
    else if (ev.type === 'reconnecting') showReconnecting()
    else if (ev.type === 'error' || (ev.type === 'closed' && ev.status === 'lost')) { showNetEnd(ev); return }
    else if (ev.type === 'kill' && ev.victim === s.heroId) panels.died()
    else if (ev.type === 'respawn' && ev.hero === s.heroId) panels.picked()
    else if (ev.type === 'matchEnd') panels.matchEnd(ev.standings)
    else if (ev.type === 'matchStart') panels.matchStart()
  }
  // Refused, kicked or lost: the message above stays up and nothing redraws
  // over it.
  if (s.status !== 'open') return
  const v = sessionView(s, now)
  if (!v) return
  // The events above are how the panels normally change, but a capped or
  // dropped event (a backgrounded tab, a slow-reader-skipped snapshot) can
  // lose the matchStart, matchEnd or respawn that would have done it — and a
  // player joining mid-results never sees that matchEnd at all. The snapshot
  // state backs them up.
  panels.sync({ ended: v.ended, dead: v.me.dead })
  net.respawnT = v.me.respawnT
  if (panels.showing === 'picker') {
    const line = respawnLine(v.me.respawnT)
    if (line !== net.backLine) { net.backLine = line; menu.setSubtitle(line) }
  }
  // The session builds a new map object whenever the arena changes (a
  // welcome, a matchStart); decorate it with that arena's theme once.
  if (net.map !== s.map) {
    net.map = s.map
    net.theme = PVP_ARENAS[s.arena].theme
    decorateMap(s.map, rulesets[net.theme.ruleset])
    skinFloors(s.map, net.theme.floorSkins)
  }
  const view = netViewOf(v, net.theme, s.map)
  maybeComputeFOV(view.map, view.player, 12, { los: true })
  renderer.updateCamera(view.player, comboShake(view.player), null)
  renderer.render(view, null)
  updateHUD(view)
  updatePvpHud(netHudModel(v, s.heroId))
  updateBuffRow(buffRowModel(view.player))
  playCues(audio, drainCues(s), view.player, net.muted)
}

// The Wilds lays several hundred tiles no other mode uses. They load the
// first time the Wilds is entered, so the title does not wait for them; the
// house interiors' tiles (renderer/interior/) come with them, and before the
// other modes that have houses.
let wildsSprites = null
// Furniture gets its lit and shaded edges and shadows once its tiles are in.
const shadeInterior = () => { try { shadeSprites(renderer.sprites, { makeCanvas: (width, height) => Object.assign(document.createElement('canvas'), { width, height }) }) } catch (e) { console.warn('Furniture shading failed', e) } }
const loadWildsSprites = () => wildsSprites ??= renderer.addSprites([...WILDS_SKINS, ...INTERIOR_SKINS]).then(shadeInterior)
let interiorSprites = null
const loadInteriorSprites = () => interiorSprites ??= renderer.addSprites(INTERIOR_SKINS).then(shadeInterior)
let beginning = false

async function beginRun(depth = 1, mode = modeForDepth(depth), arenaOverride = null) {
  if (beginning) return   // a second press while the Wilds' tiles are still coming in
  if (mode === 'wilds') {
    beginning = true
    if (!wildsSprites) menu.setSubtitle('Loading the world\u2026')
    try { await loadWildsSprites() } finally { beginning = false }
  } else if (mode === 'adventure' || mode === 'timewarp') {
    beginning = true
    try { await loadInteriorSprites() } finally { beginning = false }
  }
  runMode = mode
  activeSave = mode === 'timewarp' ? enterEpisode(savedTimewarp, depth).save : mode === 'wilds' ? savedWilds : savedAdventure
  // The bench builds its arena in memory, so a Restart stays on the bench.
  let arenaCfg = depth === 0 ? arenaOverride ?? bench?.arenaConfig() ?? null : null
  if (depth === 0 && !arenaCfg && window.saveAPI?.loadArenaConfig) {
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
  keyGrab = null
  setPhase(PHASE.PLAYING)
  menu.hide()
  keys[' '] = false
}

function pauseGame() {
  // The Wilds saves where you stand whenever you pause: there is no map
  // change or waystone hop to do it for you.
  if (runMode === 'wilds' && state && !state.gameOver) persistRun()
  setPhase(PHASE.PAUSED)
  showPauseMenu()
}
function showPauseMenu() {
  const restartDepth = state?.cave ? state.cave.surface.level : state?.level ?? 1
  menu.showPause({
    onResume: resumeGame,
    onSound: () => openSound(showPauseMenu),
    onControls: coarsePointer() ? null : () => openControls(showPauseMenu),
    onRestart: () => beginRun(restartDepth, runMode), onQuitToTitle: goTitle,
  })
}

// The title's Settings; Sound and Controls come back here.
function openSettings() {
  menu.showSettings({
    onSound: () => openSound(openSettings),
    onControls: coarsePointer() ? null : () => openControls(openSettings),
    onBack: goTitle,
  })
}

// The Sound screen: every change is kept at once and heard at once.
function openSound(back, selected = 0) {
  menu.showSound({ volume: settings.volume, muted: settings.muted, selected }, {
    onVolume: by => {
      settings.volume = stepVolume(settings.volume, by)
      setVolume(audio, settings.volume)
      keepSettings()
      playCues(audio, [{ name: 'ui-move' }], null, settings.muted)
      openSound(back, 0)
    },
    onMute: () => { setMuted(!settings.muted); playCues(audio, [{ name: 'ui-move' }], null, settings.muted); openSound(back, 1) },
    onBack: back,
  })
}

// The Controls screen. Picking an action hands the next real key press to
// `keyGrab` (routeKey): a usable key becomes that action's key, anything
// else leaves things as they were.
function openControls(back, selected = 0, waiting = null) {
  if (waiting === null) keyGrab = null
  menu.showControls({ rows: ACTIONS.map(a => ({ label: a.label, keys: keysLabel(settings.bindings, a.id) })), waiting, selected }, {
    onPick: i => {
      keyGrab = key => {
        keyGrab = null
        if (bindable(key)) {
          settings.bindings = rebind(settings.bindings, ACTIONS[i].id, key)
          keepSettings()
          for (const k of Object.keys(keys)) keys[k] = false   // nothing stays held across a change
          sentFor.clear()
        }
        openControls(back, i)
      }
      openControls(back, i, i)
    },
    onReset: () => { settings.bindings = defaultBindings(); keepSettings(); sentFor.clear(); openControls(back, ACTIONS.length) },
    onBack: () => { keyGrab = null; back() },
  })
}

function openWaystoneMenu(dests) {
  setPhase(PHASE.PAUSED)
  state.exitMenuHold = true
  sfx(state, 'ui-open')
  menu.showDestinations(dests, {
    onPick: depth => { resumeGame(); travelToMap(depth) },
    onCancel: resumeGame,
  })
}

function openInventory() {
  if (phase !== PHASE.PLAYING || !state) return
  setPhase(PHASE.PAUSED)
  inventoryOpen = true
  sfx(state, 'ui-open')
  const report = r => { if (!r.ok) think(state, EQUIP_FAIL_MESSAGES[r.reason] ?? "Can't equip that."); else sfx(state, 'equip'); afterInventoryChange() }
  showInventory(state, {
    onEquip: i => report(state.player.inventory[i]?.kind === 'outfit' ? equipOutfit(state.player, i) : equipItem(state.player, i)),
    onEquipOff: i => report(equipOffhand(state.player, i)),
    onEquipBelt: i => report(equipBelt(state.player, i)),
    onUnequip: (stance, slot) => report(
      slot === 'main' ? unequipMain(state.player, stance)
      : slot === 'outfit' ? unequipOutfit(state.player, stance)
      : slot === 'belt' ? unequipBelt(state.player)
      : unequipOffhand(state.player, stance)),
    onUse: i => useInventoryItem(i),
    onDrop: i => dropInventoryItem(i),
    onBuild: slot => buildCampfire(state.player.inventory[slot]?.kind ?? 'lumber'),
    // The yellow button: the same switch as in play, done at once since the
    // game stands still while the bag is open.
    onSwap: () => {
      const to = nextStance(state.player)
      if (!to) return
      state.player.attackMode = to
      state.player.stanceSwitch = null
      state.player.charging = null
      sfx(state, 'stance-switch')
      afterInventoryChange()
    },
    onClose: closeInventory,
  }, {
    touch: coarsePointer(),
    keys: {
      red: keysLabel(settings.bindings, 'attack'), green: keysLabel(settings.bindings, 'offhand'),
      blue: keysLabel(settings.bindings, 'interact'), yellow: keysLabel(settings.bindings, 'swap'),
      close: keysLabel(settings.bindings, 'bag'),
    },
  })
}

function closeInventory() {
  sfx(state, 'ui-close')
  inventoryOpen = false
  hideInventory()
  setPhase(PHASE.PLAYING)
  for (const k of [' ', 'q', 'Q', 'f', 'F', 'Shift']) keys[k] = false   // nothing pressed in the bag acts in the world
}

// Where the hero is on the map of the Wilds, in world tiles: where they
// stand, or the door they went in by. Null anywhere that has no map.
function heroOnMap() {
  if (runMode !== 'wilds' || !wildsWorld?.origin || !state) return null
  const surface = state.cave ? state.cave.surface : state
  return toWorld(wildsWorld.origin, surface.player.x, surface.player.y)
}

// The full map: pauses like the bag; its own key handler pans and zooms.
// While a sandstorm has taken the map (wilds/storm.js) it has no mark for
// the hero and opens where it last knew him.
function openMap() {
  const hero = heroOnMap()
  if (!hero) { think(state, 'I have no map of this place.'); return }
  setPhase(PHASE.PAUSED)
  mapOpen = true
  sfx(state, 'ui-open')
  showMap(wildsWorld, mapHero(state, hero), { onClose: closeMap }, {
    at: lastOnMap ?? hero,
    touch: coarsePointer(),
    keys: {
      red: keysLabel(settings.bindings, 'attack'), green: keysLabel(settings.bindings, 'offhand'),
      yellow: keysLabel(settings.bindings, 'swap'), close: keysLabel(settings.bindings, 'map'),
    },
  })
}

// Where the map last knew the hero: the full map opens there while a storm
// has taken him off it.
let lastOnMap = null

function closeMap() {
  sfx(state, 'ui-close')
  mapOpen = false
  hideMap()
  setPhase(PHASE.PLAYING)
  for (const k of [' ', 'q', 'Q', 'f', 'F', 'Shift']) keys[k] = false
}

// Signpost panel: pauses like the inventory; the panel's own capture-phase
// key handler (F/Escape/Enter) routes back through closeSign.
function openSign(sign) {
  if (phase !== PHASE.PLAYING) return
  // a Wilds signpost names towns: the map pencils them in (saved, as a village reached is)
  if (state.wilds && wildsWorld && hear(wildsWorld, sign.hears)) persistRun()
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
  persistIfSurface()
}

function useInventoryItem(i) {
  const item = state.player.inventory[i]
  if (!item) return
  // a potion, or anything that heals when eaten (meat, cooked meat, herring)
  if (item.kind === 'potion' || (item.kind !== 'mushroom' && Number.isFinite(item.heal))) {
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

// The nearest free walkable neighbour of (x, y), or null.
function freeAdjacentTile(x, y) {
  const { map } = state
  return [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: x+dx, y: y+dy }))
    .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !map[t.y][t.x].over && !state.entities.some(e => e.x===t.x && e.y===t.y)) ?? null
}

// An outfit landing next to a fallen boss (or on the tile itself when nothing
// is free): a floating item like any drop, so walking onto it self-equips.
function spawnOutfitDrop(tile, outfitType) {
  const at = freeAdjacentTile(tile.x, tile.y) ?? tile
  const px = tile.x * TILE_SIZE + TILE_SIZE / 2, py = tile.y * TILE_SIZE + TILE_SIZE / 2
  state.entities.push({
    type: 'floating_item', contents: makeOutfitContents(outfitType), x: at.x, y: at.y,
    startPx: px, startPy: py, targetPx: at.x * TILE_SIZE + TILE_SIZE / 2, targetPy: at.y * TILE_SIZE + TILE_SIZE / 2,
    px, py, progress: 0, duration: 0.35,
  })
}

function dropInventoryItem(i) {
  const { player } = state
  const adj = freeAdjacentTile(player.x, player.y)
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

function buildCampfire(fuel = 'lumber') {
  const gate = canBuildCampfire(state.player, fuel)
  if (!gate.ok) { think(state, 'Not enough wood.'); return }
  const spot = buildSpot(state.map, state.entities, state.player)
  if (!spot) { think(state, 'No room for a fire here.'); return }
  spendLumber(state.player, fuel)
  const fire = makeCampfire(spot.x, spot.y, { fuel })
  // Sinituli (a tale's reward): the player's own fires burn blue and mend them
  if (hasTalent(state.player, 'sinituli')) fire.blue = true
  state.entities.push(fire)
  sfx(state, fuel === 'deadwood' ? 'grey-fire' : 'campfire-light', { px: fire.px, py: fire.py })
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
    if (pvp) pvpFrame(delta)
    else if (net) netFrame()
    else {
      const d = bench ? bench.frameDelta(delta) : delta
      if (d !== null) update(d)
      if (state) render()
    }
  }
  // Drain sound cues every frame — UI cues fire while PAUSED too.
  if (state?.sfx) playCues(audio, drainSfx(state), state.player, state.sfx.muted)
  rafId = requestAnimationFrame(gameLoop)
}

// Both ways into the ceremony — walking onto the ring mid-trance, and the call
// that carries you there. Either way the trip drains away over the ceremony's
// first seconds as the wizards take over.
function beginRite(outfit) {
  const { player } = state
  state.rite = { t: 0, dur: RITE_DURATION, outfit, cx: player.px, cy: player.py }
  player.trance = 0
  player.tranceFade = TRANCE_FADE
  sfx(state, 'rite', { px: player.px, py: player.py })
}

function placePlayerAt(x, y) {
  const { player } = state
  player.x = x
  player.y = y
  player.px = x * TILE_SIZE + TILE_SIZE / 2
  player.py = y * TILE_SIZE + TILE_SIZE / 2
}

// The minute is up and the rite reaches for the player. A ring on this map
// answers by pulling them into it; underground or on a map without one, or
// once the outfit is already owned, the call simply fades unanswered.
function answerTheCall() {
  const target = pullTarget(state)
  if (!target) {
    think(state, state.cave ? 'Something called. You were too deep.' : 'Something called. Nothing here answers.')
    return
  }
  state.tripPull = { t: 0, dur: PULL_DURATION, x: target.x, y: target.y, outfit: target.outfit }
  sfx(state, 'rite', { px: state.player.px, py: state.player.py })
}

// The arrest's darkest moment: the player is put in the stocks on the square
// (wilds/city/law.js). Where the square is beyond the window, the window is
// built round the stocks first, the tales and the town anew.
function seatInStocks() {
  if (!wildsWorld) return
  toStocks(state, wildsWorld, at => {
    enterWilds(state, wildsWorld, at, wildsHooks)
    arriveTales(state, wildsWorld, taleHooks, { fresh: true })
    arriveCity(state, wildsWorld, cityHooks, { fresh: true })
  })
}

// ---- the coach (wilds/coach.js) ------------------------------------------------
const CART = /^ow_prop_city_cart/

// The player stands on the stop of `town`. The coachman may say no (in the
// one speech bubble); else the game stops under the menu of the towns down
// its roads. Listing them pencils them on the map, kept at once so that
// "Stay" keeps them too.
function boardCoach(town) {
  const why = refusal(state)
  if (why) { coachSays(town, REFUSAL_LINES[why]); return }
  const heard = wildsWorld.heard.size
  const list = destinations(wildsWorld, town)
  if (wildsWorld.heard.size !== heard) persistRun()
  if (!list.length) return
  setPhase(PHASE.PAUSED)
  sfx(state, 'ui-open')
  menu.showChoice({ title: 'The coach', lines: [], buttons: [
    ...list.map(d => ({ label: coachLabel(d), onSelect: () => rideCoach(town, d) })),
    { label: 'Stay', onSelect: resumeGame },
  ] })
}

// A village's coachman says it over his own head; Kalevanlinna's stop has
// none (its runtime owns everyone inside the walls), so there, and where he is
// out of the window, it is said over the cart beside the stop.
function coachSays(town, line) {
  const man = state.entities.find(e => e.type === 'npc' && e.coachman && e.wildsKey === town && e.hp > 0)
  if (man) { speakFrom(state, man, line); return }
  const { x, y } = state.player
  const cart = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
    .find(c => CART.test(state.map[c.y]?.[c.x]?.overlay ?? '')) ?? { x, y }
  speakAt(state, { px: cart.x * TILE_SIZE + TILE_SIZE / 2, py: cart.y * TILE_SIZE + TILE_SIZE / 2 }, line)
}

// The ride from `town`: the hero climbs onto the coach and the game goes on
// (wilds/coach-ride.js: the land ahead is made while the coach waits at the
// stop, then it rolls along the road; update() ticks it and steps him down
// at the far stop: arriveByCoach).
function rideCoach(town, d) {
  menu.hide()
  sfx(state, 'coach-go')
  startRide(state, wildsWorld, town, d)
  if (state.feedback) state.feedback.bubble = null   // a line said at the stop is left there
  for (const k of Object.keys(keys)) keys[k] = false   // nothing pressed at the menu acts on the coach
  setPhase(PHASE.PLAYING)
}

// The coach has parked at the far stop and the hero stands beside it (the
// window came along with him; coach.js arrive has him held off the stop and
// the town visited): said, and saved.
function arriveByCoach(town) {
  calmStorm(wildsWorld)   // nobody steps off the coach into a storm
  sfx(state, 'coach-arrive')
  announce(state, `You reach ${town.name}.`)
  persistRun()
  for (const k of Object.keys(keys)) keys[k] = false   // nothing pressed on the way acts on arriving
}

function update(delta) {
  if (!state) return
  if (!state.sfx) state.sfx = makeSfx(loadMutedPref())
  // A running rite is a short cutscene: the world holds its breath.
  if (state.rite) {
    state.rite.t += delta
    tickTrance(state.player, delta)   // the trip drains away under the ceremony
    if (state.rite.t >= state.rite.dur) {
      const outfit = state.rite.outfit
      state.rite = null
      state.player.trance = 0
      state.player.tranceFade = 0
      // Outfit-less anchors (the marsh's ring) play the ceremony and give
      // nothing. Otherwise the robe is simply there, under the player's feet:
      // grantContents self-equips it (or sacks it); a full sack leaves it
      // floating on the ring for the next step.
      if (outfit) {
        if (!grantContents(makeOutfitContents(outfit))) spawnOutfitDrop({ x: state.player.x, y: state.player.y }, outfit)
        persistIfSurface()
      }
    }
    tickFeedback(state.feedback, delta)
    return
  }
  // The call answered: a wash carries the player across to the mushroom ring
  // and the ceremony begins there. A cutscene too — nothing else moves.
  if (state.tripPull) {
    const pull = state.tripPull
    const handOver = pull.dur * PULL_TELEPORT_AT
    const before = pull.t
    pull.t += delta
    tickTrance(state.player, delta)
    if (before < handOver && pull.t >= handOver) {
      placePlayerAt(pull.x, pull.y)
      sfx(state, 'leap', { px: state.player.px, py: state.player.py })
    }
    if (pull.t >= pull.dur) {
      state.tripPull = null
      beginRite(pull.outfit)
    }
    tickFeedback(state.feedback, delta)
    return
  }
  // The Wilds: when the player has walked into a neighbouring piece the
  // window re-centres on it — before anything this frame reads the map. The
  // tile cache moves along so the chunks on screen are not baked again.
  if (wildsWorld && state.wilds) {
    const before = state.map
    const { recentred } = tickWilds(state, wildsWorld, delta, wildsHooks)
    if (recentred) {
      renderer.rekeyTiles(before, state.map, -recentred.dx * PIECE, -recentred.dy * PIECE)
      arriveTales(state, wildsWorld, taleHooks)
      arriveCity(state, wildsWorld, cityHooks)
    }
    // the tales rest underground, as the Adventure quests do, and the town
    // with them (the clock stops indoors)
    if (!state.cave) {
      tickTales(state, wildsWorld, delta, taleHooks)
      tickCity(state, wildsWorld, delta, cityHooks)
      tickSampoPlaces(state, wildsWorld, delta, sampoHooks)
      // Kalevanlinna's watch took the player alive (damagePlayer spared the
      // last blow): the screen fades, and at its darkest they sit in the stocks
      if (state.arrest) arrest(state)
      const st = state.player.stocks
      if (st && st.fade < ARREST_FADE) {
        const was = st.fade
        st.fade = Math.min(ARREST_FADE, st.fade + delta)
        if (was < ARREST_FADE / 2 && st.fade >= ARREST_FADE / 2) seatInStocks()
      }
    }
    // the Sampo's story is told in the street and under a roof alike
    tickSampo(state, wildsWorld, delta, sampoHooks)
    tickSampoEnd(state, wildsWorld, delta, sampoHooks)
    // on the coach (wilds/coach-ride.js): it carries the hero on along the road
    if (state.coachRide) {
      const town = state.coachRide.dest.town
      if (tickCoachRide(state, wildsWorld, delta) === 'arrived') arriveByCoach(town)
    }
    // a sandstorm on the hero (wilds/storm.js): none indoors, its sight and the monsters' with it
    const land = state.cave ? null : heroLand()
    tickStorm(state, wildsWorld, {
      clock: activeSave.clock ?? DAY_START, delta,
      desert: !!land?.desert, ring: !!land?.ring, village: !!land?.village, wind: land?.wind,
    })
  }
  const { player, map } = state
  // On top of the coach nothing underfoot is opened, picked up, entered or
  // stepped onto: those wait until the hero is on foot again.
  const onFoot = !state.coachRide
  state.shake = Math.max(0, (state.shake ?? 0) - 30 * delta)   // px/s decay
  tickMsgCooldowns(delta)

  // Player movement — skip if grabbed by a crab this frame
  const wasGrabbed = player.grabbed ?? false
  player.grabbed = false
  // Frozen solid or held in a grip (systems/player-bind.js): no walking,
  // turning, sprinting, shield, swing, cast or talk until it ends.
  tickBinds(player, delta, state.entities)
  const bound = playerBound(player)
  // The shield: up while Q is held with a shield in the offhand. Raised, the
  // player walks at half speed, cannot sprint, and every attack is dead.
  player.blockedHit = false
  const blocking = tickShield(player, !bound && !!(keys['q'] || keys['Q']), delta)
  if (blocking || bound) player.charging = null
  let vx = 0, vy = 0
  if (!bound) {
    if (keys['ArrowLeft']  || keys['a']) { vx -= 1; player.facing = 'west'  }
    if (keys['ArrowRight'] || keys['d']) { vx += 1; player.facing = 'east'  }
    if (keys['ArrowUp']    || keys['w']) { vy -= 1; player.facing = 'north' }
    if (keys['ArrowDown']  || keys['s']) { vy += 1; player.facing = 'south' }
  }
  if (vx !== 0 && vy !== 0) { const len = Math.SQRT2; vx /= len; vy /= len }
  const boss = state.entities.find(e => e.type === 'dragon_boss') ?? null
  const moving = vx !== 0 || vy !== 0
  const profile = sprintProfile(player.attackMode, { skiLegs: hasTalent(player, 'ski_legs'), drainMul: outfitOf(player, player.attackMode)?.sprintDrain ?? 1 })
  const sprinting = moving && !player.charging && !blocking && player.stamina > 0 && !wasGrabbed &&
    (keys['sprint'] || sprintDetector.sprinting())
  const chargeFactor = player.charging
    ? (player.charging.kind === 'spell' ? GUST_CHARGE.moveFactor
      : player.charging.kind === 'draw' ? DRAW_CHARGE.moveFactor
                                        : chargeMoveFactor(player.weapon?.weaponType))
    : 1
  const speed = PLAYER_SPEED * chargeFactor * rainSlow(player) * (blocking ? BLOCK_SPEED_MUL : 1) * (sprinting ? profile.speedMul : 1)
  if (sprinting) spendStamina(player, profile.drain * delta)
  const walkedFrom = { px: player.px, py: player.py }
  if (!wasGrabbed) moveEntity(player, vx * speed * delta, vy * speed * delta, map, PLAYER_HALF, boss)
  // the castle gate let down for the night (wilds/city/fx.js): walking into it says so
  if (vy < 0 && player.py === walkedFrom.py && !state.cave && isShutGate(map[player.y - 1]?.[player.x])) throttledThink('castle-gate', GATE_SHUT_LINE)
  // Päivölä: walking into a mirror turns it (systems/sunroom-run.js)
  if (state.cave?.label?.startsWith('house:')) {
    const sun = tickSunroom(state, { vx, vy, blockedX: vx !== 0 && player.px === walkedFrom.px, blockedY: vy !== 0 && player.py === walkedFrom.py })
    if (sun) onSunroom(sun)
  }

  // Chest interaction (walk onto chest tile)
  const chestIdx = !onFoot ? -1 : state.entities.findIndex(e =>
    e.type === 'chest' && !e.opening && e.x === player.x && e.y === player.y)
  if (chestIdx !== -1) {
    const chest = state.entities[chestIdx]
    // Open chest — item jumps to adjacent floor tile
    const adj = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: chest.x+dx, y: chest.y+dy }))
      .find(t => isWalkable(map[t.y]?.[t.x]?.tile, map[t.y]?.[t.x]) && !map[t.y][t.x].over && !state.entities.some(e => e.x===t.x && e.y===t.y))
    // With no free adjacent tile, the item grants straight into hand/sack —
    // only mark the chest open if that grant actually lands; a full sack
    // (plus occupied hand and no floor space) must leave it closed and
    // re-triggerable rather than silently destroying the contents.
    const directGrant = !adj && grantContents(chest.contents)
    const granted = adj || directGrant
    if (directGrant) persistIfSurface()
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
    if (granted && chest.sunReward && wildsWorld && state.wilds && state.cave) { wildsWorld.looted.add(state.cave.label); persistRun() }
  }

  // Floating item pickup (step onto landing tile once arc completes)
  const floatIdx = !onFoot ? -1 : state.entities.findIndex(e =>
    e.type === 'floating_item' && e.progress >= 1 && e.x === player.x && e.y === player.y)
  if (floatIdx !== -1) {
    const item = state.entities[floatIdx]
    if (grantContents(item.contents)) {
      state.entities = state.entities.filter((_, i) => i !== floatIdx)
      persistIfSurface()
    }
  }

  // Leap episodes: the Echo trails the player and speaks near a spot; the
  // episode module runs. Gated off underground — epCtx/mapData describe the
  // surface, not the cave.
  if (state.epCtx && !state.cave) {
    const echo = state.entities.find(e => e.type === 'echo')
    if (echo) updateEcho(echo, state, { episode: state.episode, mapData: state.epCtx.mapData, flags: state.epCtx.flags,
                                        ctx: ruleCtx(activeSave, state.epCtx.mapData) }, delta)
    EPISODE_MODULES[state.epCtx.mapData.name]?.tick(state.epCtx, delta)
    // The rule can also come true off a module's own flags (a wolf killed,
    // an npc record change), so the surface frame re-checks it rather than
    // relying on the modules' ctx.resolve() calls alone. Self-guarding on
    // episodeResolved/isResolved, so this is a no-op once resolved.
    resolveEpisode()
  }

  // Adventure quests tick on the surface only — qCtx/mapData describe the
  // surface, not the cave.
  if (state.qCtx && !state.cave) QUEST_MODULES[state.qCtx.mapData.name]?.tick?.(state.qCtx, delta)

  // Weather runs on the surface only: the animation timer always, the day
  // clock when the map has a cycle. Underground both hold.
  if (state.weather && !state.cave) {
    state.weather.t += delta
    if (state.weather.dayCycle) {
      const before = activeSave.clock ?? DAY_START
      // a clock that comes out smaller has wrapped: a new day
      if (advanceClock(activeSave, delta) < before && wildsWorld) wildsWorld.day += 1
    }
  }

  // Campfire cooking — standing on a fire cooks every raw meat carried.
  // cookMeat empties the raw stack, so it can't fire twice for the same meat.
  const fire = onFoot && state.entities.find(e => e.type === 'campfire' && e.x === player.x && e.y === player.y)
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
  const arch = onFoot && state.caveEntrances?.find(e => e.x === player.x && e.y === player.y)
  if (arch && !state.entranceHold) {
    const gate = state.gates?.[arch.label]
    if (gate && !gate.open) {
      // Sealed: stay on the cell and explain on a cooldown, like the waystone.
      throttledThink('gate', 'The vined gate is sealed. The gargoyles beside it are dry…')
    } else { enterCave(arch); return }
  }
  // House doors — same walk-onto/hold pattern as arches, no gate to check.
  const door = onFoot && !state.cave && doorAt(state.houseDoors, player.x, player.y)
  if (door && !state.entranceHold) {
    // a shut door says so (the castle always, the church at night) and stays shut;
    // the hours go by the clock the town keeps (cityHooks.clock)
    const clock = cityHooks.clock()
    const shut = doorShut(door, fracOf(clock))
    if (shut !== null) { think(state, shut); state.entranceHold = true } else { enterHouse(door); return }
  }
  if (!arch && !door) state.entranceHold = false
  if (state.cave) {
    const onStairs = player.x === state.cave.stairs.x && player.y === state.cave.stairs.y
    if (!onStairs) state.cave.offStairs = true
    else if (state.cave.offStairs) { exitCave(); return }
  }
  // A building's stairs and shut doors fire once per step-on (stairHold).
  const building = state.cave?.building
  if (building) {
    const stair = stairAt(building, player.x, player.y)
    const shut = stair ? null : shutAt(building, player.x, player.y)
    if (!stair && !shut) state.cave.stairHold = false
    else if (!state.cave.stairHold) {
      state.cave.stairHold = true
      // the Sampo's story opens a shut way (the crypt's crack, the battlements' door) and waves a guard aside
      const world = wildsWorld && state.wilds ? wildsWorld : null
      const through = shut ? passageFor(world, shut.line) : null
      const held = shut ? shut.line : blockedBy(building, stair, state.entities)
      const line = held !== null && !shut && guardWaves(world, stair.guard) ? null : held
      if (through) {
        state = travelFloor(state, { id: 'story', to: through.to })
        think(state, through.say)
        sfx(state, 'door-open', { px: state.player.px, py: state.player.py })
        return
      }
      if (line !== null) think(state, line)
      else {
        const say = sayNow(building, stair)
        if (say) building.said.add(sayKey(building, stair))
        state = travelFloor(state, stair)
        if (say) think(state, say)
        sfx(state, 'door-open', { px: state.player.px, py: state.player.py })
        return
      }
    }
  }

  // Waystone. Timewarp: a resolved episode's runestone leads back to the
  // episode select. Adventure: the arch opens a destination menu — every
  // visited map, plus the next chain map once the frontier is cleared; the
  // hold flag keeps a cancelled menu from instantly reopening until the
  // player steps off and back on.
  if (!state.cave && state.mapExit && player.x === state.mapExit.x && player.y === state.mapExit.y) {
    const mapData = OPEN_MAPS[state.level]
    if (mapData && runMode === 'timewarp') {
      if (isMapUnlocked(activeSave, mapData)) { persistRun(); goEpisodeSelect(); return }
      throttledThink('exit', 'The runestone is dark. Something here is still wrong.')
    } else if (mapData) {
      const dests = waystoneDestinations(activeSave).filter(d => d.depth !== state.level)
      if (dests.length && !state.exitMenuHold) { openWaystoneMenu(dests); return }
      if (!dests.length) {
        const done = activeSave.progress.cleared[mapData.name] ?? []
        const remain = dungeonLabels(mapData).filter(l => !done.includes(l)).length
        throttledThink('exit', `The waystone is silent — ${remain} dungeon${remain === 1 ? '' : 's'} remain${remain === 1 ? 's' : ''}.`)
      }
    }
  } else state.exitMenuHold = false

  // The coach (wilds/coach.js): stepping onto a town's stop in the Wilds
  // boards it, once until the player steps off (state.coachHold): the menu
  // of the towns down its roads, or the coachman says why not.
  if (wildsWorld && state.wilds) {
    const stop = tickCoach(state)
    if (stop) { boardCoach(stop.town); if (phase !== PHASE.PLAYING) return }
  }

  // Key pickup — walk onto the key the boss dropped
  const keyIdx = !onFoot ? -1 : state.entities.findIndex(e => e.type === 'key' && e.x === player.x && e.y === player.y)
  if (keyIdx !== -1) {
    state.entities = state.entities.filter((_, i) => i !== keyIdx)
    state.hasKey = true
    speak(state, 'You picked up the key!')
    sfx(state, 'key-pickup')
  }

  // Wild mushrooms: walk-onto pickup into the sack
  const shroomIdx = !onFoot ? -1 : state.entities.findIndex(e => e.type === 'wild_mushroom' && e.x === player.x && e.y === player.y)
  if (shroomIdx !== -1 && grantContents({ type: 'mushroom' })) {
    state.entities = state.entities.filter((_, i) => i !== shroomIdx)
    persistIfSurface()
  }

  // Rite triggers: walking onto the ring mid-trance starts the ceremony there
  // and then. Otherwise the call comes on its own once the minute is up.
  if (tickTrance(player, delta) === 'call') answerTheCall()
  const trigger = onFoot && state.entities.find(e => e.type === 'talent_trigger' && e.x === player.x && e.y === player.y)
  if (trigger && (!trigger.outfit || !ownsOutfit(player, trigger.outfit)) && riteConditionMet(trigger.rite, state)) {
    beginRite(trigger.outfit)
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
    if (throttledThink('locked', 'The door is locked — defeat the boss for its key.')) sfx(state, 'door-locked')
  }

  // Victory: walk onto the treasure the final boss dropped
  const treasureIdx = state.entities.findIndex(e => e.type === 'treasure' && e.x === player.x && e.y === player.y)
  if (treasureIdx !== -1) { state.gameOver = true; endRun(true); return }

  // Fountain toggle (F key — player must stand on basin tile)
  if (!bound && (keys['f'] || keys['F'])) {
    keys['f'] = false; keys['F'] = false
    const basin = state.entities.find(e =>
      e.type === 'prop' && e.isFountainBasin && e.x === player.x && e.y === player.y
    )
    // facing one of Päivölä's mirrors, the key turns it
    const sun = !basin && state.cave?.label?.startsWith('house:') ? tickSunroom(state, { interact: true }) : null
    if (sun) { onSunroom(sun); return }
    const sign = basin ? null : signNearby(state.signs, player.x, player.y)
    const npc = (basin || sign) ? null : nearestPeacefulNpc(state)
    // someone with a part of the Sampo's story to tell tells it; anyone else says their line
    // (and a traveller who names a town has the map pencil it in)
    if (npc?.hears && state.wilds && wildsWorld && hear(wildsWorld, npc.hears)) persistRun()
    if (npc) { if (!(wildsWorld && state.wilds && startTelling(state, npc, wildsWorld))) interactNpc(state, npc); return }
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
        persistRun()
      }
    }
  }

  // Combat cooldowns
  player.meleeCooldown  = Math.max(0, player.meleeCooldown  - delta)
  player.rangedCooldown = Math.max(0, player.rangedCooldown - delta)
  player.attackTimer    = Math.max(0, player.attackTimer    - delta)
  player.invulnTimer = Math.max(0, (player.invulnTimer ?? 0) - delta)
  player.magicCooldown = Math.max(0, (player.magicCooldown ?? 0) - delta)
  player.offCooldown = Math.max(0, (player.offCooldown ?? 0) - delta)
  tickStamina(player, delta)
  player.staminaRefusedT = Math.max(0, (player.staminaRefusedT ?? 0) - delta)
  const landedStance = tickStanceSwitch(player, delta)
  if (landedStance) {
    sfx(state, 'stance-switch')
  }
  // Mid-switch the old stance is still set but every attack is dead — and so
  // is a raised shield: the hand that would swing is holding it up.
  const attacking = keys[' '] && !player.stanceSwitch && !player.blocking && !bound

  // Melee (Space): light blades swing the instant the key lands; charge
  // weapons wind up while held and swing on release, tiered by hold time.
  // The charge path is the main hand's alone, so it keeps reading meleeWT;
  // inside the swing the hand that actually swings names its own weapon. A
  // charge weapon in the main hand therefore suspends alternation outright:
  // its wind-up belongs to that weapon, and handing every second release to
  // the offhand blade would spend the main hand's charge on the wrong steel.
  const meleeWT = player.weapon?.weaponType
  const off = offhand(player)
  // Nor does the off hand swing beside the flute: a tune kept going would
  // otherwise stab, on every second press, the mice it is leading.
  const offBlade = off?.kind === 'weapon' && !isChargeWeapon(meleeWT) && !player.weapon?.tune ? off : null
  const swing = (mods) => {
    const hand = swingHand(player, offBlade)
    const wpn = hand === 'off' ? offBlade : player.weapon
    const wt = wpn.weaponType
    // The piper's flute strikes nothing and tires nobody: a swing plays its
    // tune (systems/tune.js), and the flute stays in the hand while it sounds.
    if (wpn.tune) {
      playTune(state)
      player.meleeCooldown = 0.6
      player.swingHand = hand
      player.nextHand = nextHandAfter(hand, offBlade)
      return
    }
    const cost = meleeCost(wt, mods.tier)
    if (!canAfford(player, cost)) {
      mods = tierMods('tap', wt)                 // starved: weak swing
      player.staminaRefusedT = 0.4
      spendStamina(player, player.stamina)        // starved swing drains all remaining stamina
    } else {
      spendStamina(player, cost)
    }
    const atk = getAttack(wt)
    player.meleeCooldown = atk.cooldown * mods.cooldownMul * (hand === 'off' ? OFFHAND_COOLDOWN_MUL : 1)
    player.swingHand = hand
    player.nextHand = nextHandAfter(hand, offBlade)
    player.attackTimer = atk.duration
    player.attackDuration = atk.duration
    player.attackStyle = atk.style
    player.attackFacing = player.facing
    sfx(state, 'melee-swing', { px: player.px, py: player.py })
    noteCitySwing(state, wildsWorld)
    if (wildsWorld && state.wilds) noteSampoSwing(state, wildsWorld, sampoHooks)   // a blow on the anvil in the giant's belly
    player.attackReachMul = mods.reachMul
    const dmg = Math.max(1, Math.round((wpn.damage ?? 1) * mods.dmgMul))
    const fa = FACING_ANGLE[player.facing] ?? 0
    const arc = getSwingArc(atk.style)
    const hitAt = (dx, dy) => inSwing(arc.reach * mods.reachMul, arc.halfAngle, fa, dx, dy)
    // The swing bites a body by its nearest edge (systems/hitbox.js), so a
    // big beast is hit where the blade meets it, not at a centre point. A
    // body the player is standing inside is hit whichever way they face —
    // inSwing treats a target on top of the swinger as caught.
    const bodyHit = e => { const n = nearestPoint(e, player.px, player.py); return hitAt(n.x - player.px, n.y - player.py) }
    const miekka = wt === 'maunonmiekka'
    const hammer = !!wpn.lightning                     // Ukonvasara (systems/hammer.js)
    // An overcharged hammer lands no blow of its own: the wedge only decides
    // where the chain starts, and every point of damage is lightning.
    const zap = hammer && mods.tier === 'over'
    const collect = miekka || hammer
    const struck = []   // enemies hit this swing (for the Maunonmiekka's shockwave)
    // a blow's flash on what it lands on (state.hitEffects, aged over HIT_LIFE)
    const slash = e => state.hitEffects?.push({ x: e.x, y: e.y })
    state.entities = state.entities
      .map(e => {
        if (!isHittable(e)) return e
        if (zap) {
          if (bodyHit(e)) struck.push(e)
          return e
        }
        if (e.type === 'dragon_boss') {
          const swingHit = (cx, cy) => hitAt(cx - player.px, cy - player.py)
          const raw = meleeDamageToDragon(player, e, swingHit)
          if (raw <= 0) return e
          const bossDmg = Math.max(1, Math.round(raw * mods.dmgMul))
          const bossHit = { ...e, hp: e.hp - bossDmg, inCombat: true }
          addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${bossDmg}`, kind: 'dealt' })
          sfx(state, 'melee-hit', { px: e.px, py: e.py })
          slash(e)
          if (collect) struck.push(bossHit)
          return bossHit
        }
        if (!bodyHit(e)) return e
        if (e.type === 'wizard' && e.shieldTimer > 0) return e
        if (CREATURE_HIT[e.type] && getMonsterDef(e.type)) {
          const r = hurtCreature(state, e, dmg, { source: 'player' })
          slash(e)
          if (r.cue) sfx(state, r.cue, { px: e.px, py: e.py })
          if (r.think) think(state, r.think)
          if (!r.absorbed) addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${dmg}`, kind: 'dealt' })
          // Only the hammer collects registry creatures: the Maunonmiekka's
          // shockwave never bursts from these (hirvi, boarhound, kivihiisi,
          // etc.) — miekka and hammer never coexist on one weapon, so this
          // doesn't change anything for the miekka.
          if (hammer) struck.push(e)
          return e
        }
        // Shatter: a rimed-over enemy takes +2 and thaws on the blow. Read
        // before the copy is taken, so the cleared `frozen` rides along.
        const total = dmg + shatterBonus(e)
        const hitEnemy = { ...e, hp: e.hp - total, inCombat: true }
        slash(e)
        npcStruck(hitEnemy)
        addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${total}`, kind: 'dealt' })
        sfx(state, hitEnemy.hp <= 0 ? deathCue(hitEnemy) : 'melee-hit', { px: e.px, py: e.py })
        startKnockback(hitEnemy, hitEnemy.px - player.px, hitEnemy.py - player.py, atk.knockback * mods.kbMul)
        if (collect) struck.push(hitEnemy)
        return hitEnemy
      })
    cullEntities()
    // Maunonmiekka magic: a crimson shockwave bursts from every struck enemy,
    // splashing damage + knockback onto its neighbours.
    if (miekka && struck.length) {
      const exclude = new Set(struck)
      for (const s of struck) {
        const snap = npcSnapshot()
        const res = applyShockwave(state.entities, s.px, s.py, exclude)
        state.entities = res.entities
        npcsStruckSince(snap)
        state.shockwaves.push({ px: s.px, py: s.py, t: 0, dur: 0.35, maxRadius: SHOCK_RADIUS })
        sfx(state, 'shockwave', { px: s.px, py: s.py })
      }
    }
    // Ukonvasara: a full swing shocks what it struck (three strokes over
    // three seconds); an overcharge is the thunderclap and the chain. The
    // hero is the chain's last node when the enemies run out, so a lone foe
    // costs 3 hp; a whiff with nothing in reach costs no hp at all — just a
    // rain cloud over the hero that slows the walk for a few seconds.
    if (hammer && mods.tier === 'full') {
      for (const s of struck) if (isSpellTarget(s)) applyShock(s)
    }
    if (zap) {
      thunderclap(player, state.entities)
      state.shockwaves.push({ px: player.px, py: player.py, t: 0, dur: 0.35, maxRadius: HAMMER.clap.radius, color: '#e9d5ff' })
      sfx(state, 'thunder', { px: player.px, py: player.py })
      const nodes = chainNodes(player, struck, state.entities, lightningMods(player))
      if (nodes.length) {
        const snap = npcSnapshot()
        applyChain(state, nodes, {
          hurt: hurtEntity,
          damagePlayer: d => damagePlayer(state, d, 'lightning'),
        })
        npcsStruckSince(snap)
        sfx(state, 'crackle', { px: player.px, py: player.py })
        cullEntities()
      } else {
        applyRain(player)
      }
    }
    // Harvesting: a hatchet/axe swing lands on the nearest tree in the
    // wedge, a pick's mine also lands on the nearest rock. Damage is silent
    // bar-less chopHp on the cell; the fall/clear is what you hear and see,
    // and the lumber (trees only) arcs onto the stump for a walk-onto
    // pickup.
    // The belt lends its chop/mine to whichever blade swings (spec §5).
    const tool = resolveTool(wpn, player.belt)
    if (tool.chop || tool.mine) {
      const spot = findHarvestHit(state.map, player, hitAt, arc.reach * mods.reachMul, wpn)
      if (spot) {
        const res = harvest(state.map, spot.x, spot.y, tool)
        // no hit flash here: chopping and mining show by the fall, as they always have
        const spx = spot.x * TILE_SIZE + TILE_SIZE / 2, spy = spot.y * TILE_SIZE + TILE_SIZE / 2
        const cue = res.kind === 'rock' ? 'wall-slam' : res.felled ? 'tree-fall' : 'chop'
        sfx(state, cue, { px: spx, py: spy })
        // A cracked rock is where sling stones come from — straight into the
        // pouch, never a sack slot.
        if (res.felled && res.kind === 'rock') {
          const got = addAmmo(player, 'stone', STONES_PER_ROCK)
          if (got > 0) addFloat(state.feedback, { px: player.px, py: player.py - 10, text: `+${got}`, kind: 'heal' })
        }
        if (res.felled) {
          if (res.yield > 0) {
            state.entities.push({
              type: 'floating_item', contents: { type: res.drop ?? 'lumber', count: res.yield }, x: spot.x, y: spot.y,
              startPx: spx, startPy: spy - TILE_SIZE, targetPx: spx, targetPy: spy,
              px: spx, py: spy - TILE_SIZE, progress: 0, duration: 0.35,
            })
          }
          persistIfSurface()
        }
      }
    }
  }
  if (player.charging?.kind && CHARGE_STANCE[player.charging.kind] !== player.attackMode)
    player.charging = null
  if (player.attackMode === 'melee' && !player.weapon) {
    // Truly unarmed: no swing at all — like the empty ranged slot, the fix
    // is finding a weapon, and the game says so instead of doing nothing.
    player.charging = null
    player.nextHand = 'main'
    if (attacking) throttledThink('melee', 'Unarmed — you need a weapon.')
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
    if (player.charging && !player.charging.kind) player.charging = null   // weapon swapped mid-wind-up
    if (attacking && player.attackMode === 'melee' && player.meleeCooldown <= 0) swing(resolveCharge(meleeWT, 0))
  }

  // Magic (Space in the magic stance): hold to charge, release to cast the
  // held wand's spell — or Gust of Wind with an empty wand hand. Overlong
  // holds auto-release, and tryCast degrades the tier to what the tank can
  // cover rather than refusing the cast outright.
  if (player.attackMode === 'magic') {
    if (player.charging?.kind === 'spell') {
      if (keys[' '] && !shouldAutoReleaseGust(player.charging.t)) {
        player.charging.t += delta
      } else {
        const reached = resolveGustTier(player.charging.t)
        player.charging = null
        keys[' '] = false
        const cast = tryCast(state, spellFor(player).id, reached, { modules: { lightning: castLightning } })
        if (cast.ok) showCast(cast)
        else if (cast.reason === 'stamina') {
          player.staminaRefusedT = 0.4
          throttledThink('magic', 'Too winded to shape the wind.')
        }
      }
    } else if (attacking && (player.magicCooldown ?? 0) <= 0 && loadoutAvailable(player, 'magic')) {
      player.charging = { t: 0, kind: 'spell' }
    }
  }

  // Ranged (Space in the ranged stance). tryFire gates on the weapon, the
  // shared quiver and the per-weapon cooldown; failures (except cooldown)
  // get a throttled thought.
  const loose = (tier = 'tap') => {
    const shot = tryFire(player, tier)
    if (!shot.ok) {
      // A no_ammo failure never carries an ammoKind of its own (tryFire only
      // sets one on a successful shot), so the held weapon's kind names the
      // noun — and noAmmoMessage falls back to "ammo" if there is no weapon.
      const msg = shot.reason === 'no_ammo'
        ? noAmmoMessage(player.ranged?.ammoKind)
        : FIRE_FAIL_MESSAGES[shot.reason]
      if (msg) throttledThink('fire', msg, 1.5)
      return
    }
    const dir = DIRS[player.facing] ?? DIRS.east
    const proj = { px: player.px, py: player.py,
      dx: dir[0]*PROJECTILE_SPEED, dy: dir[1]*PROJECTILE_SPEED,
      damage: shot.damage, color: shot.color, shape: shot.shape, friendly: true }
    // Only the flags the shot actually carries — projectiles.js reads their
    // presence, not their value, for pierce/fork/chain decisions.
    if (shot.pierce !== undefined) proj.pierce = shot.pierce
    if (shot.fork) proj.fork = { ...shot.fork }
    if (shot.onHit) proj.onHit = { ...shot.onHit }
    if (shot.piercesShield) proj.piercesShield = true
    if (shot.explodes) { proj.explodes = true; proj.blastTiles = shot.blastTiles; if (shot.fireOnly) proj.fireOnly = true }
    state.projectiles.push(proj)
    sfx(state, 'ranged-shot', { px: player.px, py: player.py })
    noteCitySwing(state, wildsWorld)
  }

  // A `draw` bow (the longbow) winds up while Space is held and looses on
  // release, tiered by hold time; every other bow fires on its cooldown, so
  // holding Space streams shots as it always did.
  if (player.attackMode === 'ranged') {
    if (player.charging?.kind === 'draw') {
      if (keys[' '] && !shouldAutoReleaseDraw(player.charging.t)) {
        player.charging.t += delta
      } else {
        const held = player.charging.t
        player.charging = null
        keys[' '] = false     // an auto-release must not instantly re-draw
        loose(resolveDrawTier(held))
      }
    } else if (attacking) {
      if (player.ranged?.draw) { if (player.rangedCooldown <= 0) player.charging = { t: 0, kind: 'draw' } }
      else loose()
    }
  }

  // Projectiles: movement, walls, pierce/fork/chain, shields and every hit
  // resolve in systems/projectiles.js — game.js only lends it the hooks.
  stepProjectiles(state, delta, projectileHooks)

  // Lingering fireball flames — tick everyone standing in them
  if (state.fireZones?.length) {
    const snap = npcSnapshot()
    const fz = updateFireZones(state.fireZones, state.entities, player, delta, { hurt: hurtEntity })
    state.fireZones = fz.zones
    state.entities = fz.entities
    npcsStruckSince(snap)
    if (fz.playerDamage > 0) damagePlayer(state, fz.playerDamage, 'dot')
  }

  // Bramble patches: root what walks in, bleed what stays. Same hit path as
  // the projectiles, so a kill here culls like any other.
  if (state.zones?.length) {
    tickZones(state, delta, { hurt: hurtEntity })
    cullEntities()
  }

  // Call Lightning: unconditional by contract — the tick also counts the
  // weather layer's strike-light down, so skipping it on a quiet frame would
  // leave a night map lit as day. It early-outs on its own when idle.
  const sky = tickLightning(state, delta, { hurt: hurtEntity })
  if (sky.struck) cullEntities()
  state.flash = Math.max(0, (state.flash ?? 0) - delta)

  // Blink's afterimages fade over BLINK_DUR and then stop being drawn.
  if (state.blinkTrail) {
    state.blinkTrail.t += delta
    if (state.blinkTrail.t >= BLINK_DUR) state.blinkTrail = null
  }

  // Enemy AI — iterate a snapshot so wizard summons don't re-enter this frame
  state.entities = tickDying(state.entities, delta)
  for (const e of [...state.entities]) {
    // Slow/root/freeze count down for everything a spell can catch — hostile
    // villagers included, whose brain runs inside updateNpc below.
    tickStatus(e, delta)
    // The Wilds: whatever is far from the player sleeps — nine pieces of
    // monsters and villagers thinking at once is more than the frame affords.
    if (wildsWorld && !state.cave && e.maxHp !== undefined && asleep(e, player)) continue
    // Ukonvasara's shock: a stroke a second, drawn as a short bolt onto the
    // enemy. Kills are culled with the rest of the frame's dead below.
    if (e.shock) {
      const { strokes } = tickShock(e, delta, { hurt: hurtEntity })
      if (strokes) {
        state.arcs.push({ x0: e.px, y0: e.py - 28, x1: e.px, y1: e.py, t: 0, dur: HAMMER.arcLife })
        sfx(state, 'crackle', { px: e.px, py: e.py })
      }
    }
    // updateNpc drives peaceful AND hostile NPCs (the hostile ones run the
    // enemy brain inside their attack_hostile goal) — never both paths.
    if (e.type === 'npc') { updateNpc(e, state, delta); continue }
    if (bench?.isFrozen(e)) continue
    if (e.dying > 0) { if (getMonsterDef(e.type)) updateMonsterPose(e, delta); continue }
    if (isStoryCreature(e)) { CREATURE_UPDATE[e.type]?.(e, state, delta); updateMonsterPose(e, delta); continue }
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
    if (getMonsterDef(e.type)) { updateMonsterPose(e, delta); CREATURE_UPDATE[e.type]?.(e, state, delta) }
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
              damagePlayer(state, 1, 'dot')
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

  tickArcs(state, delta)
  tickRain(player, delta)
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
  tickBlueRest(state, delta)
  tickTune(state, delta)
  state.entities = fires.entities
  for (const f of fires.expired) sfx(state, 'campfire-out', { px: f.px, py: f.py })

  // Walk animation — player + humanoid enemies (guard, wizard); none for the
  // hero sitting on the coach
  if (onFoot) tickWalk(player, delta)
  tickFeedback(state.feedback, delta)
  if (!state.cave && tickCaveInstances(state, delta)) persistRun()
  for (const e of state.entities) {
    if (e.type === 'guard' || e.type === 'wizard' || (e.type === 'npc' && NPC_SPECIES[e.species]?.walker)) tickWalk(e, delta)
  }

  // Player death: in Adventure it is a setback — wake at the village spawn;
  // in the dungeon rush it ends the run as ever.
  if (player.hp <= 0) {
    sfx(state, 'player-death')
    const surfaceLevel = state.cave ? state.cave.surface.level : state.level
    const mapData = mapDataFor(surfaceLevel)
    if (mapData?.wilds) {
      // The Wilds: wake in the last village visited, the window rebuilt
      // around it. A cave died in is abandoned unstored, as in Adventure.
      resetNpcs(activeSave)
      npcDirty = false
      state = adventureRespawn(state, { x: state.player.x, y: state.player.y })
      const village = wildsRespawn(state, wildsWorld, wildsHooks)
      arriveTales(state, wildsWorld, taleHooks, { fresh: true })
      arriveCity(state, wildsWorld, cityHooks, { fresh: true })
      clearCrime(state)   // Kalevanlinna forgets: no warning, no wanted, no stocks
      state.npcWrath = false
      persistRun()
      queueToast(state, { title: `You awaken in ${village?.name ?? 'the village'}…`, lines: ['The dark took its toll — but you are alive.'] })
      return
    }
    if (mapData) {
      resetNpcs(activeSave)
      npcDirty = false
      state = adventureRespawn(state, mapData.playerSpawn)
      respawnNpcs()
      persistRun()
      const wakeTitle = runMode === 'timewarp' ? 'You awaken where you fell asleep…' : 'You awaken back in Aspengrove…'
      queueToast(state, { title: wakeTitle, lines: ['The dark took its toll — but you are alive.'] })
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
    // Outfits fall where bosses fall: the cyclops always carries the plate,
    // and the first dungeon cleared on a map with a MAP_CLEAR_OUTFITS entry
    // leaves that outfit. Neither drops for a body that already owns it.
    const drops = [BOSS_DROP_OUTFITS[bossType]]
    if (state.cave) drops.push(MAP_CLEAR_OUTFITS[mapDataFor(state.cave.surface.level).name])
    for (const ot of new Set(drops.filter(Boolean)))
      if (!ownsOutfit(state.player, ot)) spawnOutfitDrop(state.lastBossTile, ot)
    if (state.cave) {
      const mapData = mapDataFor(state.cave.surface.level)
      const before = isMapComplete(activeSave.progress, mapData)
      markCleared(activeSave.progress, mapData.name, state.cave.label)
      if (!before && isMapComplete(activeSave.progress, mapData)) state.cave.mapJustCompleted = true
      persistRun()
    }
  }

  // Advance in-flight enemy melee attacks (windup → strike → swing)
  for (const e of state.entities) stepEnemyAttack(e, state, delta)

  // Resolve knockback slides after AI has moved everything this frame.
  // An overcharged gust (or the Maunonmiekka shockwave) can flag a slam:
  // a one-shot wall-collision hit, applied only to enemies.
  for (const e of state.entities) {
    const slam = stepKnockback(e, delta, (px, py) => canMoveTo(map, px, py, ENEMY_HALF))
    if (slam && isHittable(e) && !isStoryCreature(e) && !(e.type === 'wizard' && e.shieldTimer > 0)) {
      // A registry creature's damage goes through its hook (hurtEntity), so a
      // slam that kills it still records the kill the way a blow would —
      // otherwise a Gust could delete the standing elk and stall its quest.
      if (CREATURE_HIT[e.type] && getMonsterDef(e.type)) { hurtEntity(e, slam.damage, { source: 'slam' }); continue }
      e.hp -= slam.damage
      e.inCombat = true
      npcStruck(e)
      addFloat(state.feedback, { px: e.px, py: e.py - 10, text: `-${slam.damage}`, kind: 'dealt' })
      sfx(state, e.hp <= 0 ? deathCue(e) : 'wall-slam', { px: e.px, py: e.py })
    }
  }
  cullEntities()
  stepKnockback(player, delta, (px, py) => canMoveTo(map, px, py, PLAYER_HALF))

  // Flush NPC deaths and wrath. It has to sit after the cull above, because
  // recordNpcState reads `dead` as "declared id with no entity left".
  // (The Wilds keeps no per-map npc record — its dead are in the piece
  // records — so there a struck animal is no reason to write the save.)
  if (npcDirty && !state.cave && mapDataFor(state.level)) { npcDirty = false; if (runMode !== 'wilds') persistRun() }
  if (pendingDrops.length) { state.entities.push(...pendingDrops); pendingDrops = [] }
  if (pendingOut) {
    const out = pendingOut; pendingOut = null
    if (state.cave && struckInBuilding(state)) {
      for (const e of out.hit) spareStruck(state, e)
      exitCave()
      violenceUnseen(state, { killed: out.killed })
      announce(state, 'Out!')   // said to the player: replaces "You step back out."
    }
  }

  // Hit flashes fade out over their HIT_LIFE (they used to be wiped here,
  // before the render ever drew them)
  ageHitEffects(state, delta)

  // Tier-A toasts: open one pausing panel per frame; the rest stay queued.
  const pending = drainToasts(state)
  if (pending.length) { openToast(pending[0]); state.feedback.toasts.push(...pending.slice(1)) }
}

// The land the hero stands on in the Wilds, asked again only when his world
// tile changes: whether it is desert, in the gentle ring round home, or in a
// village, and the desert's wind there.
let heroLandAt = null
function heroLand() {
  const { X, Y } = toWorld(wildsWorld.origin, state.player.x, state.player.y)
  const seed = wildsWorld.seed
  if (heroLandAt?.X !== X || heroLandAt.Y !== Y || heroLandAt.seed !== seed || heroLandAt.world !== wildsWorld) {
    heroLandAt = {
      X, Y, seed, world: wildsWorld, desert: isDesert(seed, X, Y), ring: inGentleRing(Math.floor(X / PIECE), Math.floor(Y / PIECE)),
      village: inVillage(wildsWorld, X, Y), wind: windAt(seed, X, Y),
    }
  }
  return heroLandAt
}
// How far the hero sees out of doors in the Wilds now (wilds/storm.js).
const wildsSight = () => sightNow(state, heroLand().desert)

function render() {
  // Open country sees almost twice as far as a dungeon or cave — 14 tiles
  // matches the audio falloff edge, so what you hear you can usually see.
  // Open-map surfaces see the whole radius; dungeons, caves and interiors
  // keep line of sight.
  const surface = !state.cave && !!mapDataFor(state.level)
  if (surface && !bench && state.wilds && wildsWorld?.origin) {
    // The Wilds out of doors see by the dune rule: the whole radius but what
    // lies behind a dune crest, further in desert country, and the landmarks
    // out to BEACON_RANGE (wilds/desert.js); a sandstorm closes both in
    // (wilds/storm.js).
    const { radius, far } = wildsSight()
    maybeComputeFOV(state.map, state.player, radius, { los: 'dunes', far })
  } else {
    // The bench lights its whole arena: the monster spawns 11 tiles out and
    // its wind-ups must read from across the room.
    maybeComputeFOV(state.map, state.player, bench ? 40 : surface ? 14 : 8, { los: !surface })
  }
  const fx = riteVisuals(state)
  if (state.weather) state.weather.look = state.cave ? null : weatherLook(state, activeSave)
  // a house is framed whole in the window when it fits
  const frame = state.cave?.label?.startsWith('house:') ? { w: state.map[0].length * TILE_SIZE, h: state.map.length * TILE_SIZE } : null
  renderer.updateCamera(state.player, state.shake ?? 0, fx, frame)
  renderer.render(state, fx)
  bench?.drawOverlay(renderer.ctx, state, renderer)
  updateHUD(state)
  // the corner minimap: out of doors in the Wilds, where there is a keyboard;
  // a sandstorm turns it to haze
  const hero = state.cave ? null : heroOnMap()
  updateMinimap(wildsWorld, hero, settings.minimap && !coarsePointer(), { haze: mapHazed(state) })
  if (hero && mapHero(state, hero)) lastOnMap = hero
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

// House doors reuse the cave transition wholesale — a stored instance means
// killed vermin stay dead and taken pickups stay taken; missing here means
// build the house behind the door (renderer/interior/): the same house every
// time, from the world's seed and the door, with a story house's things laid
// in when the door resolves to one. An instance stored by the old generator
// has no front door of its own and is built afresh. A Kalevanlinna door is
// built afresh at every visit and never kept: inside are exactly the people
// the town's schedules put there now (wilds/city/indoors.js). A door with a
// building laid by hand behind it (door.building: the church) opens onto its
// floors, peopled the same way.
function enterHouse(door) {
  if (door.building) {
    const spec = cityBuildingSpec(state, door, wildsWorld && state.wilds ? wildsWorld.seed : 0)
    enterBuilding(door, buildBuilding(spec.kind, { ...spec, strict: false }))
    return
  }
  const entrance = { x: door.x, y: door.y, caveDepth: INTERIOR_DEPTH, label: door.label }
  let inst = door.city ? null : state.caveInstances?.[door.label]
  let version = null
  const world = wildsWorld && state.wilds ? wildsWorld : null
  const owed = inst?.exit && inst.spawn ? storedSunroom(inst.map, inst.entities, { solved: !!world?.solved.has(door.label), looted: !!world?.looted.has(door.label) }) : null
  if (owed?.rebuild) inst = null
  if (inst?.exit && inst.spawn) {
    state = buildCaveState(state, entrance, {
      map: inst.map, entities: inst.entities, playerSpawn: inst.spawn, exit: inst.exit, theme: inst.theme,
      dropSpawned: inst.dropSpawned, lastBossTile: inst.lastBossTile, hasKey: inst.hasKey,
    })
    if (owed?.reward) state.entities.push(sunRewardChest(owed.reward))
  } else {
    // a story house's things come from the map's episode, or in the Wilds from the tale whose place this is
    const storyEp = wildsWorld && state.wilds ? storyEpisode(wildsWorld, door) : state.episode
    const worldSeed = wildsWorld && state.wilds ? wildsWorld.seed : 0
    const spec = door.city ? cityHouseSpec(state, door, worldSeed) : houseSpec(door, { worldSeed, story: storyEp?.houses?.[door.story] ?? null })
    const house = generateInterior(spec, { solved: !!world?.solved.has(door.label), looted: !!world?.looted.has(door.label) })
    state = buildCaveState(state, entrance, {
      map: house.map, entities: buildEntities(house.entitySpawns, house.map, INTERIOR_DEPTH),
      playerSpawn: house.playerSpawn, exit: house.exit, theme: house.theme,
    })
    if (door.city) state.cave.city = true
    if (house.reward) state.entities.push(sunRewardChest(house.reward))
    version = house.version
  }
  announce(state, (version && VERSIONS[version]?.enter) || 'You step inside.')
  sfx(state, 'door-open', { px: state.player.px, py: state.player.py })
}

// A building of several floors (renderer/interior/floors.js), entered like a
// house. built = { floors: [{ id, map, entitySpawns, stairs, shut, playerSpawn?,
// exit? }], ground, theme }. Only the ground floor is the state's map; the
// others wait in state.cave.building with their own entities. Never kept as a
// cave instance: it is built afresh at every visit.
function enterBuilding(door, built) {
  const entrance = { x: door.x, y: door.y, caveDepth: INTERIOR_DEPTH, label: door.label }
  const floors = built.floors.map(f => ({
    id: f.id, map: f.map, entities: buildEntities(f.entitySpawns, f.map, INTERIOR_DEPTH),
    stairs: f.stairs, shut: f.shut, spawn: f.playerSpawn, exit: f.exit, ...(f.theme && { theme: f.theme }),
  }))
  const building = makeBuilding(floors, built.ground)
  const ground = building.floors.get(built.ground)
  state = buildCaveState(state, entrance, {
    map: ground.map, entities: ground.entities, playerSpawn: ground.spawn, exit: ground.exit, theme: built.theme,
  })
  state.cave.building = building
  state.cave.city = true
  announce(state, 'You step inside.')
  sfx(state, 'door-open', { px: state.player.px, py: state.player.py })
}

// Päivölä's reward: a chest in the alcove the light opened. What it holds is
// rolled when it appears, on the rung of the caves' best but one.
const SUN_LOOT_DEPTH = 4
function sunRewardChest(at) {
  const [chest] = buildEntities([{ kind: 'chest', x: at.x, y: at.y, contents: rollChestLoot(SUN_LOOT_DEPTH, Math.random, state.player) }], state.map, INTERIOR_DEPTH)
  return { ...chest, sunReward: true }
}

function onSunroom(result) {
  if (result === 'turned') { sfx(state, 'mirror-turn', { px: state.player.px, py: state.player.py }); return }
  // the light has reached the seed: the alcove is open, the reward waits in it
  // (unless it was taken before, in a visit a death has since rolled back)
  const world = wildsWorld && state.wilds ? wildsWorld : null
  if (!world?.looted.has(state.cave.label)) state.entities.push(sunRewardChest(state.cave.sun.alcove))
  if (world) { world.solved.add(state.cave.label); persistRun() }
  announce(state, 'The seed drinks the light, and a panel in the wall swings open.')
  sfx(state, 'sun-bloom', { px: state.player.px, py: state.player.py })
}

function exitCave() {
  const isHouse = state.cave.label.startsWith('house:')
  const mapJustCompleted = runMode === 'adventure' && !isHouse && state.cave.mapJustCompleted
  const next = nextMapDepth(state.cave.surface.level)
  const city = state.cave.city ? state.cave.label : null
  // a Kalevanlinna house: whoever was struck down in it is out until tomorrow,
  // and nothing of it is kept (it is built afresh at the next visit)
  if (city) leaveCityHouse(state)
  state = restoreSurface(state)
  if (city) delete state.caveInstances[city]
  persistRun()
  if (isHouse) {
    announce(state, 'You step back out.')
  } else if (mapJustCompleted) {
    announce(state, next ? 'The waystone stirs — the way onward is open.'
                         : 'The wilds are conquered — your adventure is complete!')
  } else announce(state, 'You emerge into the light.')
  sfx(state, 'emerge')
}

// Waystone travel: a fresh open map, the player carried over to its spawn.
function travelToMap(depth) {
  // The map being left still owns its npc record — write it before `state`
  // becomes the new map and the departing kills/wrath are out of reach. Its
  // cleared instances go too: nothing ages them once we are elsewhere, so
  // they would pile up in the save one interior per door opened.
  if (OPEN_MAPS[state.level]) {
    npcDirty = false
    state.caveInstances = pruneClearedInstances(state.caveInstances)
    persistRun()
  }
  const cfg = LEVEL_CONFIG.find(c => c.depth === depth) ?? LEVEL_CONFIG[LEVEL_CONFIG.length - 1]
  const theme = DEPTH_THEMES.find(t => t.depths.includes(depth)) ?? DEPTH_THEMES[0]
  const mapName = OPEN_MAPS[depth].name
  const npcRecord = npcRecordFor(activeSave, mapName)
  const felledRecord = activeSave.felled[mapName] ?? []
  const { map, entitySpawns, playerSpawn, caveEntrances, houseDoors, mapExit, signs } =
    generateLevel(depth, cfg.mapW, cfg.mapH, { skipProps: rulesetHasOverlays(rulesets[theme.ruleset]), structures,
      npcs: npcRecord, felled: felledRecord })
  decorateMap(map, rulesets[theme.ruleset])
  state = {
    ...state,
    level: depth, map, theme,
    entities: buildEntities(entitySpawns, map, depth),
    projectiles: [], fireZones: [], zones: [], lightning: [], strikes: [], flash: 0,
    shockwaves: [], arcs: [], hitEffects: [], blinkTrail: null,
    feedback: makeFeedback(),
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    hasKey: false, dropSpawned: false, lastBossTile: null,
    caveEntrances: caveEntrances ?? [],
    houseDoors: houseDoors ?? [],
    caveInstances: { ...activeSave.caves[mapName] },
    mapExit: mapExit ?? null,
    entranceHold: false,
    signs: signs ?? [],
    npcWrath: npcRecord.hostile,
    creatureKills: {},
    npcSpawnIds: [...npcSpawns(entitySpawns), ...npcRecord.dead],
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, depth) },
    weather: weatherForDepth(depth),
  }
  activeSave.progress.mapDepth = depth
  recordVisit(activeSave.progress, OPEN_MAPS[depth].name)
  persistRun()
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
    // Ground zones (bramble), lightning marks, the strikes they became and
    // the white flash of the last one — per-map like every other effect list.
    zones: [],
    lightning: [],
    strikes: [],
    flash: 0,
    blinkTrail: null,
    shockwaves: [],
    arcs: [],
    player: {
      ...state.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: playerSpawn.x * TILE_SIZE + TILE_SIZE / 2,
      py: playerSpawn.y * TILE_SIZE + TILE_SIZE / 2,
    },
    feedback: makeFeedback(),
    hitEffects: [],
    shake: 0,
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
    run: { ...state.run, deepestLevel: Math.max(state.run.deepestLevel, next) },
    weather: weatherForDepth(next),
  }
  announce(state, `Level ${next}. Deeper…`)
  sfx(state, 'descend')
}

async function endRun(won) {
  state.run.won = won
  if (runMode === 'rush') meta = applyRunResult(meta, { deepestLevel: state.run.deepestLevel, won })
  await window.saveAPI.saveMeta(meta)
  await window.saveAPI.deleteRun()
  setPhase(PHASE.GAMEOVER)
  menu.showGameOver(
    { won, deepestLevel: state.run.deepestLevel },
    { onPlayAgain: () => beginRun(1, 'rush'), onQuitToTitle: goTitle },
  )
}

async function init() {
  const canvas = document.getElementById('game-canvas')
  renderer = new Renderer(canvas)
  renderer.resize()
  rulesets = (await window.saveAPI.loadRulesets()) ?? {}
  await registerMonsters((await window.saveAPI.loadMonsters?.()) ?? [])
  structures = (await window.saveAPI.loadStructures()) ?? {}
  await renderer.loadSprites([...rulesetTileNames(rulesets), ...structureTileNames(structures), ...ROAD_TILES, ...OPEN_MAP_SPRITES])
  pruneMissingTiles(rulesets, renderer.sprites)
  savedAdventure = normalizeAdventureSave(await window.saveAPI.loadCaves?.())
  savedTimewarp = normalizeTimewarpSave(await window.saveAPI.loadTimewarp?.(), savedAdventure.leaps, savedAdventure.npcs)
  savedWilds = normalizeAdventureSave(await window.saveAPI.loadWilds?.())
  const savedMeta = await window.saveAPI.loadMeta()
  meta = validateMeta(savedMeta) ? savedMeta : getInitialMeta()
  // Resizing reallocates the canvas backing store (blank); repaint the current
  // frame even when not in PLAYING, since the loop no longer renders every frame.
  window.addEventListener('resize', () => { renderer.resize(); if (state) render() })
  const benchName = new URLSearchParams(location.search).get('bench')
  if (benchName && window.saveAPI?.benchSave) {
    const { startBench } = await import('../tools/monster-bench/bench.js')
    bench = startBench({ name: benchName, renderer, goTitle, getState: () => state,
      startArena: cfg => beginRun(0, 'arena', cfg),
      spawn: spawns => { state.entities.push(...buildEntities(spawns, state.map, state.level, state.player)) } })
  } else goTitle()
  // A tab reloaded mid-match goes straight back to its hero (4b spec §2).
  const seat = window.saveAPI?.isWeb ? loadSeat() : null
  if (seat) startNet({ kind: 'quick', resume: seat })
  lastTime = performance.now()
  rafId = requestAnimationFrame(gameLoop)
}

init()
