import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createLabServer } from '../tools/monster-lab/server.mjs'
import { makeProjectRoot, makeCutBody, readJson } from './studio-fixture.js'
import { isLocalRequest } from '../tools/monster-studio/studio-routes.js'

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

  // a raw request with exactly these headers (fetch picks its own Host/Origin)
  const raw = (method, p, headers, body = '') => new Promise((resolve, reject) => {
    const { port } = server.address()
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
  it('a cross-site POST is refused 403 and writes nothing', async () => {
    await post('/api/studio/drafts/boar/open')
    await patch('/api/studio/drafts/boar/def', { stats: { hp: 13 } })
    const before = fs.readFileSync(path.join(projectRoot, 'renderer/data/monsters/boar.json'))
    const host = `127.0.0.1:${server.address().port}`
    for (const headers of [{ Host: host, Origin: 'https://evil.example' }, { Host: 'evil.example', Origin: `http://${host}` }, { Host: 'evil.example' }]) {
      const res = await raw('POST', '/api/studio/drafts/boar/publish', { ...headers, 'Content-Type': 'text/plain' }, '{"force":true}')
      assert.equal(res.status, 403, JSON.stringify(headers)); assert.match(res.text, /cross-site request refused/)
    }
    for (const [method, p] of [['PATCH', '/api/studio/drafts/boar/def'], ['DELETE', '/api/studio/drafts/boar'], ['PUT', '/api/studio/drafts/boar/cut']])
      assert.equal((await raw(method, p, { Host: host, Origin: 'https://evil.example' }, '{}')).status, 403, method)
    assert.ok(fs.readFileSync(path.join(projectRoot, 'renderer/data/monsters/boar.json')).equals(before))
    assert.equal(readJson(projectRoot, 'drafts/monsters/boar/def.json').stats.hp, 13)
  })
  it('the studio page (Origin localhost) and a plain node fetch (no Origin) still write', async () => {
    const { port } = server.address()
    const res = await raw('PATCH', '/api/studio/drafts/boar/def', { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' }, '{"stats":{"hp":14}}')
    assert.equal(res.status, 200)
    assert.equal((await patch('/api/studio/drafts/boar/def', { stats: { hp: 15 } })).status, 200)
    assert.equal(readJson(projectRoot, 'drafts/monsters/boar/def.json').stats.hp, 15)
  })
  it('isLocalRequest: loopback Host on any port, Origin (when sent) loopback too', () => {
    for (const h of ['localhost:5180', '127.0.0.1:1', '[::1]:5180', 'localhost'])
      assert.equal(isLocalRequest({ host: h }), true, h)
    for (const h of [undefined, '', 'evil.example', 'localhost.evil.example:5180', 'localhost:5180@evil.example', '10.0.0.1:5180'])
      assert.equal(isLocalRequest({ host: h }), false, String(h))
    assert.equal(isLocalRequest({ host: 'localhost:5180', origin: 'http://127.0.0.1:9' }), true)
    for (const o of ['null', 'https://evil.example', 'http://localhost.evil.example', ''])
      assert.equal(isLocalRequest({ host: 'localhost:5180', origin: o }), false, o)
  })
})
