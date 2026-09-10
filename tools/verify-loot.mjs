// Boots the game, starts Adventure, and reports what the surface chests hold
// against what the player can actually use.
// Usage: DISPLAY=:0 node tools/verify-loot.mjs [runs]   (≈12 s per run)
//
// Requires --dcdebug so game.js wires up window.__dc = { get state() {...} }
// (see renderer/game.js, main.cjs) — inert in a normal `npm start` launch.
//
// The surface rebuilds on every launch, so its chests re-roll each time; a few
// runs is enough to see the shape of the table. Each run leaves the adventure
// save as it found it (it only reads), but it does start a run, so point it at
// a save you don't mind touching.
import { _electron as electron } from 'playwright-core'

// The tier-1 pools (systems/loot.js) — everything a first-map chest may hold.
// The hatchet joins them because the chest beside the spawn carries fixed
// contents (openmap.js `starter`) and never rolls the table at all; no loot
// pool holds one, so seeing it here always means that chest.
const TIER_1 = new Set(['dagger', 'sword', 'sling', 'shortbow', 'sparkwand', 'hatchet'])

const runs = Number(process.argv[2] ?? 1)
let chests = 0, unusable = 0, offTier = 0

for (let run = 0; run < runs; run++) {
  const app = await electron.launch({ args: ['.', '--dcdebug'], env: { ...process.env, DISPLAY: ':0' } })
  try {
    const page = await app.firstWindow()
    page.on('pageerror', e => console.log('PAGEERROR', e.message))
    await page.waitForFunction(() => window.__dc?.state || document.querySelector('canvas'))
    // Adventure is the first title-menu item; Enter selects and confirms it.
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)   // the first map takes a moment to build

    const snap = await page.evaluate(() => {
      const s = window.__dc?.state
      if (!s) return null
      const p = s.player
      const bows = [p.ranged, ...p.inventory.filter(i => i.kind === 'ranged').map(i => i.payload)]
      return {
        level: s.level,
        talents: p.talents ?? [],
        ammoKinds: bows.filter(Boolean).map(b => b.ammoKind),
        chests: s.entities.filter(e => e.type === 'chest').map(e => e.contents),
      }
    })
    if (!snap) throw new Error('no game state — did the run start?')
    if (run === 0) console.log(`depth ${snap.level}  talents [${snap.talents.join(', ') || 'none'}]  bows for [${snap.ammoKinds.join(', ') || 'none'}]\n`)

    const has = t => snap.talents.includes(t)
    for (const c of snap.chests) {
      chests++
      const name = c.weaponType ?? c.ammoKind ?? c.type
      // Same gates as canEquip, restated here so the tool stays standalone.
      const dead =
        (c.type === 'ranged' && !has('ranged_stance')) ||
        (c.type === 'wand' && !has('magic_stance')) ||
        (c.heavy && !has('heavy_weapons')) ||
        (c.type === 'ammo' && !snap.ammoKinds.includes(c.ammoKind))
      const stray = (c.weaponType && !TIER_1.has(c.weaponType))
      if (dead) unusable++
      if (stray) offTier++
      console.log(`  ${c.type.padEnd(7)} ${String(name).padEnd(12)} ${dead ? 'UNUSABLE' : 'usable'}${stray ? '  ← ABOVE TIER 1' : ''}`)
    }
  } finally {
    await app.close()
  }
}

console.log(`\n${chests} chests: ${unusable} unusable (${(100 * unusable / chests).toFixed(0)}%), ${offTier} above tier 1`)
if (offTier > 0) throw new Error(`${offTier} chest(s) held gear from above the map's loot tier`)
