// tools/monster-bench/argv.cjs
// `electron . --bench <name>` opens the game straight into the monster
// bench; main.cjs hands the renderer a query string, as it does --dcdebug.
// CJS so main.cjs can require it.
const NAME_RE = /^[a-z0-9_]+$/

function benchNameFrom(argv) {
  const i = argv.indexOf('--bench')
  const name = i >= 0 ? argv[i + 1] : null
  return typeof name === 'string' && NAME_RE.test(name) ? name : null
}

// The bench also exposes window.__dc (dcdebug) for the test driver.
function benchQuery(argv) {
  const name = benchNameFrom(argv)
  if (name) return `bench=${name}&dcdebug=1`
  return argv.includes('--dcdebug') ? 'dcdebug=1' : undefined
}

module.exports = { benchNameFrom, benchQuery }
