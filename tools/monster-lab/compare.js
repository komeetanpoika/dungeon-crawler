// tools/monster-lab/compare.js
// Pinned param snapshots rendered side by side on the SAME sim clock as the
// main stage, so variants animate in lockstep. Click a pin to restore it.
export function makePinStrip(container, getRig, getSim, onRestore) {
  const pins = []   // { params, canvas }
  const strip = container

  function pin(params) {
    const snap = JSON.parse(JSON.stringify(params))
    const canvas = document.createElement('canvas')
    canvas.width = 120; canvas.height = 120
    canvas.title = 'click: restore · right-click: remove'
    canvas.onclick = () => onRestore(JSON.parse(JSON.stringify(snap)))
    canvas.oncontextmenu = e => {
      e.preventDefault()
      const i = pins.findIndex(p => p.canvas === canvas)
      if (i >= 0) { pins.splice(i, 1); canvas.remove() }
    }
    strip.append(canvas)
    pins.push({ params: snap, canvas })
  }

  function redraw() {
    const rig = getRig(), sim = getSim()
    if (!rig) return
    for (const p of pins) {
      const ctx = p.canvas.getContext('2d')
      ctx.clearRect(0, 0, 120, 120)
      ctx.save(); ctx.translate(60, 60)
      rig.drawMonster(ctx, p.params,
        { t: sim.t, state: sim.state, stateT: sim.stateT, facing: -Math.PI / 2,
          speed01: sim.speed01, seed: sim.seed }, 24)
      ctx.restore()
    }
  }
  const loop = () => { redraw(); requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  return { pin, redraw }
}
