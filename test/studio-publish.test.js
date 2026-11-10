import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeProjectRoot, makeCutBody, snapshotTree, readJson } from './studio-fixture.js'
import { openDraft, createDraft, saveDraftCut, patchDraftDef } from '../tools/monster-studio/drafts.js'
import { publishDraft } from '../tools/monster-studio/publish.js'

describe('publish', () => {
  it('publishes a retuned code monster: def merged, spawn replaced, draft gone', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    patchDraftDef(r, 'boar', { stats: { hp: 9 }, behavior: { weapon: 'maul', weaponOverrides: { damage: 3 } }, spawn: { openMaps: { depths: [7, 18], count: 2 } } })
    const out = publishDraft(r, 'boar')
    assert.deepEqual(out.wrote, ['renderer/data/monsters/boar.json'])
    const d = readJson(r, 'renderer/data/monsters/boar.json')
    assert.equal(d.stats.hp, 9); assert.equal(d.behavior.weaponOverrides.damage, 3); assert.deepEqual(d.spawn, { openMaps: { depths: [7, 18], count: 2 } })
    assert.equal(fs.existsSync(path.join(r, 'drafts/monsters/boar')), false)
  })
  it('publishes a new drawing: cut, png, parts, template rig, def and index', () => {
    const r = makeProjectRoot(); createDraft(r, { name: 'fresh', ...makeCutBody({ name: 'fresh' }) })
    const out = publishDraft(r, 'fresh')
    for (const f of ['assets/cuts/fresh.json', 'assets/cuts/fresh.png', 'renderer/assets/monsters/fresh-parts.js',
      'renderer/assets/monsters/fresh-parts.png', 'renderer/render/monster-rigs/fresh.js', 'renderer/data/monsters/fresh.json', 'renderer/data/monsters/index.json'])
      assert.ok(out.wrote.includes(f), f)
    assert.equal(readJson(r, 'assets/cuts/fresh.json').source, 'assets/cuts/fresh.png')
    assert.ok(readJson(r, 'renderer/data/monsters/index.json').includes('fresh'))
  })
  it('publish refuses a leaking cut 400, naming the piece, and writes nothing', () => {
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    saveDraftCut(r, 'monsterx', { cut: makeCutBody({ name: 'monsterx', short: true }).cut })
    const before = snapshotTree(r, ['renderer', 'assets'])
    assert.throws(() => publishDraft(r, 'monsterx'), e => e.status === 400 && /arm/.test(e.message))
    assert.deepEqual(snapshotTree(r, ['renderer', 'assets']), before)
  })
  it('publish refuses a bad spawn 400 and writes nothing', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    patchDraftDef(r, 'boar', { spawn: { depths: [0, 9] } })
    const before = snapshotTree(r, ['renderer', 'assets'])
    assert.throws(() => publishDraft(r, 'boar'), e => e.status === 400)
    assert.deepEqual(snapshotTree(r, ['renderer', 'assets']), before)
  })
  it('publish of a story monster writes params only', () => {
    const r = makeProjectRoot(); openDraft(r, 'story1')
    const f = path.join(r, 'drafts/monsters/story1/def.json')
    fs.writeFileSync(f, JSON.stringify({ ...readJson(r, 'drafts/monsters/story1/def.json'), params: { bob: 2 }, stats: { hp: 99 }, spawn: { depths: [1, 5], weight: 1 } }))
    publishDraft(r, 'story1')
    const d = readJson(r, 'renderer/data/monsters/story1.json')
    assert.equal(d.params.bob, 2); assert.notEqual(d.stats?.hp, 99); assert.equal(d.spawn ?? null, null)
  })
  it('a stats-only publish of a drawn monster writes the def alone; its cut stays byte for byte', () => {
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    const cutBefore = fs.readFileSync(path.join(r, 'assets/cuts/monsterx.json'))
    const keep = snapshotTree(r, ['assets', 'renderer/assets', 'renderer/render'])
    patchDraftDef(r, 'monsterx', { stats: { hp: 12 } })
    const out = publishDraft(r, 'monsterx')
    assert.deepEqual(out.wrote, ['renderer/data/monsters/monsterx.json'])
    assert.ok(fs.readFileSync(path.join(r, 'assets/cuts/monsterx.json')).equals(cutBefore))
    assert.deepEqual(snapshotTree(r, ['assets', 'renderer/assets', 'renderer/render']), keep)
    assert.equal(readJson(r, 'renderer/data/monsters/monsterx.json').stats.hp, 12)
  })
  it('a changed cut is published compact, like the cutter writes it', () => {
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    saveDraftCut(r, 'monsterx', { cut: { ...makeCutBody({ name: 'monsterx' }).cut, outHeight: 40 } })
    const out = publishDraft(r, 'monsterx')
    assert.ok(out.wrote.includes('assets/cuts/monsterx.json'))
    const text = fs.readFileSync(path.join(r, 'assets/cuts/monsterx.json'), 'utf8')
    assert.equal(text.includes('\n'), false)
    assert.equal(JSON.parse(text).outHeight, 40); assert.equal(JSON.parse(text).source, 'assets/cuts/monsterx.png')
  })
  it('a stale draft answers 409 until forced; a hand-written cut-out rig survives', () => {
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    saveDraftCut(r, 'monsterx', { cut: { ...makeCutBody({ name: 'monsterx' }).cut, outHeight: 40 } }) // so installCut runs
    fs.writeFileSync(path.join(r, 'renderer/render/monster-rigs/monsterx.js'), '// cutout-rig: hand-written\nexport const x = 1\n')
    fs.writeFileSync(path.join(r, 'renderer/data/monsters/monsterx.json'), JSON.stringify({ ...readJson(r, 'renderer/data/monsters/monsterx.json'), extra: 1 }))
    assert.throws(() => publishDraft(r, 'monsterx'), e => e.status === 409 && e.stale === true)
    publishDraft(r, 'monsterx', { force: true })
    assert.match(fs.readFileSync(path.join(r, 'renderer/render/monster-rigs/monsterx.js'), 'utf8'), /hand-written/)
  })

  it('publish writes the draft anims; a draft without anims removes them', () => {
    const STRIKE = { phases: [{ time: 0.3, pose: {} }, { time: 0.35, pose: { arm_l: { turn: -25 } } }, { time: 0.08, hit: true, pose: {} }] }
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    patchDraftDef(r, 'monsterx', { anims: { attack: STRIKE } })
    assert.deepEqual(publishDraft(r, 'monsterx').wrote, ['renderer/data/monsters/monsterx.json'])
    assert.deepEqual(readJson(r, 'renderer/data/monsters/monsterx.json').anims, { attack: STRIKE })
    openDraft(r, 'monsterx')
    patchDraftDef(r, 'monsterx', { anims: null })
    publishDraft(r, 'monsterx')
    assert.equal('anims' in readJson(r, 'renderer/data/monsters/monsterx.json'), false)
  })
})
