// Learned abilities. Everything that unlocks a talent — rite, boss kill,
// dungeon clear, future NPC — funnels through grantTalent. Persistence is
// the caller's job (game.js persists for Adventure; Dungeon Rush never does).
// The stance talents (Marksmanship, Gust of Wind, Might) became outfits on
// 2026-09-17 — see systems/outfits.js — and Ski-legs a pair of Elk-hide
// Boots on 2026-11-28 (entities.js WORN_TYPES; outfits.js migrateToWorn).
import { queueToast } from './feedback.js'
import { sfx } from './sfx.js'

export const TALENTS = {
  // rewards of the Wilds' tales (data/tales.js `reward`)
  lake_breath: { name: "The lake's breath", desc: 'A quarter more stamina.' },
  tapio_peace: { name: "Tapio's peace", desc: 'Wolves leave you be unless you strike first.' },
  sinituli: { name: 'Sinituli', desc: 'Your campfires burn blue, and their light mends you.' },
  // rewards of the three tribes' bosses (systems/tribes.js; each boss's hook
  // grants its own): the Mountain King's hide (systems/player-damage.js),
  // Syöjätär's tongue (systems/poison.js) and the walrus's heart (applyTalents)
  kivinahka: { name: 'Kivinahka', desc: 'A blow of three or more lands one lighter.' },
  kaarmeenkieli: { name: 'Käärmeenkieli', desc: 'No poison takes hold of you.' },
  mursun_sydan: { name: 'Mursun sydän', desc: 'One more heart.' },
}
// Dungeon Rush starts with no talent: what it wears from the first step is
// in systems/outfits.js (RUSH_START_OUTFITS, RUSH_START_WORN). A fixed list:
// the tales' rewards are earned in the Wilds, not handed to a Rush run.
export const RUSH_START_TALENTS = []

export function hasTalent(player, id) {
  return (player?.talents ?? []).includes(id)
}

// What a talent changes on the body itself, settled wherever a body gets its
// talents: at the grant (below), and where game.js builds the player for a
// run (a new game, a save loaded, a kit applied). Safe to call any number of
// times: `talentHp` remembers what Mursun sydän has already added, so the
// HEART_BONUS is added once and mended by as much, and a body that woke
// after death (systems/cave.js adventureRespawn fills hp to maxHp) keeps it.
// A body without the talent is left as it is. Käärmeenkieli also clears the
// poison already in him (systems/poison.js lets no new one take hold).
export const HEART_BONUS = 2
export function applyTalents(player) {
  const want = hasTalent(player, 'mursun_sydan') ? HEART_BONUS : 0
  const had = player.talentHp ?? 0
  if (want !== had) {
    player.maxHp = (player.maxHp ?? 0) + want - had
    player.hp = Math.min(player.maxHp, (player.hp ?? 0) + Math.max(0, want - had))
    player.talentHp = want
  }
  if (player.poison && hasTalent(player, 'kaarmeenkieli')) player.poison = undefined
}

// Returns true only when newly learned, so callers know to persist.
export function grantTalent(state, id) {
  const def = TALENTS[id]
  if (!def) return false
  const p = state.player
  p.talents ??= []
  if (p.talents.includes(id)) return false
  p.talents.push(id)
  applyTalents(p)
  queueToast(state, { title: 'Talent learned', lines: [def.name, def.desc].filter(Boolean) })
  sfx(state, 'talent-learned')
  return true
}
