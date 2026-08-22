// Mobile touch layer: floating joystick + action buttons. Emits synthetic
// KeyboardEvents on window so the game's existing key listeners and keys{}
// map work unchanged. Self-gating: does nothing on fine-pointer devices.
import { joystickDirs, diffDirs } from './touch-input.js'

const NUB_RADIUS = 34   // px the nub may travel from the anchor

function initTouchControls() {
  if (!matchMedia('(pointer: coarse)').matches) return

  const held = new Set()
  const press = key => {
    if (held.has(key)) return
    held.add(key)
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  }
  const release = key => {
    if (!held.delete(key)) return
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
  }
  const releaseAll = () => { for (const k of [...held]) release(k) }

  // --- Joystick: anchor under the first touch in the zone, 8-way quantized ---
  const zone = document.getElementById('joystick-zone')
  const base = document.getElementById('joystick-base')
  const nub = document.getElementById('joystick-nub')
  let stickId = null
  let originX = 0, originY = 0
  let dirs = []

  const setDirs = next => {
    const { press: p, release: r } = diffDirs(dirs, next)
    r.forEach(release)
    p.forEach(press)
    dirs = next
  }

  zone.addEventListener('pointerdown', e => {
    if (stickId !== null) return   // one stick pointer at a time
    stickId = e.pointerId
    originX = e.clientX
    originY = e.clientY
    zone.setPointerCapture(e.pointerId)
    base.style.left = `${originX}px`
    base.style.top = `${originY}px`
    base.style.display = 'block'
    nub.style.transform = 'translate(0, 0)'
  })
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return
    const dx = e.clientX - originX
    const dy = e.clientY - originY
    const len = Math.hypot(dx, dy) || 1
    const clamp = Math.min(len, NUB_RADIUS) / len
    nub.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`
    setDirs(joystickDirs(dx, dy))
  })
  const endStick = e => {
    if (e.pointerId !== stickId) return
    stickId = null
    base.style.display = 'none'
    setDirs([])
  }
  zone.addEventListener('pointerup', endStick)
  zone.addEventListener('pointercancel', endStick)

  // --- Buttons: hold = key held; tap = short press+release (same path) ---
  const buttonResets = []
  const bindHold = (el, key) => {
    let activeId = null
    el.addEventListener('pointerdown', e => {
      if (activeId !== null) return
      activeId = e.pointerId
      el.setPointerCapture(e.pointerId)
      el.classList.add('active')
      press(key)
    })
    const end = e => {
      if (e.pointerId !== activeId) return
      activeId = null
      el.classList.remove('active')
      release(key)
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    buttonResets.push(() => { activeId = null; el.classList.remove('active') })
  }
  bindHold(document.getElementById('touch-attack'), ' ')
  bindHold(document.getElementById('touch-stance'), 'Shift')
  bindHold(document.getElementById('touch-fountain'), 'f')
  bindHold(document.getElementById('touch-bag'), 'i')
  bindHold(document.getElementById('touch-pause'), 'Escape')

  // --- Stance button doubles as a status icon. The HUD already renders the
  // active stance ('▶ ' prefix on #hud-ranged); mirror it instead of
  // reaching into game state. ---
  const rangedEl = document.getElementById('hud-ranged')
  const stanceBtn = document.getElementById('touch-stance')
  new MutationObserver(() => {
    const icon = rangedEl.textContent.startsWith('▶') ? '🏹' : '🗡'
    if (stanceBtn.textContent !== icon) stanceBtn.textContent = icon
  }).observe(rangedEl, { childList: true, characterData: true, subtree: true })

  // --- Never leave keys stuck when the page loses the pointer/focus ---
  window.addEventListener('blur', () => { stickId = null; base.style.display = 'none'; dirs = []; buttonResets.forEach(reset => reset()); releaseAll() })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stickId = null; base.style.display = 'none'; dirs = []; buttonResets.forEach(reset => reset()); releaseAll() }
  })
}

initTouchControls()
