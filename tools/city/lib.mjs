// A small RGBA raster for drawing tile art in Node: pixels, rects, char maps,
// textures, shading ramps, slicing into 16x16 tiles. Used by
// tools/city/make-city-tiles.mjs.
import { readFileSync } from 'node:fs'
import { runPixels } from '../static-overworld/px.mjs'

export const T = 16
export const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]
const key = c => c ? (c[0] << 16 | c[1] << 8 | c[2]) : -1
export const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

export class Pic {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4) }
  static from(w, h, rgba) { const p = new Pic(w, h); p.d.set(rgba); return p }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h }
  get(x, y) {
    if (!this.in(x, y)) return null
    const i = (y * this.w + x) * 4
    return this.d[i + 3] ? [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]] : null
  }
  // c: [r,g,b,a] or a '#rrggbb' string; null clears the pixel
  set(x, y, c) {
    if (!this.in(x, y)) return this
    const i = (y * this.w + x) * 4
    if (c == null) { this.d[i] = this.d[i + 1] = this.d[i + 2] = this.d[i + 3] = 0; return this }
    if (typeof c === 'string') c = hex(c)
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = c[3] ?? 255
    return this
  }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); return this }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.set(x, y, c); return this }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, c); return this }
  // draw another picture on top (its see-through pixels leave this one alone)
  blit(p, x0 = 0, y0 = 0) {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const c = p.get(x, y); if (c) this.set(x0 + x, y0 + y, c) }
    return this
  }
  // a char map: rows of characters, '.' or ' ' see-through, else pal[ch]
  map(rows, pal, x0 = 0, y0 = 0) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return
      if (!(ch in pal)) throw new Error(`no colour for "${ch}"`)
      this.set(x0 + x, y0 + y, pal[ch])
    }))
    return this
  }
  clone() { return Pic.from(this.w, this.h, this.d) }
  crop(x0, y0, w, h) {
    const p = new Pic(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = this.get(x0 + x, y0 + y); if (c) p.set(x, y, c) }
    return p
  }
  flipX() {
    const p = new Pic(this.w, this.h)
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const c = this.get(x, y); if (c) p.set(this.w - 1 - x, y, c) }
    return p
  }
  // swap colours: pairs of [from, to] ('#hex' each)
  recolor(pairs) {
    const m = new Map(pairs.map(([a, b]) => [key(hex(a)), hex(b)]))
    const p = this.clone()
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const c = p.get(x, y), to = c && m.get(key(c))
      if (to) p.set(x, y, to)
    }
    return p
  }
  // every pixel through fn(c, x, y) -> colour | null | undefined (keep)
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const r = fn(this.get(x, y), x, y)
      if (r !== undefined) this.set(x, y, r)
    }
    return this
  }
  // the 16x16 tile at cell (cx, cy)
  cell(cx, cy) { return this.crop(cx * T, cy * T, T, T) }
}

// A shading ramp: shift(c, n) moves a colour n steps along the first ramp
// holding it (positive darker); colours on no ramp stay.
export function ramps(...lists) {
  const at = new Map()
  for (const list of lists) list.forEach((h, i) => { if (!at.has(key(hex(h)))) at.set(key(hex(h)), { list, i }) })
  return (c, n) => {
    if (!c || !n) return c
    const r = at.get(key(c))
    if (!r) return c
    return hex(r.list[Math.max(0, Math.min(r.list.length - 1, r.i + n))])
  }
}

// Decode PNG tiles into Pics. Tiny Town's tiles are 1-, 2- and 4-bit indexed
// PNGs that tools/png-read.mjs does not read, so chromium decodes them.
export async function loadTiles(dir, names) {
  const files = Object.fromEntries(names.map(n => [n, `${dir}/${n}.png`]))
  for (const f of Object.values(files)) readFileSync(f)   // a clear error for a missing tile
  const res = await runPixels(files, images => {
    const out = {}
    for (const [name, img] of Object.entries(images)) {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      out[name] = { w: img.width, h: img.height, px: Array.from(g.getImageData(0, 0, img.width, img.height).data) }
    }
    return out
  }, null)
  return Object.fromEntries(Object.entries(res).map(([n, { w, h, px }]) => [n, Pic.from(w, h, Uint8Array.from(px))]))
}
