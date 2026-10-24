// tools/monster-bench/watch-filter.cjs
// Which file changes reload the monster bench. CJS so main.cjs can require
// it. A path is relative to the repo root; the bench reloads on game code
// and data under renderer/, except the editor's autosaved painter maps and
// the bench's own Save, whose watch events land just after the write.
const OWN_WRITE_MS = 1500

function shouldReload(rel, now, lastWrite) {
  const p = String(rel ?? '').replace(/\\/g, '/')
  if (!p.startsWith('renderer/') || !/\.(js|json)$/.test(p)) return false
  if (p === 'renderer/data/painter-maps.json') return false
  if (lastWrite && p === lastWrite.rel && now - lastWrite.at < OWN_WRITE_MS) return false
  return true
}

module.exports = { shouldReload, OWN_WRITE_MS }
