// tools/monster-bench/scaffold.mjs
// A new bench monster in one go: its JSON def (a loud placeholder look on
// the quadruped rig until its art exists), a hook module wired for the
// bench (TUNING_SCHEMA read through tuningOf every frame, debugState,
// debugDraw), and a node test that passes as generated. CLI: new-monster.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const { writeMonster, NAME_RE, RESERVED_NAMES } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')

export function defFor(name) {
  return { name, rig: 'quadruped', params: { hideColor: '#ff00ff', bellyColor: '#00e5ff' },
           stats: { hp: 10, dmg: 1, speed: 70 }, behavior: {}, hooks: true, spawn: null, tuning: {} }
}

const title = name => name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ')
const slot = name => /^[a-z_]/.test(name) ? `.${name}` : `['${name}']`

export function hookSource(name) {
  return `// ${title(name)}: describe what it does, how the player sees it coming, how to beat it.
//
// Runs as a CREATURE_UPDATE supplement after the brain and act have moved
// it this frame (see systems/monsters.js). Every number worth tweaking
// lives in TUNING_SCHEMA; the values come from the monster's JSON \`tuning\`
// and are read through tuningOf every frame, so a monster-bench edit lands
// on the next frame.
import { CREATURE_UPDATE } from '../creatures.js'
import { tuningOf } from '../monsters.js'

export const TUNING_SCHEMA = [
  { key: 'cooldown', label: 'Cooldown', group: 'attack', type: 'range', min: 0.2, max: 10, step: 0.1, default: 2,
    hint: 'seconds between attacks' },
]

export function update(e, state, delta) {
  const T = tuningOf(e.type)
  const m = e.mech ?? (e.mech = { state: 'idle', t: 0, cd: T.cooldown })
  m.t += delta
  m.state = 'idle'
  if (m.t >= T.cooldown) { m.t = 0; m.state = 'attack' }   // placeholder: the attack starts here
  m.cd = Math.max(0, T.cooldown - m.t)
}

// Monster-bench readout: one short line on where the state machine is.
export function debugState(e) {
  return \`\${e.mech?.state ?? '-'} cd \${(e.mech?.cd ?? 0).toFixed(2)}\`
}

// Monster-bench overlay (Hitboxes on): ctx sits at the monster's screen
// centre, S px per tile. Draw range rings and aim lines here.
export function debugDraw(ctx, e, S) {
}

CREATURE_UPDATE${slot(name)} = update
`
}

export function testSource(name) {
  return `import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as hooks from '../renderer/systems/monsters/${name}.js'
import { registerMonsters, clearMonsters, tuningOf, updateMonsterPose } from '../renderer/systems/monsters.js'

const def = JSON.parse(readFileSync(new URL('../renderer/data/monsters/${name}.json', import.meta.url), 'utf8'))

describe('${name}', () => {
  beforeEach(async () => {
    clearMonsters()
    await registerMonsters([def], { loadRig: id => import(\`../renderer/render/monster-rigs/\${id}.js\`),
      loadHooks: async () => hooks, warn: m => { throw new Error(m) } })
  })
  it('takes its tuning from the def, every TUNING_SCHEMA key present', () => {
    for (const p of hooks.TUNING_SCHEMA) assert.ok(p.key in tuningOf('${name}'), p.key)
  })
  it('steps without throwing and reports its state', () => {
    const e = { type: '${name}', x: 2, y: 2, px: 80, py: 80, hp: 10, maxHp: 10 }
    const state = { player: { px: 300, py: 300, hp: 10 }, entities: [e] }
    for (let i = 0; i < 30; i++) { updateMonsterPose(e, 1 / 60); hooks.update(e, state, 1 / 60) }
    assert.equal(typeof hooks.debugState(e), 'string')
  })
})
`
}

export function scaffoldMonster(name, { monstersDir, hooksDir, testsDir }) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`invalid monster name "${name}"`)
  if (RESERVED_NAMES.has(name)) throw new Error(`monster name "${name}" is reserved for a built-in type`)
  const files = { def: path.join(monstersDir, `${name}.json`), hook: path.join(hooksDir, `${name}.js`),
                  test: path.join(testsDir, `${name}.test.js`) }
  for (const f of Object.values(files)) if (fs.existsSync(f)) throw new Error(`${name}: already exists (${f})`)
  fs.writeFileSync(files.hook, hookSource(name))
  fs.writeFileSync(files.test, testSource(name))
  const { name: _, ...data } = defFor(name)
  writeMonster(monstersDir, name, data)
  return { files: Object.values(files) }
}
