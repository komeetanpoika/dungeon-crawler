// tools/monster-lab/stage.js
// Preview canvas + pose simulator. Runs its own rAF loop; renders the current
// rig with the current params at the sim's pose. Backdrop and collision
// overlay are toggles. Pure UI — persistence lives in io.js.
const STATES = ['idle', 'walk', 'attack', 'hit', 'death']

export function makeStage(canvas, simBar) {
  const ctx = canvas.getContext('2d')
  const st = { rig: null, params: {}, half: 8, zoom: 2, backdrop: true, overlay: false,
               sim: { state: 'idle', speed01: 0, seed: 7, paused: false, t: 0, stateT: 0 } }

  // sim bar: state buttons, speed slider, seed reroll, pause
  for (const s of STATES) {
    const b = document.createElement('button')
    b.textContent = s
    b.onclick = () => { st.sim.state = s; st.sim.stateT = 0; refresh() }
    b.dataset.state = s
    simBar.append(b)
  }
  const speed = Object.assign(document.createElement('input'),
    { type: 'range', min: 0, max: 1, step: 0.05, value: 0, title: 'speed01' })
  speed.oninput = () => { st.sim.speed01 = Number(speed.value) }
  const reroll = Object.assign(document.createElement('button'), { textContent: '🎲 seed' })
  reroll.onclick = () => { st.sim.seed = Math.floor(Math.random() * 1024) }
  const pause = Object.assign(document.createElement('button'), { textContent: '⏸' })
  pause.onclick = () => { st.sim.paused = !st.sim.paused; pause.textContent = st.sim.paused ? '▶' : '⏸' }
  simBar.append(speed, reroll, pause)
  const refresh = () => { for (const b of simBar.querySelectorAll('button[data-state]'))
    b.classList.toggle('active', b.dataset.state === st.sim.state) }
  refresh()

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    if (!st.sim.paused) { st.sim.t += dt; st.sim.stateT += dt }
    const S = 32 * st.zoom, W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    if (st.backdrop) {                       // simple checker floor
      for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) {
        ctx.fillStyle = ((x + y) / S) % 2 ? '#2a2d33' : '#26292f'
        ctx.fillRect(x, y, S, S)
      }
    }
    if (st.rig) {
      ctx.save(); ctx.translate(W / 2, H / 2)
      st.rig.drawMonster(ctx, st.params,
        { t: st.sim.t, state: st.sim.state, stateT: st.sim.stateT,
          facing: -Math.PI / 2, speed01: st.sim.state === 'walk' ? Math.max(0.6, st.sim.speed01) : st.sim.speed01,
          seed: st.sim.seed }, S)
      ctx.restore()
    }
    if (st.overlay) {
      ctx.strokeStyle = '#4caf50'; ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.arc(W / 2, H / 2, st.half * st.zoom, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    sim: st.sim,
    setRig: mod => { st.rig = mod },
    setParams: p => { st.params = p },
    setHalf: n => { st.half = n },
    set zoom(z) { st.zoom = z }, get zoom() { return st.zoom },
    set backdrop(v) { st.backdrop = v }, set overlay(v) { st.overlay = v },
  }
}
