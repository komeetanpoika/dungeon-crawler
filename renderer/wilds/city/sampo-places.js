// The Sampo's three pieces out in the Wilds (sampo.js PIECES): where their
// places come to be, and what happens at them. DOM-free.
//
//   admitSampo(world, pieces) -> keys
//     `pieces` are about to enter the window (session.js, beside tales.js
//     admit, before their records are made). Once Seppo has named the three
//     places, new land of a piece's country on its side of the city, two
//     pieces or more from the walls, no village and no farmland, becomes its place: the
//     first such land the player comes to, so Seppo's word is good. A place
//     is a tale-style place (world.places, id 'sampo_<kind>', village
//     'sampo'): sites.js builds it, and it is not forgotten until its piece
//     is in Seppo's hands.
//   tickSampoPlaces(state, world, delta, hooks)     every surface frame
//     hooks: { spawn(spawns) -> entities, persist(), refreshInventory?() }
//     Each place in the window is played from the flags: its guardian is
//     there until beaten (state.creatureKills is the death, never its
//     absence), the piece lies at the place until it is carried off, and a
//     lost piece is laid again. Also sets state.gloom (0..1): the copper
//     mountain is dark at noon until its watch is beaten (systems/weather.js).
//
// The places:
//   sea       Iku-Turso's bay: he rises beside whoever walks the pier
//             (systems/monsters/lurker.js) and can be struck while he is up
//   mountain  the copper mountain's bowl, dark at noon: Pohjan vahti cannot
//             be hurt out of firelight (monsters/pohjanvahti.js); the three
//             braziers light when the player comes beside them, and burn a minute
//   marsh     the great pike's pond: it rises for meat held at the pier's
//             end, and takes one blow a rising; its jawbone is for Väinö
import { PIECE, pieceKey, pieceBiome, isPermanent } from '../layout.js'
import { getPiece } from '../world.js'
import { pieceClass } from '../roads.js'
import { think } from '../../systems/feedback.js'
import { sfx } from '../../systems/sfx.js'
import { isWalkable } from '../../systems/entities.js'
import { makeCampfire } from '../../systems/campfire.js'
import { PIECES, PIECE_KINDS, JAW, stageOf } from './sampo.js'

const WIN = 3
export const GLOOM_FULL = 34    // tiles from the bowl's middle within which it is full dark
export const GLOOM_EDGE = 52    // ... and beyond which the day is the day's
export const GLOOM_FADE = 2     // seconds the dark takes to come or go

const parseKey = key => { const [wx, wy] = key.split(',').map(Number); return { wx, wy } }
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const inWindow = (world, p) => !!world.origin && p.wx >= world.origin.wx && p.wx < world.origin.wx + WIN
  && p.wy >= world.origin.wy && p.wy < world.origin.wy + WIN
const toWin = (world, p, c) => ({ x: (p.wx - world.origin.wx) * PIECE + c.x, y: (p.wy - world.origin.wy) * PIECE + c.y })

// ---- where the places come to be ------------------------------------------------------

// The city is pieces (0..1, 2..3). A side holds what lies mostly that way
// from its middle, two pieces or more beyond the walls.
const SIDES = {
  south: (wx, wy) => wy >= 5 && wy - 2.5 >= Math.abs(wx - 0.5),
  north: (wx, wy) => wy <= 0 && 2.5 - wy >= Math.abs(wx - 0.5),
  west: (wx, wy) => wx <= -2 && 0.5 - wx >= Math.abs(wy - 2.5),
}
export const placeKeyOf = (world, kind) => { for (const [key, p] of world.places) if (p.id === PIECES[kind].place) return key; return null }

// (farmland, the first road piece out of a town, holds a farm: roads.js pieceClass)
export function fitsPiece(seed, kind, wx, wy) {
  const P = PIECES[kind]
  return SIDES[P.side](wx, wy) && !isPermanent(seed, wx, wy) && pieceBiome(seed, wx, wy) === P.land && pieceClass(seed, wx, wy) !== 'farmland'
}

export function admitSampo(world, pieces) {
  if (!world.sampo || stageOf(world) !== 'pieces') return []
  const f = world.sampo.flags, hits = []
  const far = p => Math.hypot(p.wx - 0.5, p.wy - 2.5)
  for (const kind of PIECE_KINDS) {
    if (f[`won_${kind}`] || f[kind] || placeKeyOf(world, kind)) continue
    const open = pieces.filter(p => {
      const key = pieceKey(p.wx, p.wy)
      return !world.records.has(key) && !world.places.has(key) && fitsPiece(world.seed, kind, p.wx, p.wy)
    }).sort((a, b) => far(a) - far(b) || (pieceKey(a.wx, a.wy) < pieceKey(b.wx, b.wy) ? -1 : 1))
    if (!open.length) continue
    const key = pieceKey(open[0].wx, open[0].wy)
    world.places.set(key, { id: PIECES[kind].place, village: 'sampo', done: false })
    world.pieces.delete(key)   // generated out of sight as ordinary land: make it anew
    hits.push(key)
  }
  return hits
}

// ---- at the places --------------------------------------------------------------------

const REMARK = {
  sea: 'The water here is thick with salt. Something out there is grinding.',
  mountain: 'Noon, and dark as a cellar. The sun has not been up here in a long time.',
  marsh: 'Something long and slow turns under the lilies. It looks hungry.',
}
const WON = {
  sea: 'He lets go. Something bright rolls up onto the planks.',
  mountain: 'The dark lifts off the hills like a lid. There is a stone where the beast stood.',
  marsh: 'The pike rolls over. There is more in its belly than fish.',
}
export const NO_BAIT = 'It will not rise for nothing. Meat, perhaps.'

const carrying = (player, kind) => !!player.inventory?.some(i => i.kind === kind)
const lying = (state, kind) => state.entities.some(e => e.type === 'floating_item' && e.contents?.type === kind)

// The open cell nearest a point (the point itself first), nobody and nothing on it.
function openCell(state, at, r = 3) {
  const busy = new Set(state.entities.map(e => `${e.x},${e.y}`))
  for (let d = 0; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue
    const x = at.x + dx, y = at.y + dy, cell = state.map[y]?.[x]
    if (cell && isWalkable(cell.tile, cell) && !cell.over && !busy.has(`${x},${y}`)) return { x, y }
  }
  return null
}
function lay(state, hooks, kind, at) {
  const spot = openCell(state, at)
  if (!spot) return false
  state.entities.push(...hooks.spawn([{ kind: 'floating_pickup', contents: { type: kind, count: 1 }, ...spot }]))
  return true
}

// The guardian of a place: there while unbeaten. Returns it, or null once it
// is dead (the kill record) or cannot be placed.
function guardian(state, c, at) {
  const type = PIECES[c.kind].guardian
  let e = state.entities.find(x => x.type === type && x.sampoKey === c.kind)
  if (e) return e
  if (c.r.up && state.creatureKills?.[type]) return null
  if (!at) return null
  // a new rising: a kill of its kind elsewhere, or last time, is not this one's
  if (state.creatureKills) delete state.creatureKills[type]
  ;[e] = c.hooks.spawn([{ kind: type, x: at.x, y: at.y }])
  if (!e) return null
  e.sampoKey = c.kind
  e.taleKey = `sampo:${c.kind}`   // awake however far the player stands (session.js asleep)
  state.entities.push(e)
  c.r.up = true
  return e
}

function win(state, world, c, at, extra = []) {
  const f = world.sampo.flags
  f[`won_${c.kind}`] = true
  think(state, WON[c.kind])
  sfx(state, 'key-pickup', { px: state.player.px, py: state.player.py })
  for (const kind of [PIECES[c.kind].item, ...extra]) lay(state, c.hooks, kind, at)
  c.r.laid = true
  c.hooks.persist?.()
}

function remark(state, c, at, within = 10) {
  if (c.r.said || !at || state.feedback?.bubble || cheb(at, state.player) > within) return
  c.r.said = true
  think(state, REMARK[c.kind])
}

const lairs = pts => Object.keys(pts).filter(k => k.startsWith('lair ')).map(k => pts[k])

const PLAY = {
  sea(state, world, c) {
    const { pts } = c
    remark(state, c, pts['pier bank'])
    const e = guardian(state, c, pts['lair 1'])
    if (e) { e.lurkSpots = lairs(pts); e.lurkPier = pts['pier end'] }
    else if (c.r.up) win(state, world, c, pts['pier end'])
  },
  marsh(state, world, c) {
    const { pts } = c, { player } = state
    remark(state, c, pts['pier bank'])
    const e = guardian(state, c, pts['lair 1'])
    if (e) {
      e.lurkSpots = lairs(pts).slice(0, 1); e.lurkPier = pts['pier end']
      // at the pier's end with nothing to offer: once a visit
      if (!c.r.hinted && c.r.said && cheb(pts['pier end'], player) === 0 && !carrying(player, 'meat') && e.lurk?.state === 'under' && !state.feedback?.bubble) {
        c.r.hinted = true
        think(state, NO_BAIT)
      }
    } else if (c.r.up) win(state, world, c, pts['pier end'], [JAW])
  },
  mountain(state, world, c) {
    const { pts } = c, { player } = state
    remark(state, c, pts.vault, 30)
    // a cold brazier lights for whoever comes beside it, and burns a campfire's time
    for (const label of Object.keys(pts)) {
      if (!label.startsWith('brazier ')) continue
      const b = pts[label]
      if (cheb(b, player) > 1 || state.entities.some(e => e.type === 'campfire' && e.x === b.x && e.y === b.y)) continue
      state.entities.push({ ...makeCampfire(b.x, b.y), brazier: true })
      sfx(state, 'campfire-light', { px: b.x * 32 + 16, py: b.y * 32 + 16 })
    }
    if (!guardian(state, c, pts.den) && c.r.up) win(state, world, c, pts.vault)
  },
}

export function tickSampoPlaces(state, world, delta, hooks) {
  if (!world?.sampo || !world.origin || state.cave) return
  const f = world.sampo.flags
  const rt = world._sampoPlaces ??= {}
  let gloom = 0
  for (const kind of PIECE_KINDS) {
    const key = placeKeyOf(world, kind)
    const p = key ? parseKey(key) : null
    if (!p || !inWindow(world, p)) { delete rt[kind]; continue }
    const piece = getPiece(world, p.wx, p.wy)
    const pts = Object.fromEntries((piece.points ?? []).map(q => [q.label, toWin(world, p, q)]))
    const c = { kind, pts, r: rt[kind] ??= {}, hooks }
    const prize = pts['pier end'] ?? pts.vault
    if (!f[`won_${kind}`]) PLAY[kind](state, world, c)
    else if (!f[kind] && prize) {
      // a piece lost on the way (dropped, or left lying) is here again, once a visit
      const item = PIECES[kind].item
      if (!c.r.laid && !carrying(state.player, item) && !lying(state, item)) lay(state, hooks, item, prize)
      c.r.laid = true
    }
    if (kind === 'mountain' && !f.won_mountain && pts.vault) {
      const d = Math.hypot(pts.vault.x - state.player.x, pts.vault.y - state.player.y)
      gloom = Math.max(0, Math.min(1, (GLOOM_EDGE - d) / (GLOOM_EDGE - GLOOM_FULL)))
    }
  }
  const was = state.gloom ?? 0, step = delta / GLOOM_FADE
  state.gloom = gloom > was ? Math.min(gloom, was + step) : Math.max(gloom, was - step)
}
