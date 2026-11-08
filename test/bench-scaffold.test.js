import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scaffoldMonster, defFor, hookSource } from '../tools/monster-bench/scaffold.mjs'
import { registerMonsters, clearMonsters, tuningOf, updateMonsterPose } from '../renderer/systems/monsters.js'
import { CREATURE_UPDATE } from '../renderer/systems/creatures.js'

const dirs = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'))
  const d = { monstersDir: path.join(root, 'monsters'), hooksDir: path.join(root, 'hooks'), testsDir: path.join(root, 'tests') }
  for (const v of Object.values(d)) fs.mkdirSync(v)
  return d
}

describe('scaffoldMonster', () => {
  it('writes def, hook and test into the given dirs', () => {
    const d = dirs()
    const { files } = scaffoldMonster('glorp', d)
    assert.deepEqual(files.map(f => path.relative(path.dirname(path.dirname(f)), f)).sort(),
      ['hooks/glorp.js', 'monsters/glorp.json', 'tests/glorp.test.js'])
    const def = JSON.parse(fs.readFileSync(path.join(d.monstersDir, 'glorp.json'), 'utf8'))
    assert.equal(def.name, 'glorp'); assert.equal(def.rig, 'quadruped')
    assert.equal(def.hooks, true); assert.equal(def.spawn, null); assert.deepEqual(def.tuning, {})
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d.monstersDir, 'index.json'), 'utf8')), ['glorp'])
  })
  it('refuses an existing monster and writes nothing new', () => {
    const d = dirs()
    fs.writeFileSync(path.join(d.hooksDir, 'glorp.js'), '// mine')
    assert.throws(() => scaffoldMonster('glorp', d), /glorp: already exists/)
    assert.equal(fs.readFileSync(path.join(d.hooksDir, 'glorp.js'), 'utf8'), '// mine')
    assert.equal(fs.existsSync(path.join(d.monstersDir, 'glorp.json')), false)
    assert.equal(fs.existsSync(path.join(d.testsDir, 'glorp.test.js')), false)
  })
  it('refuses a reserved or invalid name and leaves nothing behind', () => {
    const d = dirs()
    assert.throws(() => scaffoldMonster('guard', d), /reserved/)
    assert.throws(() => scaffoldMonster('../x', d), /invalid/)
    for (const v of Object.values(d)) assert.deepEqual(fs.readdirSync(v), [])
  })
})

describe('the generated hook', () => {
  const name = 'zz_scaffold_probe'
  const file = path.resolve('renderer/systems/monsters', `${name}.js`)
  afterEach(() => { fs.rmSync(file, { force: true }); clearMonsters() })
  it('runs in the real registry, reading tuning every frame', async () => {
    fs.writeFileSync(file, hookSource(name))
    const mod = await import(pathToFileURL(file).href)
    await registerMonsters([defFor(name)], { loadHooks: async () => mod, warn: m => { throw new Error(m) } })
    assert.equal(tuningOf(name).cooldown, 2)
    assert.equal(CREATURE_UPDATE[name], mod.update)
    const e = { type: name, x: 2, y: 2, px: 80, py: 80, hp: 10, maxHp: 10 }
    const state = { player: { px: 300, py: 300, hp: 10 }, entities: [e] }
    for (let i = 0; i < 30; i++) { updateMonsterPose(e, 0.05); mod.update(e, state, 0.05) }
    assert.equal(typeof mod.debugState(e), 'string')
    tuningOf(name).cooldown = 9
    mod.update(e, state, 0.05)
    assert.ok(e.mech.cd > 2, 'a tuning edit reaches the next frame')
    assert.equal(typeof mod.debugDraw, 'function')
  })
})
