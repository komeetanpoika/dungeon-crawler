// Bottom strip: thumbnails of every tile; click loads it into the editor.
export async function buildLibrary(names, { onPick }) {
  const container = document.getElementById('library')
  const filter = document.getElementById('library-filter')
  const items = []
  for (const name of names) {
    const img = document.createElement('img')
    img.src = await window.editorAPI.readTile(name)
    img.title = name
    img.addEventListener('click', () => onPick(name))
    container.appendChild(img)
    items.push({ name, img })
  }
  filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase()
    for (const { name, img } of items)
      img.style.display = name.toLowerCase().includes(q) ? '' : 'none'
  })
  return {
    add(name, dataURL) {
      const img = document.createElement('img')
      img.src = dataURL
      img.title = name
      img.addEventListener('click', () => onPick(name))
      container.appendChild(img)
      items.push({ name, img })
    },
  }
}
