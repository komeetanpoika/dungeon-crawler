// node tools/monster-cutter/preview.mjs <name>
// Writes tools/monster-cutter/out/<name>-preview.png: the source tinted per
// owning piece with cut lines, pivots and points, and beside it the cut-out
// rig's posed frames (idle, walk steps 0-3, attack) at S = 64, drawn through
// the software canvas with the real engine.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from '../png-read.mjs'
import { writePng } from '../png-write.mjs'
import { decodeMask } from './mask.js'
import { segment } from './segment.js'
import { composeCut } from './compose.js'
import { supercoverLine } from './raster.js'
import { makeSoftCanvas } from './soft-canvas.js'
import { makeCutoutRig, CUTOUT_SCHEMA } from '../../renderer/render/monster-rigs/cutout.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const name = process.argv[2]
if (!name) { console.error('usage: preview.mjs <name>'); process.exit(2) }

const cut = JSON.parse(fs.readFileSync(path.join(root, 'assets/cuts', name + '.json'), 'utf8'))
const png = readPng(path.join(root, cut.source))
const src = { w: png.width, h: png.height, rgba: png.pixels }
const { w, h } = cut
const mask = decodeMask(cut.mask, w * h)
const { owner, leaks } = segment(mask, w, h, cut.pieces)
if (leaks.length) console.warn('warning: cut lines leak for', leaks.join(', '))

const TINTS = [[230, 70, 60], [60, 140, 230], [70, 200, 90], [240, 200, 50], [190, 80, 220], [60, 210, 210], [240, 140, 40], [240, 110, 180]]
const FRAME_W = 280, FRAME_H = 240, S = 64, COLS = 3, ROWS = 2
const H_OUT = Math.max(FRAME_H * ROWS, 480), SCALE = H_OUT / h
const SW = Math.round(w * SCALE), W_OUT = SW + FRAME_W * COLS
const out = new Uint8Array(W_OUT * H_OUT * 4)
for (let i = 0; i < out.length; i += 4) out.set([40, 40, 48, 255], i)
const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < W_OUT && y < H_OUT) out.set([...c, 255], (y * W_OUT + x) * 4) }

// source, tinted by owner, nearest-neighbour scaled
for (let y = 0; y < H_OUT; y++) for (let x = 0; x < SW; x++) {
  const sx = Math.min(w - 1, Math.floor(x / SCALE)), sy = Math.min(h - 1, Math.floor(y / SCALE)), i = sy * w + sx
  const o = i * 4
  if (!mask[i]) { px(x, y, [src.rgba[o] >> 2, src.rgba[o + 1] >> 2, src.rgba[o + 2] >> 2]); continue }
  const t = TINTS[owner[i] % TINTS.length]
  px(x, y, [0, 1, 2].map(k => Math.round(src.rgba[o + k] * 0.55 + t[k] * 0.45)))
}
const at = ([x, y]) => [Math.round((x + 0.5) * SCALE), Math.round((y + 0.5) * SCALE)]
const dot = (p, r, c) => { const [cx, cy] = at(p); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) px(cx + dx, cy + dy, c) }
for (const p of cut.pieces) {
  if (p.cut) for (const q of supercoverLine(at(p.cut[0]), at(p.cut[1]))) px(q[0], q[1], [255, 255, 255])
  dot(p.pivot, 3, [255, 255, 0])
  dot(p.seed, 2, TINTS[cut.pieces.indexOf(p) % TINTS.length].map(v => v >> 1))
}
for (const pt of Object.values(cut.points ?? {})) dot([pt.x, pt.y], 3, [0, 255, 255])

// posed frames through the real engine
const { atlas, parts } = composeCut(src, cut)
const rig = makeCutoutRig({ id: name, parts, imageUrl: null })
rig._setSheetImage({ ...atlas, width: atlas.w, height: atlas.h, naturalWidth: atlas.w, complete: true })
const params = Object.fromEntries(CUTOUT_SCHEMA.map(d => [d.key, d.default]))
const facing = cut.faces === 'left' ? Math.PI : 0
const poses = [{ t: 0.25, state: 'idle' }, ...[0, 1, 2, 3].map(i => ({ t: (i + 0.5) / params.gaitFreq, state: 'walk', speed01: 1 })), { t: 0.3, state: 'attack' }]
poses.forEach((pose, k) => {
  const { ctx, img } = makeSoftCanvas(FRAME_W, FRAME_H)
  ctx.save(); ctx.translate(FRAME_W / 2, FRAME_H - 48)
  rig.drawMonster(ctx, params, { facing, ...pose }, S)
  ctx.restore()
  const ox = SW + (k % COLS) * FRAME_W, oy = Math.floor(k / COLS) * FRAME_H
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
    const o = (y * FRAME_W + x) * 4, a = img.rgba[o + 3] / 255
    if (a > 0) px(ox + x, oy + y, [0, 1, 2].map(j => Math.round(img.rgba[o + j] * a + 70 * (1 - a))))
    else px(ox + x, oy + y, [70, 70, 80])
  }
})

const file = path.join(root, 'tools/monster-cutter/out', name + '-preview.png')
fs.mkdirSync(path.dirname(file), { recursive: true })
writePng(file, W_OUT, H_OUT, out)
console.log('wrote', path.relative(root, file))
