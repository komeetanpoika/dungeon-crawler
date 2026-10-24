import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as hooks from '../renderer/systems/monsters/monsteri.js'
import { registerMonsters, clearMonsters, tuningOf, updateMonsterPose } from '../renderer/systems/monsters.js'

const def = JSON.parse(readFileSync(new URL('../renderer/data/monsters/monsteri.json', import.meta.url), 'utf8'))

describe('monsteri', () => {
  beforeEach(async () => {
    clearMonsters()
    await registerMonsters([def], { loadRig: id => import(`../renderer/render/monster-rigs/${id}.js`),
      loadHooks: async () => hooks, warn: m => { throw new Error(m) } })
  })
  it('takes its tuning from the def, every TUNING_SCHEMA key present', () => {
    for (const p of hooks.TUNING_SCHEMA) assert.ok(p.key in tuningOf('monsteri'), p.key)
  })
  it('steps without throwing and reports its state', () => {
    const e = { type: 'monsteri', x: 2, y: 2, px: 80, py: 80, hp: 10, maxHp: 10 }
    const state = { player: { px: 300, py: 300, hp: 10 }, entities: [e] }
    for (let i = 0; i < 30; i++) { updateMonsterPose(e, 1 / 60); hooks.update(e, state, 1 / 60) }
    assert.equal(typeof hooks.debugState(e), 'string')
  })
})
