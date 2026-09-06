// Frame selection for sheet-drawn NPCs (data/npcs.js species with a `sheet`).
// The clock is distance, not time: `anim.dist` grows only while the creature
// moves, so a standing animal holds its first walk frame instead of trotting
// on the spot, and a faster animal cycles faster for free. Which row plays
// comes from what the brain is doing — the chase goals gallop, everything
// else trots — and a claw swing shows the bite for its duration.
export const RUN_GOALS = new Set(['hunt_prey', 'attack_hostile', 'flee_hurt'])
export const STRIDE = { walk: 8, run: 14 }     // px of travel per frame
const STILL_AFTER = 0.1                        // s without motion before the pose settles

export function tickNpcAnim(e, movedPx, delta) {
  const a = e.anim ??= { dist: 0, still: 0 }
  if (movedPx > 0.01) { a.dist += movedPx; a.still = 0 }
  else a.still += delta
  return a
}

// { row, frame } into `sheet.rows`. A missing row degrades to `walk`, so a
// sheet with only a walk row still animates.
export function npcFrame(e, sheet) {
  const rows = sheet.rows
  if (e.attack?.phase === 'swing' && rows.bite) return { row: 'bite', frame: 0 }
  const a = e.anim
  if (!a || a.still >= STILL_AFTER) return { row: 'walk', frame: 0 }
  const row = RUN_GOALS.has(e.ai?.current) && rows.run ? 'run' : 'walk'
  return { row, frame: Math.floor(a.dist / STRIDE[row]) % rows[row].frames }
}
