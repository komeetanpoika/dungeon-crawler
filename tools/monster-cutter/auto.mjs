// node tools/monster-cutter/auto.mjs <name> <png> [--tolerance N] [--view front|side] [--faces left|right] [--force]
// Copies the PNG to assets/cuts/<name>.png and writes a first-guess cut:
// background mask, automatic pieces, and head/chest points.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../png-read.mjs'
import { autoMask, keepMain, encodeMask } from './mask.js'
import { findPieces } from './finder.js'
import { segment } from './segment.js'
import { validateCut } from './cut-format.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1] }
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--force'))
const [name, png] = pos
if (!name || !png) { console.error('usage: auto.mjs <name> <png> [--tolerance N] [--view front|side] [--faces left|right] [--force]'); process.exit(2) }
if (!/^[a-z0-9_]+$/.test(name)) { console.error(`invalid name "${name}"`); process.exit(2) }

const cutFile = path.join(root, 'assets/cuts', name + '.json')
if (fs.existsSync(cutFile) && !args.includes('--force')) { console.error(`${path.relative(root, cutFile)} exists; pass --force to overwrite`); process.exit(1) }

const img = readPng(png)
const src = { w: img.width, h: img.height, rgba: img.pixels }
const { w, h } = src
const mask = keepMain(autoMask(src, { tolerance: Number(flag('tolerance', 40)) }), w, h, Math.round(Math.max(w, h) * 0.02))
const pieces = findPieces(mask, w, h)
const { owner } = segment(mask, w, h, pieces)

// the topmost pixel of a piece (x = middle of its top row) moved 15% of its height down
function topPoint(idx) {
  let top = h, bottom = -1, x0 = w, x1 = -1
  for (let i = 0; i < w * h; i++) if (owner[i] === idx) { const y = (i / w) | 0; if (y < top) top = y; if (y > bottom) bottom = y }
  if (bottom < 0) return null
  for (let x = 0; x < w; x++) if (owner[top * w + x] === idx) { if (x < x0) x0 = x; x1 = x }
  return { x: Math.round((x0 + x1) / 2), y: Math.round(top + 0.15 * (bottom - top)) }
}
const figureTop = () => {
  let top = h, x0 = w, x1 = -1
  for (let i = 0; i < w * h; i++) if (mask[i]) { const y = (i / w) | 0; if (y < top) top = y }
  for (let x = 0; x < w; x++) if (mask[top * w + x]) { if (x < x0) x0 = x; x1 = x }
  return { x: Math.round((x0 + x1) / 2), y: top }
}
const torsoIdx = pieces.findIndex(p => p.parent === null), headIdx = pieces.findIndex(p => p.role === 'head')
const headPt = (headIdx >= 0 && topPoint(headIdx)) || figureTop()
const chestPt = topPoint(torsoIdx) ?? figureTop()
const points = {
  head: { piece: headIdx >= 0 ? pieces[headIdx].id : pieces[torsoIdx].id, ...headPt },
  chest: { piece: pieces[torsoIdx].id, ...chestPt },
}

const cut = { version: 1, name, source: `assets/cuts/${name}.png`, credit: null, w, h, mask: encodeMask(mask),
  view: flag('view', 'front'), faces: flag('faces', 'left'), outHeight: 84, outline: null, pieces, points }
const errs = validateCut(cut)
if (errs.length) { console.error('first guess is invalid:\n- ' + errs.join('\n- ')); process.exit(1) }

fs.mkdirSync(path.dirname(cutFile), { recursive: true })
fs.copyFileSync(png, path.join(root, cut.source))
fs.writeFileSync(cutFile, JSON.stringify(cut))
console.log(`wrote ${path.relative(root, cutFile)}: ${pieces.length} pieces (${pieces.map(p => p.id).join(', ')})`)
