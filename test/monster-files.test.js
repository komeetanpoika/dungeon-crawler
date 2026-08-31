import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { readMonsters, writeMonster } = createRequire(import.meta.url)('../tools/monster-lab/monster-files.cjs')

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
