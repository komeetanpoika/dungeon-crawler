// window.prompt is unsupported in Electron renderers; this is the stand-in.
export function textPrompt(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10'
    const box = document.createElement('div')
    box.style.cssText =
      'background:#1a1a24;border:1px solid #444;border-radius:4px;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:260px'
    const label = document.createElement('div')
    label.textContent = message
    const input = document.createElement('input')
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
    const ok = document.createElement('button')
    ok.textContent = 'OK'
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    const done = value => { overlay.remove(); resolve(value) }
    ok.addEventListener('click', () => done(input.value))
    cancel.addEventListener('click', () => done(null))
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(input.value)
      if (e.key === 'Escape') done(null)
    })
    row.append(cancel, ok)
    box.append(label, input, row)
    overlay.append(box)
    document.body.append(overlay)
    input.focus()
  })
}
