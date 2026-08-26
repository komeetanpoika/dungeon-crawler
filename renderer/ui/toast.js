// Pause-overlay milestone toast: a title and a few lines. Space, Enter,
// Escape or a click closes it (game.js owns the pause/resume around it).
let keyHandler = null

const el = () => document.getElementById('toast-overlay')

export function showToast(toast, onClose) {
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'sign-panel toast-panel'
  panel.innerHTML = `<div class="sign-title">${toast.title}</div>` +
    toast.lines.map(l => `<div class="sign-line">${l}</div>`).join('') +
    `<div class="sign-hint">Continue</div>`
  panel.addEventListener('click', onClose)
  root.appendChild(panel)
  root.style.display = 'flex'
  keyHandler = (e) => {
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Escape') return
    e.preventDefault(); e.stopPropagation()
    onClose()
  }
  window.addEventListener('keydown', keyHandler, true)   // capture: outrank game key handlers
}

export function hideToast() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
