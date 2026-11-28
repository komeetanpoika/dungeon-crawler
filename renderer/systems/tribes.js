// The tribe kit: what the three peoples of the Wilds share (data/tribes.js;
// their members are registry monsters whose def carries behavior.tribe and
// behavior.role, each with its own hook in systems/monsters/). Pure and
// DOM-free; game.js calls tickTribes once a frame and noteBlow where the
// player's own blade and shots land.
//
// Peace. A member of a `friendly` tribe is `peaceful`: no enemy (the brain
// never runs for it, no spell seeks it out, nothing counts it a threat),
// though the player's own weapons can still reach it. The flag is set where
// a member is built (atPeace) and kept by tickTribes; nobody else writes it.
//
// Wrath. The player's blow on a peaceful member angers its whole tribe for
// WRATH_TIME seconds of play: while it runs every member is an ordinary
// enemy and its role decides what it does (its hook's business). When it
// runs out, or the hero dies (clearWrath), they are at peace again and
// whatever fight was under way is dropped. A def with behavior.calm (the
// gong) may be struck freely. Wrath is not saved.
//
//   state.tribeWrath  { [tribe]: seconds left }   one object for the run:
//                     game.js makes it with the state, and a cave's or a
//                     house's state shares it, so it is only ever changed
//                     in place
//   e.peaceful        at peace now
//   e.duel            set by a hook: this member fights for sport, and is
//                     no longer peaceful while it does (the walrus's bout)
//   e.quiet           set by a hook: it has no greeting to give just now
//   e.talk            { near, want, cd, ix }   its greeting's bookkeeping
//   e.summoned        built by summonNear, not dealt by the Wilds
import { getMonsterDef, makeMonsterFromDef } from './monsters.js'
import { TRIBES } from '../data/tribes.js'
import { addFloat, speakFrom, sayDuration, announce } from './feedback.js'
import { sfx } from './sfx.js'
import { isWalkable, hasLineOfSight } from './entities.js'
import { canMoveTo } from './nav.js'

const S = 32
export const WRATH_TIME = 240   // s of play a wronged tribe holds its grudge
export const SPEAK_REACH = 2.5  // tiles within which a peaceful member greets the hero
export const SPEAK_EVERY = 8    // s between two greetings of one speaker

const behaviorOf = e => (e?.type ? getMonsterDef(e.type)?.behavior : null) ?? null
export const tribeOf = e => { const t = behaviorOf(e)?.tribe; return t && TRIBES[t] ? t : null }
export const roleOf = e => (tribeOf(e) ? behaviorOf(e).role ?? null : null)
export const isMember = (e, tribe) => !!tribe && tribeOf(e) === tribe

const alive = e => e.hp > 0 && !(e.dying > 0)

// The living of e's own tribe within `tiles` of it (centre to centre), e
// itself only with `self`.
export function alliesOf(e, state, tiles, { self = false } = {}) {
  const tribe = tribeOf(e)
  if (!tribe) return []
  const reach = tiles * S
  return (state.entities ?? []).filter(o =>
    (o !== e || self) && alive(o) && tribeOf(o) === tribe && Math.hypot(o.px - e.px, o.py - e.py) <= reach)
}

// Mend `target` by up to n, never above its maxHp; a green float shows what
// it got. Returns the gain (0 for the whole, the dead and the dying).
export function healAlly(state, target, n) {
  if (!target || !alive(target) || !Number.isFinite(target.maxHp)) return 0
  const gain = Math.max(0, Math.min(n, target.maxHp - target.hp))
  if (!(gain > 0)) return 0
  target.hp += gain
  addFloat(state.feedback, { px: target.px, py: target.py - 10, text: `+${gain}`, kind: 'heal' })
  return gain
}

export const wrathOf = (state, tribe) => Math.max(0, state?.tribeWrath?.[tribe] ?? 0)

// Whether `e` is at peace now: a member of a friendly tribe that holds no
// grudge, outside a duel. False for everything that is no member.
export function atPeace(state, e) {
  const tribe = tribeOf(e)
  return !!tribe && TRIBES[tribe].nature === 'friendly' && !(wrathOf(state, tribe) > 0) && !e.duel
}

// A member's flag follows its tribe. One that has just made its peace drops
// the fight it was in: a swing in the air is not finished, a stun is over
// (nothing would count it down: the enemy loop no longer runs for it), the
// brain forgets whom it was chasing (`ai` starts empty), and the health bar
// that a blow called up is put away.
function settle(state, e) {
  const was = e.peaceful
  e.peaceful = atPeace(state, e)
  if (e.peaceful && was === false) { e.attack = null; e.inCombat = false; e.stunTimer = 0; e.ai = {} }
}
const settleAll = (state, tribe = null) => {
  for (const e of state.entities ?? []) if (tribe ? isMember(e, tribe) : tribeOf(e)) settle(state, e)
}

export function angerTribe(state, tribe, seconds = WRATH_TIME) {
  if (!TRIBES[tribe] || !(seconds > 0)) return
  const w = state.tribeWrath ?? (state.tribeWrath = {})
  w[tribe] = seconds
  settleAll(state, tribe)
  // a greeting one of them was in the middle of is cut short
  const said = state.feedback?.bubble
  if (said?.anchorId !== undefined && (state.entities ?? []).some(e => e.id === said.anchorId && isMember(e, tribe))) state.feedback.bubble = null
}

// Every grudge is over (the hero died, or woke somewhere else).
export function clearWrath(state) {
  const w = state.tribeWrath
  if (w) for (const k of Object.keys(w)) w[k] = 0
  settleAll(state)
}

// The player's own blade or shot is about to land on `e`: a peaceful member
// (of a def that is not `calm`) takes it as its whole tribe's quarrel.
// Spells' strays, fire, lightning and other creatures never come here: they
// do not reach the peaceful at all (factions.js isSpellTarget). True when
// this blow started a grudge.
export function noteBlow(state, e) {
  if (!e?.peaceful) return false
  const tribe = tribeOf(e)
  if (!tribe || behaviorOf(e).calm) return false
  angerTribe(state, tribe)
  announce(state, `The ${TRIBES[tribe].name} turn on you!`)
  sfx(state, 'npc-wrath', { px: e.px, py: e.py })
  return true
}

// speakFrom finds its speaker by id; a registry monster is built without one.
let nextId = 1
export const withId = e => { e.id ??= `tribe${nextId++}`; return e }

// A peaceful member with lines greets the hero who comes within SPEAK_REACH:
// once per approach, SPEAK_EVERY apart, and never over a bubble that is
// still up (it waits for it, if the hero is still there).
function greet(state, e, lines, delta) {
  const t = e.talk ?? (e.talk = { near: false, want: false, cd: 0, ix: ((e.x ?? 0) + (e.y ?? 0)) % lines.length })
  t.cd = Math.max(0, t.cd - delta)
  const hero = state.player
  if (!alive(e) || e.quiet || !hero || hero.riding) return
  const near = Math.hypot(hero.px - e.px, hero.py - e.py) <= SPEAK_REACH * S
  if (!near) { t.near = false; t.want = false; return }
  if (!t.near) { t.near = true; t.want = !(t.cd > 0) }
  if (!t.want || state.feedback?.bubble) return
  const line = lines[t.ix % lines.length]
  t.ix = (t.ix + 1) % lines.length
  t.want = false
  t.cd = SPEAK_EVERY
  speakFrom(state, withId(e), line, sayDuration(line))
}

// Once a frame, before the enemy loop: the grudges run down, every member's
// flag follows, and the peaceful greet.
export function tickTribes(state, delta) {
  const w = state.tribeWrath
  if (w) for (const k of Object.keys(w)) if (w[k] > 0) w[k] = Math.max(0, w[k] - delta)
  for (const e of state.entities ?? []) {
    const tribe = tribeOf(e)
    if (!tribe) continue
    settle(state, e)
    const lines = e.peaceful ? TRIBES[tribe].lines?.[e.type] : null
    if (lines?.length) greet(state, e, lines, delta)
  }
}

// A member calls another into the world (a witch's para, Syöjätär's brood,
// the King's hall): the registry monster `name`, built as game.js
// buildEntities builds one, on a free walkable cell min..max tiles from `e`
// (one `e` can see, if there is any), with `e`'s loot depth, `summoned`, and
// whatever `extra` gives it (a home, its maker). Null when there is no such
// monster or no cell. It is no spawn of its piece: the Wilds drops it when
// the ground it stands on leaves the window.
export function summonNear(state, e, name, { min = 1, max = 2, extra = {}, rng = Math.random } = {}) {
  const def = getMonsterDef(name)
  const map = state.map
  if (!def || !map) return null
  const half = def.stats.half ?? 8
  const taken = new Set((state.entities ?? []).map(o => `${o.x},${o.y}`))
  if (state.player) taken.add(`${state.player.x},${state.player.y}`)
  const seen = [], unseen = []
  const r = Math.ceil(max)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy)
      if (d < min || d > max) continue
      const x = e.x + dx, y = e.y + dy
      const c = map[y]?.[x]
      if (!c || !isWalkable(c.tile, c) || c.over || taken.has(`${x},${y}`)) continue
      if (!canMoveTo(map, x * S + S / 2, y * S + S / 2, half)) continue
      ;(hasLineOfSight(map, e.y, e.x, y, x) ? seen : unseen).push({ x, y })
    }
  }
  const spots = seen.length ? seen : unseen
  if (!spots.length) return null
  const at = spots[Math.min(spots.length - 1, Math.floor(rng() * spots.length))]
  const m = { ...makeMonsterFromDef(name, at.x, at.y), px: at.x * S + S / 2, py: at.y * S + S / 2,
    lootDepth: e.lootDepth ?? 1, damageCooldown: 0, summoned: true, ...extra }
  m.peaceful = atPeace(state, m)
  state.entities.push(m)
  return m
}
