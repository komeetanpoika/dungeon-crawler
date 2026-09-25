// The local PvP harness: you on the keyboard against bots, in the page.
// Takes the keys object as a parameter and touches no DOM; game.js owns the
// loop, the renderer and the menus.
import { makeMatch } from './sim.js'
import { botInput } from './bots.js'
import { PVP, CLASSES } from '../data/pvp.js'

export const LOCAL_ID = 'you'

export function inputFromKeys(keys, sprinting = false) {
  let x = 0, y = 0, facing = null
  if (keys.ArrowLeft || keys.a) { x -= 1; facing = 'west' }
  if (keys.ArrowRight || keys.d) { x += 1; facing = 'east' }
  if (keys.ArrowUp || keys.w) { y -= 1; facing = 'north' }
  if (keys.ArrowDown || keys.s) { y += 1; facing = 'south' }
  return { move: { x, y }, facing, attack: !!keys[' '], alt: !!(keys.q || keys.Q), sprint: !!(sprinting || keys.sprint) }
}

export function makeLocalMatch({ cls, bots = PVP.localBots, sfx = null }) {
  const n = Math.max(1, Math.min(5, Math.round(bots)))
  const roster = [{ id: LOCAL_ID, name: 'You', cls }]
  for (let i = 0; i < n; i++) roster.push({ id: `bot${i + 1}`, name: `Bot ${i + 1}`, cls: CLASSES[i % CLASSES.length] })
  return makeMatch({ roster, sfx })
}

export function localInputs(match, keys, sprinting) {
  const inputs = {}
  for (const h of match.heroes) inputs[h.id] = h.id === LOCAL_ID ? inputFromKeys(keys, sprinting) : botInput(match, h)
  return inputs
}

// What Renderer.render and updateHUD read: a single-player-shaped state
// whose `player` is the local hero, plus `heroes` for everyone else.
export function viewOf(match, theme) {
  return {
    map: match.map, theme, level: 0,
    player: match.heroes.find(h => h.id === LOCAL_ID),
    heroes: match.heroes,
    entities: match.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),
    projectiles: match.projectiles, lightning: match.lightning, strikes: match.strikes,
    arcs: match.arcs, shockwaves: match.shockwaves, zones: match.zones, fireZones: match.fireZones,
    feedback: match.feedback, sfx: match.sfx, hitEffects: [], flash: 0,
  }
}
