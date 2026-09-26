// Small pure helpers between the net session and the game: the socket URL,
// the typed room code, the refusal lines, and the render view.
import { NET } from '../data/net.js'

export const netUrl = loc => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${NET.path}`

export const normalizeCode = raw => String(raw ?? '').replace(/\s+/g, '').toUpperCase()

// Whether a normalized code is exactly NET.codeLength letters from the
// server's code alphabet — checked client-side before ever opening a socket,
// so a mistyped code shows the same refusal line the server would give
// without a round trip.
const CODE_RE = new RegExp(`^[${NET.codeAlphabet}]{${NET.codeLength}}$`)
export const validCode = code => CODE_RE.test(code)

const ERROR_TEXT = {
  version: 'The game was updated — reload the page.',
  no_room: 'No such room.',
  room_full: 'That room is full.',
  bad_name: 'Pick another name (1–12 letters, digits, space, _ or -).',
  bad_hello: 'Could not join — check the code.',
  server_full: 'The server is full — try again soon.',
  rate_limited: 'Too many attempts — wait a minute and try again.',
  idle: 'Removed for inactivity.',
}
export const errorText = code => ERROR_TEXT[code] ?? 'Could not connect.'

// The title over a refusal line: being removed, or slowed down, is not a
// failed join; otherwise it names the way in ('quick' | 'host' | 'join').
const KIND_TITLE = { quick: 'Could not join', host: 'Could not host', join: 'Could not join' }
export function errorTitle(code, kind) {
  if (code === 'idle') return 'Removed'
  if (code === 'rate_limited') return 'Slow down'
  return KIND_TITLE[kind] ?? 'Could not connect'
}

// The class picker's subtitle before an online match. `coarse` is
// matchMedia('(pointer: coarse)').matches — the same check that turns the
// touch controls on (ui/touch-controls.js); the caller evaluates it.
export const controlHint = coarse => coarse
  ? 'Stick: move · Red: attack · Green: shield / blink'
  : 'WASD: move · Space: attack · Q: shield / blink'

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
