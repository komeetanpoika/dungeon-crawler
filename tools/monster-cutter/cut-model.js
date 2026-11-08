// Pure edit operations on a cut (the cutter page's model). Every operation
// takes a cut and returns a new one, leaving its input untouched; given a
// valid cut it returns a valid cut, and it throws instead of returning one
// that validateCut would refuse. No DOM, no node: imports.
import { encodeMask } from './mask.js'
import { ROLES } from './cut-format.js'

const NAME_RE = /^[a-z0-9_]+$/
const LIMBS = ['arm', 'leg']
const SIDES = ['left', 'right']

// a copy whose pieces and points may be changed; the mask runs are shared (never mutated)
const edit = cut => ({ ...cut, pieces: structuredClone(cut.pieces), points: structuredClone(cut.points ?? {}) })
const ipt = ([x, y]) => [Math.round(x), Math.round(y)] // cut ends and seeds: whole pixels
const pieceOf = (cut, id) => {
  const p = cut.pieces.find(q => q.id === id)
  if (!p) throw new Error(`unknown piece "${id}"`)
  return p
}

export function newCut({ name, w, h, mask, pieces, view = 'front', faces = 'left', outHeight = 84, outline = null }) {
  const runs = ArrayBuffer.isView(mask) ? encodeMask(mask) : [...mask]
  return {
    version: 1, name, source: null, credit: null, w, h, mask: runs,
    view, faces, outHeight, outline, pieces: structuredClone(pieces), points: {},
  }
}

// end: 0 or 1, the end of the piece's cut line to move
export function moveCutEnd(cut, id, end, xy) {
  if (end !== 0 && end !== 1) throw new Error(`cut end must be 0 or 1, got ${end}`)
  const out = edit(cut), p = pieceOf(out, id)
  if (!p.cut) throw new Error(`piece "${id}" has no cut`)
  p.cut[end] = ipt(xy)
  return out
}

export function movePivot(cut, id, [x, y]) {
  const out = edit(cut)
  pieceOf(out, id).pivot = [x, y]
  return out
}

export function moveSeed(cut, id, xy) {
  const out = edit(cut)
  pieceOf(out, id).seed = ipt(xy)
  return out
}

// side is required for an arm or a leg and dropped for every other role
export function setRole(cut, id, role, side = null) {
  if (!ROLES.includes(role)) throw new Error(`unknown role "${role}"`)
  const out = edit(cut), p = pieceOf(out, id)
  if (p.parent === null && role !== 'torso') throw new Error(`the root piece "${id}" must stay the torso`)
  if (p.parent !== null && role === 'torso') throw new Error('only the root piece can be the torso')
  if (LIMBS.includes(role) && !SIDES.includes(side)) throw new Error(`a${role === 'arm' ? 'n' : ''} ${role} needs a side (left or right), got "${side}"`)
  p.role = role
  p.side = LIMBS.includes(role) ? side : null
  return out
}

// A new `extra_<n>` piece carved from parentId by the line, on the seed's side.
export function splitPiece(cut, parentId, line, seed) {
  const out = edit(cut), parent = pieceOf(out, parentId)
  const ids = new Set(out.pieces.map(p => p.id))
  let n = 1
  while (ids.has(`extra_${n}`)) n++
  const id = `extra_${n}`
  const [a, b] = [ipt(line[0]), ipt(line[1])]
  out.pieces.push({
    id, role: 'extra', side: null, parent: parentId, seed: ipt(seed), cut: [a, b],
    pivot: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], z: parent.z + 1, claims: [],
  })
  return { cut: out, id }
}

// The piece goes back into its parent: its children hang on the parent and its
// points ride the parent; its claims are dropped.
export function mergePiece(cut, id) {
  const p = pieceOf(cut, id)
  if (p.parent === null) throw new Error(`the root piece "${id}" cannot be merged`)
  const out = edit(cut)
  out.pieces = out.pieces.filter(q => q.id !== id)
  for (const q of out.pieces) if (q.parent === id) q.parent = p.parent
  for (const pt of Object.values(out.points)) if (pt.piece === id) pt.piece = p.parent
  return out
}

export function setZ(cut, id, z) {
  if (!Number.isFinite(z)) throw new Error(`z must be a number, got ${z}`)
  const out = edit(cut)
  pieceOf(out, id).z = z
  return out
}

export function addClaim(cut, id, { x, y, r }) {
  if (!(r > 0)) throw new Error(`a claim needs a positive radius, got ${r}`)
  const out = edit(cut), p = pieceOf(out, id)
  p.claims = [...(p.claims ?? []), { x: Math.round(x), y: Math.round(y), r }]
  return out
}

export function clearClaims(cut, id) {
  const out = edit(cut)
  pieceOf(out, id).claims = []
  return out
}

export function setPoint(cut, name, pieceId, [x, y]) {
  if (!NAME_RE.test(String(name))) throw new Error(`point name "${name}" must match ${NAME_RE}`)
  const out = edit(cut)
  pieceOf(out, pieceId)
  out.points[name] = { piece: pieceId, x: Math.round(x), y: Math.round(y) }
  return out
}

export function removePoint(cut, name) {
  const out = edit(cut)
  delete out.points[name]
  return out
}

export function setView(cut, view) {
  if (view !== 'front' && view !== 'side') throw new Error(`view must be front or side, got "${view}"`)
  return { ...edit(cut), view }
}

export function setFaces(cut, faces) {
  if (faces !== 'left' && faces !== 'right') throw new Error(`faces must be left or right, got "${faces}"`)
  return { ...edit(cut), faces }
}

export function setOutHeight(cut, outHeight) {
  if (!(Number.isInteger(outHeight) && outHeight > 0)) throw new Error(`output height must be a positive whole number, got ${outHeight}`)
  return { ...edit(cut), outHeight }
}

// hex: '#rgb' / '#rrggbb', or null for the automatic outline
export function setOutline(cut, hex) {
  if (hex !== null && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) throw new Error(`outline must be #rgb, #rrggbb or null, got "${hex}"`)
  return { ...edit(cut), outline: hex }
}

// mask: the w*h Uint8Array of the subject
export function setMask(cut, mask) {
  if (mask.length !== cut.w * cut.h) throw new Error(`mask has ${mask.length} pixels, the cut ${cut.w * cut.h}`)
  return { ...edit(cut), mask: encodeMask(mask) }
}

// New pieces (Auto); points on a piece that is gone move to the new root.
export function replacePieces(cut, pieces) {
  const out = edit(cut)
  out.pieces = structuredClone(pieces)
  const ids = new Set(out.pieces.map(p => p.id))
  const root = out.pieces.find(p => p.parent === null)
  for (const pt of Object.values(out.points)) if (!ids.has(pt.piece)) pt.piece = root.id
  return out
}

// A first guess at the head and chest points: the head 15% down from the top
// of the head piece (else the figure's top), the chest the same on the torso.
export function guessPoints(mask, w, h, pieces, owner) {
  const topPoint = idx => {
    let top = h, bottom = -1, x0 = w, x1 = -1
    for (let i = 0; i < w * h; i++) if (owner[i] === idx) { const y = (i / w) | 0; if (y < top) top = y; if (y > bottom) bottom = y }
    if (bottom < 0) return null
    for (let x = 0; x < w; x++) if (owner[top * w + x] === idx) { if (x < x0) x0 = x; x1 = x }
    return { x: Math.round((x0 + x1) / 2), y: Math.round(top + 0.15 * (bottom - top)) }
  }
  const figureTop = () => {
    let top = h, x0 = w, x1 = -1
    for (let i = 0; i < w * h; i++) if (mask[i]) { const y = (i / w) | 0; if (y < top) top = y }
    if (top === h) return { x: w >> 1, y: 0 }
    for (let x = 0; x < w; x++) if (mask[top * w + x]) { if (x < x0) x0 = x; x1 = x }
    return { x: Math.round((x0 + x1) / 2), y: top }
  }
  const torso = pieces.findIndex(p => p.parent === null), head = pieces.findIndex(p => p.role === 'head')
  return {
    head: { piece: pieces[head >= 0 ? head : torso].id, ...((head >= 0 && topPoint(head)) || figureTop()) },
    chest: { piece: pieces[torso].id, ...(topPoint(torso) ?? figureTop()) },
  }
}

// Claims painted over pixels whose piece (before claims, `base` from segment)
// is drawn in front of the claimer: that piece's hole shows when the claimer
// turns. -> [{ id, over }], one per claimer and covered piece.
export function behindClaims(cut, base) {
  const { w, h, pieces } = cut
  const out = []
  pieces.forEach((p, i) => {
    const over = new Set()
    for (const { x, y, r } of p.claims ?? []) {
      for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(h - 1, Math.ceil(y + r)); j++) {
        for (let k = Math.max(0, Math.floor(x - r)); k <= Math.min(w - 1, Math.ceil(x + r)); k++) {
          const b = base[j * w + k]
          if (b < 0 || b === i || (k - x) ** 2 + (j - y) ** 2 > r * r) continue
          if (pieces[b].z > p.z) over.add(pieces[b].id)
        }
      }
    }
    for (const id of over) out.push({ id: p.id, over: id })
  })
  return out
}

// The size an upload is shrunk to: at most `max` px on the long side.
export function fitSize(w, h, max = 2048) {
  const long = Math.max(w, h)
  if (long <= max) return { w, h, scale: 1 }
  const scale = max / long
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale }
}
