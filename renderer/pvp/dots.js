// The elemental edges (2b spec §1): what a landed direct hit from a hero
// holding Ember or Venom leaves on the victim — a burn or a poison
// (`hero.burn` / `hero.poison` = { owner, t, next }, dealt by the sim's
// tickDots), Venom's slow, and a major Ember's fire patch. Pure: no DOM.
import { computeBlastTiles, makeFireZone } from '../systems/fire.js'
import { applySlow } from '../systems/status.js'
import { BUFFS, DOTS } from '../data/pvp.js'

// A burn or a poison from `owner` for `dur` s. Re-applying refreshes the
// time (never shortening it) and takes the new owner, but keeps the tick
// clock running: hits landing faster than the interval must not keep
// pushing the next tick away.
export function setDot(target, kind, owner, dur) {
  const d = target[kind]
  if (d) { d.owner = owner; d.t = Math.max(d.t, dur); return d }
  return (target[kind] = { owner, t: dur, next: DOTS[kind].interval })
}

// Called by hurtHero on a landed direct hit that took hp (not blocked, not
// soaked whole by a Ward), when the attacker holds an edge.
export function applyEdge(match, by, target) {
  const edge = by.buffs?.edge
  if (!edge) return
  const def = BUFFS[edge.kind][edge.tier]
  if (edge.kind === 'ember') {
    setDot(target, 'burn', by.id, def.burn)
    if (def.emberPatchTiles) layEmberPatch(match, by, target, def.emberPatchTiles)
    return
  }
  setDot(target, 'poison', by.id, def.poison)
  // Venom's slow rides the ordinary slow timer (so PVP.ccMul scales it in a
  // match) for as long as the poison; a stronger slow already running stays.
  // This leans on scaleNewCC's floor (min(before, now)) to keep the new
  // ccMul-scaled slow from clipping one already running longer: a
  // weaker-but-longer slow could in principle let that floor keep its own
  // unscaled time instead of this one's — unreachable with today's content,
  // since nothing outlasts Venom's own duration while running a weaker mul.
  const mul = 1 - def.slow
  if (!(target.slowTimer > 0) || target.slowMul >= mul) applySlow(target, mul, def.poison)
}

// A major Ember's patch under the victim: a fire zone of emberPatchTiles
// tiles credited to the attacker, burning like the fireball's. One per
// attacker: a newer one replaces the older, so a flurry of hits does not
// stack patches.
function layEmberPatch(match, by, target, n) {
  const tiles = computeBlastTiles(match.map, target.x, target.y, n)
  if (!tiles.length) return
  match.fireZones = match.fireZones.filter(z => !(z.edge && z.owner === by.id))
  match.fireZones.push({ ...makeFireZone(tiles), owner: by.id, edge: true })
}
