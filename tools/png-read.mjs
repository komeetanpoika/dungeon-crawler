// Minimal PNG reader: 8-bit, non-interlaced, colour types 0 (grey), 2 (RGB),
// 3 (indexed), 4 (grey+alpha) and 6 (RGBA). Enough to inspect our own sprite
// sheets in tests without taking on a dependency; throws clearly on anything
// else rather than returning wrong pixels.
import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// Undo the per-row filter in place. `prev` is the already-unfiltered row above.
function unfilter(type, line, prev, ch) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= ch ? line[i - ch] : 0
    const b = prev[i]
    const c = i >= ch ? prev[i - ch] : 0
    let v = line[i]
    if (type === 1) v += a
    else if (type === 2) v += b
    else if (type === 3) v += (a + b) >> 1
    else if (type === 4) v += paeth(a, b, c)
    else if (type !== 0) throw new Error(`unsupported PNG row filter ${type}`)
    line[i] = v & 0xff
  }
}

export function readPng(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`)

  let pos = 8
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0
  let palette = null, trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    pos += 12 + len                     // 4 len + 4 type + data + 4 crc
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }

  if (depth !== 8) throw new Error(`${path}: only 8-bit PNGs supported (got bit depth ${depth})`)
  if (interlace !== 0) throw new Error(`${path}: interlaced PNGs not supported`)
  const ch = CHANNELS[colorType]
  if (!ch) throw new Error(`${path}: unsupported colour type ${colorType}`)
  if (colorType === 3 && !palette) throw new Error(`${path}: indexed PNG missing PLTE chunk`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const out = new Uint8Array(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    unfilter(filter, line, prev, ch)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (colorType === 6) {
        out[i] = line[x*4]; out[i+1] = line[x*4+1]; out[i+2] = line[x*4+2]; out[i+3] = line[x*4+3]
      } else if (colorType === 2) {
        out[i] = line[x*3]; out[i+1] = line[x*3+1]; out[i+2] = line[x*3+2]; out[i+3] = 255
      } else if (colorType === 3) {
        const p = line[x]
        out[i] = palette[p*3]; out[i+1] = palette[p*3+1]; out[i+2] = palette[p*3+2]
        out[i+3] = trns && p < trns.length ? trns[p] : 255
      } else if (colorType === 4) {
        out[i] = out[i+1] = out[i+2] = line[x*2]; out[i+3] = line[x*2+1]
      } else {
        out[i] = out[i+1] = out[i+2] = line[x]; out[i+3] = 255
      }
    }
    prev = line
  }
  return { width, height, pixels: out }
}
