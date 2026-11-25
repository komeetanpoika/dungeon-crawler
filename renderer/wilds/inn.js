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
export const INN_SKINS = [...Object.values(STALL), ...HORSES, TROUGH]
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

// c: { t, put, hold, door, rng }, sites.js's: `put` lays a solid piece of
// art on cleared ground and holds it, `door` makes the door record.
export function makeInnStamps({ t, put, hold, door, rng }) {
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
  // a house always lived in (interior/versions.js) whose `kind` is the inn.
  function inn(X, Y) {
    const wall = pick(PLASTER), roof = pick(INN_ROOFS)
    const x0 = X - DOOR_COL, x1 = x0 + INN_W - 1, top = Y - INN_STOREYS - 1
    // (the city's door record goes to a record of its own, thrown away: the
    // Wilds door is made below, with the Wilds' label)
    cityHouse(grid, makeRecord(), {
      x0, x1, top, storeys: INN_STOREYS, wall, roof, door: { x: X, y: Y }, chim: x0 + 2, sign: 'inn', flowers: true,
      info: { kind: 'inn', look: LOOK },
    })
    // its second chimney, as Kalevanlinna's inn has (city/build-fixed.js)
    put(x1 - 2, top, HOUSE_FRONT.roofs[roof].chim)
    // the doorstep stays clear
    for (let i = -1; i <= 1; i++) { t.clear(X + i, Y + 1); hold(X + i, Y + 1) }
    return { x0, x1, top, door: door(X, Y, 'safe', null, { look: { ...LOOK }, lived: true, kind: 'inn' }) }
  }

  // The stable, its stalls in row Y from X eastward, w wide, under the city's
  // shingle roof: two or three of the stalls hold a horse, each facing west or
  // east, standing in the stall (the stall is its deco); the rest stand empty.
  function stable(X, Y, w) {
    const R = HOUSE_FRONT.roofs[STABLE_ROOF]
    const order = Array.from({ length: w }, (_, i) => i)
    for (let i = w - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    const horses = new Set(order.slice(0, Math.min(w, rng() < 0.5 ? 2 : 3)))
    for (let i = 0; i < w; i++) {
      const x = X + i, end = (l, m, r) => i === 0 ? l : i === w - 1 ? r : m
      put(x, Y - 2, end(R.l, R.m, R.r))
      put(x, Y - 1, end(R.el, R.em, R.er))
      const stall = end(STALL.l, STALL.m, STALL.r)
      if (horses.has(i)) { put(x, Y, pick(HORSES)); t.setDeco(x, Y, stall) } else put(x, Y, stall)
    }
    return { x0: X, x1: X + w - 1, top: Y - 2 }
  }

  return { inn, stable }
}
