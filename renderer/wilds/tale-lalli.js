// The Lalli tale (data/tales.js `lalli`), after the legend of Lalli and the
// bishop: Lalli is up a pine with the bishop's hat stuck on his head and
// mice waiting at the foot of it. Kerttu, his wife, makes a sausage of two
// cuts of raw meat; the pint is in their larder; the piper camped by the tree
// trades his flute for the two; and mice follow the flute's tune
// (systems/tune.js) wherever it goes, off the end of the pond's pier too.
//
// A module of the Wilds' own, run by wilds/tale-run.js like the quest and
// episode modules: onArrive when its village or its place enters the window,
// tick every surface frame. Everyone it puts in the world is rebuilt from
// the flags on arrival:
//   sausage_made  Kerttu has made one (she makes another if it is lost)
//   flute_given   the piper has been paid
//   mice          how many of the eight are in the pond
//   lalli_down    all eight: he is down, and the tale is done
//   axe_laid / axe_taken   his axe, laid at the foot of the pine once per world
import { TILE, weaponContents } from '../systems/entities.js'
import { makeItem, addItem, removeItem, itemFromContents } from '../systems/inventory.js'
import { tuneCarries, hasFlute } from '../systems/tune.js'
import { sfx } from '../systems/sfx.js'
import { think, speakFrom, addFloat } from '../systems/feedback.js'

export const MICE = 8
export const MEAT_FOR_SAUSAGE = 2
const AWAY = 16        // tiles from which the Lalli who climbed down is out of sight (the player sees 14)
// who a stray blow must not take out of the tale
const KEPT = new Set(['lalli_treed', 'piper', 'kerttu'])

const near = (a, b, r = 1) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= r
const poi = (ctx, label) => ctx.mapData.pois.find(p => p.label === label) ?? null
const own = (ctx, e) => e.taleKey === ctx.mapData.name
const folk = (ctx, species) => ctx.state.entities.filter(e => e.type === 'npc' && e.species === species && own(ctx, e))
const count = (player, kind) => player.inventory.find(i => i.kind === kind)?.count ?? 0
const take = (player, kind, n = 1) => { for (; n > 0; n--) removeItem(player, player.inventory.findIndex(i => i.kind === kind)) }
const lying = (ctx, weaponType) => ctx.state.entities.some(e => e.type === 'floating_item' && e.contents?.weaponType === weaponType)
const AXE = () => ({ type: 'weapon', ...weaponContents('lalli_axe') })
const FLUTE = () => ({ type: 'weapon', ...weaponContents('flute') })

// Up to n open cells within r tiles of a point, nearest first, nobody on them.
function openCells(state, at, n, r = 3) {
  const out = []
  const busy = new Set(state.entities.map(e => `${e.x},${e.y}`))
  busy.add(`${state.player.x},${state.player.y}`)
  for (let d = 0; d <= r && out.length < n; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || out.length >= n) continue
    const x = at.x + dx, y = at.y + dy, cell = state.map[y]?.[x]
    if (cell?.tile === TILE.FLOOR && !cell.overlay && !busy.has(`${x},${y}`)) out.push({ x, y })
  }
  return out
}

function person(ctx, species, at, id) {
  if (!at || ctx.state.entities.some(e => e.id === `npc:${ctx.mapData.name}:${id}`)) return
  ctx.spawn([{ kind: 'npc', species, hostile: false, id: `npc:${ctx.mapData.name}:${id}`, x: at.x, y: at.y }])
}

// The mice still to be led: eight less the drowned, at the foot of the pine.
// Returns how many it had to add.
function topUp(ctx) {
  const foot = poi(ctx, 'tree foot')
  if (!foot || ctx.flags.lalli_down) return 0
  const want = MICE - (ctx.flags.mice ?? 0) - folk(ctx, 'mouse').length
  if (want <= 0) return 0
  const spots = openCells(ctx.state, foot, want)
  ctx.runtime.mouse ??= 0
  ctx.spawn(spots.map(at => ({ kind: 'npc', species: 'mouse', id: `npc:${ctx.mapData.name}:mouse:${ctx.runtime.mouse++}`, ...at })))
  return spots.length
}

// His axe, where he dropped it, for as long as nobody has picked it up.
function layAxe(ctx) {
  const foot = poi(ctx, 'tree foot')
  if (!foot || !ctx.flags.axe_laid || ctx.flags.axe_taken || lying(ctx, 'lalli_axe')) return
  const [at] = openCells(ctx.state, foot, 1)
  if (!at) return
  ctx.spawn([{ kind: 'floating_pickup', contents: AXE(), ...at }])
  ctx.runtime.axeSeen = true
}

function handFlute(ctx) {
  const { state } = ctx
  if (!addItem(state.player, itemFromContents(FLUTE())).ok) {
    const [at] = openCells(state, state.player, 1, 2)
    ctx.spawn([{ kind: 'floating_pickup', contents: FLUTE(), ...(at ?? { x: state.player.x, y: state.player.y }) }])
  }
  sfx(state, 'pickup', { px: state.player.px, py: state.player.py })
  ctx.refreshInventory?.()
}

// The tale's people at their posts. Asked on arrival and again every tick:
// whatever a blow does to one of them, they are there the next frame, and
// Lalli is in his pine however hard he was hit.
function posts(ctx) {
  person(ctx, 'kerttu', poi(ctx, 'kerttu'), 'kerttu')
  person(ctx, 'piper', poi(ctx, 'piper camp'), 'piper')
  if (ctx.flags.lalli_down) return
  const top = poi(ctx, 'lalli tree')
  person(ctx, 'lalli_treed', top, 'lalli')
  if (!top) return
  for (const e of folk(ctx, 'lalli_treed')) {
    if (e.x === top.x && e.y === top.y && !e.knockback) continue
    Object.assign(e, { x: top.x, y: top.y, px: top.x * 32 + 16, py: top.y * 32 + 16 })
    delete e.knockback
  }
}

export function onArrive(ctx) {
  posts(ctx)
  if (ctx.flags.lalli_down) layAxe(ctx)
  else topUp(ctx)
}

function climbDown(ctx) {
  const { state } = ctx
  const foot = poi(ctx, 'tree foot')
  state.entities = state.entities.filter(e => !(own(ctx, e) && e.species === 'lalli_treed'))
  const [at] = foot ? openCells(state, foot, 1) : []
  if (at) person(ctx, 'lalli', at, 'lalli_down')
  // the axe is had once per world; a later Lalli village pays in loot (tale-run.js)
  if (ctx.special()) ctx.set('axe_laid')
  ctx.set('lalli_down')
  layAxe(ctx)
  think(state, 'He is down. The hat is not coming off.')
  sfx(state, 'key-pickup', { px: state.player.px, py: state.player.py })
  ctx.persist()
}

export function tick(ctx) {
  const { state, flags } = ctx
  const { player } = state
  posts(ctx)
  for (const e of state.entities) if (e.type === 'npc' && KEPT.has(e.species) && own(ctx, e) && e.hp < e.maxHp) e.hp = e.maxHp

  // Kerttu: two cuts of raw meat for a sausage, as often as one is needed
  const [kerttu] = folk(ctx, 'kerttu')
  const asking = !!kerttu && !flags.flute_given && near(player, kerttu) && count(player, 'meat') >= MEAT_FOR_SAUSAGE && !count(player, 'sausage')
  if (!asking) ctx.runtime.noRoom = false
  else {
    // the two cuts go first (they may be what makes room); with no room for
    // the sausage they come straight back and she says so, once per visit
    take(player, 'meat', MEAT_FOR_SAUSAGE)
    if (!addItem(player, makeItem('sausage')).ok) {
      addItem(player, makeItem('meat', MEAT_FOR_SAUSAGE))
      if (!ctx.runtime.noRoom) speakFrom(state, kerttu, 'Make room in that sack and I will make it.')
      ctx.runtime.noRoom = true
    } else {
      ctx.set('sausage_made')
      speakFrom(state, kerttu, 'There. It is all boar once it is in the skin.')
      sfx(state, 'pickup', { px: player.px, py: player.py })
      ctx.refreshInventory?.()
      ctx.persist()
    }
  }

  // the piper: his flute for the pint and the sausage together
  const [piper] = folk(ctx, 'piper')
  if (piper && near(player, piper)) {
    if (!flags.flute_given) {
      if (count(player, 'beer') && count(player, 'sausage')) {
        take(player, 'beer'); take(player, 'sausage')
        ctx.set('flute_given')
        handFlute(ctx)
        speakFrom(state, piper, 'Ah! A proper pint. Here: hold it and strike, like a sword. It plays.')
        ctx.persist()
      }
    } else if (!flags.lalli_down && !hasFlute(player) && !lying(ctx, 'flute')) {
      // the tale never dies with a lost flute
      handFlute(ctx)
      speakFrom(state, piper, 'Lost it? Ach. I have another.')
    }
  }

  if (flags.lalli_down) {
    // picked up: it was lying here and is not any more
    if (flags.axe_laid && !flags.axe_taken && poi(ctx, 'tree foot')) {
      const there = lying(ctx, 'lalli_axe')
      if (ctx.runtime.axeSeen && !there) ctx.set('axe_taken')
      ctx.runtime.axeSeen = there
    }
    // he walks home when nobody is looking: the Lalli in the village is the one who stays
    const down = state.entities.find(e => e.id === `npc:${ctx.mapData.name}:lalli_down`)
    if (down && !near(player, down, AWAY)) state.entities = state.entities.filter(e => e !== down)
    return
  }

  // the pond: a mouse at the end of the pier while a tune carries goes in
  const end = poi(ctx, 'pier end')
  if (end && tuneCarries(state)) {
    const wet = state.entities.filter(e => e.type === 'npc' && e.species === 'mouse' && e.hp > 0 && near(e, end))
    if (wet.length) {
      state.entities = state.entities.filter(e => !wet.includes(e))
      for (const m of wet) {
        sfx(state, 'sink', { px: m.px, py: m.py })
        addFloat(state.feedback, { px: m.px, py: m.py - 8, text: 'plop', kind: 'note' })
      }
      const mine = wet.filter(m => own(ctx, m)).length
      if (mine) ctx.set('mice', (flags.mice ?? 0) + mine)
    }
  }
  if ((flags.mice ?? 0) >= MICE) { climbDown(ctx); return }
  // killed, not led: there are always more
  if (topUp(ctx) && !flags.more_said) {
    ctx.set('more_said')
    think(state, 'More of them, out from under the roots. Killing them is no use.')
  }
}
