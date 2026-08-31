import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLabServer } from '../tools/monster-lab/server.mjs'

let server, base, dir
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'))
  server = createLabServer({ root: process.cwd(), monstersDir: dir,
                             rigsDir: path.join(process.cwd(), 'renderer/render/monster-rigs') })
  await new Promise(r => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

describe('lab server API', () => {
  it('GET /api/rigs lists rig modules without schema.js', async () => {
    const rigs = await (await fetch(`${base}/api/rigs`)).json()
    assert.ok(rigs.includes('quadruped'))
    assert.ok(!rigs.includes('schema'))
  })
  it('PUT then GET /api/monsters round-trips', async () => {
    const put = await fetch(`${base}/api/monsters/testmon`, {
      method: 'PUT', body: JSON.stringify({ rig: 'quadruped', stats: { hp: 5 } }) })
    assert.equal(put.status, 200)
    const { defs } = await (await fetch(`${base}/api/monsters`)).json()
    assert.equal(defs.length, 1)
    assert.equal(defs[0].name, 'testmon')
  })
  it('PUT with a bad name is rejected 400 and writes nothing', async () => {
    const res = await fetch(`${base}/api/monsters/..%2Fevil`, { method: 'PUT', body: '{}' })
    assert.equal(res.status, 400)
    assert.ok(!fs.existsSync(path.join(dir, '..', 'evil.json')))
  })
  it('PUT with invalid JSON is rejected 400', async () => {
    assert.equal((await fetch(`${base}/api/monsters/ok`, { method: 'PUT', body: '{nope' })).status, 400)
  })
})

describe('lab server static', () => {
  it('serves renderer modules with a JS content type', async () => {
    const res = await fetch(`${base}/renderer/render/monster-rigs/quadruped.js`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /javascript/)
  })
  it('blocks path traversal', async () => {
    assert.equal((await fetch(`${base}/../etc/passwd`)).status, 404)
  })
  it('/api/events answers as an SSE stream', async () => {
    const ac = new AbortController()
    const res = await fetch(`${base}/api/events`, { signal: ac.signal })
    assert.match(res.headers.get('content-type'), /text\/event-stream/)
    ac.abort()
  })
})
