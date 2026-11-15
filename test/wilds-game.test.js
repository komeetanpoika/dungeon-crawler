// The Wilds wired into game.js. game.js needs a DOM, so this checks its
// source: the glue it must import and the seams it must go through. The
// behaviour itself is covered by test/wilds-world.test.js (session.js) and
// by the live driver tools/wilds/walk.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const SRC = fs.readFileSync(new URL('../renderer/game.js', import.meta.url), 'utf8')

test('game.js still parses', () => {
  execFileSync(process.execPath, ['--check', new URL('../renderer/game.js', import.meta.url).pathname])
})

test('game.js imports the Wilds glue', () => {
  for (const name of ['enterWilds', 'tickWilds', 'snapshotWilds', 'wildsRespawn', 'asleep'])
    assert.match(SRC, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from './wilds/session.js'`), `${name} not imported`)
  assert.match(SRC, /import \{[^}]*\bmakeWorld\b[^}]*\} from '.\/wilds\/world.js'/)
  assert.match(SRC, /import \{[^}]*\bWILDS_SKINS\b[^}]*\} from '.\/wilds\/terrain.js'/)
  assert.match(SRC, /\bWILDS_DEPTH\b/)
})

test('the Wilds has its own save and never writes the Adventure one', () => {
  assert.match(SRC, /saveAPI\.loadWilds\?\.\(\)/)
  assert.match(SRC, /saveAPI\.saveWilds\?\.\(savedWilds\)/)
  // persistRun picks exactly one file per mode
  const persist = SRC.slice(SRC.indexOf('function persistRun()'), SRC.indexOf('function persistIfSurface()'))
  assert.match(persist, /runMode === 'wilds'/)
  assert.match(persist, /snapshotWilds\(state, wildsWorld\)/)
})

test('the window re-centres before update reads the map, and the tile cache follows', () => {
  const update = SRC.slice(SRC.indexOf('function update(delta)'), SRC.indexOf('function render()'))
  const tick = update.indexOf('tickWilds(')
  const mapRead = update.indexOf('const { player, map } = state')
  assert.ok(tick > 0 && mapRead > 0 && tick < mapRead, 'tickWilds must run before `const { player, map } = state`')
  assert.match(update, /renderer\.rekeyTiles\(/)
  assert.match(update, /asleep\(e, player\)/)
})

test('the title offers The Wilds and the level20 cheat reaches it', () => {
  assert.match(SRC, /onWilds: \(\) => beginRun\(WILDS_DEPTH, 'wilds'\)/)
  assert.match(SRC, /mode === 'wilds' \? savedWilds/)
})

// found by the whole-branch review
test('a hit on an animal does not write the whole Wilds save', () => {
  assert.match(SRC, /npcDirty = false; if \(runMode !== 'wilds'\) persistRun\(\)/)
})

test('the Wilds caps the unfinished caves it keeps in the save, and tells the tile cache which map it replaced', () => {
  assert.match(SRC, /capInstances\(/)
  assert.match(SRC, /renderer\.rekeyTiles\(before, state\.map,/)
})

test('the game builds a camp\'s fire from its spawn', () => {
  assert.match(SRC, /case 'campfire':\s*return \[makeCampfire\(s\.x, s\.y, \{ eternal: true \}\)\]/)
})

test('the Wilds\' tiles load on entering the Wilds, not with the title', () => {
  assert.doesNotMatch(SRC, /renderer\.loadSprites\(\[[^\]]*WILDS_SKINS/, 'the title still loads the Wilds tiles')
  assert.match(SRC, /renderer\.addSprites\(WILDS_SKINS\)/)
  // beginRun waits for them before it builds the first window
  const begin = SRC.slice(SRC.indexOf('async function beginRun'), SRC.indexOf('function resumeGame'))
  assert.ok(begin.indexOf('await loadWildsSprites()') > 0 && begin.indexOf('await loadWildsSprites()') < begin.indexOf('startNewRun('))
})

test('the tales are wired in: arrival after every new window, a tick after the Wilds tick', () => {
  assert.match(SRC, /import \{ arriveTales, tickTales \} from '\.\/wilds\/tale-run\.js'/)
  const upd = SRC.slice(SRC.indexOf('tickWilds(state, wildsWorld, delta, wildsHooks)'))
  assert.ok(upd.indexOf('tickTales(state, wildsWorld, delta, taleHooks)') > 0 && upd.indexOf('tickTales(') < 900, 'tickTales does not follow tickWilds')
  assert.ok((SRC.match(/arriveTales\(state, wildsWorld, taleHooks, \{ fresh: true \}\)/g) ?? []).length >= 2, 'arriveTales after entering and after waking')
  assert.match(SRC, /if \(recentred\) [\s\S]{0,200}arriveTales\(state, wildsWorld, taleHooks\)/)
})
