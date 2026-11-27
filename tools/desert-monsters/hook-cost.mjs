// node tools/desert-monsters/hook-cost.mjs
// What the desert creatures' hooks cost a frame, measured in Node on a real
// piece of seed 7's deep desert: two sand worms hunting a hero who walks
// (their search for a way under the sand is the dear part), an antlion with
// the hero on its slope, three scorpions. Prints mean and worst ms per frame.
import { readFileSync } from 'node:fs'
import { generatePiece } from '../../renderer/wilds/piece.js'
import { registerMonsters, makeMonsterFromDef, updateMonsterPose } from '../../renderer/systems/monsters.js'
import { makePlayer } from '../../renderer/systems/entities.js'
import { makeFeedback } from '../../renderer/systems/feedback.js'
import { makeSfx } from '../../renderer/systems/sfx.js'
import { setDamageObserver } from '../../renderer/systems/player-damage.js'
import { looseSand } from '../../renderer/wilds/sand.js'
import { CREATURE_UPDATE } from '../../renderer/systems/creatures.js'

const S = 32
const NAMES = ['hiekkamato', 'kuoppaleuka', 'skorpioni']
const defs = NAMES.map(n => JSON.parse(readFileSync(new URL(`../../renderer/data/monsters/${n}.json`, import.meta.url), 'utf8')))
await registerMonsters(defs, { warn: m => { throw new Error(m) } })
setDamageObserver(() => 0)

const piece = generatePiece(7, 10, -1, 0)
const map = piece.cells
// a row of loose sand to walk along
let row = null
for (let y = 20; y < 60 && !row; y++) { let run = 0; for (let x = 10; x < 70; x++) { run = looseSand(map, x, y) ? run + 1 : 0; if (run >= 30) { row = { y, x0: x - 29 }; break } } }
const hero = { ...makePlayer(row.x0, row.y), px: row.x0 * S + 16, py: row.y * S + 16 }
const state = { map, player: hero, entities: [], feedback: makeFeedback(), sfx: makeSfx() }
const put = (name, x, y) => { const e = { ...makeMonsterFromDef(name, x, y), px: x * S + 16, py: y * S + 16 }; state.entities.push(e); return e }
const sandNear = (x, y) => { for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (looseSand(map, x + dx, y + dy)) return [x + dx, y + dy]; return [x, y] }

function measure(label, setup, frames = 1800) {
  state.entities = []
  Object.assign(hero, { x: row.x0, y: row.y, px: row.x0 * S + 16, py: row.y * S + 16, hp: 10, knockback: null })
  setup()
  let total = 0, worst = 0, dir = 1
  for (let i = 0; i < frames; i++) {
    // the hero walks the row back and forth
    hero.px += dir * 2; if (hero.px > (row.x0 + 28) * S || hero.px < row.x0 * S + 16) dir = -dir
    hero.x = Math.floor(hero.px / S); hero.knockback = null; hero.invulnTimer = 0
    const t0 = performance.now()
    for (const e of state.entities) { CREATURE_UPDATE[e.type](e, state, 1 / 60); updateMonsterPose(e, 1 / 60) }
    const ms = performance.now() - t0
    total += ms; worst = Math.max(worst, ms)
    state.sfx.cues.length = 0; state.feedback.floats.length = 0
  }
  console.log(`${label}: mean ${(total / frames).toFixed(4)} ms a frame, worst ${worst.toFixed(3)} ms`)
}
measure('two worms hunting', () => { put('hiekkamato', ...sandNear(row.x0 + 6, row.y - 5)); put('hiekkamato', ...sandNear(row.x0 + 14, row.y + 5)) })
measure('an antlion, the hero crossing its funnel', () => { put('kuoppaleuka', row.x0 + 14, row.y) })
measure('three scorpions buried by the way', () => { for (const dx of [6, 14, 22]) put('skorpioni', ...sandNear(row.x0 + dx, row.y - 3)) })
