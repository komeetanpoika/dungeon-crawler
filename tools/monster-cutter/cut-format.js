// Cut-file format: role list and validation (pure, no DOM, no node: imports).
import { decodeMask } from './mask.js'

export const ROLES = ['torso', 'head', 'arm', 'leg', 'tail', 'weapon', 'extra']
const ID_RE = /^[a-z0-9_]+$/

// Returns a list of problems; empty when the cut file is valid.
export function validateCut(cut) {
  const errs = []
  if (!cut || cut.version !== 1) errs.push('version must be 1')
  if (!cut) return errs
  const pieces = Array.isArray(cut.pieces) ? cut.pieces : []
  const ids = new Set()
  for (const p of pieces) {
    if (!ID_RE.test(String(p.id))) errs.push(`piece id "${p.id}" must match ${ID_RE}`)
    if (ids.has(p.id)) errs.push(`duplicate piece id "${p.id}"`)
    ids.add(p.id)
  }
  const roots = pieces.filter(p => p.parent === null)
  if (roots.length !== 1) errs.push(`exactly one root piece is required, found ${roots.length}`)
  else if (roots[0].role !== 'torso') errs.push(`root piece "${roots[0].id}" must have role torso`)
  for (const p of pieces) {
    if (p.parent !== null && !ids.has(p.parent)) errs.push(`piece "${p.id}" has unknown parent "${p.parent}"`)
    if (!ROLES.includes(p.role)) errs.push(`piece "${p.id}" has unknown role "${p.role}"`)
    const limb = p.role === 'arm' || p.role === 'leg'
    if (limb && p.side !== 'left' && p.side !== 'right') errs.push(`piece "${p.id}" must have a side`)
    if (!limb && p.side !== null) errs.push(`piece "${p.id}" must not have a side`)
    const root = p.parent === null
    // a non-root piece with no cut is a detached blob; only the root is barred from having one
    if (root && p.cut !== null) errs.push(`root piece "${p.id}" must not have a cut`)
  }
  // cycles
  const byId = new Map(pieces.map(p => [p.id, p]))
  for (const p of pieces) {
    const seen = new Set()
    for (let q = p; q; q = byId.get(q.parent)) {
      if (seen.has(q.id)) { errs.push(`piece "${p.id}" is in a parent cycle`); break }
      seen.add(q.id)
    }
  }
  for (const [name, pt] of Object.entries(cut.points || {})) {
    if (!ids.has(pt.piece)) errs.push(`point "${name}" names unknown piece "${pt.piece}"`)
  }
  if (!Array.isArray(cut.mask) || cut.mask.reduce((a, b) => a + b, 0) !== cut.w * cut.h || decodeMask(cut.mask, cut.w * cut.h).length !== cut.w * cut.h) {
    errs.push('mask does not decode to w*h pixels')
  }
  if (cut.view !== 'front' && cut.view !== 'side') errs.push(`view must be front or side, got "${cut.view}"`)
  if (cut.faces !== 'left' && cut.faces !== 'right') errs.push(`faces must be left or right, got "${cut.faces}"`)
  return errs
}
