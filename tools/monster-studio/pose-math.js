// Which pieces can be posed, which share a joint, and what a handle drag means.
import { LIMITS } from '../../renderer/render/monster-rigs/anims.js'

const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1]

export function posablePieces(parts) {
  return (parts?.pieces ?? []).filter(p => p.rect && p.rect[2] > 0 && p.rect[3] > 0).map(p => p.id)
}

export function jointGroups(parts) {
  const posable = new Set(posablePieces(parts))
  const list = (parts?.pieces ?? []).filter(p => posable.has(p.id))
  const out = new Map()
  for (const p of list) {
    out.set(p.id, list.filter(q => q.parent === p.parent && same(q.pivot, p.pivot)).map(q => q.id))
  }
  return out
}

export function dragValues({ joint, restEnd, mouse, prevTurn = 0 }) {
  const rx = restEnd.x - joint.x, ry = restEnd.y - joint.y
  const mx = mouse.x - joint.x, my = mouse.y - joint.y
  const raw = (Math.atan2(my, mx) - Math.atan2(ry, rx)) * 180 / Math.PI
  const k = Math.round((prevTurn - raw) / 360)
  const turn = Math.min(LIMITS.turn[1], Math.max(LIMITS.turn[0], raw + 360 * k))
  const restLen = Math.hypot(rx, ry)
  const stretch = restLen === 0 ? 1
    : Math.min(LIMITS.stretch[1], Math.max(LIMITS.stretch[0], Math.hypot(mx, my) / restLen))
  return { turn, stretch }
}

// Grabbing a handle: the drag moves the dot by the pointer's travel from
// where it went down, never onto the pointer (a press can land up to the
// hit radius off the dot), and nothing moves until the pointer has left a
// small dead zone, so a plain click on a dot only selects its piece.
export const DEAD_ZONE = 3       // canvas px

export function startGrab(tip, mouse) {
  return { dx: tip.x - mouse.x, dy: tip.y - mouse.y, from: { x: mouse.x, y: mouse.y }, live: false }
}

// Where the grabbed dot is with the pointer at `mouse`, or null while a
// grab that has not gone live is still inside the dead zone.
export function grabPoint(grab, mouse, deadZone = DEAD_ZONE) {
  if (!grab.live && Math.hypot(mouse.x - grab.from.x, mouse.y - grab.from.y) < deadZone) return null
  return { x: mouse.x + grab.dx, y: mouse.y + grab.dy }
}
