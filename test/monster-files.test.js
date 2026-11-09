import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { readMonsters, writeMonster, updateMonster, mergeDefPatch } = createRequire(import.meta.url)('../tools/monster-lab/monster-files.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'monfiles-'))

describe('writeMonster', () => {
  it('writes <name>.json and maintains a sorted index.json', () => {
    const dir = tmp()
    writeMonster(dir, 'zeta', { rig: 'quadruped' })
    writeMonster(dir, 'alpha', { rig: 'quadruped' })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')), ['alpha', 'zeta'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'alpha.json'), 'utf8')).name, 'alpha')
  })
  it('overwrites without duplicating the index entry', () => {
    const dir = tmp()
    writeMonster(dir, 'a', { rig: 'x' }); writeMonster(dir, 'a', { rig: 'y' })
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')), ['a'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')).rig, 'y')
  })
  it('rejects path-escaping and uppercase names', () => {
    const dir = tmp()
    assert.throws(() => writeMonster(dir, '../evil', {}))
    assert.throws(() => writeMonster(dir, 'Bad', {}))
    assert.throws(() => writeMonster(dir, 'a/b', {}))
  })
  it('rejects a reserved built-in name', () => {
    const dir = tmp()
    assert.throws(() => writeMonster(dir, 'crab', {}), /reserved/)
    assert.ok(!fs.existsSync(path.join(dir, 'crab.json')))
  })
})

describe('writeMonster index name', () => {
  it('refuses the name index so the index file survives', () => {
    const dir = tmp()
    writeMonster(dir, 'a', {})
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf8')
    assert.throws(() => writeMonster(dir, 'index', {}), /reserved for the index file/)
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), before)
  })
})

describe('readMonsters', () => {
  it('round-trips what writeMonster wrote', () => {
    const dir = tmp()
    writeMonster(dir, 'boarhound', { rig: 'quadruped', stats: { hp: 30 } })
    const { defs, warnings } = readMonsters(dir)
    assert.equal(defs.length, 1)
    assert.equal(defs[0].name, 'boarhound')
    assert.deepEqual(warnings, [])
  })
  it('no index.json -> empty with a warning, never a throw', () => {
    const { defs, warnings } = readMonsters(tmp())
    assert.deepEqual(defs, [])
    assert.equal(warnings.length, 1)
  })
  it('skips index entries whose file is missing or invalid', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(['ghost', 'bad']))
    fs.writeFileSync(path.join(dir, 'bad.json'), '{nope')
    const { defs, warnings } = readMonsters(dir)
    assert.deepEqual(defs, [])
    assert.equal(warnings.length, 2)
  })
})

describe('writeMonster index handling', () => {
  it('does not rewrite index.json when the name is already listed', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'index.json'), '["a"]')
    writeMonster(dir, 'a', { rig: 'quadruped' })
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'), '["a"]')
  })
})

describe('updateMonster', () => {
  const seed = dir => writeMonster(dir, 'm', { rig: 'quadruped', params: { a: 1 }, stats: { hp: 5, dmg: 1 },
    behavior: { taxon: 'beast', sightRange: 200 }, spawn: null, hooks: true, tuning: { x: 1, y: 2 } })
  const read = dir => JSON.parse(fs.readFileSync(path.join(dir, 'm.json'), 'utf8'))
  it('merges stats and behavior, replaces tuning, keeps every other field', () => {
    const dir = tmp(); seed(dir)
    updateMonster(dir, 'm', { stats: { hp: 9 }, behavior: { sightRange: 300 }, tuning: { x: 5 } })
    const d = read(dir)
    assert.deepEqual(d.stats, { hp: 9, dmg: 1 })
    assert.deepEqual(d.behavior, { taxon: 'beast', sightRange: 300 })
    assert.deepEqual(d.tuning, { x: 5 })
    assert.deepEqual(d.params, { a: 1 }); assert.equal(d.spawn, null); assert.equal(d.hooks, true)
    assert.equal(d.rig, 'quadruped'); assert.equal(d.name, 'm')
  })
  it('leaves sections the patch omits untouched', () => {
    const dir = tmp(); seed(dir)
    updateMonster(dir, 'm', { stats: { dmg: 4 } })
    assert.deepEqual(read(dir).tuning, { x: 1, y: 2 })
    assert.deepEqual(read(dir).behavior, { taxon: 'beast', sightRange: 200 })
  })
  it('updateMonster replaces params whole and keeps the rest', () => {
    const dir = tmp(); seed(dir)
    updateMonster(dir, 'm', { params: { b: 2 } })
    const d = read(dir)
    assert.deepEqual(d.params, { b: 2 })
    assert.deepEqual(d.tuning, { x: 1, y: 2 }); assert.deepEqual(d.stats, { hp: 5, dmg: 1 })
  })
  it('refuses a missing monster', () => {
    assert.throws(() => updateMonster(tmp(), 'nope', { tuning: {} }), /no monster "nope"/)
  })
  it('refuses a bad name', () => {
    assert.throws(() => updateMonster(tmp(), '../x', { tuning: {} }))
  })
})

describe('mergeDefPatch', () => {
  it('behaviour null deletes, stats merge, params/tuning replace, spawn replaces, rest survives', () => {
    const def = { rig: 'ogre', stats: { hp: 20, dmg: 2, speed: 50 }, behavior: { weapon: 'maul', weaponOverrides: { damage: 3 }, sightRange: 200 },
                  params: { bob: 1, wobble: 2 }, tuning: { a: 1 }, spawn: { depths: [3, 5], weight: 1 }, hooks: false, name: 'ogre' }
    const out = mergeDefPatch(def, { stats: { hp: 24 }, behavior: { weapon: null, weaponOverrides: null }, params: { bob: 2 }, spawn: null })
    assert.deepEqual(out.stats, { hp: 24, dmg: 2, speed: 50 })
    assert.deepEqual(out.behavior, { sightRange: 200 })
    assert.deepEqual(out.params, { bob: 2 })
    assert.deepEqual(out.tuning, { a: 1 })
    assert.equal(out.spawn, null)
    assert.equal(out.hooks, false)
    assert.equal(def.behavior.weapon, 'maul') // input untouched
  })
})
