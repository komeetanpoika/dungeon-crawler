// A hero's buffs (2b spec §1): hero.buffs = { haste, might, ward, edge },
// each null or { tier, t } — Ward also carries `pool`, the edge `kind`
// ('ember' | 'venom'). Timers count down in moveHero, which the client's
// predictor shares, so a Haste runs out on both sides on the same tick.
// Pure: no DOM.
import { BUFFS, EDGE_KINDS } from '../data/pvp.js'

export const emptyBuffs = () => ({ haste: null, might: null, ward: null, edge: null })
const SLOTS = ['haste', 'might', 'ward', 'edge']
const RANK = { minor: 0, major: 1 }

// The slot a buff kind lives in: the two edges share one.
export const slotOf = kind => EDGE_KINDS.includes(kind) ? 'edge' : kind

// Taking a buff. A different buff stacks beside the others. The same buff
// again keeps the higher tier and the longer remaining time (Ward: the
// larger pool too). An edge of the other kind replaces the one held.
// Returns the slot's new state.
export function grantBuff(hero, kind, tier) {
  const def = BUFFS[kind]?.[tier]
  if (!def) throw new Error(`pvp: unknown buff ${kind}/${tier}`)
  hero.buffs ??= emptyBuffs()
  const slot = slotOf(kind)
  const cur = hero.buffs[slot]
  if (!cur || (slot === 'edge' && cur.kind !== kind)) {
    const fresh = slot === 'edge' ? { kind, tier, t: def.dur } : { tier, t: def.dur }
    if (kind === 'ward') fresh.pool = def.pool
    hero.buffs[slot] = fresh
    return fresh
  }
  if (RANK[tier] > RANK[cur.tier]) cur.tier = tier
  cur.t = Math.max(cur.t, def.dur)
  if (kind === 'ward') cur.pool = Math.max(cur.pool, def.pool)
  return cur
}

// Counts every buff down; one whose time is up is gone.
export function tickBuffs(hero, dt) {
  const b = hero.buffs
  if (!b) return
  for (const s of SLOTS) {
    if (!b[s]) continue
    b[s].t -= dt
    if (b[s].t <= 1e-9) b[s] = null
  }
}

// Death and a new kit: no buffs, and no burn or poison left running.
export function clearBuffs(hero) {
  hero.buffs = emptyBuffs()
  hero.burn = null
  hero.poison = null
}

// The walk-speed factor Haste gives (1 without it).
export const hasteMul = hero => hero.buffs?.haste ? BUFFS.haste[hero.buffs.haste.tier].mul : 1
// What Might adds to each of the hero's direct hits (0 without it).
export const mightBonus = hero => hero.buffs?.might ? BUFFS.might[hero.buffs.might.tier].bonus : 0

// Ward (damagePlayer's `soak`): takes what it can of `amount` from the pool
// and returns the rest; a pool emptied breaks the ward.
export function soakWard(hero, amount) {
  const w = hero.buffs?.ward
  if (!w || amount <= 0) return amount
  const soaked = Math.min(w.pool, amount)
  w.pool -= soaked
  if (w.pool <= 0) hero.buffs.ward = null
  return amount - soaked
}

// A deep copy, for the snapshot and for hydrating one.
export function copyBuffs(b) {
  const out = emptyBuffs()
  for (const s of SLOTS) if (b?.[s]) out[s] = { ...b[s] }
  return out
}
