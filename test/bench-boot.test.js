import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { benchNameFrom, benchQuery } = createRequire(import.meta.url)('../tools/monster-bench/argv.cjs')

describe('bench argv', () => {
  it('reads a valid bench name', () => {
    const argv = ['electron', '.', '--bench', 'glorp']
    assert.equal(benchNameFrom(argv), 'glorp')
    assert.equal(benchQuery(argv), 'bench=glorp&dcdebug=1')
  })
  it('rejects a bad or missing bench name', () => {
    assert.equal(benchNameFrom(['electron', '.', '--bench', '../x']), null)
    assert.equal(benchNameFrom(['electron', '.', '--bench']), null)
    assert.equal(benchQuery(['electron', '.', '--bench', '../x']), undefined)
  })
  it('keeps --dcdebug alone working', () => {
    assert.equal(benchQuery(['electron', '.', '--dcdebug']), 'dcdebug=1')
  })
  it('no flags: undefined', () => {
    assert.equal(benchQuery(['electron', '.']), undefined)
  })
})
