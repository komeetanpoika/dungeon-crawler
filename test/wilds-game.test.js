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
  assert.equal((SRC.match(/arriveCity\(state, wildsWorld, cityHooks, \{ fresh: true \}\)/g) ?? []).length, 3,
    'after entering, after waking, and for a window built round the stocks')
  for (const at of [...SRC.matchAll(/arriveTales\(state, wildsWorld, taleHooks(, \{ fresh: true \})?\)/g)]) {
    const next = SRC.slice(at.index, at.index + 160)
    assert.match(next, /arriveCity\(state, wildsWorld, cityHooks/, 'arriveCity follows arriveTales')
  }
  const upd = SRC.slice(SRC.indexOf('tickWilds(state, wildsWorld, delta, wildsHooks)'))
  const tales = upd.indexOf('tickTales(state, wildsWorld, delta, taleHooks)')
  assert.ok(upd.indexOf('tickCity(state, wildsWorld, delta, cityHooks)') > tales && upd.indexOf('tickCity(') < tales + 200, 'tickCity beside tickTales, on the surface')
  // the near radius comes from the real screen, at 32 px a tile
  assert.match(SRC, /viewHalf: \(\) => \(renderer \? \{ w: renderer\.viewW \/ \(2 \* TILE_SIZE\), h: renderer\.viewH \/ \(2 \* TILE_SIZE\) \}/)
  // the game's route requests stop once a millisecond is spent (the tests' go by count)
  assert.match(SRC, /now: \(\) => performance\.now\(\),\n\}/)
  // a swing, a shot and a cast each make the townsfolk flinch
  assert.equal((SRC.match(/noteCitySwing\(state, wildsWorld\)/g) ?? []).length, 3)
})

// Kalevanlinna's law (wilds/city/law.js); its behaviour is test/wilds-city-crime.test.js
test("the city's law is wired in: violence from npcStruck, the arrest's fade, a key jeers, a wake forgets", () => {
  assert.match(SRC, /import \{ cityViolence, arrest, toStocks, clearCrime \} from '\.\/wilds\/city\/law\.js'/)
  // every npc the player strikes reaches the law, with the hit path's source (the watch's own blows say 'watch')
  assert.match(SRC, /function npcStruck\(e, alive = e\.hp > 0, source = 'player'\)/)
  assert.match(SRC, /if \(e\.cityKey !== undefined && wildsWorld\) cityViolence\(state, wildsWorld, e, \{ killed: !alive, source \}\)/)
  assert.match(SRC, /npcStruck\(e, e\.hp > 0, source\)/)
  assert.match(SRC, /hurt: \(target, amount\) => hurtEntity\(target, amount, \{ source: 'watch', hitCue: null \}\)/)
  // a watchman's blow on a registry creature is not the player's: its reaction line is no thought of theirs
  const hurt = SRC.slice(SRC.indexOf('function hurtEntity('), SRC.indexOf('function hurtEntity(') + 600)
  assert.match(hurt, /if \(r\.think && source !== 'watch'\) think\(state, r\.think\)/)
  assert.doesNotMatch(hurt, /if \(r\.think\) think\(/)
  // the arrest follows the town's tick: fade, and the stocks at its darkest
  const upd = SRC.slice(SRC.indexOf('tickCity(state, wildsWorld, delta, cityHooks)'))
  assert.ok(upd.indexOf('if (state.arrest) arrest(state)') > 0 && upd.indexOf('if (state.arrest) arrest(state)') < 300, 'the arrest beside tickCity')
  assert.match(upd.slice(0, 700), /ARREST_FADE \/ 2[\s\S]*seatInStocks\(\)/)
  // the window built round the stocks when the square is beyond it: the same arrival as a wake's
  assert.match(SRC, /function seatInStocks\(\) \{[\s\S]{0,80}toStocks\(state, wildsWorld, at => \{\s*enterWilds\(state, wildsWorld, at, wildsHooks\)\s*arriveTales\(state, wildsWorld, taleHooks, \{ fresh: true \}\)\s*arriveCity\(state, wildsWorld, cityHooks, \{ fresh: true \}\)/)
  // in the stocks a key press only jeers
  assert.match(SRC, /if \(state\.player\.stocks\) \{ sfx\(state, 'jeer'[^}]*\}\); return \}\s*struggle\(state\.player\)/)
  // a wake and a load forget
  assert.equal((SRC.match(/arriveCity\(state, wildsWorld, cityHooks, \{ fresh: true \}\)\s*clearCrime\(state\)/g) ?? []).length, 2)
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

// the castle gate let down at night (wilds/city/fx.js): walking into it from
// the street says so, on a cooldown like the other blocked ways
test('walking into the shut castle gate says it is shut for the night', () => {
  assert.match(SRC, /import \{[^}]*\bisShutGate\b[^}]*\} from '.\/wilds\/city\/fx.js'/)
  const i = SRC.indexOf('isShutGate(')
  const at = SRC.slice(i - 200, i + 120)
  assert.match(at, /vy < 0 && player\.py === walkedFrom\.py/, 'pushing north and held')
  assert.match(at, /isShutGate\(map\[player\.y - 1\]\?\.\[player\.x\]\)/, 'the cell ahead is the shut gate')
  assert.match(at, /throttledThink\('castle-gate', GATE_SHUT_LINE\)/)
})

test('the city in the running game: shut doors, day counter, build at entry', () => {
  // a door's hours (the church, the keep) by the town's clock
  assert.match(SRC, /doorShut\(door, /)
  assert.match(SRC, /state\.entranceHold = true/)
  assert.match(SRC, /wildsWorld\.day\s*\+=\s*1/)
  assert.match(SRC, /import \{[^}]*\bcityFor\b[^}]*\} from '.\/wilds\/city\/build.js'/)
  // built during Wilds entry, before the window is
  assert.ok(SRC.indexOf('cityFor(wildsWorld.seed)') > 0 && SRC.indexOf('cityFor(wildsWorld.seed)') < SRC.indexOf('enterWilds(state, wildsWorld'))
  // a shut door never reaches enterHouse
  const i = SRC.indexOf('doorShut(door, ')
  assert.match(SRC.slice(i - 120, i), /cityHooks\.clock\(\)/)
  assert.match(SRC.slice(i, i + 250), /if \(shut !== null\) \{ think\(state, shut\); state\.entranceHold = true \} else \{ enterHouse\(door\); return \}/)
})
