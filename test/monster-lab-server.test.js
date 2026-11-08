import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLabServer } from '../tools/monster-lab/server.mjs'
import { writePng } from '../tools/png-write.mjs'
import { encodeMask } from '../tools/monster-cutter/mask.js'

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

  it('GET /api/rigs leaves out helper modules', async () => {
    const rigs = await (await fetch(`${base}/api/rigs`)).json()
    assert.ok(!rigs.includes('pixel'))
    assert.ok(!rigs.includes('cutout'))
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

describe('cut endpoints', () => {
  let cserver, cbase, croot
  before(async () => {
    croot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-cuts-'))
    for (const d of ['assets/cuts', 'renderer/assets/monsters', 'renderer/render/monster-rigs', 'renderer/data/monsters'])
      fs.mkdirSync(path.join(croot, d), { recursive: true })
    fs.writeFileSync(path.join(croot, 'renderer/data/monsters/index.json'), '[]')
    cserver = createLabServer({ root: process.cwd(), monstersDir: path.join(croot, 'renderer/data/monsters'),
      rigsDir: path.join(croot, 'renderer/render/monster-rigs'), cutsRoot: croot })
    await new Promise(r => cserver.listen(0, r))
    cbase = `http://127.0.0.1:${cserver.address().port}`
  })
  after(() => cserver.close())

  const W = 100, H = 100
  function makeBody({ short = false, withPng = true, switchRig } = {}) {
    const mask = new Uint8Array(W * H), rgba = new Uint8Array(W * H * 4)
    for (let i = 0; i < W * H; i++) rgba.set([255, 255, 255, 255], i * 4)
    const rect = (x, y, w, h, col) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { mask[j * W + i] = 1; rgba.set([...col, 255], (j * W + i) * 4) } }
    rect(30, 20, 40, 60, [255, 0, 0]); rect(20, 25, 10, 40, [0, 0, 255])
    const pieces = [
      { id: 'torso', role: 'torso', side: null, parent: null, seed: [50, 50], cut: null, pivot: [50, 50], z: 0, claims: [] },
      { id: 'arm', role: 'arm', side: 'left', parent: 'torso', seed: [22, 40],
        cut: short ? [[30, 40], [30, 45]] : [[30, 22], [30, 68]], pivot: [29, 40], z: 1, claims: [] },
    ]
    const cut = { version: 1, name: 'srv', source: 'assets/cuts/srv.png', credit: null, w: W, h: H, mask: encodeMask(mask),
      view: 'front', faces: 'left', outHeight: 30, outline: '#102030', pieces, points: { chest: { piece: 'torso', x: 50, y: 40 } } }
    const body = { cut }
    if (withPng) {
      const f = path.join(os.tmpdir(), `srv-${process.pid}.png`)
      writePng(f, W, H, rgba)
      body.sourcePng = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
    }
    if (switchRig !== undefined) body.switchRig = switchRig
    return body
  }
  const put = (name, body) => fetch(`${cbase}/api/cuts/${name}`, { method: 'PUT', body: JSON.stringify(body) })

  it('GET /cutter serves the cutter page', async () => {
    const res = await fetch(`${cbase}/cutter`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/html/)
  })
  it('PUT a valid cut with its source writes the cut, the parts and a new def; GET /api/cuts lists it', async () => {
    const res = await put('srv', makeBody())
    assert.equal(res.status, 200)
    const out = await res.json()
    assert.equal(out.ok, true)
    assert.equal(out.createdDef, true)
    for (const f of ['assets/cuts/srv.json', 'assets/cuts/srv.png', 'renderer/assets/monsters/srv-parts.png',
      'renderer/assets/monsters/srv-parts.js', 'renderer/render/monster-rigs/srv.js', 'renderer/data/monsters/srv.json'])
      assert.ok(fs.existsSync(path.join(croot, f)), f)
    assert.deepEqual(await (await fetch(`${cbase}/api/cuts`)).json(), ['srv'])
    const st = await (await fetch(`${cbase}/api/cuts/srv/status`)).json()
    assert.equal(st.rig.cutout, true)
  })
  it('PUT a cut with a leaking piece is refused 400 and names the piece', async () => {
    const res = await put('leaky', makeBody({ short: true }))
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /arm/)
    assert.ok(!fs.existsSync(path.join(croot, 'renderer/render/monster-rigs/leaky.js')))
  })
  it('PUT over a def on another rig answers 409 needsSwitch, then succeeds with switchRig', async () => {
    fs.writeFileSync(path.join(croot, 'renderer/data/monsters/other.json'),
      JSON.stringify({ rig: 'quadruped', params: {}, stats: { hp: 5, dmg: 1, speed: 50 }, behavior: {}, hooks: false, spawn: null, tuning: {} }))
    const res = await put('other', makeBody())
    assert.equal(res.status, 409)
    assert.equal((await res.json()).needsSwitch, true)
    const ok = await put('other', makeBody({ switchRig: true }))
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).switched, true)
  })
  it('re-PUT keeps the bench-tuned params of a def already on its cut rig', async () => {
    await put('keep', makeBody())
    const f = path.join(croot, 'renderer/data/monsters/keep.json')
    const def = JSON.parse(fs.readFileSync(f, 'utf8'))
    def.params = { tuned: 7 }; def.stats.hp = 99
    fs.writeFileSync(f, JSON.stringify(def))
    assert.equal((await put('keep', makeBody({ withPng: false }))).status, 200)
    const after = JSON.parse(fs.readFileSync(f, 'utf8'))
    assert.deepEqual(after.params, { tuned: 7 })
    assert.equal(after.stats.hp, 99)
  })
  it('status for a name whose def is broken JSON answers 500 and the server lives on', async () => {
    fs.writeFileSync(path.join(croot, 'renderer/data/monsters/broken.json'), '{nope')
    const res = await fetch(`${cbase}/api/cuts/broken/status`)
    assert.equal(res.status, 500)
    assert.match((await res.json()).error, /not valid JSON/)
    assert.equal((await fetch(`${cbase}/api/cuts`)).status, 200)
  })
  it('PUT over a hand-written rig file answers 409 with an error', async () => {
    fs.writeFileSync(path.join(croot, 'renderer/render/monster-rigs/handmade.js'), 'export const x = 1\n')
    const res = await put('handmade', makeBody())
    assert.equal(res.status, 409)
    const j = await res.json()
    assert.match(j.error, /not a cut-out rig/)
    assert.equal(j.needsSwitch, undefined)
  })
  it('PUT over a corrupt def answers 500', async () => {
    fs.writeFileSync(path.join(croot, 'renderer/data/monsters/corrupt.json'), '{nope')
    assert.equal((await put('corrupt', makeBody())).status, 500)
  })
  it('a refused leaking PUT leaves the last good cut on disk', async () => {
    assert.equal((await put('good', makeBody())).status, 200)
    const f = path.join(croot, 'assets/cuts/good.json')
    const before = fs.readFileSync(f, 'utf8')
    const res = await put('good', makeBody({ short: true }))
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /arm/)
    assert.equal(fs.readFileSync(f, 'utf8'), before)
  })
  it('/api/events delivers a cuts event after the first PUT on a fresh root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-fresh-'))
    for (const d of ['renderer/assets/monsters', 'renderer/render/monster-rigs', 'renderer/data/monsters'])
      fs.mkdirSync(path.join(root, d), { recursive: true })
    fs.writeFileSync(path.join(root, 'renderer/data/monsters/index.json'), '[]')
    const s = createLabServer({ root: process.cwd(), monstersDir: path.join(root, 'renderer/data/monsters'),
      rigsDir: path.join(root, 'renderer/render/monster-rigs'), cutsRoot: root })
    await new Promise(r => s.listen(0, r))
    const b = `http://127.0.0.1:${s.address().port}`
    const ac = new AbortController()
    try {
      const ev = await fetch(`${b}/api/events`, { signal: ac.signal })
      const reader = ev.body.getReader()
      await reader.read() // :ok
      await fetch(`${b}/api/cuts/fresh`, { method: 'PUT', body: JSON.stringify(makeBody()) })
      let text = ''
      const deadline = Date.now() + 3000
      while (!/"dir":"cuts"/.test(text) && Date.now() < deadline) {
        const { value, done } = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ done: true }), 3000))])
        if (done) break
        text += Buffer.from(value).toString()
      }
      assert.match(text, /"dir":"cuts"/)
    } finally { ac.abort(); s.close() }
  })
  it('PUT a reserved name or a bad name or a non-PNG source is refused 400', async () => {
    assert.equal((await put('dragon', makeBody())).status, 400)
    assert.equal((await put('..%2Fevil', makeBody())).status, 400)
    const b = makeBody(); b.sourcePng = 'data:image/jpeg;base64,AAAA'
    assert.equal((await put('jpg', b)).status, 400)
  })
})
