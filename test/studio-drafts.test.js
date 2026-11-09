import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeProjectRoot, makeCutBody, snapshotTree } from './studio-fixture.js'
import { listStudio, openDraft, readDraft, saveDraftCut, patchDraftDef, suggestName, createDraft, renameDraft, discardDraft } from '../tools/monster-studio/drafts.js'

describe('draft store', () => {
  it('listStudio sorts kinds: code, drawn, story', () => {
    const r = makeProjectRoot()
    assert.deepEqual(listStudio(r).monsters.map(m => [m.name, m.kind]), [['boar', 'code'], ['monsterx', 'drawn'], ['story1', 'story']])
  })
  it('openDraft copies the game\'s files and touches nothing published', () => {
    const r = makeProjectRoot(), before = snapshotTree(r, ['renderer', 'assets'])
    const v = openDraft(r, 'monsterx')
    assert.equal(v.isNew, false); assert.equal(v.stale, false); assert.equal(v.cutChanged, false); assert.equal(v.buildError, null)
    assert.ok(fs.existsSync(path.join(r, 'drafts/monsters/monsterx/monsterx-parts.js')))
    assert.deepEqual(snapshotTree(r, ['renderer', 'assets']), before)
  })
  it('a leaking cut is saved with a buildError naming the piece', () => {
    const r = makeProjectRoot(); openDraft(r, 'monsterx')
    const { buildError } = saveDraftCut(r, 'monsterx', { cut: makeCutBody({ name: 'monsterx', short: true }).cut })
    assert.match(buildError, /arm/)
    assert.equal(readDraft(r, 'monsterx').cutChanged, true)
  })
  it('story patch keeps only params', () => {
    const r = makeProjectRoot(); openDraft(r, 'story1')
    patchDraftDef(r, 'story1', { params: { bob: 2 }, stats: { hp: 99 }, spawn: { depths: [1, 5] } })
    const d = readDraft(r, 'story1').def
    assert.equal(d.params.bob, 2); assert.notEqual(d.stats?.hp, 99); assert.equal(d.spawn ?? null, null)
  })
  it('suggestName skips taken names', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    assert.equal(suggestName(r, 'Boar!'), 'boar_2')
    assert.equal(suggestName(r, 'guard'), 'guard_2')
  })
  it('createDraft refuses a published name 409; rename to a taken name is refused 409', () => {
    const r = makeProjectRoot(), body = makeCutBody({ name: 'x' })
    assert.throws(() => createDraft(r, { name: 'boar', ...body }), e => e.status === 409)
    createDraft(r, { name: 'newmon', ...body })
    assert.throws(() => renameDraft(r, 'newmon', 'monsterx'), e => e.status === 409)
    const v = renameDraft(r, 'newmon', 'newmon2')
    assert.equal(v.def.rig, 'newmon2'); assert.ok(fs.existsSync(path.join(r, 'drafts/monsters/newmon2/newmon2-parts.png')))
  })
  it('stale turns true when the game\'s def changes after the draft started', () => {
    const r = makeProjectRoot(); openDraft(r, 'boar')
    fs.writeFileSync(path.join(r, 'renderer/data/monsters/boar.json'), '{"rig":"quadruped","name":"boar","stats":{"hp":7}}')
    assert.equal(readDraft(r, 'boar').stale, true)
  })
  it('bad names are refused 400 everywhere', () => {
    const r = makeProjectRoot()
    for (const f of [() => openDraft(r, '../x'), () => readDraft(r, 'A'), () => discardDraft(r, 'index')])
      assert.throws(f, e => e.status === 400)
  })
  it('a new draft is drawn, listed, and discard removes it', () => {
    const r = makeProjectRoot()
    const v = createDraft(r, { name: 'newmon', ...makeCutBody({ name: 'x' }) })
    assert.equal(v.kind, 'drawn'); assert.equal(v.isNew, true); assert.equal(v.cutChanged, true); assert.equal(v.cut.source, 'drafts/monsters/newmon/source.png')
    assert.deepEqual(listStudio(r).newDrafts, ['newmon'])
    discardDraft(r, 'newmon')
    assert.deepEqual(listStudio(r).newDrafts, [])
  })
})
