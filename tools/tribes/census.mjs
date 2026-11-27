// Where the three tribes turned up (renderer/wilds/tribes-cast.js): over the
// pieces round home of each seed (seven by seven, or `--reach` pieces each
// way), how many camps, seats and roaming packs of each tribe the Wilds
// dealt, by toughness; beside them, how many pieces of the tribe's country
// (wilds/layout.js pieceBiome) there are and on how many of the pieces
// looked at the tribe is met at all. `--list` names every camp and seat with
// its piece and the world tile of its middle (a court's: of its ring).
//
//   node tools/tribes/census.mjs <seed…> [--reach 3] [--list]
import { generatePiece } from '../../renderer/wilds/piece.js'
import { PIECE } from '../../renderer/wilds/layout.js'
import { TRIBES } from '../../renderer/data/tribes.js'
import { TRIBE_KINDS, tribeOfKind } from '../../renderer/wilds/tribes-cast.js'

const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1] }
const reach = Number(flag('--reach') ?? 3)
const list = args.includes('--list')
const seeds = args.filter(a => !a.startsWith('--')).map(Number)
if (!seeds.length || seeds.some(Number.isNaN) || !(reach >= 0)) {
  console.error('usage: node tools/tribes/census.mjs <seed…> [--reach 3] [--list]')
  process.exit(1)
}

const TIERS = [1, 2, 3, 4]
const byTier = counts => TIERS.map(tier => counts[tier] ?? 0).join(' ')
const add = (counts, tier) => { counts[tier] = (counts[tier] ?? 0) + 1 }
const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0)

for (const seed of seeds) {
  const tally = Object.fromEntries(Object.keys(TRIBES).map(tribe => [tribe, { country: 0, met: 0, camps: {}, seats: {}, packs: {}, names: {}, heads: 0, wares: 0, places: [] }]))
  let pieces = 0
  for (let wy = -reach; wy <= reach; wy++) for (let wx = -reach; wx <= reach; wx++) {
    const p = generatePiece(seed, wx, wy, 0)
    pieces++
    const here = new Set()
    for (const [tribe, row] of Object.entries(tally)) if (TRIBES[tribe].country === p.biome) row.country++
    for (const s of p.spawns) {
      const tribe = s.kind === 'ware' ? s.tribe : tribeOfKind(s.kind)
      if (!tribe) continue
      here.add(tribe)
      if (TRIBE_KINDS.has(s.kind)) tally[tribe].heads++; else tally[tribe].wares++
    }
    for (const tribe of here) tally[tribe].met++
    if (p.main.tribe) {
      const row = tally[p.main.tribe]
      add(p.main.kind === 'boss' ? row.seats : row.camps, p.tier)
      row.names[p.main.site] = (row.names[p.main.site] ?? 0) + 1
      const at = p.main.court?.ring ?? p.main
      row.places.push(`${p.main.site} at world tile (${wx * PIECE + at.x}, ${wy * PIECE + at.y}), piece ${p.key}, toughness ${p.tier}`)
    }
    for (const k of p.packs) if (k.tribe) add(tally[k.tribe].packs, p.tier)
  }
  console.log(`seed ${seed}: ${pieces} pieces (${2 * reach + 1} by ${2 * reach + 1} round home)`)
  console.log('  tribe    country  its pieces  met on   camps by toughness 1-4   seats 1-4   packs 1-4   members  wares')
  for (const [tribe, row] of Object.entries(tally)) {
    const share = row.country ? ` (${(row.met / row.country).toFixed(2)} of its country's count)` : ''
    console.log(`  ${tribe.padEnd(8)} ${TRIBES[tribe].country.padEnd(8)} ${String(row.country).padStart(6)} ${String(row.met).padStart(10)}   ${byTier(row.camps).padEnd(10)} = ${String(sum(row.camps)).padEnd(8)} ${byTier(row.seats).padEnd(8)} = ${String(sum(row.seats)).padEnd(3)} ${byTier(row.packs).padEnd(8)} = ${String(sum(row.packs)).padEnd(4)} ${String(row.heads).padStart(5)} ${String(row.wares).padStart(6)}${share}`)
    const names = Object.entries(row.names).map(([name, n]) => `${name} ${n}`).join(', ')
    if (names) console.log(`           ${names}`)
    if (list) for (const place of row.places) console.log(`           ${place}`)
  }
}
