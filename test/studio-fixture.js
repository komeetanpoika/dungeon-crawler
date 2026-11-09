// Shared temp-root builder for the Monster Studio tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { writePng } from '../tools/png-write.mjs'
import { encodeMask } from '../tools/monster-cutter/mask.js'
import { buildCut } from '../tools/monster-cutter/build-cut.js'
import { rigModuleSource } from '../tools/monster-cutter/templates.js'

const W = 100, H = 100

// A 100x100 two-rect cut (torso + left arm). short: the arm's cut line leaks.
export function makeCutBody({ name = 'srv', short = false } = {}) {
  const mask = new Uint8Array(W * H), rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) rgba.set([255, 255, 255, 255], i * 4)
  const rect = (x, y, w, h, col) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { mask[j * W + i] = 1; rgba.set([...col, 255], (j * W + i) * 4) } }
  rect(30, 20, 40, 60, [255, 0, 0]); rect(20, 25, 10, 40, [0, 0, 255])
  const pieces = [
    { id: 'torso', role: 'torso', side: null, parent: null, seed: [50, 50], cut: null, pivot: [50, 50], z: 0, claims: [] },
    { id: 'arm', role: 'arm', side: 'left', parent: 'torso', seed: [22, 40],
      cut: short ? [[30, 40], [30, 45]] : [[30, 22], [30, 68]], pivot: [29, 40], z: 1, claims: [] },
  ]
  const cut = { version: 1, name, source: `assets/cuts/${name}.png`, credit: null, w: W, h: H, mask: encodeMask(mask),
    view: 'front', faces: 'left', outHeight: 30, outline: '#102030', pieces, points: { chest: { piece: 'torso', x: 50, y: 40 } } }
  const f = path.join(os.tmpdir(), `studio-${process.pid}-${crypto.randomBytes(4).toString('hex')}.png`)
  writePng(f, W, H, rgba)
  const sourcePng = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
  fs.unlinkSync(f)
  return { cut, sourcePng }
}

export function makeProjectRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'))
  const w = (rel, data) => { const f = path.join(r, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2)) }
  w('renderer/data/monsters/index.json', ['boar', 'monsterx', 'story1'])
  w('renderer/data/monsters/boar.json', { name: 'boar', rig: 'quadruped', params: {}, stats: { hp: 5, dmg: 1, speed: 50 }, behavior: {}, spawn: { depths: [3, 5], weight: 1 } })
  w('renderer/data/monsters/story1.json', { name: 'story1', rig: 'quadruped', placedBy: 'story', params: {}, stats: { hp: 5, dmg: 1, speed: 50 }, behavior: {} })
  w('renderer/data/monsters/monsterx.json', { name: 'monsterx', rig: 'monsterx', params: {}, stats: { hp: 10, dmg: 1, speed: 60 }, behavior: { weapon: 'maul' }, spawn: null })
  const { cut, sourcePng } = makeCutBody({ name: 'monsterx' })
  w('assets/cuts/monsterx.json', JSON.stringify(cut))
  w('assets/cuts/monsterx.png', Buffer.from(sourcePng.split(',')[1], 'base64'))
  w('renderer/render/monster-rigs/monsterx.js', rigModuleSource('monsterx'))
  buildCut({ root: r, name: 'monsterx' })
  return r
}

// sorted [relPath, sha1] list of every file under the given dirs
export function snapshotTree(root, dirs) {
  const out = []
  const walk = rel => {
    const full = path.join(root, rel)
    if (!fs.existsSync(full)) return
    for (const e of fs.readdirSync(full, { withFileTypes: true })) {
      const r = path.join(rel, e.name)
      if (e.isDirectory()) walk(r)
      else out.push([r, crypto.createHash('sha1').update(fs.readFileSync(path.join(root, r))).digest('hex')])
    }
  }
  for (const d of dirs) walk(d)
  return out.sort((a, b) => a[0] < b[0] ? -1 : 1)
}
