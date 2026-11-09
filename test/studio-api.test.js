import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../tools/monster-studio/api.js'

const realFetch = globalThis.fetch
const stub = (status, body) => {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, ...init })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return calls
}

describe('studio api client', () => {
  afterEach(() => { globalThis.fetch = realFetch })

  it('sends JSON to the route and resolves to the body', async () => {
    const calls = stub(200, { rev: 3 })
    assert.deepEqual(await api.patchDef('big tusk', { params: { bob: 2 } }), { rev: 3 })
    assert.equal(calls[0].url, '/api/studio/drafts/big%20tusk/def')
    assert.equal(calls[0].method, 'PATCH')
    assert.equal(calls[0].headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(calls[0].body), { params: { bob: 2 } })
  })

  it('rejects a non-OK answer with the server error, status and body', async () => {
    stub(409, { error: 'changed in the game', stale: true })
    await assert.rejects(api.publish('ogre'), err => {
      assert.equal(err.message, 'changed in the game')
      assert.equal(err.status, 409)
      assert.equal(err.body.stale, true)
      return true
    })
  })

  it('GETs carry no body', async () => {
    const calls = stub(200, { name: 'big_tusk' })
    assert.deepEqual(await api.suggestName('big-tusk'), { name: 'big_tusk' })
    assert.equal(calls[0].url, '/api/studio/suggest-name?base=big-tusk')
    assert.equal(calls[0].body, undefined)
  })
})
