// node tools/monster-bench/new-monster.mjs <name>
// Scaffold a new monster for the bench: def, hook module and test.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffoldMonster } from './scaffold.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const name = process.argv[2]
try {
  const { files } = scaffoldMonster(name, {
    monstersDir: path.join(ROOT, 'renderer/data/monsters'),
    hooksDir: path.join(ROOT, 'renderer/systems/monsters'),
    testsDir: path.join(ROOT, 'test'),
  })
  for (const f of files) console.log('wrote', path.relative(ROOT, f))
  console.log(`\nnpm run bench -- ${name}`)
} catch (err) {
  console.error(`new-monster: ${err.message}`)
  process.exit(1)
}
