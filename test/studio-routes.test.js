import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createLabServer } from '../tools/monster-lab/server.mjs'
import { makeProjectRoot, makeCutBody } from './studio-fixture.js'

describe('studio routes', () => {
  let server, base, projectRoot
  before(async () => {
    projectRoot = makeProjectRoot()
    server = createLabServer({ root: process.cwd(), cutsRoot: projectRoot })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => new Promise(r => server.close(r)))
  const send = (method, p, body) => fetch(base + p, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const post = (p, b) => send('POST', p, b)
  const patch = (p, b) => send('PATCH', p, b)
  const getJson = async p => (await fetch(base + p)).json()

  it('POST open, PATCH def, GET draft round-trip', async () => {
    assert.equal((await post('/api/studio/drafts/boar/open')).status, 200)
    assert.equal((await patch('/api/studio/drafts/boar/def', { stats: { hp: 9 } })).status, 200)
    assert.equal((await getJson('/api/studio/drafts/boar')).def.stats.hp, 9)
  })
  it('/sg serves the draft def and the game page with the bridge after web-shim', async () => {
    await post('/api/studio/drafts/boar/open'); await patch('/api/studio/drafts/boar/def', { stats: { hp: 9 } })
    assert.equal((await getJson('/sg/boar@3/renderer/data/monsters/boar.json')).stats.hp, 9)
    const page = await (await fetch(`${base}/sg/boar/renderer/index.html`)).text()
    assert.ok(page.indexOf('web-shim.js') < page.indexOf('/tools/monster-studio/game-bridge.js'))
    assert.ok(page.indexOf('/tools/monster-studio/game-bridge.js') < page.indexOf('src="game.js"'))
    assert.equal((await fetch(`${base}/sg/boar/renderer/game.js`)).headers.get('cache-control'), 'no-store')
  })
  it('/sg for a new drawn draft serves a template rig and lists it in the index', async () => {
    await post('/api/studio/drafts', { name: 'fresh', ...makeCutBody({ name: 'fresh' }) })
    assert.match(await (await fetch(`${base}/sg/fresh/renderer/render/monster-rigs/fresh.js`)).text(), /^\/\/ cutout-rig:/)
    assert.ok((await getJson('/sg/fresh/renderer/data/monsters/index.json')).includes('fresh'))
  })
  it('/sg refuses traversal', async () => {
    await post('/api/studio/drafts/boar/open')
    for (const p of ['/sg/boar/../../etc/passwd', '/sg/boar/renderer/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/sg/nodraft/renderer/index.html'])
      assert.equal((await fetch(base + p)).status, 404, p)
  })
  it('draft routes refuse bad names', async () => {
    for (const p of ['/api/studio/drafts/..%2Fx/open', '/api/studio/drafts/A/open', '/api/studio/drafts/index/open'])
      assert.equal((await post(p)).status, 400, p)
  })
  it('a stale publish answers 409 with stale: true', async () => {
    await post('/api/studio/drafts/boar/open')
    fs.writeFileSync(path.join(projectRoot, 'renderer/data/monsters/boar.json'), '{"rig":"quadruped","name":"boar","stats":{"hp":7}}')
    const res = await post('/api/studio/drafts/boar/publish', {})
    assert.equal(res.status, 409); assert.equal((await res.json()).stale, true)
  })
  it('GET /cutter redirects to /studio', async () => {
    const res = await fetch(`${base}/cutter`, { redirect: 'manual' })
    assert.equal(res.status, 302); assert.equal(res.headers.get('location'), '/studio')
  })
  it('an unparsable body is a 400', async () => {
    const res = await fetch(`${base}/api/studio/drafts/boar/rename`, { method: 'POST', body: '{nope' })
    assert.equal(res.status, 400)
  })
})
