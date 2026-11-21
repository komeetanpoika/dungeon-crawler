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
  // the house interiors' tiles come with them, not with the title either
  assert.doesNotMatch(SRC, /renderer\.loadSprites\(\[[^\]]*INTERIOR_SKINS/, 'the title loads the interior tiles')
  assert.match(SRC, /renderer\.addSprites\(\[\.\.\.WILDS_SKINS, \.\.\.INTERIOR_SKINS\]\)/)
  // beginRun waits for them before it builds the first window
  const begin = SRC.slice(SRC.indexOf('async function beginRun'), SRC.indexOf('function resumeGame'))
  assert.ok(begin.indexOf('await loadWildsSprites()') > 0 && begin.indexOf('await loadWildsSprites()') < begin.indexOf('startNewRun('))
})

test('the tales are wired in: arrival after every new window, a tick after the Wilds tick', () => {
  assert.match(SRC, /import \{ arriveTales, tickTales, storyEpisode \} from '\.\/wilds\/tale-run\.js'/)
  const upd = SRC.slice(SRC.indexOf('tickWilds(state, wildsWorld, delta, wildsHooks)'))
  assert.ok(upd.indexOf('tickTales(state, wildsWorld, delta, taleHooks)') > 0 && upd.indexOf('tickTales(') < 900, 'tickTales does not follow tickWilds')
  assert.ok((SRC.match(/arriveTales\(state, wildsWorld, taleHooks, \{ fresh: true \}\)/g) ?? []).length >= 2, 'arriveTales after entering and after waking')
  assert.match(SRC, /if \(recentred\) [\s\S]{0,200}arriveTales\(state, wildsWorld, taleHooks\)/)
})

test('the city runtime is wired in beside the tales, with the screen and the swing', () => {
  assert.match(SRC, /import \{ arriveCity, tickCity, noteCitySwing \} from '\.\/wilds\/city\/runtime\.js'/)
  // every arrival of the tales is one of the city's too: entering, waking, every re-centre
  assert.equal((SRC.match(/arriveCity\(state, wildsWorld, cityHooks, \{ fresh: true \}\)/g) ?? []).length, 2, 'after entering and after waking')
  for (const at of [...SRC.matchAll(/arriveTales\(state, wildsWorld, taleHooks(, \{ fresh: true \})?\)/g)]) {
    const next = SRC.slice(at.index, at.index + 160)
    assert.match(next, /arriveCity\(state, wildsWorld, cityHooks/, 'arriveCity follows arriveTales')
  }
  const upd = SRC.slice(SRC.indexOf('tickWilds(state, wildsWorld, delta, wildsHooks)'))
  const tales = upd.indexOf('tickTales(state, wildsWorld, delta, taleHooks)')
  assert.ok(upd.indexOf('tickCity(state, wildsWorld, delta, cityHooks)') > tales && upd.indexOf('tickCity(') < tales + 200, 'tickCity beside tickTales, on the surface')
  // the near radius comes from the real screen, at 32 px a tile
  assert.match(SRC, /viewHalf: \(\) => \(renderer \? \{ w: renderer\.viewW \/ \(2 \* TILE_SIZE\), h: renderer\.viewH \/ \(2 \* TILE_SIZE\) \}/)
  // a swing, a shot and a cast each make the townsfolk flinch
  assert.equal((SRC.match(/noteCitySwing\(state, wildsWorld\)/g) ?? []).length, 3)
})

test('a story house in the Wilds takes its things from the tale', () => {
  assert.match(SRC, /storyEpisode\(wildsWorld, door\)/)
  assert.match(SRC, /save: \(\) => activeSave/)
})

test("Tapio's peace: wolves are built calm for a player who has it", () => {
  assert.match(SRC, /s\.species === 'wolf' && hasTalent\(player, 'tapio_peace'\)/)
})

test('sinituli: a fire the player builds is blue, and its light mends', () => {
  assert.match(SRC, /hasTalent\(state\.player, 'sinituli'\)\) fire\.blue = true/)
  assert.match(SRC, /tickBlueRest\(state, delta\)/)
})

test('the title: Adventure is the Wilds, PvP arena is online play on the web and a local match on the desktop', () => {
  const title = SRC.slice(SRC.indexOf('menu.showTitle(meta, {'), SRC.indexOf('menu.showTitle(meta, {') + 700)
  assert.match(title, /onWilds: \(\) => beginRun\(WILDS_DEPTH, 'wilds'\)/)
  assert.match(title, /onPvpArena: \(\) => \(window\.saveAPI\?\.isWeb \? goOnline\(\) : goPvpPicker\(\)\)/)
  assert.ok(!/onTimewarp|onAdventure/.test(title), 'the old modes are still wired to the title')
  assert.ok(!SRC.includes('Loading the Wilds'), 'the player still reads "the Wilds" as the mode\'s name')
})

test('the flute plays instead of striking, and its tune is ticked every frame', () => {
  assert.match(SRC, /import \{[^}]*\bplayTune\b[^}]*\btickTune\b[^}]*\} from '.\/systems\/tune.js'/)
  const swing = SRC.slice(SRC.indexOf('const swing = (mods) => {'), SRC.indexOf("sfx(state, 'melee-swing'"))
  assert.match(swing, /if \(wpn\.tune\) \{[^}]*playTune\(state\)[^}]*return/s, 'the flute must return before any stamina is spent or blow dealt')
  assert.ok(swing.indexOf('wpn.tune') < swing.indexOf('meleeCost('), 'the flute costs no stamina')
  assert.match(SRC, /tickTune\(state, delta\)/)
})

// found by the step-3 review: an offhand dagger took every second press and stabbed the mice being led
test('with the flute in hand the off hand never swings', () => {
  assert.match(SRC, /const offBlade = off\?\.kind === 'weapon' && !isChargeWeapon\(meleeWT\) && !player\.weapon\?\.tune \? off : null/)
})

test('the city in the running game: closed doors, day counter, build at entry', () => {
  assert.match(SRC, /door\.closed/)
  assert.match(SRC, /state\.entranceHold = true/)
  assert.match(SRC, /wildsWorld\.day\s*\+=\s*1/)
  assert.match(SRC, /import \{[^}]*\bcityFor\b[^}]*\} from '.\/wilds\/city\/build.js'/)
  // built during Wilds entry, before the window is
  assert.ok(SRC.indexOf('cityFor(wildsWorld.seed)') > 0 && SRC.indexOf('cityFor(wildsWorld.seed)') < SRC.indexOf('enterWilds(state, wildsWorld'))
  // a closed door never reaches enterHouse
  const i = SRC.indexOf('door.closed')
  assert.match(SRC.slice(i, i + 200), /else \{ enterHouse\(door\); return \}/)
})
