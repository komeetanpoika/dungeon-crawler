// Smoothed visibility for creatures and the Echo: every frame a hook asks
// for a target alpha (0 or 1) and fadeA eases toward it at a fixed rate.
// Pure — no browser imports.
export function stepFade(e, target, delta, { inTime = 0.5, outTime = 0.35 } = {}) {
  if (!Number.isFinite(e.fadeA)) e.fadeA = target
  const rate = target > e.fadeA ? 1 / inTime : 1 / outTime
  const step = Math.max(-rate * delta, Math.min(rate * delta, target - e.fadeA))
  e.fadeA = Math.max(0, Math.min(1, e.fadeA + step))
  return e.fadeA
}
