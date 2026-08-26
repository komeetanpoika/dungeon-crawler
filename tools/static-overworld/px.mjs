// Headless-chromium pixel toolkit for the static-overworld workbench.
// Node has no canvas; chromium does. Loads images as data URLs, runs a
// caller-supplied function in the page against loaded <img>s, and saves any
// returned data-URL PNGs back to disk.
import { chromium } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

export async function withPage(fn) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    return await fn(page)
  } finally {
    await browser.close()
  }
}

export function imgDataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64')
}

// Run `pageFn(images, arg)` inside chromium with the named images loaded.
// `images` arrives as {name: HTMLImageElement}. The function may return
// JSON-serializable data; any string value that starts with data:image/png
// found in {saveAs: dataUrl} pairs of a returned `files` object is written out.
export async function runPixels(imageFiles, pageFn, arg, outDir) {
  return withPage(async page => {
    await page.setContent('<html><body></body></html>')
    const sources = Object.fromEntries(Object.entries(imageFiles).map(([k, f]) => [k, imgDataUrl(f)]))
    const result = await page.evaluate(async ({ sources, fnSrc, arg }) => {
      const images = {}
      await Promise.all(Object.entries(sources).map(([k, src]) => new Promise((res, rej) => {
        const img = new Image()
        img.onload = () => { images[k] = img; res() }
        img.onerror = rej
        img.src = src
      })))
      const fn = new Function('return (' + fnSrc + ')')()
      return await fn(images, arg)
    }, { sources, fnSrc: pageFn.toString(), arg })
    if (result && result.files && outDir) {
      fs.mkdirSync(outDir, { recursive: true })
      for (const [name, dataUrl] of Object.entries(result.files)) {
        fs.writeFileSync(path.join(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
      }
    }
    return result
  })
}
