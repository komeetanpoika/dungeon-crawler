// The Fight tab: the real game's bench arena (through the /sg/ mirror, on the
// draft's def and parts) in an iframe. The bench panel inside it autosaves its
// Fight fields to the draft; flush() waits out that 400 ms debounce.
const AUTOSAVE_WAIT = 450

export function mountFightTab(rootEl) {
  rootEl.replaceChildren()
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
  let frame = null

  function hide() {
    if (!frame) return
    frame.src = 'about:blank'
    frame.remove()
    frame = null
  }

  return {
    show(view) {
      hide()
      rootEl.replaceChildren()
      if (view.buildError) {
        rootEl.append(make('p', { className: 'info', textContent: `Fix the cut first: ${view.buildError}` }))
        return
      }
      const note = make('p', { className: 'info', textContent: 'Click the game to play. Changes save to the draft.' })
      frame = make('iframe', { className: 'fight-frame', title: `${view.name} in the game` })
      frame.addEventListener('load', () => frame?.focus())
      frame.src = `/sg/${view.name}@${view.rev}/renderer/index.html?bench=${encodeURIComponent(view.name)}&dcdebug=1`
      rootEl.append(note, frame)
    },
    hide,
    flush: () => new Promise(resolve => setTimeout(resolve, AUTOSAVE_WAIT)),
  }
}
