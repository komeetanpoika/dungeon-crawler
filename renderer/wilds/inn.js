// The crossroads inn of the roadside (features.js ROADSIDE), as the user asked
// for it after the second playtest: larger, more guests, a stable, in
// Kalevanlinna's style. Its house is laid by the city's own house stamp
// (city/stamps.js house), so it reads like the city's houses row for row: a
// roof row with two chimneys, the eaves with a gable over the door, a storey of
// plaster with flower boxes and the inn's sign beside the door, the ground
// floor with the door in its south face; nine wide and two storeys. Beside it
// stands a stable: a roof of the city's over a row of stalls, horses standing
// in two or three of them, with a trough, hay and the cart in the yard before
// it and the stable hand by it. The innkeeper and the guests are inside
// (interior/versions.js innSpec).
//
// In the desert (sites.js `desert`) the same inn, by the same draws and on the
// same cells, is a caravanserai of the desert kit (sites.js passes it as
// `adobe`): flat roofs of mud brick over two storeys, its gateway an arch
// rising through the upper storey over the door, the inn's sign beside it;
// its stable is a pen under a shade of reeds, the same horses standing in it.
// The awnings along its front are laid once the piece is done (awnings).
// The door record, and so whoever is inside, is the same either way.
//
// The plans are laid as a farm's are (sites.js lay), in cells from the
// place's middle, as drawn or mirrored east to west, the house north or south
// of its yard; but only where one of them stands whole, moved up to INN_SHIFT
// cells either way (its ground goes with it), off every road and trail and
// the small things' ground; else sites.js lays the smaller inn of before.
// Only the `spare` things give way to a trail. Besides a farm's items they use
//   ['inn', dx, dy]        the inn's house, its door at (dx, dy), in the middle of its ground floor
//   ['stable', x, y, w]    the stable, its stalls in row y from x eastward, w wide, its roof the two rows above
// Pure: what it lays is a function of the plan and the piece's rng.
import { house as cityHouse, makeRecord } from './city/stamps.js'
import { HOUSE_FRONT, PROPS } from './city/kit.js'

export const INN_W = 9, INN_STOREYS = 2
// the ground the inn, its stable and its yard are laid on (features.js PAD.inn)
export const INN_PAD = 10
// How far either way a plan may be moved to stand whole (a farm moves at most
// sites.js FARM_SHIFT): the trails to the junction cross the ground by it, and
// a big inn finds a way between them in about 95 % of inn pieces moved up to 6.
export const INN_SHIFT = 6
const DOOR_COL = INN_W >> 1
// what the inn looks like outside, for the house built behind its door (interior/versions.js)
const LOOK = { w: INN_W, storeys: INN_STOREYS, wall: 'plaster' }
// the city's plaster fronts (city/build-blocks.js); its roofs but the shingle, which is the stable's
const PLASTER = ['white', 'ochre', 'rose', 'green']
const INN_ROOFS = ['red', 'blue', 'dark']
const STABLE_ROOF = 'brown'
// Drawn by tools/make-wilds-farm-tiles.mjs: the stalls (the first with the
// stable's west corner, the last with its east one, a partition on the west
// side of every stall but the first), a horse facing west and east, a trough.
const STALL = { l: 'ow_house_stable_l', m: 'ow_house_stable_m', r: 'ow_house_stable_r' }
const HORSES = ['ow_prop_horse_w', 'ow_prop_horse_e']
const TROUGH = 'ow_prop_trough'
// Drawn by tools/make-wilds-desert-tiles.mjs: the desert's pen, by the rows
// of the stable (its shade of reeds seen from above where the roof is, its
// fringed edge over the posts that hold it where the eaves are, and the straw
// the horses stand on for the stalls), and the awnings along the inn's front
// in two cloths (their cloth from the wall over its first row, their
// scalloped edge on poles over the next).
const PEN = {
  top: { l: 'ow_prop_pen_top_l', m: 'ow_prop_pen_top_m', r: 'ow_prop_pen_top_r' },
  front: { l: 'ow_prop_pen_front_l', m: 'ow_prop_pen_front_m', r: 'ow_prop_pen_front_r' },
  stall: { l: 'ow_prop_pen_l', m: 'ow_prop_pen_m', r: 'ow_prop_pen_r' },
}
const AWNINGS = [0, 1].map(c => ({ cloth: ['l', 'm', 'r'].map(e => `ow_prop_awning_${c}_${e}`), front: ['l', 'm', 'r'].map(e => `ow_prop_awning_${c}_front_${e}`) }))
export const INN_SKINS = [...Object.values(STALL), ...HORSES, TROUGH, ...Object.values(PEN).flatMap(Object.values), ...AWNINGS.flatMap(a => [...a.cloth, ...a.front])]
// what stands about the yard: the cart is the city's (PROPS.cart: horse west, cart east), so are the planters
const CART = PROPS.cart, PLANTER = PROPS.planter
const HAY = ['ow_prop_hay_0', 'ow_prop_hay_1']

export const INN_PLANS = [[
  // the house north of its yard, the stable east of the house
  ['inn', -3, 0], ['stable', 3, 0, 4],
  ['spare', -5, 1, PLANTER[0]], ['spare', -1, 1, PLANTER[1]], ['spare', -8, 0, 'ow_prop_woodpile'],
  ['pair', 3, 2, ...CART], ['low', 6, 1, TROUGH], ['spare', 7, -1, HAY[1]], ['low', 7, 0, HAY[0]],
  ['folk', 5, 2, 'villager'],
], [
  // the yard north of the house, the stable across it
  ['stable', -2, -4, 4], ['inn', 0, 3],
  ['spare', -2, 4, PLANTER[0]], ['spare', 2, 4, PLANTER[1]], ['spare', -5, 3, 'ow_prop_woodpile'],
  ['pair', -4, -2, ...CART], ['low', 2, -3, TROUGH], ['spare', 2, -5, HAY[1]], ['low', 2, -4, HAY[0]],
  ['folk', 0, -2, 'villager'],
]]

// The cells an inn or stable item builds on, as sites.js footprint gives
// them: `solid` stands, `step` is the doorstep kept clear.
export function innFootprint([kind, ...a]) {
  const out = []
  if (kind === 'inn') {
    const [dx, dy] = a
    for (let y = dy - INN_STOREYS - 1; y <= dy; y++) for (let i = 0; i < INN_W; i++) out.push({ x: dx - DOOR_COL + i, y, what: 'solid' })
    for (let i = -1; i <= 1; i++) out.push({ x: dx + i, y: dy + 1, what: 'step' })
  } else {
    const [x0, y, w] = a
    for (let j = y - 2; j <= y; j++) for (let i = 0; i < w; i++) out.push({ x: x0 + i, y: j, what: 'solid' })
  }
  return out
}
// The item mirrored east to west (the inn's door is in its middle).
export function innMirrored([kind, ...a]) {
  return kind === 'inn' ? [kind, -a[0], a[1]] : [kind, -(a[0] + a[2] - 1), a[1], a[2]]
}

// The caravanserai's front, column by column between its ends, the gateway in
// the middle (DOOR_COL): `win` a window, `m` a plain wall, `gate` the gateway.
const FRONT = { upper: ['win', 'win', 'm', 'gate', 'm', 'win', 'win'], ground: ['win', 'm', 'win', 'gate', 'win', 'm', 'win'] }
// What stands on its roof over the third column from each end (a hatch or a
// vent pot, the desert's chimneys), by the inn's roof draw.
const ROOF_THINGS = [['hatch', 'hatch'], ['pot', 'pot'], ['hatch', 'pot']]
// The woodwork's paint and the awnings' cloth, by the inn's wall draw (each
// pairing of the two once).
const trimOf = wi => wi % 2 ? 'stone' : 'wood', clothOf = wi => wi >> 1

// c: { t, put, hold, door, rng, adobe }, sites.js's: `put` lays a solid piece
// of art on cleared ground and holds it, `door` makes the door record;
// `adobe`: the desert kit's roofs and walls (sites.js ROOF.adobe, WALL.adobe),
// given for an inn in the desert.
export function makeInnStamps({ t, put, hold, door, rng, adobe = null }) {
  // the city's stamp lays through a grid of its own; this one is the piece's ground
  const grid = {
    prop: (x, y) => t.propAt(x, y),
    setProp: (x, y, n, walk = false) => put(x, y, n, { walkable: walk }),
    setDeco: (x, y, n) => t.setDeco(x, y, n),
    setGround: (x, y, n) => t.setGround(x, y, n),
    setTag: () => {},
  }
  const pick = list => list[Math.floor(rng() * list.length)]

  // The inn's house, its door at (X, Y). Returns its box and its door record,
  // a house always lived in (interior/versions.js) whose `kind` is the inn,
  // and in the desert the cloth of its awnings (awnings).
  function inn(X, Y) {
    const wall = pick(PLASTER), roof = pick(INN_ROOFS)
    const x0 = X - DOOR_COL, x1 = x0 + INN_W - 1, top = Y - INN_STOREYS - 1
    if (adobe) caravanserai(x0, top, X, Y, PLASTER.indexOf(wall), INN_ROOFS.indexOf(roof))
    else {
      // (the city's door record goes to a record of its own, thrown away: the
      // Wilds door is made below, with the Wilds' label)
      cityHouse(grid, makeRecord(), {
        x0, x1, top, storeys: INN_STOREYS, wall, roof, door: { x: X, y: Y }, chim: x0 + 2, sign: 'inn', flowers: true,
        info: { kind: 'inn', look: LOOK },
      })
      // its second chimney, as Kalevanlinna's inn has (city/build-fixed.js)
      put(x1 - 2, top, HOUSE_FRONT.roofs[roof].chim)
    }
    // the doorstep stays clear
    for (let i = -1; i <= 1; i++) { t.clear(X + i, Y + 1); hold(X + i, Y + 1) }
    const made = { x0, x1, top, door: door(X, Y, 'safe', null, { look: { ...LOOK }, lived: true, kind: 'inn' }) }
    if (adobe) made.cloth = clothOf(PLASTER.indexOf(wall))
    return made
  }
  // The desert's inn on the cells the city's would take, laid as the city's
  // stamp lays them (each cell put and its deco cleared, the door walkable,
  // the sign hung beside it over the wall of the storey above): the roof's
  // back row, its front row with the parapet stepped up over the gateway, the
  // upper storey and the ground floor (FRONT). `wi`, `ri`: the wall and roof draws.
  function caravanserai(x0, top, X, Y, wi, ri) {
    const R = adobe.roof.red, W = adobe.wall[trimOf(wi)], U = W.up
    const things = ROOF_THINGS[ri].map(k => adobe.roof[k === 'hatch' ? 'red' : 'blue'].chim)
    const lay = (x, y, n, walk = false) => { put(x, y, n, { walkable: walk }); t.setDeco(x, y, null) }
    const upper = { win: U.win, m: U.m, gate: U.arch }, ground = { win: W.win, m: W.m, gate: W.gate }
    for (let i = 0; i < INN_W; i++) {
      const x = x0 + i, end = (l, m, r) => i === 0 ? l : i === INN_W - 1 ? r : m
      const thing = i === 2 ? things[0] : i === INN_W - 3 ? things[1] : null
      lay(x, top, end(R.top[0], thing ?? R.top[1], R.top[2]))
      lay(x, top + 1, end(R.low[0], i === DOOR_COL ? R.gable : R.low[1], R.low[2]))
      lay(x, top + 2, end(U.l, upper[FRONT.upper[i - 1]], U.r))
      lay(x, Y, end(W.l, ground[FRONT.ground[i - 1]], W.r), i === DOOR_COL)
    }
    // the sign hangs beside the gateway, on the storey over it
    t.setDeco(X + 1, Y - 1, t.propAt(X + 1, Y - 1))
    put(X + 1, Y - 1, HOUSE_FRONT.signs.inn)
  }

  // The stable, its stalls in row Y from X eastward, w wide, under the city's
  // shingle roof: two or three of the stalls hold a horse, each facing west or
  // east, standing in the stall (the stall is its deco); the rest stand empty.
  // In the desert the pen, by the same draws: its shade of reeds over the
  // same two rows, the horses standing on its straw.
  function stable(X, Y, w) {
    const R = HOUSE_FRONT.roofs[STABLE_ROOF]
    const roof = adobe ? PEN.top : { l: R.l, m: R.m, r: R.r }, eave = adobe ? PEN.front : { l: R.el, m: R.em, r: R.er }, stalls = adobe ? PEN.stall : STALL
    const order = Array.from({ length: w }, (_, i) => i)
    for (let i = w - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    const horses = new Set(order.slice(0, Math.min(w, rng() < 0.5 ? 2 : 3)))
    for (let i = 0; i < w; i++) {
      const x = X + i, end = ({ l, m, r }) => i === 0 ? l : i === w - 1 ? r : m
      put(x, Y - 2, end(roof))
      put(x, Y - 1, end(eave))
      const stall = end(stalls)
      if (horses.has(i)) { put(x, Y, pick(HORSES)); t.setDeco(x, Y, stall) } else put(x, Y, stall)
    }
    return { x0: X, x1: X + w - 1, top: Y - 2 }
  }

  return { inn, stable }
}

// The awnings along the front of a desert inn (`h`, what inn() returned),
// laid once everything else of the piece has its place: either side of the
// doorstep, a row of cloth from the wall over a row of its scalloped edge on
// poles, before the three columns at that end, or before the two nearest the
// doorstep where three will not go (its west end and its east end then meet).
// An awning is laid only whole, where each of its cells is inside the piece,
// off the paths, not `spot` and held by nothing (but the planter beside the
// doorstep, which it takes over), and each parts no walkable ground (`parts`,
// sites.js); where none can be, what stood there stays. `held` and `hold`
// are features.js's. No draw of the piece's rng is spent.
const AWNING_WIDTHS = [3, 2]
export function awnings(t, h, { held, hold, parts, spot }) {
  const { x: X, y: Y } = h.door, A = AWNINGS[h.cloth]
  for (const side of [-1, 1]) {
    const planter = ({ x, y }) => x === X + 2 * side && y === Y + 1 && PLANTER.includes(t.propAt(x, y))
    const fits = c => t.inside(c.x, c.y) && !t.onPath(c.x, c.y) && !(c.x === spot.x && c.y === spot.y) && (planter(c) || (t.free(c.x, c.y) && !held(c.x, c.y)))
    for (const w of AWNING_WIDTHS) {
      const xs = Array.from({ length: w }, (_, i) => side < 0 ? X - 1 - w + i : X + 2 + i)
      const ends = w === 3 ? [0, 1, 2] : [0, 2]
      const cells = xs.flatMap((x, i) => [{ x, y: Y + 1, n: A.cloth[ends[i]] }, { x, y: Y + 2, n: A.front[ends[i]] }])
      if (!cells.every(fits)) continue
      // a cell at a time, all taken up again if one of them would part the ground round it
      const done = []
      for (const c of cells) {
        if (!planter(c) && parts(c.x, c.y) > 1) break
        done.push({ ...c, was: t.propAt(c.x, c.y) })
        t.setProp(c.x, c.y, c.n)
      }
      if (done.length < cells.length) {
        for (const c of done) { if (c.was) t.setProp(c.x, c.y, c.was); else t.clear(c.x, c.y) }
        continue
      }
      for (const c of cells) hold(c.x, c.y)
      break
    }
  }
}
