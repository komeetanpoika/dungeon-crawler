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
