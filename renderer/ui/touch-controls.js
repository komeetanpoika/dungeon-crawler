// Mobile touch layer: fixed thumbstick + diamond action cluster + start/
// select pills. Emits synthetic KeyboardEvents on window so the game's
// existing key listeners and keys{} map work unchanged. Self-gating: does
// nothing on fine-pointer devices.
import { joystickDirs, diffDirs } from './touch-input.js'

const NUB_RADIUS = 34   // px the nub may travel from the stick center

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

  // --- Thumbstick: fixed dial; direction measured from the dial's center,
  // so even the first touch steers immediately. 8-way quantized. ---
  const zone = document.getElementById('joystick-zone')
  const base = document.getElementById('joystick-base')
  const nub = document.getElementById('joystick-nub')
  let stickId = null
  let centerX = 0, centerY = 0
  let dirs = []

  const setDirs = next => {
    const { press: p, release: r } = diffDirs(dirs, next)
    r.forEach(release)
    p.forEach(press)
    dirs = next
  }
  const steer = (x, y) => {
    const dx = x - centerX
    const dy = y - centerY
    const len = Math.hypot(dx, dy) || 1
    if (len >= NUB_RADIUS * 0.9) press('sprint')
    else release('sprint')
    const clamp = Math.min(len, NUB_RADIUS) / len
    nub.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`
    setDirs(joystickDirs(dx, dy))
  }

  zone.addEventListener('pointerdown', e => {
    if (stickId !== null) return   // one stick pointer at a time
    stickId = e.pointerId
    const rect = base.getBoundingClientRect()
    centerX = rect.left + rect.width / 2
    centerY = rect.top + rect.height / 2
    zone.setPointerCapture(e.pointerId)
    steer(e.clientX, e.clientY)
  })
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return
    steer(e.clientX, e.clientY)
  })
  const endStick = e => {
    if (e.pointerId !== stickId) return
    stickId = null
    nub.style.transform = 'translate(0, 0)'
    release('sprint')
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
  bindHold(document.getElementById('touch-quickuse'), 'q')
  bindHold(document.getElementById('touch-select'), 'i')
  bindHold(document.getElementById('touch-start'), 'Escape')

  // --- The quick-use button mirrors the badge data the HUD publishes on
  // #hud-consumable rather than reaching into game state: grey when the sack
  // holds no consumables. ---
  const consumable = document.getElementById('hud-consumable')
  const quickBtn = document.getElementById('touch-quickuse')
  new MutationObserver(() => {
    quickBtn.classList.toggle('empty', !consumable.dataset.quickEmoji)
  }).observe(consumable, { attributes: true, attributeFilter: ['data-quick-emoji'] })

  // --- Never leave keys stuck when the page loses the pointer/focus ---
  const resetAll = () => {
    stickId = null
    nub.style.transform = 'translate(0, 0)'
    dirs = []
    buttonResets.forEach(reset => reset())
    releaseAll()
  }
  window.addEventListener('blur', resetAll)
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll() })
}

initTouchControls()
