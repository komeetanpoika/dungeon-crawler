import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// Load the real preload.cjs against a stand-in electron module.
const ipc = new EventEmitter()
ipc.invoke = async () => null
let api = null
before(() => {
  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true,
    exports: { contextBridge: { exposeInMainWorld: (_k, v) => { api = v } }, ipcRenderer: ipc } }
  require('../preload.cjs')
})

describe('preload: bench file changes', () => {
  it('a change that arrives before the bench subscribes is delivered on subscribe', () => {
    ipc.emit('bench-files-changed', {}, 'renderer/systems/monsters/x.js')
    const got = []
    api.onBenchFilesChanged(rel => got.push(rel))
    assert.deepEqual(got, ['renderer/systems/monsters/x.js'])
    ipc.emit('bench-files-changed', {}, 'renderer/data/monsters/x.json')
    assert.deepEqual(got, ['renderer/systems/monsters/x.js', 'renderer/data/monsters/x.json'])
  })
})
