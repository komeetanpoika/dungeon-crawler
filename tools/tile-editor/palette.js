import { SIZE, rgbaToHex } from './lib.js'

// Decode a data-URL PNG into 16×16 ImageData.
export function dataURLToImageData(dataURL) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = SIZE; c.height = SIZE
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, SIZE, SIZE)
      resolve(ctx.getImageData(0, 0, SIZE, SIZE))
    }
    img.onerror = () => resolve(null)
    img.src = dataURL
  })
}

// Unique opaque colors across the given ImageDatas, most-used first.
export function extractPalette(imageDatas, max = 64) {
  const freq = new Map()
  for (const d of imageDatas) {
    if (!d) continue
    for (let i = 0; i < d.data.length; i += 4) {
      if (d.data[i + 3] === 0) continue
      const hex = rgbaToHex(d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3])
      freq.set(hex, (freq.get(hex) ?? 0) + 1)
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c)
}
