// Bottom strip: thumbnails of every tile. A click normally loads the tile into
// the pixel editor; while pick mode is active it instead answers whoever asked
// for a tile (the Rules tab's "+ add tile"), then leaves pick mode.
export async function buildLibrary(names, { onPick }) {
  const container = document.getElementById('library')
  const filter = document.getElementById('library-filter')
  const modeEl = document.getElementById('library-mode')
  const items = []
  let pick = null                       // { handler } while picking

  function setPickMode(handler, prompt = '') {
    pick = handler ? { handler } : null
    modeEl.textContent = pick ? `${prompt} · esc to cancel` : ''
    container.classList.toggle('picking', !!pick)
  }

  // One click funnel so pick mode also applies to tiles added after the initial
  // build (the Draw tab's Save tile appends to this strip at runtime).
  function fire(name) {
    if (!pick) { onPick(name); return }
    const { handler } = pick
    setPickMode(null)                   // leave the mode before the handler re-renders
    handler(name)
  }

  function addThumb(name, src) {
    const img = document.createElement('img')
    img.src = src
    img.title = name
    img.dataset.name = name
    // Respect an active filter — Save tile can append while one is typed in.
    const q = filter.value.toLowerCase()
    if (q && !name.toLowerCase().includes(q)) img.style.display = 'none'
    img.addEventListener('click', () => fire(name))
    container.appendChild(img)
    items.push({ name, img })
  }

  for (const name of names) addThumb(name, await window.editorAPI.readTile(name))

  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase()
    for (const { name, img } of items)
      img.style.display = name.toLowerCase().includes(q) ? '' : 'none'
  })
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPickMode(null) })

  return {
    add(name, dataURL) {
      const existing = items.find(it => it.name === name)
      if (existing) { existing.img.src = dataURL; return }
      addThumb(name, dataURL)
    },
    setPickMode,
    get picking() { return !!pick },
  }
}
