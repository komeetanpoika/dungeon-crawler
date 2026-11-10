import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { browserCommand } from '../tools/monster-studio/open-browser.mjs'

describe('open-browser', () => {
  it('picks the Windows browser on WSL, open on mac, xdg-open with a display, nothing headless', () => {
    assert.deepEqual(browserCommand({ platform: 'linux', env: {}, procVersion: 'Linux 6.6 microsoft-standard-WSL2' }).bin, 'cmd.exe')
    assert.equal(browserCommand({ platform: 'darwin', env: {}, procVersion: '' }).bin, 'open')
    assert.equal(browserCommand({ platform: 'linux', env: { DISPLAY: ':0' }, procVersion: 'Linux' }).bin, 'xdg-open')
    assert.equal(browserCommand({ platform: 'linux', env: {}, procVersion: 'Linux' }), null)
  })
})
