// Unit tests for server/static.js's request handler, against a fake req/res
// (no real socket needed — this only exercises the parsing/routing logic).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeStaticHandler } from '../server/static.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer')
const handler = makeStaticHandler(ROOT)

function fakeRes() {
  const res = { statusCode: null, headers: null, body: null, ended: false }
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers }
  res.end = body => { res.body = body; res.ended = true }
  return res
}

describe('makeStaticHandler', () => {
  it('serves index.html at /', async () => {
    const res = fakeRes()
    handler({ url: '/' }, res)
    // fs.readFile is async; wait for the callback to fire.
    for (let i = 0; i < 200 && !res.ended; i++) await new Promise(r => setTimeout(r, 5))
    assert.equal(res.statusCode, 200)
  })

  it('404s an unknown file', async () => {
    const res = fakeRes()
    handler({ url: '/does-not-exist.xyz' }, res)
    for (let i = 0; i < 200 && !res.ended; i++) await new Promise(r => setTimeout(r, 5))
    assert.equal(res.statusCode, 404)
  })

  it('400s a bad percent-escape', () => {
    const res = fakeRes()
    handler({ url: '/%E0' }, res)
    assert.equal(res.statusCode, 400)
  })

  it('400s an unparsable absolute-form url', () => {
    const res = fakeRes()
    handler({ url: 'http://[' }, res)
    assert.equal(res.statusCode, 400)
  })
})
