// Install a built cut into the game: write the cut-out rig module and create
// (or, on request, switch) the monster def. Never touches a hand-written rig
// and never rewrites a def that is already on its cut rig.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { CUTOUT_MARKER, rigModuleSource } from './templates.js'

const { writeMonster, RESERVED_NAMES, NAME_RE } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')

const rigFile = (root, name) => path.join(root, 'renderer/render/monster-rigs', name + '.js')
const defDir = root => path.join(root, 'renderer/data/monsters')
const readDef = (root, name) => {
  try { return JSON.parse(fs.readFileSync(path.join(defDir(root), name + '.json'), 'utf8')) } catch { return null }
}

export function cutStatus({ root, name }) {
  const def = readDef(root, name)
  const file = rigFile(root, name)
  const exists = fs.existsSync(file)
  return {
    reserved: RESERVED_NAMES.has(name),
    def: { exists: !!def, rig: def?.rig ?? null },
    rig: { exists, cutout: exists && fs.readFileSync(file, 'utf8').split('\n')[0] === CUTOUT_MARKER },
  }
}

export function installCut({ root, name, switchRig = false }) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`invalid monster name "${name}"`)
  if (RESERVED_NAMES.has(name)) throw new Error(`monster name "${name}" is reserved for a built-in type`)
  const status = cutStatus({ root, name })
  if (status.rig.exists && !status.rig.cutout) throw new Error(`rig "${name}" is not a cut-out rig`)
  const def = readDef(root, name)
  if (def && def.rig !== name && !switchRig) throw Object.assign(new Error(`def uses rig ${def.rig}`), { needsSwitch: true })

  const out = { createdRig: false, createdDef: false, switched: false }
  if (!status.rig.exists) {
    fs.mkdirSync(path.dirname(rigFile(root, name)), { recursive: true })
    fs.writeFileSync(rigFile(root, name), rigModuleSource(name))
    out.createdRig = true
  }
  if (!def) {
    writeMonster(defDir(root), name, { rig: name, params: {}, stats: { hp: 10, dmg: 1, speed: 60 }, behavior: {}, hooks: false, spawn: null, tuning: {} })
    out.createdDef = true
  } else if (def.rig !== name) {
    writeMonster(defDir(root), name, { ...def, rig: name, params: {} })
    out.switched = true
  }
  return out
}
