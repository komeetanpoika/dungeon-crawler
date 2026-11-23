// Kalevanlinna's skeleton, laid the same in every world: the wall and its
// towers and gates, the harbour, the streets and the square, the castle, the
// church with its green and churchyard, the inn, the smithy, the barracks,
// the fish market, the warehouses and the windmill (PLAN in plan.js says
// where). Then, after the blocks are in, what dresses the streets: lamps,
// benches, stalls and kerbs.
import { PLAN, wallCells, insideWalls, streetCellsById, towerRect } from './plan.js'
import { HARBOUR, PROPS, PAVE, CASTLE, HOUSE_FRONT } from './kit.js'
import { hashInt } from '../rand.js'
import { DAY } from './schedule.js'
import {
  N, TAG, lay, pave, cobble, flag, alley, squareStone, wallRun, towerJoins, tower, harbourTower, gateArch, gateSide,
  house, stall, windmill, lamp, bench, keep, church, addDoor,
} from './stamps.js'

const K = (x, y) => y * N + x
const MAIN = ['north', 'west', 'east', 'quay', 'castle']
const GRASS = (x, y) => ['ow_grass_0', 'ow_grass_0', 'ow_grass_0', 'ow_grass_1'][hashInt(0, x, y, 7) % 4]
const FLOWERS = ['ow_deco_flower_0', 'ow_deco_flower_1', 'ow_deco_flower_2', 'ow_deco_flower_3']
const GRAVES = ['ow_prop_grave_0', 'ow_prop_grave_1', 'ow_prop_grave_2', 'ow_prop_grave_3', 'ow_prop_cross_0', 'ow_prop_cross_1']
const rect = (x0, y0, x1, y1, fn) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y) }

// The castle's own wall, a tile inside its plot so its towers stay on it.
const CASTLE_WALL = { x0: 105, y0: 25, x1: 135, y1: 55, gate: 110 }

export function layFixed(G, rec) {
  const P = PLAN.places
  // everything inside the wall starts as bare paving
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (insideWalls(x, y)) pave(G, x, y, flag(x, y))

  // ---- streets and the square ----
  for (const [id, set] of streetCellsById()) for (const k of set) {
    const x = k % N, y = (k - x) / N
    pave(G, x, y, MAIN.includes(id) ? cobble(x, y) : flag(x, y))
  }
  const sq = P.square
  rect(sq.x0, sq.y0, sq.x1, sq.y1, (x, y) => pave(G, x, y, squareStone(x, y)))

  layHarbour(G, rec)
  layWalls(G)
  layCastle(G, rec)
  layChurch(G, rec)
  layPlaces(G, rec)
  for (const p of PLAN.posts) rec.spots[p.id] = { x: p.x, y: p.y }
  Object.assign(rec.spots, {
    'gate-N-in': { x: 80, y: 23 }, 'gate-N-out': { x: 80, y: 18 },
    'gate-W-in': { x: 22, y: 68 }, 'gate-W-out': { x: 18, y: 68 },
    'gate-E-in': { x: 138, y: 75 }, 'gate-E-out': { x: 142, y: 75 },
  })
}

// ---- the wall ----------------------------------------------------------------------
function layWalls(G) {
  const walls = wallCells()
  const towers = new Set()
  for (const t of PLAN.towers) { const r = towerRect(t); rect(r.x0, r.y0, r.x1, r.y1, (a, b) => towers.add(K(a, b))) }
  // no face falls on a gate: its arch, and the north gate's lower row
  const gates = new Set()
  for (const g of [...Object.values(PLAN.gates), ...PLAN.waterGates]) for (let d = -1; d <= 1; d++) gates.add(g.dir === 'N' ? K(g.x + d, g.y) : K(g.x, g.y + d))
  for (let d = -1; d <= 1; d++) gates.add(K(PLAN.gates.N.x + d, PLAN.gates.N.y + 1))
  wallRun(G, walls, towers, (x, y) => gates.has(K(x, y)))
  const mouth = PLAN.harbour.mouth
  // the wall runs on behind each tower it meets, gates counting as wall
  const masonry = new Set([...walls, ...gates])
  for (const t of PLAN.towers) {
    const r = towerRect(t)
    const joins = towerJoins(masonry, towers, t.x, t.y, r.y0, r.y1)
    if (t.y === mouth.y && (t.x < mouth.x0 || t.x > mouth.x1)) harbourTower(G, t.x, t.y, joins, r.body)
    else tower(G, t.x, t.y, t.kind === 'round' ? 'round3' : 'square3', r.body, joins)
  }
  // the water gates' passage on the plain mole (the mossy one's moss would show through the arches)
  for (const g of PLAN.waterGates) gateSide(G, g.x, g.y, () => HARBOUR.mole[0])
  gateArch(G, PLAN.gates.N.x, PLAN.gates.N.y)
  gateSide(G, PLAN.gates.W.x, PLAN.gates.W.y)
  gateSide(G, PLAN.gates.E.x, PLAN.gates.E.y)
}

// ---- the harbour ---------------------------------------------------------------------
function layHarbour(G, rec) {
  const { basin, mouth, piers } = PLAN.harbour
  const water = (x, y) => lay(G, x, y, null, { ground: ['ow_water_0', 'ow_water_1'][(x + y) & 1] })
  rect(basin.x0, basin.y0, basin.x1, basin.y1, water)
  for (let x = mouth.x0; x <= mouth.x1; x++) {
    water(x, mouth.y)
    const C = HARBOUR.chain
    G.setProp(x, mouth.y, x === mouth.x0 ? C.l : x === mouth.x1 ? C.r : (x - mouth.x0) % 6 === 3 ? C.float : C.m)
  }
  const pierX = new Set(piers.map(p => p.x))
  // the wharf along the basin's head, the quay wall below it, the moles down its sides
  for (let x = basin.x0; x <= basin.x1; x++) {
    pave(G, x, basin.y0 - 1, HARBOUR.quay.s)
    if (!pierX.has(x)) lay(G, x, basin.y0, HARBOUR.face, { ground: 'ow_water_0' })
  }
  for (let y = basin.y0; y < mouth.y; y++) { pave(G, basin.x0 - 1, y, HARBOUR.quay.e); pave(G, basin.x1 + 1, y, HARBOUR.quay.w) }
  piers.forEach((p, i) => {
    for (let y = p.y0; y <= p.y1; y++) lay(G, p.x, y, 'ow_pier_log_v', { walk: true, ground: 'ow_water_0' })
    rec.spots[`quay-${i + 1}`] = { x: p.x, y: p.y1 }
  })
  // boats moored beside the piers
  for (const [x, y] of [[66, 111], [70, 116], [78, 109], [82, 113], [90, 119], [94, 110], [70, 128], [88, 131]]) lay(G, x, y, 'ow_boat', { ground: 'ow_water_0' })
  for (const x of [67, 73, 85, 91]) lay(G, x, basin.y0 - 1, HARBOUR.bollard, { ground: HARBOUR.quay.s })

  // the fish market on the quay: Granny Pohjanen's herring stall in the middle
  const fm = PLAN.places.fishMarket
  rect(fm.x0, fm.y0, fm.x1, fm.y1, (x, y) => pave(G, x, y, flag(x, y)))
  stall(G, 70, 100, 'blue'); stall(G, 67, 100, 'red'); stall(G, 73, 100, 'green')
  lay(G, 71, 101, 'ow_prop_barrel_0'); lay(G, 68, 101, PROPS.produce[2])
  lay(G, fm.x0, fm.y0, PROPS.netRack[0]); lay(G, fm.x0 + 1, fm.y0, PROPS.netRack[1])
  lay(G, fm.x1 - 1, fm.y0, PROPS.netRack[0]); lay(G, fm.x1, fm.y0, PROPS.netRack[1])
  lay(G, fm.x1, fm.y1 - 1, PROPS.crates[0]); lay(G, fm.x0, fm.y1 - 1, PROPS.barrels[1])
  rec.spots['fish-market'] = { x: 70, y: 102 }
  // warehouses facing the wharf
  const wh = PLAN.places.warehouses
  for (const [x0, x1] of [[wh.x0, wh.x0 + 5], [wh.x1 - 5, wh.x1]]) {
    const dx = x0 + 2
    house(G, rec, { x0, x1, top: wh.y0, storeys: 3, roofRows: 3, wall: 'stone', roof: 'dark', door: { x: dx, y: wh.y1 }, chim: null, gable: false,
      info: { kind: 'warehouse', look: { w: 5, storeys: 2, wall: 'stone' } } })
  }
  rect(wh.x0 + 6, wh.y0, wh.x1 - 6, wh.y1, (x, y) => pave(G, x, y, alley(x, y)))
}

// ---- the castle ------------------------------------------------------------------------
function layCastle(G, rec) {
  const C = CASTLE_WALL, P = PLAN.places
  const walls = new Set(), towers = new Set(), gate = new Set()
  rect(C.x0, C.y0, C.x1, C.y0, (x, y) => walls.add(K(x, y))); rect(C.x0, C.y1, C.x1, C.y1, (x, y) => walls.add(K(x, y)))
  rect(C.x0, C.y0, C.x0, C.y1, (x, y) => walls.add(K(x, y))); rect(C.x1, C.y0, C.x1, C.y1, (x, y) => walls.add(K(x, y)))
  for (let d = -1; d <= 1; d++) { walls.delete(K(C.gate + d, C.y1)); gate.add(K(C.gate + d, C.y1)); gate.add(K(C.gate + d, C.y1 + 1)) }
  const tw = [[C.x0, C.y0], [C.x1, C.y0], [C.x0, C.y1], [C.x1, C.y1], [C.gate - 3, C.y1], [C.gate + 3, C.y1], [120, C.y0], [C.x0, 40], [C.x1, 40]]
  // a tower on the north or south wall is a row taller (plan.js towerRect)
  const bodyOf = y => y === C.y0 || y === C.y1 ? 1 : 0
  for (const [x, y] of tw) rect(x - 1, y - 1 - bodyOf(y), x + 1, y + 1, (a, b) => { towers.add(K(a, b)); walls.add(K(a, b)) })
  // the courtyard
  rect(C.x0 + 1, C.y0 + 1, C.x1 - 1, C.y1 - 1, (x, y) => pave(G, x, y, flag(x, y)))
  wallRun(G, walls, towers, (x, y) => gate.has(K(x, y)))
  const masonry = new Set([...walls, ...gate])
  for (const [x, y] of tw) {
    const joins = towerJoins(masonry, towers, x, y, y - 1 - bodyOf(y), y + 1)
    tower(G, x, y, x === C.x0 || x === C.x1 ? 'round3' : 'square3', bodyOf(y), joins)
  }
  // the gate: walked through on the street's cobbles, the portcullis up; at
  // night fx.js lets it down (gateShut), the art and the way with it
  CASTLE.gate2Open.forEach((r, j) => r.forEach((n, i) => lay(G, C.gate - 1 + i, C.y1 + j, n, { walk: true, ground: cobble(C.gate - 1 + i, C.y1 + j) })))
  // the keep at the head of the courtyard: its door open by day
  // (interior/buildings/castle.js), barred at night
  const k = P.keep
  const kd = keep(G, k.x0 + 3, k.y1, k.x1 - k.x0 - 5).door
  // the double door: either half opens it (one record, two cells)
  addDoor(rec, kd.x, kd.y, {
    kind: 'castle', look: { w: 5, storeys: 2, wall: 'stone' }, building: 'castle', span: 2,
    hours: { from: DAY.dawn, to: DAY.night, shut: 'The keep is barred for the night.' },
  })
  G.setWalk(kd.x, kd.y, true); G.setWalk(kd.x + 1, kd.y, true)
  rect(k.x0 + 5, k.y1 + 1, k.x0 + 8, C.y1 - 2, (x, y) => pave(G, x, y, cobble(x, y)))
  // and a cobbled walk from the gate along the garden's south edge to it: the
  // street graph (streets.js lanes are paving) takes the Count home this way
  rect(C.gate - 1, C.y1 - 4, C.gate + 1, C.y1 - 1, (x, y) => pave(G, x, y, cobble(x, y)))
  rect(C.gate + 2, C.y1 - 4, k.x0 + 4, C.y1 - 3, (x, y) => pave(G, x, y, cobble(x, y)))
  // the Count's garden: beds, trees and benches west of the courtyard
  rect(C.x0 + 2, 40, C.x0 + 10, 50, (x, y) => pave(G, x, y, GRASS(x, y)))
  for (const [bx, by] of [[C.x0 + 3, 41], [C.x0 + 7, 41], [C.x0 + 3, 47], [C.x0 + 7, 47]])
    PROPS.bed.forEach((r, j) => r.forEach((n, i) => lay(G, bx + i, by + j, n)))
  for (const [x, y] of [[C.x0 + 2, 40], [C.x0 + 10, 40], [C.x0 + 2, 50], [C.x0 + 10, 50], [C.x0 + 6, 45]]) lay(G, x, y, 'ow_tree_small')
  bench(G, C.x0 + 4, 45); bench(G, C.x0 + 8, 45)
  lay(G, C.x1 - 3, C.y1 - 3, PROPS.well[0]); lay(G, C.x1 - 3, C.y1 - 2, PROPS.well[1])
}

// ---- the church, its green and its churchyard ----------------------------------------------
function layChurch(G, rec) {
  const P = PLAN.places
  const d = P.churchDoor
  // behind the church, and the green in front of it, grass and trees
  rect(P.belltower.x0, P.church.y0, P.church.x1, P.church.y1, (x, y) => pave(G, x, y, GRASS(x, y)))
  const c = church(G, P.church.x0, d.y, P.church.x1 - P.church.x0 - 1, d.x)
  for (const [x, y] of [[29, 57], [36, 56], [44, 57], [50, 59]]) lay(G, x, y, 'ow_tree_small')
  // open by day (interior/buildings/church.js), locked at night
  // its double door: either half opens it (one record, two cells)
  addDoor(rec, d.x, d.y, {
    kind: 'church', look: { w: 5, storeys: 2, wall: 'stone' }, building: 'church', span: 2,
    hours: { from: DAY.dawn, to: DAY.dusk, shut: 'The church is locked for the night.' },
  })
  G.setWalk(d.x, d.y, true); G.setWalk(d.x + 1, d.y, true)
  rec.spots['church-door'] = { x: d.x, y: d.y + 1 }
  rec.spots['church-steps'] = { x: d.x + 3, y: d.y + 2 }
  rec.spots.bell = { x: c.bell.x, y: c.bell.y }
  const g = P.green
  rect(g.x0, g.y0, g.x1, g.y1, (x, y) => pave(G, x, y, GRASS(x, y)))
  for (const [x, y] of [[g.x0, g.y0], [g.x1, g.y0], [g.x0, g.y1 - 1], [g.x1, g.y1 - 1], [g.x0 + 4, g.y0 + 2]]) lay(G, x, y, (x + y) % 2 ? 'ow_tree_small' : 'ow_tree_apple')
  bench(G, g.x0 + 2, g.y0 + 5); bench(G, g.x1 - 2, g.y0 + 5)
  rec.spots['bench-g1'] = { x: g.x0 + 2, y: g.y0 + 6 }; rec.spots['bench-g2'] = { x: g.x1 - 2, y: g.y0 + 6 }
  for (const [x, y] of [[g.x0 + 1, g.y1], [g.x1 - 1, g.y1]]) lay(G, x, y, PROPS.planter[(x + y) & 1])
  for (let i = 0; i < 6; i++) { const x = g.x0 + 1 + (i * 3) % 7, y = g.y0 + 3 + ((i * 5) % 6); if (!G.prop(x, y)) G.setProp(x, y, FLOWERS[i % 4], true) }
  // the churchyard: a fence with its gate towards the church door, graves in rows
  const cy = P.churchyard
  rect(cy.x0, cy.y0, cy.x1, cy.y1, (x, y) => pave(G, x, y, GRASS(x, y)))
  const gx = d.x
  for (let x = cy.x0; x <= cy.x1; x++) {
    if (x === gx || x === gx + 1) continue
    lay(G, x, cy.y0, x === cy.x0 ? 'ow_fence_l' : x === cy.x1 ? 'ow_fence_r' : x === gx + 2 ? 'ow_fence_end_l' : x === gx - 1 ? 'ow_fence_end_r' : 'ow_fence_m')
    lay(G, x, cy.y1, x === cy.x0 ? 'ow_fence_bl' : x === cy.x1 ? 'ow_fence_br' : 'ow_fence_m')
  }
  for (let y = cy.y0 + 1; y < cy.y1; y++) { lay(G, cy.x0, y, 'ow_fence_side_l'); lay(G, cy.x1, y, 'ow_fence_side_r') }
  for (let y = cy.y0 + 2; y < cy.y1 - 1; y += 2) for (let x = cy.x0 + 2; x < cy.x1 - 1; x += 2) {
    if (Math.abs(x - gx) <= 1) continue
    if (hashInt(0, x, y, 31) % 5) lay(G, x, y, GRAVES[hashInt(0, x, y, 32) % GRAVES.length])
  }
  for (const [x, y] of [[cy.x0 + 1, cy.y1 - 1], [cy.x1 - 1, cy.y0 + 1], [cy.x1 - 1, cy.y1 - 1]]) lay(G, x, y, 'ow_tree_small')
}

// ---- the square's buildings, the barracks, the mill -------------------------------------------
function layPlaces(G, rec) {
  const P = PLAN.places
  // the Golden Pike on the north side of the square, its yard behind
  const inn = P.inn
  rect(inn.x0, inn.y0, inn.x1, inn.y1, (x, y) => pave(G, x, y, alley(x, y)))
  house(G, rec, { x0: inn.x0, x1: inn.x1, top: inn.door.y - 4, storeys: 3, wall: 'ochre', roof: 'red', door: inn.door, chim: inn.x0 + 2, sign: 'inn', flowers: true,
    info: { kind: 'inn', look: { w: 5, storeys: 3, wall: 'plaster' } } })
  const innLabel = rec.doors[rec.doors.length - 1].label
  lay(G, inn.x1 - 2, inn.door.y - 4, HOUSE_FRONT.roofs.red.chim); rec.chimneys.push({ x: inn.x1 - 2, y: inn.door.y - 4, door: innLabel })
  lay(G, inn.x0 + 1, inn.y0 + 1, PROPS.well[0]); lay(G, inn.x0 + 1, inn.y0 + 2, PROPS.well[1])
  lay(G, inn.x0 + 4, inn.y0 + 1, PROPS.cart[0]); lay(G, inn.x0 + 5, inn.y0 + 1, PROPS.cart[1])
  lay(G, inn.x1 - 1, inn.y0, 'ow_prop_woodpile'); lay(G, inn.x1, inn.y0, PROPS.barrels[0]); lay(G, inn.x1, inn.y0 + 1, PROPS.barrels[1])
  rec.spots['inn-door'] = { x: inn.door.x, y: inn.door.y + 1 }
  rec.inn = { door: { ...inn.door }, doorstep: { x: inn.door.x, y: inn.door.y + 1 } }

  // Seppo's smithy on the east side of the square, its work yard open to it
  const sm = P.smithy
  rect(sm.x0, sm.y0, sm.x1, sm.y1, (x, y) => pave(G, x, y, alley(x, y)))
  house(G, rec, { x0: sm.x0, x1: sm.x1, top: sm.y0, storeys: 2, wall: 'stone', roof: 'dark', door: { x: sm.x0 + 3, y: sm.y0 + 3 }, chim: sm.x0 + 1, sign: 'smith',
    info: { kind: 'smithy', look: { w: 5, storeys: 2, wall: 'stone' } } })
  lay(G, sm.x1 - 1, sm.y0 + 5, PROPS.forge); lay(G, sm.x0 + 3, sm.y0 + 5, PROPS.anvil)
  lay(G, sm.x1, sm.y1, 'ow_prop_woodpile'); lay(G, sm.x1, sm.y0 + 4, PROPS.barrels[1])
  rec.spots['smithy-anvil'] = { x: sm.x0 + 2, y: sm.y0 + 5 }

  // the barracks by the north gate, its roof to the street along the wall and
  // its door on the drill yard behind, the yard open to that street by a
  // paved way down the barracks' east end
  const br = P.barracks
  rect(br.x0, br.y0, br.x1, br.y1, (x, y) => pave(G, x, y, flag(x, y)))
  const hx1 = br.x1 - 2, bx = (br.x0 + hx1) >> 1
  house(G, rec, { x0: br.x0, x1: hx1, top: br.y0, storeys: 2, wall: 'stone', roof: 'dark', door: { x: bx, y: br.y0 + 3 }, chim: br.x0 + 2,
    info: { kind: 'barracks', look: { w: 5, storeys: 2, wall: 'stone' } } })
  lay(G, br.x0 + 2, br.y1 - 1, 'ow_prop_target'); lay(G, br.x1 - 2, br.y1 - 1, 'ow_prop_target')
  lay(G, br.x1, br.y0 + 6, PROPS.barrels[0]); lay(G, br.x0, br.y0 + 4, PROPS.crates[1])
  rec.spots['barracks-door'] = { x: bx, y: br.y0 + 4 }

  // the square: the dry Sampo fountain, the crier's box, the stocks
  const f = P.fountain
  lay(G, f.x, f.y, PROPS.fountain.empty, { ground: squareStone(f.x, f.y) })
  for (const [x, y] of [[f.x - 1, f.y - 1], [f.x + 1, f.y - 1], [f.x - 1, f.y + 1], [f.x + 1, f.y + 1]]) lay(G, x, y, PROPS.planter[(x + y) & 1])
  rec.spots.fountain = { x: f.x, y: f.y + 1 }
  lay(G, P.crier.x, P.crier.y, PROPS.crier, { walk: true })
  rec.spots.crier = { x: P.crier.x, y: P.crier.y }
  lay(G, P.stocks.x, P.stocks.y, PROPS.stocks)
  rec.spots.stocks = { x: P.stocks.x, y: P.stocks.y + 1 }

  // the windmill in the crafts quarter
  windmill(G, P.windmill.x, P.windmill.y)
}

// ---- dressing, once the blocks are in ----------------------------------------------------------
export function layDressing(G, rec) {
  const P = PLAN.places, sq = P.square
  const streets = streetCellsById()
  const mainCell = new Set(MAIN.flatMap(id => [...streets.get(id)]))
  const doorAt = new Set(rec.doors.map(d => K(d.x, d.y)))
  const isStreet = (x, y) => mainCell.has(K(x, y)) || (x >= sq.x0 && x <= sq.x1 && y >= sq.y0 && y <= sq.y1)
  // a lamp or a bench may stand where it shuts nobody out: every open cell beside it is street
  const free = (x, y) => isStreet(x, y) && G.walkable(x, y) && !G.prop(x, y) && !doorAt.has(K(x, y)) && !Object.values(rec.spots).some(s => s.x === x && s.y === y) &&
    [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !G.walkable(x + dx, y + dy) || (isStreet(x + dx, y + dy) && !doorAt.has(K(x + dx, y + dy))))

  // stalls round the edge of the square, each with its seller's spot in front
  let n = 0
  const colours = ['red', 'green', 'blue']
  const stallAt = (x, y) => {
    if (![[x, y], [x, y + 1], [x, y + 2]].every(([a, b]) => free(a, b) || (b === y + 2 && G.walkable(a, b) && !G.prop(a, b)))) return
    stall(G, x, y, colours[n % 3]); n++
    rec.spots[`stall-${n}`] = { x, y: y + 2 }
    if (n % 3 === 1 && free(x + 1, y + 1)) lay(G, x + 1, y + 1, PROPS.produce[n % 3])
  }
  for (const x of [64, 66, 74, 76, 85, 87, 89, 91, 93]) stallAt(x, sq.y0 + 1)
  for (const x of [64, 66, 68, 70, 72, 74, 84, 86, 88, 90, 92]) stallAt(x, sq.y1 - 4)
  // benches about the fountain, facing south, a spot in front of each
  let b = 0
  for (const [x, y] of [[75, 77], [83, 77], [72, 72], [86, 74], [76, 66], [84, 66]]) {
    if (!free(x, y) || !G.walkable(x, y + 1)) continue
    bench(G, x, y); b++
    rec.spots[`bench-${b}`] = { x, y: y + 1 }
  }
  for (const [k, s] of Object.entries(rec.spots)) if (/^bench-g/.test(k)) { b++; rec.spots[`bench-${b}`] = s; delete rec.spots[k] }
  // lamps every seven tiles along the main streets, and round the square
  const placeAlong = cells => {
    let last = -99
    cells.forEach((c, i) => { if (i - last >= 7 && free(c[0], c[1])) { lamp(G, rec, c[0], c[1]); last = i } })
  }
  const line = (x0, y0, x1, y1) => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]); return out }
  placeAlong(line(79, 24, 79, 58)); placeAlong(line(81, 27, 81, 58))
  placeAlong(line(24, 67, 60, 67)); placeAlong(line(27, 69, 60, 69))
  placeAlong(line(98, 74, 137, 74)); placeAlong(line(101, 76, 137, 76))
  placeAlong(line(78, 88, 78, 102)); placeAlong(line(80, 91, 80, 102))
  placeAlong(line(109, 59, 109, 72)); placeAlong(line(111, 62, 111, 72))
  placeAlong([...line(sq.x0, sq.y0, sq.x1, sq.y0), ...line(sq.x1, sq.y0 + 1, sq.x1, sq.y1), ...line(sq.x0, sq.y1, sq.x1 - 1, sq.y1).reverse(), ...line(sq.x0, sq.y0 + 1, sq.x0, sq.y1 - 1).reverse()])
  // kerbs where a main street meets a building, and a drain here and there
  for (const k of mainCell) {
    const x = k % N, y = (k - x) / N
    if (!G.walkable(x, y) || G.prop(x, y) || !G.ground(x, y)?.startsWith('ow_city_pave_cobble')) continue
    const closed = ([dx, dy]) => !G.walkable(x + dx, y + dy) && G.tagAt(x + dx, y + dy) === TAG.CITY && !isStreet(x + dx, y + dy)
    const side = [['n', [0, -1]], ['s', [0, 1]], ['w', [-1, 0]], ['e', [1, 0]]].find(([, d]) => closed(d))
    if (side) G.setGround(x, y, PAVE.kerb[side[0]])
    else if (hashInt(0, x, y, 9) % 41 === 0) G.setGround(x, y, PAVE.drain)
  }
}
