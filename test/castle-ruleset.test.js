import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { candidatesForRole, rulesetHasOverlays } from '../renderer/systems/decorate.js'

const rulesets = JSON.parse(
  readFileSync(new URL('../renderer/data/rulesets.json', import.meta.url), 'utf8'))
const castle = rulesets.castle

describe('castle ruleset (derived from castle-demo painting)', () => {
  it('exists in rulesets.json', () => {
    assert.ok(castle, "run: node tools/derive-castle-ruleset.mjs")
  })

  it('offers floor and wall candidates to decorateMap', () => {
    assert.ok(candidatesForRole(castle, 'floor').length >= 4)
    assert.ok(candidatesForRole(castle, 'wall').length >= 10)
  })

  it('carries an overlay distribution', () => {
    assert.equal(rulesetHasOverlays(castle), true)
  })

  it('every tile has an existing sprite and weight >= 1', () => {
    assert.ok(Object.keys(castle.tiles).length > 0)
    for (const [name, def] of Object.entries(castle.tiles)) {
      const png = fileURLToPath(new URL(`../renderer/assets/tiles/${name}.png`, import.meta.url))
      assert.ok(existsSync(png), `sprite missing: ${name}.png`)
      assert.ok((def.weight ?? 0) >= 1, `zero weight: ${name}`)
    }
  })

  it('does not disturb the other rulesets', () => {
    for (const key of ['catacombs', 'outdoors']) {
      assert.ok(rulesets[key], `ruleset '${key}' should still exist`)
    }
  })
})
