// The Warrior's gesture recogniser (spec 2a §2): while the attack is held,
// the stick's direction each tick is read as one of the screen's four
// sectors, and every change to a new sector is a move. Release classifies
// the moves into a combo. Pure: the sim and the client's predictor both run
// it, so a predicted hold spends exactly the stamina the server's does.
import { WARRIOR_COMBOS } from '../data/pvp.js'
import { spendStamina } from '../systems/stamina.js'

const ORDER = ['n', 'e', 's', 'w']
export const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' }
export const SECTOR_FACING = { n: 'north', e: 'east', s: 'south', w: 'west' }

// The unit vector of an input move (each axis clamped to -1/0/1, a diagonal
// normalised): the walk direction moveHero uses, and a hold's lockDir.
export function unitMove(move) {
  let x = Math.sign(move?.x ?? 0), y = Math.sign(move?.y ?? 0)
  if (x !== 0 && y !== 0) { x /= Math.SQRT2; y /= Math.SQRT2 }
  return { x, y }
}

// The sector a move points into: the dominant axis wins; neutral is null; a
// diagonal with equal axes keeps `prev`, so adding D to a held W changes
// nothing until W is let go.
export function sectorOf(move, prev = null) {
  const x = Math.sign(move?.x ?? 0), y = Math.sign(move?.y ?? 0)
  if (x === 0 && y === 0) return null
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'e' : 'w'
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 's' : 'n'
  return prev
}

// A fresh gesture at the press. `last` starts as the sector already held, so
// walking into the press is not itself a move — the stick must change.
export const startGesture = move => ({ moves: [], last: sectorOf(move, null), cost: 0 })

// One tick of the held attack. A move registers when the sector changes to a
// non-null sector other than the last one seen (leaving neutral included),
// costs WARRIOR_COMBOS.moveCost, and is refused when `stamina` cannot pay it.
// Past WARRIOR_COMBOS.maxMoves moves are ignored and free. `cost` is what
// this tick spends (0 or moveCost); the caller pays it.
export function stepGesture(state, move, stamina = Infinity) {
  const sector = sectorOf(move, state.last)
  const next = { moves: state.moves, last: sector, cost: 0 }
  if (sector === null || sector === state.last) return next
  if (state.moves.length >= WARRIOR_COMBOS.maxMoves) return next
  if (stamina < WARRIOR_COMBOS.moveCost) return next
  return { moves: [...state.moves, sector], last: sector, cost: WARRIOR_COMBOS.moveCost }
}

const turn = (a, b) => (ORDER.indexOf(b) - ORDER.indexOf(a) + 4) % 4

// What a release fires: { kind: 'swing' | 'lunge' | 'fence' | 'whirl', dir }
// — dir is the sector the combo aims (null for a swing: the facing held).
// d,d a lunge toward d; d,opposite(d) a fence toward d; four moves each
// turning 90° the same way round a whirlwind (aimed at its last move);
// anything else a plain swing.
export function classify(moves) {
  if (moves.length === 2 && moves[0] === moves[1]) return { kind: 'lunge', dir: moves[0] }
  if (moves.length === 2 && moves[1] === OPPOSITE[moves[0]]) return { kind: 'fence', dir: moves[0] }
  if (moves.length === 4) {
    const turns = moves.slice(1).map((m, i) => turn(moves[i], m))
    if (turns.every(t => t === 1) || turns.every(t => t === 3)) return { kind: 'whirl', dir: moves[3] }
  }
  return { kind: 'swing', dir: null }
}

export const isComboWeapon = weaponType => weaponType === WARRIOR_COMBOS.weapon

// The press: a hold begins, sliding along the move held at that moment.
export function beginHold(hero, move) {
  const { moves, last } = startGesture(move)
  hero.combo = { moves, last, lockDir: unitMove(move) }
}

// One held tick: read the stick, pay for a move that registers.
export function holdGesture(hero, move) {
  const g = stepGesture(hero.combo, move, hero.stamina ?? 0)
  hero.combo = { moves: g.moves, last: g.last, lockDir: hero.combo.lockDir }
  if (g.cost) spendStamina(hero, g.cost)
}
