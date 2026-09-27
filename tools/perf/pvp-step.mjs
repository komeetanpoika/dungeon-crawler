// The server's per-tick cost on a PvP arena with six bots (2b spec §4: the
// budget is 2 ms per 30 Hz tick): a whole match of botInput for every hero
// (the bots' pathing), stepMatch, and a snapshot encoded at the server's
// 20 Hz — each timed on its own. Pure Node, no browser.
//
//   node tools/perf/pvp-step.mjs [arena…]      (default: pillars keep wilds)
import { makeMatch, stepMatch } from '../../renderer/pvp/sim.js'
import { botInput } from '../../renderer/pvp/bots.js'
import { snapshotBody, encode } from '../../renderer/net/protocol.js'
import { PVP, CLASSES } from '../../renderer/data/pvp.js'
import { NET } from '../../renderer/data/net.js'
import { PVP_ARENAS } from '../../renderer/data/pvp-arenas.js'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['pillars', 'keep', 'wilds']
const stat = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return { mean: s.reduce((t, x) => t + x, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], max: s.at(-1) }
}
const fmt = ({ mean, p95, max }) => `mean ${mean.toFixed(3)} p95 ${p95.toFixed(3)} max ${max.toFixed(2)}`
for (const id of ids) {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}`, cls: CLASSES[i % 3] }))
  const m = makeMatch({ roster, arena: PVP_ARENAS[id], seed: 1 })
  const bots = [], step = [], snap = [], total = []
  for (let tick = 1; !m.ended; tick++) {
    const t0 = performance.now()
    const inputs = {}
    for (const h of m.heroes) inputs[h.id] = botInput(m, h)
    const t1 = performance.now()
    stepMatch(m, inputs, PVP.tick)
    const t2 = performance.now()
    if (Math.floor(tick * NET.snapshotHz * PVP.tick) !== Math.floor((tick - 1) * NET.snapshotHz * PVP.tick)) encode(snapshotBody(m))
    const t3 = performance.now()
    bots.push(t1 - t0); step.push(t2 - t1); snap.push(t3 - t2); total.push(t3 - t0)
  }
  console.log(`${id} (${m.arena.size.w}×${m.arena.size.h}, ${total.length} ticks)`)
  console.log(`  bots  ${fmt(stat(bots))} ms`)
  console.log(`  step  ${fmt(stat(step))} ms`)
  console.log(`  snap  ${fmt(stat(snap))} ms`)
  console.log(`  tick  ${fmt(stat(total))} ms  (budget 2)`)
}
