// A small world for the desert creatures' hook tests: an open floor (no
// outdoor skins, so every cell is loose sand: wilds/sand.js), a hero, the
// feedback and sound queues, and the real defs registered with their real
// rigs and the hook modules under test.
import { readFileSync } from 'node:fs'
import { TILE, makePlayer } from '../../renderer/systems/entities.js'
import { makeFeedback } from '../../renderer/systems/feedback.js'
import { makeSfx } from '../../renderer/systems/sfx.js'
import { registerMonsters, clearMonsters, makeMonsterFromDef, updateMonsterPose } from '../../renderer/systems/monsters.js'

export const S = 32
export const defOf = name => JSON.parse(readFileSync(new URL(`../../renderer/data/monsters/${name}.json`, import.meta.url), 'utf8'))

export async function register(names, hooks) {
  clearMonsters()
  await registerMonsters(names.map(defOf), {
    loadRig: id => import(`../../renderer/render/monster-rigs/${id}.js`),
    loadHooks: async name => hooks[name] ?? hooks,
    warn: m => { throw new Error(m) },
  })
}

export const cell = (skin) => ({ tile: TILE.FLOOR, ...(skin ? { skin } : {}), visible: true, explored: true })
export function world({ w = 40, h = 40, hero = [20, 20], skin = null } = {}) {
  const map = Array.from({ length: h }, () => Array.from({ length: w }, () => cell(skin)))
  const player = { ...makePlayer(hero[0], hero[1]), px: hero[0] * S + S / 2, py: hero[1] * S + S / 2, facing: 'south' }
  return { map, player, entities: [], feedback: makeFeedback(), sfx: makeSfx(), projectiles: [] }
}
export function spawn(state, name, x, y, over = {}) {
  const e = { ...makeMonsterFromDef(name, x, y), px: x * S + S / 2, py: y * S + S / 2, ...over }
  state.entities.push(e)
  return e
}
export function moveHero(state, x, y) {
  Object.assign(state.player, { x: Math.floor(x), y: Math.floor(y), px: x * S + S / 2, py: y * S + S / 2 })
}
// Run a hook-driven creature the way game.js does (hook, then pose), `seconds` at 60 fps.
// `each(i)` runs before every frame (to walk the hero, say).
export function run(state, e, update, seconds, each = null) {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) {
    each?.(i)
    state.player.invulnTimer = Math.max(0, (state.player.invulnTimer ?? 0) - 1 / 60)
    update(e, state, 1 / 60)
    updateMonsterPose(e, 1 / 60)
  }
}
export const cues = state => state.sfx.cues.map(c => c.name)
export const tilesApart = (a, b) => Math.hypot(a.px - b.px, a.py - b.py) / S
