// Pause-overlay signpost panel: a title and a few carved lines. Read-only —
// F, Escape or Enter closes it (game.js owns the pause/resume around it).
let keyHandler = null

const el = () => document.getElementById('sign-overlay')

export function showSign(sign, onClose) {
  const root = el()
  root.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'sign-panel'
  panel.innerHTML = `<div class="sign-title">${sign.title}</div>` +
    sign.lines.map(l => `<div class="sign-line">${l}</div>`).join('') +
    `<div class="sign-hint">Close (F)</div>`
  panel.addEventListener('click', onClose)
  root.appendChild(panel)
  root.style.display = 'flex'
  keyHandler = (e) => {
    if (e.key !== 'f' && e.key !== 'F' && e.key !== ' ' && e.key !== 'Escape' && e.key !== 'Enter') return
    e.preventDefault(); e.stopPropagation()
    onClose()
  }
  window.addEventListener('keydown', keyHandler, true)   // capture: outrank game key handlers
}

export function hideSign() {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null }
  const root = el()
  root.style.display = 'none'
  root.innerHTML = ''
}
