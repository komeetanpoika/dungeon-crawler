// Six bots fight a full match headless under Node: the DOM-free check for
// renderer/pvp/sim.js, and an invariant sweep over every tick.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeMatch, stepMatch } from '../renderer/pvp/sim.js'
import { botInput } from '../renderer/pvp/bots.js'
import { PVP } from '../renderer/data/pvp.js'
import { isWalkable } from '../renderer/systems/entities.js'

describe('pvp soak', () => {
  it('six bots play a full match without breaking an invariant', () => {
    const roster = ['warrior', 'archer', 'mage', 'warrior', 'archer', 'mage'].map((cls, i) => ({ id: `b${i}`, name: `B${i}`, cls }))
    const m = makeMatch({ roster })
    const kills = []
    let ended = false
    for (let i = 0; i < Math.ceil(PVP.matchLength / PVP.tick) + 5 && !ended; i++) {
      const inputs = Object.fromEntries(m.heroes.map(h => [h.id, botInput(m, h)]))
      for (const ev of stepMatch(m, inputs, PVP.tick)) {
        if (ev.type === 'kill') kills.push(ev)
        if (ev.type === 'matchEnd') ended = true
      }
      for (const h of m.heroes) {
        assert.ok(h.hp >= 0 && h.hp <= h.maxHp, `${h.id} hp ${h.hp} out of [0, ${h.maxHp}]`)
        if (h.dead) continue
        assert.ok(h.hp > 0, `${h.id} alive at ${h.hp} hp`)
        const cell = m.map[h.y]?.[h.x]
        assert.ok(cell && isWalkable(cell.tile, cell), `${h.id} inside a wall at ${h.x},${h.y}`)
      }
    }
    assert.ok(ended, 'match never ended')
    assert.ok(kills.length > 0, 'nobody died in four minutes')
    const deaths = m.heroes.reduce((s, h) => s + h.deaths, 0)
    assert.equal(deaths, kills.length)
    const credited = kills.filter(k => k.killer).length
    const selfKills = kills.length - credited
    assert.equal(m.heroes.reduce((s, h) => s + h.kills, 0), credited - selfKills)
  })
})
