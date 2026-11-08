import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { watchTree } = createRequire(import.meta.url)('../tools/monster-bench/watcher.cjs')

const tick = ms => new Promise(r => setTimeout(r, ms))
async function until(pred, ms = 3000) {
  for (let t = 0; t < ms; t += 25) { if (pred()) return true; await tick(25) }
  return false
}
// The bench's Save and the Edit tool both write a temp file and rename it
// over the original — the case Electron's Node 20 recursive watch loses.
function atomic(file, text) { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file) }

describe('watchTree', () => {
  let w = null
  afterEach(() => { w?.close(); w = null })
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'))
    fs.mkdirSync(path.join(root, 'sub'))
    fs.writeFileSync(path.join(root, 'sub', 'm.json'), '1')
    return root
  }
  const count = (events, rel) => events.filter(e => e === rel).length

  it('reports every atomic replace of the same file, not just the first', async () => {
    const root = setup(), events = []
    w = watchTree(root, rel => events.push(rel))
    await tick(50)
    atomic(path.join(root, 'sub', 'm.json'), '2')
    assert.ok(await until(() => count(events, 'sub/m.json') >= 1), JSON.stringify(events))
    const seen = count(events, 'sub/m.json')
    atomic(path.join(root, 'sub', 'm.json'), '3')
    assert.ok(await until(() => count(events, 'sub/m.json') > seen), JSON.stringify(events))
    const seen2 = count(events, 'sub/m.json')
    fs.writeFileSync(path.join(root, 'sub', 'm.json'), '4')
    assert.ok(await until(() => count(events, 'sub/m.json') > seen2), JSON.stringify(events))
  })
  it('watches a directory created after it started', async () => {
    const root = setup(), events = []
    w = watchTree(root, rel => events.push(rel))
    fs.mkdirSync(path.join(root, 'later'))
    await tick(100)
    fs.writeFileSync(path.join(root, 'later', 'x.js'), 'a')
    assert.ok(await until(() => events.includes('later/x.js')), JSON.stringify(events))
  })
  it('a removed directory does not throw and the rest keeps reporting', async () => {
    const root = setup(), events = [], errors = []
    w = watchTree(root, rel => events.push(rel), { onError: e => errors.push(e) })
    fs.rmSync(path.join(root, 'sub'), { recursive: true })
    await tick(100)
    fs.writeFileSync(path.join(root, 'top.js'), 'a')
    assert.ok(await until(() => events.includes('top.js')), JSON.stringify(events))
  })
})
