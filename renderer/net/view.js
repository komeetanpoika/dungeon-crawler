// Small pure helpers between the net session and the game: the socket URL,
// the typed room code, the refusal lines, and the render view.
import { NET } from '../data/net.js'

export const netUrl = loc => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${NET.path}`

export const normalizeCode = raw => String(raw ?? '').replace(/\s+/g, '').toUpperCase()

const ERROR_TEXT = {
  version: 'The game was updated — reload the page.',
  no_room: 'No such room.',
  room_full: 'That room is full.',
  bad_name: 'Name: 1–12 letters, digits, space, _ or -.',
  bad_hello: 'Could not join — check the code.',
  server_full: 'The server is full — try again soon.',
}
export const errorText = code => ERROR_TEXT[code] ?? 'Could not connect.'

// What Renderer.render and updateHUD read: a single-player-shaped state whose
// player is your (predicted) hero, plus every hero for the multi-hero draw.
export function netViewOf(v, theme, map) {
  return {
    map, theme, level: 0,
    player: v.me,
    heroes: [v.me, ...v.others],
    entities: v.pickups.filter(p => p.up).map(p => ({ ...p, type: 'pvp_pickup' })),
    projectiles: v.projectiles, lightning: v.lightning, strikes: v.strikes,
    arcs: v.arcs, shockwaves: v.shockwaves, zones: [], fireZones: [],
    feedback: v.feedback, hitEffects: [], flash: 0,
  }
}
