// node tools/desert-monsters/preview.mjs <rig> <out.png> [--scale 1] [--params '{"k":v}']
// A sheet of a shape-drawn rig's poses through the software canvas: the rows
// poses.mjs lists for the rig (each a list of { label, pose, params? }),
// drawn on sand at S = 64 so the art pixels show. For the builder's eye; the game draws the same op stream
// through the pixel stage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSoftCanvas } from '../monster-cutter/soft-canvas.js'
import { writePng } from '../png-write.mjs'
import { defaultParams } from '../../renderer/render/monster-rigs/schema.js'
import { POSES } from './poses.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [rigId, out, ...rest] = process.argv.slice(2)
if (!rigId || !out) { console.error('usage: preview.mjs <rig> <out.png> [--params json] [--cell px]'); process.exit(2) }
const arg = k => { const i = rest.indexOf(k); return i === -1 ? null : rest[i + 1] }
const rig = await import(path.join(root, 'renderer/render/monster-rigs', rigId + '.js'))
const base = { ...defaultParams(rig.PARAM_SCHEMA), ...JSON.parse(arg('--params') ?? '{}') }
const rows = POSES[rigId]
if (!Array.isArray(rows)) { console.error(`${rigId}: no rows in poses.mjs`); process.exit(2) }

const S = 64, CELL = Number(arg('--cell') ?? 256)
const cols = Math.max(...rows.map(r => r.length))
const { ctx, img } = makeSoftCanvas(cols * CELL, rows.length * CELL)
const SAND = ['#d9b77c', '#d4b176']
for (let y = 0; y < img.h / 32; y++) for (let x = 0; x < img.w / 32; x++) {
  ctx.fillStyle = SAND[(x + y) % 2]
  ctx.fillRect(x * 32, y * 32, 32, 32)
}
rows.forEach((row, r) => row.forEach((cell, c) => {
  ctx.save()
  ctx.translate(c * CELL + CELL / 2, r * CELL + CELL / 2)
  const pose = { t: 0, state: 'idle', stateT: 0, facing: 0, speed01: 0, seed: 0, sink: 0, burn: 0, flicker: 0, eyeGlow: 0, ...cell.pose }
  rig.drawMonster(ctx, { ...base, ...(cell.params ?? {}) }, pose, S)
  ctx.restore()
}))
writePng(out, img.w, img.h, img.rgba)
console.log(out, `${img.w}x${img.h}`, rows.map(r => r.map(c => c.label).join(' | ')).join('\n  '))
