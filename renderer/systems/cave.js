// Cave transitions: an open-map arch leads down into a one-floor dungeon and
// back out. The surface state object is stashed wholesale, so opened chests,
// explored fog and everything else are exactly as you left them; the player
// body (hp, inventory, weapons) travels both ways.
import { TILE } from './entities.js'
import { makeFeedback } from './feedback.js'

const TILE_SIZE = 32
const centered = n => n * TILE_SIZE + TILE_SIZE / 2

// Beaten caves regenerate this many seconds of SURFACE time after you leave;
// a cave with its boss still alive keeps its state indefinitely.
export const CAVE_RESET_TIME = 180

// entrance: {x, y, caveDepth, label}; dungeon: {map, entities, playerSpawn,
// theme} — either freshly generated or a stored instance, which additionally
// carries the boss-drop flags and any unclaimed key.
export function buildCaveState(surface, entrance, dungeon) {
  const { map, entities, playerSpawn, theme } = dungeon
  // the way back out: the spawn tile is the stairs you came down
  map[playerSpawn.y][playerSpawn.x].tile = TILE.STAIRS_UP
  return {
    ...surface,
    level: entrance.caveDepth,
    map,
    theme,
    entities,
    projectiles: [],
    fireZones: [],
    zones: [],
    lightning: [],
    strikes: [],
    flash: 0,
    blinkTrail: null,
    shockwaves: [],
    hitEffects: [],
    log: [],
    feedback: makeFeedback(),
    player: {
      ...surface.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: centered(playerSpawn.x), py: centered(playerSpawn.y),
    },
    hasKey: dungeon.hasKey ?? false,
    dropSpawned: dungeon.dropSpawned ?? false,
    lastBossTile: dungeon.lastBossTile ?? null,
    lockedMsgCooldown: 0,
    fireMsgCooldown: 0,
    entranceHold: false,
    caveEntrances: [],
    cave: {
      surface,
      mouth: { x: entrance.x, y: entrance.y },
      stairs: { x: playerSpawn.x, y: playerSpawn.y },
      label: entrance.label,
      offStairs: false,
    },
  }
}

// Back to the stashed surface: same world, the player as the cave left them,
// standing in the arch. entranceHold keeps the arch from swallowing them
// again until they step off it. The cave itself is stored as an instance so
// re-entering finds it exactly as left — killed enemies dead, loot looted.
export function restoreSurface(caveState) {
  const { surface, mouth, label, stairs } = caveState.cave
  return {
    ...surface,
    caveInstances: {
      ...surface.caveInstances,
      [label]: {
        map: caveState.map,
        entities: caveState.entities,
        stairs: { ...stairs },
        theme: caveState.theme,
        level: caveState.level,
        dropSpawned: caveState.dropSpawned,
        lastBossTile: caveState.lastBossTile,
        hasKey: caveState.hasKey,
        cleared: !caveState.entities.some(e => e.isBoss),
        age: 0,
      },
    },
    player: {
      ...caveState.player,
      x: mouth.x, y: mouth.y,
      px: centered(mouth.x), py: centered(mouth.y),
    },
    entranceHold: true,
  }
}

// Adventure death is a setback, not a game over: wake at the map's spawn with
// full hp, keeping whatever was carried (loot grabbed underground included).
// Dying inside a cave abandons it UNSTORED — the world rolls back to the
// cave's last-saved instance, or fresh if it never was.
export function adventureRespawn(state, spawn) {
  const surface = state.cave ? state.cave.surface : state
  return {
    ...surface,
    player: {
      ...state.player,
      hp: state.player.maxHp,
      x: spawn.x, y: spawn.y,
      px: centered(spawn.x), py: centered(spawn.y),
    },
    projectiles: [],
    fireZones: [],
    zones: [],
    lightning: [],
    strikes: [],
    flash: 0,
    blinkTrail: null,
    shockwaves: [],
    hitEffects: [],
    gameOver: false,
    entranceHold: false,
  }
}

// Surface-time aging: cleared instances count toward their reset and vanish
// at CAVE_RESET_TIME (the next entry generates fresh); uncleared instances
// never age. Call from the surface update only. Returns whether any instance
// was removed, so the caller knows to persist the change.
export function tickCaveInstances(state, dt) {
  let removed = false
  for (const [label, inst] of Object.entries(state.caveInstances ?? {})) {
    if (!inst.cleared) continue
    inst.age += dt
    if (inst.age >= CAVE_RESET_TIME) { delete state.caveInstances[label]; removed = true }
  }
  return removed
}

// Leaving a map for good: drop every stored instance already marked cleared —
// beaten caves and houses alike (a house has no boss, so restoreSurface stores
// it cleared the moment you walk back out). They would regenerate on the next
// visit anyway once tickCaveInstances aged them out, but nothing ages them
// while you are on another map, so without this every door ever opened keeps a
// 44x28 map alive in the save. Uncleared instances (a cave whose boss still
// lives) are kept. Pure: returns a new map, the input is untouched.
export function pruneClearedInstances(caveInstances) {
  return Object.fromEntries(Object.entries(caveInstances ?? {}).filter(([, inst]) => inst?.cleared !== true))
}
