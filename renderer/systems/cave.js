// Cave transitions: an open-map arch leads down into a one-floor dungeon and
// back out. The surface state object is stashed wholesale, so opened chests,
// explored fog and everything else are exactly as you left them; the player
// body (hp, inventory, weapons) travels both ways.
import { TILE } from './entities.js'
import { makeFeedback } from './feedback.js'

const TILE_SIZE = 32
const centered = n => n * TILE_SIZE + TILE_SIZE / 2

// entrance: {x, y, caveDepth, label}; dungeon: {map, entities, playerSpawn, theme}
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
    shockwaves: [],
    hitEffects: [],
    log: [],
    feedback: makeFeedback(),
    player: {
      ...surface.player,
      x: playerSpawn.x, y: playerSpawn.y,
      px: centered(playerSpawn.x), py: centered(playerSpawn.y),
    },
    hasKey: false,
    dropSpawned: false,
    lastBossTile: null,
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
// again until they step off it.
export function restoreSurface(caveState) {
  const { surface, mouth } = caveState.cave
  return {
    ...surface,
    player: {
      ...caveState.player,
      x: mouth.x, y: mouth.y,
      px: centered(mouth.x), py: centered(mouth.y),
    },
    entranceHold: true,
  }
}
