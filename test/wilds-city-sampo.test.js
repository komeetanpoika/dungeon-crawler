// The Sampo of Kalevanlinna, part 1 (wilds/city/sampo.js, sampo-run.js): the
// story's record in the world, what the town says at each stage, the crier's
// call, the Count's and the smith's tellings, the look under the lid's rim
// and the smith's gift.
//
// Entities are compared by identity with assert.ok(a === b), never with
// assert.equal(a, b) (a city npc's ai.goals reaches the whole city).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stageOf, tellingFor, namedLines, luckLine, crierItem, loadSampo, LID_TILE, LID_REMARK, GIFT, GIFT_TOAST } from '../renderer/wilds/city/sampo.js'
import { startTelling, tickSampo, TELL_REACH } from '../renderer/wilds/city/sampo-run.js'
import { linesFor } from '../renderer/wilds/city/lines.js'
import { crierNews, datedNews, STOCKS_NEWS } from '../renderer/wilds/city/crier.js'
import { arriveCity, tickCity } from '../renderer/wilds/city/runtime.js'
import { cityFor } from '../renderer/wilds/city/build.js'
import { cityCtx } from '../renderer/wilds/city/walkers.js'
import { makeWorld, exportWorld, GEN } from '../renderer/wilds/world.js'
import { enterWilds } from '../renderer/wilds/session.js'
import { buildBuilding } from '../renderer/interior/buildings/index.js'
import { makeNpc, interactNpc } from '../renderer/systems/npc.js'
import { makeFeedback, tickFeedback, sayDuration, BUBBLE_DUR } from '../renderer/systems/feedback.js'
import { isWalkable } from '../renderer/systems/entities.js'
import { DAY_LENGTH } from '../renderer/data/weather.js'

const SEED = 7
const S = 32
const DT = 0.05
const folk = cityCtx(cityFor(SEED), SEED).folk
const who = id => folk.find(p => p.id === `named:${id}`)
const day = quest => ({ night: false, crime: 'calm', quest })
const withFlags = (...flags) => { const w = makeWorld(null, { seed: SEED }); for (const f of flags) w.sampo.flags[f] = true; return w }

test('the story has a record in the world, kept in a save and across a generator change', () => {
  const world = makeWorld(null, { seed: SEED })
  assert.deepEqual(world.sampo, { flags: {} })
  assert.equal(stageOf(world), 'luck')
  assert.equal(stageOf(withFlags('heard')), 'heard')
  assert.equal(stageOf(withFlags('heard', 'mark')), 'mark')
  assert.equal(stageOf(withFlags('heard', 'mark', 'smith', 'gift')), 'pieces')
  assert.equal(stageOf({}), null, 'a world without the record tells no story')
  world.sampo.flags.heard = true; world.sampo.flags.mark = true
  const saved = JSON.parse(JSON.stringify(exportWorld(world)))
  assert.deepEqual(makeWorld(saved).sampo, { flags: { heard: true, mark: true } })
  assert.deepEqual(makeWorld({ ...saved, gen: GEN - 1 }).sampo, { flags: { heard: true, mark: true } }, 'an old generator\'s save keeps the story')
  // a save from before the story, and a broken one
  const { sampo, ...old } = saved
  assert.deepEqual(makeWorld(old).sampo, { flags: {} })
  assert.deepEqual(loadSampo({ flags: { heard: 'yes', smith: true, nonsense: true } }), { flags: { smith: true } })
  assert.deepEqual(loadSampo([1, 2]), { flags: {} })
})

test('what the town says follows the story', () => {
  const isLine = l => typeof l === 'string' && l.length > 0 && /[.!?]$/.test(l)
  for (const stage of ['luck', 'heard', 'mark', 'pieces']) {
    for (const id of ['count', 'seppo', 'pohjanen', 'vaino', 'vicar']) {
      const lines = linesFor(who(id), day(stage))
      assert.ok(lines.length >= 1 && lines.every(isLine), `${id} at ${stage}`)
      const own = namedLines(id, stage)
      if (own) assert.deepEqual(lines, own)
      else assert.deepEqual(lines, linesFor(who(id), day(null)), `${id} at ${stage}: their everyday lines`)
    }
  }
  assert.deepEqual(linesFor(who('count'), day(null)), [], 'without the story the Count answers nothing')
  assert.ok(linesFor(who('pohjanen'), day('luck')).some(l => /castle/.test(l)), 'Granny Pohjanen sends a newcomer to the castle')
  assert.ok(linesFor(who('pohjanen'), day('heard')).some(l => /rim/.test(l)), '... and then to the rim')
  assert.ok(linesFor(who('seppo'), day('pieces')).some(l => /sea/.test(l) && /mountain/.test(l) && /marsh/.test(l)), 'Seppo repeats the three places')
  // every grown townsperson has a word about the dim Sampo by day; children, the watch and the night do not
  const tf = (job, temperament, age = 'adult') => ({ id: 'tf:1', job, temperament, age })
  for (const t of ['cheerful', 'gruff', 'shy', 'chatty']) {
    const lines = linesFor(tf('baker', t), day('luck'))
    assert.deepEqual(lines, [...linesFor(tf('baker', t), day(null)), luckLine(t)])
    assert.ok(/Sampo|fountain/i.test(luckLine(t)) && isLine(luckLine(t)))
  }
  assert.deepEqual(linesFor(tf('child', 'shy', 'child'), day('luck')), linesFor(tf('child', 'shy', 'child'), day(null)))
  assert.deepEqual(linesFor(tf('watch', 'gruff'), day('luck')), linesFor(tf('watch', 'gruff'), day(null)))
  assert.deepEqual(linesFor(tf('baker', 'shy'), { night: true, crime: 'calm', quest: 'luck' }), linesFor(tf('baker', 'shy'), { night: true, crime: 'calm' }))
  // a warned player hears wary lines whatever the story
  assert.deepEqual(linesFor(who('seppo'), { night: false, crime: 'warned', quest: 'pieces' }), linesFor(who('seppo'), { night: false, crime: 'warned' }))
})

test('the crier calls the Count\'s reward first, and the story as it goes', () => {
  const world = makeWorld(null, { seed: SEED })
  const news = crierNews(world, SEED, 2)
  assert.equal(news.length, 4, 'the Sampo, the market, the weather and a townsperson')
  assert.equal(news[0], crierItem(world))
  assert.ok(/Sampo/.test(news[0]) && /reward/.test(news[0]) && /castle/.test(news[0]), news[0])
  assert.ok(news[0].length <= 15 * 7, 'short enough to stay up while it is read (feedback.js SAY_MAX)')
  assert.deepEqual(datedNews(world, 2), [news[0]], 'his first call of every day until the Count is heard')
  world.stocksDay = 1
  assert.deepEqual(datedNews(world, 2), [news[0], STOCKS_NEWS])
  assert.equal(crierNews(world, SEED, 2).filter(l => l === news[0]).length, 1, 'once in the round')
  world.sampo.flags.heard = true
  assert.deepEqual(datedNews(world, 2), [STOCKS_NEWS], 'the Count heard: the round carries it')
  assert.ok(/reward stands/.test(crierNews(world, SEED, 2)[0]))
  world.sampo.flags.mark = true; world.sampo.flags.smith = true
  assert.ok(/three lost pieces/.test(crierNews(world, SEED, 2)[0]))
  for (const stage of [[], ['heard'], ['heard', 'mark'], ['heard', 'mark', 'smith']]) {
    const l = crierItem(withFlags(...stage))
    assert.ok(l.startsWith('Hear ye! ') && l.length <= 15 * 7, `short enough to read while it is up: ${l}`)
  }
})

test('who has something to tell, and when', () => {
  assert.equal(tellingFor('named:count', {}), null)
  const fresh = makeWorld(null, { seed: SEED })
  assert.equal(tellingFor('named:count', fresh).sets, 'heard')
  assert.equal(tellingFor('named:seppo', fresh), null, 'the smith owns up to nothing unasked')
  assert.equal(tellingFor('named:seppo', withFlags('heard')), null)
  assert.equal(tellingFor('named:count', withFlags('heard')), null, 'the Count says it once')
  const seppo = tellingFor('named:seppo', withFlags('heard', 'mark'))
  assert.equal(seppo.sets, 'smith')
  assert.ok(seppo.lines.some(l => /sea/.test(l) && /mountain/.test(l) && /marsh/.test(l)), 'he names the three places')
  assert.equal(tellingFor('named:seppo', withFlags('heard', 'mark', 'smith')), null)
  assert.equal(tellingFor('named:pohjanen', withFlags('heard', 'mark')), null)
})

// ---- at play: a bare floor with the teller on it ----------------------------------------

const FLOOR = 1
const room = (w = 12, h = 8) => Array.from({ length: h }, () => Array.from({ length: w }, () => ({ tile: FLOOR })))
function stage(world, id, { building = false } = {}) {
  const e = makeNpc({ species: 'townsfolk', id, x: 5, y: 3 })
  const state = {
    player: { x: 5, y: 4, px: 5 * S + 16, py: 4 * S + 16 }, entities: [e], feedback: makeFeedback(), map: room(),
    ...(building && { cave: { building: { floors: new Map(), at: 'hall' } } }),
  }
  const saves = []
  const hooks = { spawn: spawns => spawns.map(s => ({ type: 'floating_item', contents: s.contents, x: s.x, y: s.y })), persist: () => saves.push({ ...world.sampo.flags }) }
  const tick = (seconds, each) => { for (let t = 0; t < seconds - 1e-9; t += DT) { tickSampo(state, world, DT, hooks); tickFeedback(state.feedback, DT); each?.() } }
  return { state, e, hooks, saves, tick }
}

test('the Count tells of the lid: line by line, each up long enough to read, then the story moves', () => {
  const world = makeWorld(null, { seed: SEED })
  const { state, e, saves, tick } = stage(world, 'named:count', { building: true })
  const telling = tellingFor('named:count', world)
  assert.equal(startTelling(state, e, world), true)
  assert.equal(startTelling(state, e, world), true, 'asking again mid-telling neither restarts nor says an everyday line')
  const seen = []
  let gaps = 0
  tick(telling.lines.reduce((a, l) => a + sayDuration(l), 0) + 1, () => {
    const b = state.feedback.bubble
    if (b && b.anchorId === e.id) { if (seen.at(-1) !== b.text) seen.push(b.text) } else if (state.telling) gaps++
    if (state.telling && state.telling.i < telling.lines.length - 1) assert.equal(world.sampo.flags.heard, undefined, 'not told before the last line')
  })
  assert.deepEqual(seen, [...telling.lines], 'every line, in order')
  assert.ok(gaps <= telling.lines.length, `the bubble stays up through a line (${gaps} frames without)`)
  assert.equal(world.sampo.flags.heard, true)
  assert.equal(state.telling, null)
  assert.deepEqual(saves, [{ heard: true }], 'the game is saved as the story moves')
  assert.equal(startTelling(state, e, world), false, 'told once')
})

test('a telling stops when the player walks off, and begins anew', () => {
  const world = withFlags('heard', 'mark')
  const { state, e, tick } = stage(world, 'named:seppo')
  assert.equal(startTelling(state, e, world), true)
  tick(1)
  assert.equal(state.telling.i, 0)
  state.player.x = e.x + TELL_REACH + 1
  tick(DT)
  assert.equal(state.telling, null)
  assert.equal(state.feedback.bubble, null, 'his line goes with him')
  assert.equal(world.sampo.flags.smith, undefined)
  state.player.x = e.x
  assert.equal(startTelling(state, e, world), true)
  tick(DT)
  assert.equal(state.feedback.bubble.text, tellingFor('named:seppo', world).lines[0], 'from the beginning')
  // a teller struck down or gone says no more
  state.entities.length = 0
  tick(DT)
  assert.equal(state.telling, null)
  // nobody tells a warned player anything
  state.entities.push(e)
  state.cityRun = { crime: { level: 'warned' }, people: new Map() }
  assert.equal(startTelling(state, e, world), false)
})

test('the mark under the rim: seen from square beside the lid, once the Count has said to look', () => {
  const world = makeWorld(null, { seed: SEED })
  const { state, saves, tick } = stage(world, 'named:count', { building: true })
  state.map[3][6].overlay = LID_TILE   // beside the throne, as in the great hall
  state.player.x = 6; state.player.y = 4
  tick(DT)
  assert.equal(world.sampo.flags.mark, undefined, 'nothing to look for yet')
  world.sampo.flags.heard = true
  state.player.x = 5   // before the throne: cornerwise to the lid
  tick(DT)
  assert.equal(world.sampo.flags.mark, undefined, 'not from before the throne')
  state.player.x = 6
  state.feedback.bubble = { text: 'Someone is speaking.', kind: 'speech', t: 0 }
  tick(DT)
  assert.equal(world.sampo.flags.mark, undefined, 'not over someone\'s words')
  tick(BUBBLE_DUR)
  assert.equal(world.sampo.flags.mark, true)
  assert.equal(state.feedback.bubble.text, LID_REMARK)
  assert.equal(state.feedback.bubble.kind, 'thought')
  assert.deepEqual(saves, [{ heard: true, mark: true }])
  tick(3)
  assert.ok(state.feedback.bubble?.text === LID_REMARK, 'the thought stays up long enough to read')
  // in the street a tile of that name is nothing
  const out = stage(withFlags('heard'), 'named:count')
  out.state.map[3][6].overlay = LID_TILE; out.state.player.x = 6
  out.tick(DT)
  assert.equal(out.state.feedback.bubble, null)
})

test('the great hall has the lid where the player can stand square beside it', () => {
  const b = buildBuilding('castle', { seed: 3, people: [] })
  const hall = b.floors.find(f => f.id === 'hall')
  const at = []
  hall.map.forEach((row, y) => row.forEach((c, x) => { if (c?.overlay === LID_TILE) at.push({ x, y }) }))
  assert.equal(at.length, 1, 'one lid')
  const beside = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => hall.map[at[0].y + dy]?.[at[0].x + dx]).filter(c => c && isWalkable(c.tile, c))
  assert.ok(beside.length >= 1, 'a cell to stand on square beside it')
})

test('Seppo owns up, the town hears of it, and he hands over a sword', () => {
  const world = withFlags('heard', 'mark')
  const { state, e, saves, tick } = stage(world, 'named:seppo')
  const telling = tellingFor('named:seppo', world)
  assert.equal(startTelling(state, e, world), true)
  const total = telling.lines.reduce((a, l) => a + sayDuration(l), 0)
  tick(total - 1)
  assert.equal(world.sampo.flags.smith, true, 'told as the last line begins')
  assert.equal(world.sampo.flags.gift, undefined, 'the sword when he has finished')
  assert.equal(state.entities.length, 1)
  tick(2)
  assert.equal(world.sampo.flags.gift, true)
  const sword = state.entities.find(x => x.type === 'floating_item')
  assert.ok(sword && sword.contents.type === 'weapon' && sword.contents.weaponType === GIFT, JSON.stringify(sword?.contents))
  assert.ok(Math.max(Math.abs(sword.x - state.player.x), Math.abs(sword.y - state.player.y)) === 1, 'beside the player')
  assert.ok(!(sword.x === e.x && sword.y === e.y), 'not under the smith')
  assert.deepEqual(state.feedback.toasts, [GIFT_TOAST], 'the three places on a toast')
  assert.deepEqual(saves.at(-1), { heard: true, mark: true, smith: true, gift: true })
  tick(1)
  assert.equal(state.entities.filter(x => x.type === 'floating_item').length, 1, 'one sword a world')
  assert.equal(crierItem(world), crierNews(world, SEED, 0)[0])
})

// ---- in the town --------------------------------------------------------------------

test('in the town: Seppo at his anvil denies it, then owns up, and says the three places after', () => {
  const world = withFlags('heard')
  const state = {
    player: { x: 0, y: 0, px: 0, py: 0, hp: 5, maxHp: 5, facing: 'south' }, entities: [], projectiles: [], zones: [],
    fireZones: [], lightning: [], strikes: [], shockwaves: [], arcs: [], hitEffects: [], feedback: makeFeedback(),
    caveInstances: {}, sfx: { cues: [], muted: false },
  }
  const buildEntities = spawns => spawns.flatMap(s => {
    if (s.kind === 'npc') { const n = makeNpc(s); if (n && s.lines) n.lines = s.lines; return n ? [n] : [] }
    return [{ type: s.kind === 'floating_pickup' ? 'floating_item' : s.kind, contents: s.contents, x: s.x, y: s.y, px: s.x * S + 16, py: s.y * S + 16 }]
  })
  enterWilds(state, world, { X: 99, Y: 229 }, { buildEntities })   // two steps south of the anvil
  const hooks = { spawn: spawns => buildEntities(spawns), clock: () => 0.4 * DAY_LENGTH, day: () => 0, viewHalf: () => ({ w: 20, h: 12 }), sfx: () => {}, hurt: () => {} }
  arriveCity(state, world, hooks, { fresh: true })
  const w = state.cityRun.people.get('named:seppo')
  assert.ok(w.mode === 'near' && w.entity, 'the smith is at his anvil in the morning')
  assert.equal(state.cityRun.quest, 'heard')
  assert.deepEqual(w.entity.lines, namedLines('seppo', 'heard'))
  assert.equal(startTelling(state, w.entity, world), false, 'nothing to own up to yet')
  assert.ok(interactNpc(state, w.entity, () => 0)?.text.includes('Never seen it'))
  world.sampo.flags.mark = true
  state.player.x = w.entity.x; state.player.y = w.entity.y + 1
  assert.equal(startTelling(state, w.entity, world), true)
  const sampoHooks = { spawn: hooks.spawn, persist: () => {} }
  for (let t = 0; t < 60 && !world.sampo.flags.gift; t += DT) {
    tickSampo(state, world, DT, sampoHooks)
    tickCity(state, world, DT, hooks)
    tickFeedback(state.feedback, DT)
    state.sfx.cues = []
  }
  assert.equal(world.sampo.flags.smith, true)
  assert.equal(world.sampo.flags.gift, true)
  assert.equal(state.cityRun.quest, 'pieces')
  assert.deepEqual(w.lines, namedLines('seppo', 'pieces'), 'the street follows the story')
  if (w.entity) assert.ok(w.entity.lines === w.lines)
  assert.deepEqual(state.cityRun.people.get('named:pohjanen').lines, namedLines('pohjanen', 'pieces'))
})
