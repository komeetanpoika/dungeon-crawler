// Transient, non-modal status messages for the editor. No deps, no imports.
// toast(message, type) where type is 'ok' | 'error' | 'info'.
let container = null

function ensure() {
  if (container) return container
  const style = document.createElement('style')
  style.textContent = `
    #editor-toasts { position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 6px; align-items: center;
      z-index: 1000; pointer-events: none; }
    #editor-toasts .toast { pointer-events: auto; cursor: pointer; max-width: 70vw;
      padding: 6px 14px; border-radius: 4px; font: 13px/1.4 monospace; color: #fff;
      box-shadow: 0 2px 8px #0008; opacity: 0; transition: opacity .2s; }
    #editor-toasts .toast.show { opacity: 1; }
    #editor-toasts .toast.ok { background: #226633; }
    #editor-toasts .toast.error { background: #aa3333; }
    #editor-toasts .toast.info { background: #33415a; }`
  document.head.appendChild(style)
  container = document.createElement('div')
  container.id = 'editor-toasts'
  document.body.appendChild(container)
  return container
}

export function toast(message, type = 'ok') {
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = message
  let removed = false
  const dismiss = () => {
    if (removed) return
    removed = true
    el.classList.remove('show')
    setTimeout(() => el.remove(), 250)
  }
  el.addEventListener('click', dismiss)
  ensure().appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(dismiss, type === 'error' ? 5000 : 2600)
  return el
}
