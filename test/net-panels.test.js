import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeNetPanels } from '../renderer/ui/net-panels.js'

const fakeUi = () => {
  const calls = []
  const ui = {
    hide: () => calls.push('hide'), picker: () => calls.push('picker'), wait: () => calls.push('wait'),
    confirm: () => calls.push('confirm'), results: rows => calls.push(['results', rows]),
  }
  return { ui, calls }
}
const ROWS = [{ rank: 1, name: 'Aino', cls: 'mage', kills: 3, deaths: 1 }]

describe('makeNetPanels', () => {
  it('Escape opens the confirm; Stay closes it back to the bare arena', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape()
    assert.equal(p.confirming, true)
    p.stay()
    assert.equal(p.confirming, false)
    assert.deepEqual(calls, ['confirm', 'hide'])
  })
  it('a second Escape closes it too, and a third opens it again', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape(); p.escape(); p.escape()
    assert.deepEqual(calls, ['confirm', 'hide', 'confirm'])
    assert.equal(p.confirming, true)
  })
  it('Stay with no confirm open does nothing', () => {
    const { ui, calls } = fakeUi()
    makeNetPanels(ui).stay()
    assert.deepEqual(calls, [])
  })
  it('over the death picker: Escape, then Stay, brings the picker back', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.died(); p.escape(); p.stay()
    assert.deepEqual(calls, ['picker', 'confirm', 'picker'])
  })
  it('over the results: Stay brings the table back with its rows', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.matchEnd(ROWS); p.escape(); p.stay()
    assert.deepEqual(calls, [['results', ROWS], 'confirm', ['results', ROWS]])
  })
  it('a death or a match end while the confirm is open waits under it, and shows on Stay', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.escape(); p.died(); p.matchEnd(ROWS)
    assert.deepEqual(calls, ['confirm'])
    p.stay()
    assert.deepEqual(calls, ['confirm', ['results', ROWS]])
  })
  it('picking a class clears the picker; matchStart clears the results and the picker', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.died(); p.picked()
    p.died(); p.matchEnd(ROWS); p.matchStart()
    assert.deepEqual(calls, ['picker', 'hide', 'picker', ['results', ROWS], 'hide'])
  })
  it('sync backstops: ended without a matchEnd shows the wait panel; a live snapshot clears it; alive clears the picker', () => {
    const { ui, calls } = fakeUi()
    const p = makeNetPanels(ui)
    p.sync({ ended: true, dead: false })
    p.sync({ ended: true, dead: false })          // no change, no redraw
    p.sync({ ended: false, dead: false })
    p.died()
    p.sync({ ended: false, dead: true })
    p.sync({ ended: false, dead: false })
    assert.deepEqual(calls, ['wait', 'hide', 'picker', 'hide'])
  })
})

describe('after a reconnect', () => {
  it('showing names the panel that is up', () => {
    const { ui } = fakeUi()
    const p = makeNetPanels(ui)
    assert.equal(p.showing, null)
    p.died(); assert.equal(p.showing, 'picker')
    p.escape(); assert.equal(p.showing, 'confirm')
    p.stay(); p.matchEnd(ROWS); assert.equal(p.showing, 'results')
    p.matchStart(); p.sync({ ended: true, dead: false }); assert.equal(p.showing, 'wait')
  })
  it('refresh() draws again whatever the Reconnecting overlay covered: picker, results, wait, the confirm, or nothing', () => {
    const cases = [
      [p => p.died(), 'picker'],
      [p => p.matchEnd(ROWS), ['results', ROWS]],
      [p => p.sync({ ended: true, dead: false }), 'wait'],
      [p => { p.died(); p.escape() }, 'confirm'],
      [() => {}, 'hide'],
    ]
    for (const [setup, want] of cases) {
      const { ui, calls } = fakeUi()
      const p = makeNetPanels(ui)
      setup(p)
      calls.length = 0
      p.refresh()
      assert.deepEqual(calls, [want])
    }
  })
})
