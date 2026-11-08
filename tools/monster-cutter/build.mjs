// node tools/monster-cutter/build.mjs <name> [--install] [--switch]
// Builds assets/cuts/<name>.json into the game's atlas + PARTS, optionally
// installing the rig module and def (--switch moves a def off another rig).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCut } from './build-cut.js'
import { installCut } from './install-cut.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const name = args.find(a => !a.startsWith('--'))
if (!name) { console.error('usage: build.mjs <name> [--install] [--switch]'); process.exit(2) }
try {
  const { atlasPath, partsPath } = buildCut({ root, name })
  console.log('wrote', path.relative(root, atlasPath)); console.log('wrote', path.relative(root, partsPath))
  if (args.includes('--install') || args.includes('--switch')) {
    console.log('installed', installCut({ root, name, switchRig: args.includes('--switch') }))
  }
} catch (e) {
  console.error(e.message + (e.needsSwitch ? ' (pass --switch to move it onto the cut rig)' : ''))
  process.exit(1)
}
