// PvP protocol v3 (v1 in 2026-09-25-pvp-server-netcode-design.md §1; v2 adds hello.quick, 4a spec §1;
// v3 adds the arena id on welcome and snap, seat tokens, hello.resume and bye, 4b spec §1-§2): message
// names, validation of everything a client sends, and the snapshot a server
// sends — plus hydrateHero, which turns a snapshot hero back into a hero the
// renderer and the predictor can use. Shared by server/ and the browser;
// pure, no DOM.
import { NET } from '../data/net.js'
import { KITS } from '../data/pvp.js'
import { DIRS, weaponContents, makeRangedContents, makeWandContents } from '../systems/entities.js'
import { gearOf, offhand } from '../systems/inventory.js'
import { makeHero, applyKit } from '../pvp/hero.js'

export const MSG = { HELLO: 'hello', INPUT: 'input', CLASS: 'class', PING: 'ping',
  WELCOME: 'welcome', SNAP: 'snap', ERROR: 'error', PONG: 'pong' }
export const ERR = { VERSION: 'version', NO_ROOM: 'no_room', ROOM_FULL: 'room_full',
  BAD_NAME: 'bad_name', BAD_HELLO: 'bad_hello', SERVER_FULL: 'server_full',
  RATE_LIMITED: 'rate_limited', IDLE: 'idle' }

export const encode = msg => JSON.stringify(msg)

export function decode(text) {
  try {
    const m = JSON.parse(String(text))
    return m && typeof m === 'object' && !Array.isArray(m) && typeof m.type === 'string' ? m : null
  } catch { return null }
}

const axis = v => Number.isFinite(v) ? Math.sign(v) : 0
const count = v => Number.isInteger(v) && v >= 0

// Everything a client may say about its hero: which way it pushes and which
// buttons are down. Nothing else — never a position, damage or ammo.
export function validateInput(raw) {
  if (!raw || typeof raw !== 'object' || !count(raw.seq) || !count(raw.view)) return null
  return {
    seq: raw.seq, view: raw.view,
    move: { x: axis(raw.move?.x), y: axis(raw.move?.y) },
    facing: typeof raw.facing === 'string' && Object.hasOwn(DIRS, raw.facing) ? raw.facing : null,
    attack: raw.attack === true, alt: raw.alt === true, sprint: raw.sprint === true,
  }
}

const NAME_RE = new RegExp(`^[A-Za-z0-9 _-]{1,${NET.nameMax}}$`)
export function validateName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  return NAME_RE.test(name) ? name : null
}

export const validateClass = raw => typeof raw === 'string' && Object.hasOwn(KITS, raw)

const CODE_RE = new RegExp(`^[${NET.codeAlphabet}]{${NET.codeLength}}$`)
// Exactly one way in: { create: true } a private room, { room: CODE } join
// by code, { quick: true } a public room with bot fill (protocol v2).
export function validateHello(raw) {
  if (raw?.v !== NET.protocolVersion) return { error: ERR.VERSION }
  const name = validateName(raw.name)
  if (!name) return { error: ERR.BAD_NAME }
  if (!validateClass(raw.cls)) return { error: ERR.BAD_HELLO }
  const create = raw.create === true
  const quick = raw.quick === true
  const room = typeof raw.room === 'string' ? raw.room.trim().toUpperCase() : null
  if (Number(create) + Number(quick) + Number(!!room) !== 1) return { error: ERR.BAD_HELLO }
  if (create) return { name, cls: raw.cls, create: true }
  if (quick) return { name, cls: raw.cls, quick: true }
  return CODE_RE.test(room) ? { name, cls: raw.cls, room } : { error: ERR.BAD_HELLO }
}

// The hero fields a client needs to draw a hero and to predict its own. Gear
// is not sent: the class kit rebuilds it; only the offhand's kind (the
// rune parks the Warrior's buckler) and the main hands' types travel.
//
// prevAlt was added on top of the brief's list: moveHero reads hero.prevAlt
// directly to edge-detect an alt press, for the offhand-wand tap cast, and
// it was missing from the brief's HERO_FIELDS.
//
// Walk-sway bookkeeping (_wpx/_wpy/walkPhase/swayAmp) is deliberately never
// sent. tickWalk measures a frame's movement as px/py minus _wpx/_wpy, so
// each hydrated hero must keep its own anchor from its own previous tickWalk
// call; re-pinning it to the snapshot's raw (pre-interpolation) position
// every hydration produces a spurious, oversized walk delta on every other
// hero the client draws (interpolated to an older position before its own
// tickWalk runs). moveHero's replay exactness does not depend on walk sway.
const HERO_FIELDS = ['id', 'name', 'cls', 'x', 'y', 'px', 'py', 'facing', 'hp', 'maxHp', 'stamina',
  'staminaRegenT', 'dead', 'respawnT', 'spawnProtect', 'invulnTimer', 'kills', 'deaths', 'attackMode',
  'attackTimer', 'attackDuration', 'attackStyle', 'attackFacing', 'attackReachMul', 'blocking',
  'shieldDropT', 'stunTimer', 'slowTimer', 'slowMul', 'rootTimer', 'frozen', 'needRelease',
  'meleeCooldown', 'rangedCooldown', 'magicCooldown', 'offCooldown', 'prevAlt']

export function heroSnap(h) {
  const s = {}
  for (const f of HERO_FIELDS) s[f] = h[f] ?? null
  s.charging = h.charging ? (h.charging.kind ? { t: h.charging.t, kind: h.charging.kind } : { t: h.charging.t }) : null
  s.rune = h.rune ? { t: h.rune.t } : null
  s.shock = h.shock ? { tickT: h.shock.tickT, left: h.shock.left } : null
  s.rain = h.rain ? { t: h.rain.t, dur: h.rain.dur } : null
  s.blinkTrail = h.blinkTrail ? { from: { ...h.blinkTrail.from }, to: { ...h.blinkTrail.to }, t: h.blinkTrail.t } : null
  s.knockback = h.knockback ? { vx: h.knockback.vx, vy: h.knockback.vy } : null
  s.ammo = { ...h.ammo }
  s.off = offhand(h)?.kind ?? null
  s.hands = { weapon: h.weapon?.weaponType ?? null, ranged: h.ranged?.weaponType ?? null, wand: h.wand?.weaponType ?? null }
  return s
}

export function hydrateHero(hero, s) {
  const h = hero ?? makeHero({ id: s.id, name: s.name, cls: s.cls })
  if (h.cls !== s.cls || (offhand(h)?.kind ?? null) !== s.off) {
    applyKit(h, s.cls)
    if (s.off === null) gearOf(h, h.attackMode).off = null
  }
  for (const f of HERO_FIELDS) if (s[f] !== undefined && s[f] !== null) h[f] = s[f]
  for (const f of ['dead', 'blocking', 'frozen', 'needRelease', 'prevAlt']) h[f] = !!s[f]
  h.charging = s.charging ? { ...s.charging } : null
  h.rune = s.rune ? { t: s.rune.t } : null
  h.shock = s.shock ? { ...s.shock } : undefined
  h.rain = s.rain ? { ...s.rain } : undefined
  h.blinkTrail = s.blinkTrail ? { from: { ...s.blinkTrail.from }, to: { ...s.blinkTrail.to }, t: s.blinkTrail.t } : null
  h.knockback = s.knockback ? { ...s.knockback } : null
  h.ammo = { ...h.ammo, ...s.ammo }
  const hands = s.hands ?? {}
  if ((h.weapon?.weaponType ?? null) !== (hands.weapon ?? null)) h.weapon = hands.weapon ? weaponContents(hands.weapon) : null
  if ((h.ranged?.weaponType ?? null) !== (hands.ranged ?? null)) h.ranged = hands.ranged ? makeRangedContents(hands.ranged) : null
  if ((h.wand?.weaponType ?? null) !== (hands.wand ?? null)) h.wand = hands.wand ? makeWandContents(hands.wand) : null
  return h
}

export function snapshotBody(match, { events = [], cues = [] } = {}) {
  return {
    type: MSG.SNAP, arena: match.arena.id, tick: match.tick, clock: match.clock, waiting: !!match.waiting, ended: !!match.ended,
    matchLength: match.matchLength,
    heroes: match.heroes.map(heroSnap),
    projectiles: match.projectiles.map(p => ({ px: p.px, py: p.py, dx: p.dx, dy: p.dy, shape: p.shape, color: p.color })),
    lightning: match.lightning.map(m => ({ x: m.x, y: m.y, t: m.t, delay: m.delay })),
    strikes: match.strikes.map(s => ({ x: s.x, y: s.y, t: s.t })),
    arcs: match.arcs.map(a => ({ ...a })),
    shockwaves: match.shockwaves.map(s => ({ ...s })),
    pickups: match.pickups.map(p => ({ kind: p.kind, x: p.x, y: p.y, px: p.px, py: p.py, up: p.up })),
    events, cues,
  }
}
