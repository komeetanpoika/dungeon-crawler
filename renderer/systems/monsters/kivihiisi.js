// Kivihiisi, the Hiisi of the Pass — the Mountain Pass quest's boss
// (docs/superpowers/specs/2026-09-10-adventure-quests-design.md §4). The
// ordinary brain chases and swings; this hook owns only its stone cladding:
// `clad` layers (0-3) each eat one hit, and it re-clads a layer every
// RECLAD_EVERY seconds — never above the boulders still standing in the ring
// (the quest module passes that count). Mine the ring out and the fight is
// fair. Frozen, the rime takes every layer with it on the next blow.
// Pure — no browser/Electron imports.
import { CREATURE_HIT } from '../creatures.js'
import { shatterBonus } from '../status.js'

export const CLAD_MAX = 3
export const RECLAD_EVERY = 6   // s between layers

// A registry spawn arrives with only type/x/y/px/py/hp, so the first touch
// stamps the cladding and — the contract makeMonsterFromDef does not enforce
// — the weapon, without which enemy-attack.js could never land a hit.
export function ensureKivihiisi(e, stones = CLAD_MAX) {
  if (e.clad !== undefined) return e
  Object.assign(e, { clad: Math.min(CLAD_MAX, stones), recladT: 0, weaponId: 'maul' })
  return e
}

// Returns true when a layer went back on.
export function tickClad(e, delta, stones) {
  ensureKivihiisi(e, stones)
  const cap = Math.min(CLAD_MAX, stones)
  if (e.clad > cap) e.clad = cap
  e.recladT += delta
  if (e.recladT < RECLAD_EVERY) return false
  e.recladT = 0
  if (e.clad >= cap) return false
  e.clad++
  return true
}

CREATURE_HIT.kivihiisi = (e, state, dmg) => {
  ensureKivihiisi(e)
  if (e.frozen) {
    // shatterBonus clears `frozen` as it reads it — take it before the copy,
    // or the copy carries frozen: true back over hurtCreature's assign.
    const bonus = shatterBonus(e)
    e.clad = 0
    return { entity: { ...e, hp: e.hp - dmg - bonus, inCombat: true }, absorbed: false, cue: 'melee-hit' }
  }
  if (e.clad > 0) { e.clad--; return { entity: e, absorbed: true, cue: 'wall-slam' } }
  return { entity: { ...e, hp: e.hp - dmg, inCombat: true }, absorbed: false, cue: 'melee-hit' }
}
