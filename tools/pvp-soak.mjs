// A bot soak of PvP matches (2b spec, Testing): four bots a match through
// the arena rotation, seeded, headless. Prints the buffs taken per kind and
// tier, time-to-kill (first damage taken in a life → death; 2a's soak was
// 8.3 s) and per-class K/D, plus the stall checks the 2a bugs taught: the
// longest a bot sent attack against needRelease, and the longest it stood
// idle (no move, no attack or alt) with a foe within 5 tiles.
//
//   node tools/pvp-soak.mjs [matches=20]
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { botInput } from '../renderer/pvp/bots.js'
import { PVP, CLASSES } from '../renderer/data/pvp.js'
import { arenaAt } from '../renderer/data/pvp-arenas.js'
import { TILE_SIZE } from '../renderer/systems/movement.js'

const N = Number(process.argv[2] ?? 20)
const cls = Object.fromEntries(CLASSES.map(c => [c, { kills: 0, deaths: 0, ttk: [] }]))
const buffs = {}, arenas = {}
let latchMax = 0, idleMax = 0
for (let m = 0; m < N; m++) {
  // Class mixes rotate with the match number, as 2a's soak did.
  const roster = [0, 1, 2, 3].map(i => ({ id: `b${i}`, name: `B${i}`, cls: CLASSES[(m + i * (1 + (m % 2))) % 3] }))
  const match = makeMatch({ roster, arena: arenaAt(m), seed: 1000 + m })
  arenas[match.arena.id] = (arenas[match.arena.id] ?? 0) + 1
  const byId = id => match.heroes.find(h => h.id === id)
  const firstHit = {}, latch = {}, idle = {}, last = {}
  while (!match.ended) {
    const inputs = Object.fromEntries(match.heroes.map(h => [h.id, botInput(match, h)]))
    for (const h of match.heroes) {
      const i = inputs[h.id]
      latch[h.id] = !h.dead && h.needRelease && i.attack ? (latch[h.id] ?? 0) + PVP.tick : 0
      const near = match.heroes.some(f => f !== h && !f.dead && Math.hypot(f.px - h.px, f.py - h.py) < 5 * TILE_SIZE)
      const moved = last[h.id] && (last[h.id].px !== h.px || last[h.id].py !== h.py)
      idle[h.id] = !h.dead && near && !moved && !i.attack && !i.alt ? (idle[h.id] ?? 0) + PVP.tick : 0
      latchMax = Math.max(latchMax, latch[h.id]); idleMax = Math.max(idleMax, idle[h.id])
      last[h.id] = { px: h.px, py: h.py }
    }
    const t = (match.tick + 1) * PVP.tick
    for (const e of stepMatch(match, inputs, PVP.tick)) {
      if (e.type === 'hit' && e.amount > 0 && firstHit[e.target] == null) firstHit[e.target] = t
      if (e.type === 'pickup' && e.kind === 'buff') buffs[`${e.buff} ${e.tier}`] = (buffs[`${e.buff} ${e.tier}`] ?? 0) + 1
      if (e.type === 'respawn') firstHit[e.hero] = null
      if (e.type === 'kill') {
        const v = byId(e.victim), k = byId(e.killer)
        cls[v.cls].deaths++
        if (firstHit[v.id] != null) cls[v.cls].ttk.push(t - firstHit[v.id])
        firstHit[v.id] = null
        if (k) cls[k.cls].kills++
      }
    }
  }
}
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN
console.log(`${N} matches: ${JSON.stringify(arenas)}`)
console.log('buffs taken:', Object.entries(buffs).sort().map(([k, n]) => `${k} ${n}`).join(', '))
for (const c of CLASSES) {
  const s = cls[c]
  console.log(`${c.padEnd(8)} K/D ${(s.kills / Math.max(1, s.deaths)).toFixed(2)} (${s.kills}/${s.deaths})  TTK mean ${mean(s.ttk).toFixed(2)} s`)
}
const all = CLASSES.flatMap(c => cls[c].ttk)
console.log(`TTK mean ${mean(all).toFixed(2)} s, median ${median(all).toFixed(2)} s (n ${all.length}; 2a: 8.3 s, target 6.2-10.4 s)`)
console.log(`longest attack-against-needRelease ${latchMax.toFixed(2)} s, longest idle near a foe ${idleMax.toFixed(2)} s`)
