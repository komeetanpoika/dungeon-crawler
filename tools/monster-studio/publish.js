// Publish: the one moment a studio draft reaches the game. All checks run
// before the first write. Errors are plain Errors with a numeric .status.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { checkCut, buildCut } from '../monster-cutter/build-cut.js'
import { checkInstall, installCut, newDef } from '../monster-cutter/install-cut.js'
import { readDraft, draftDir, discardDraft } from './drafts.js'
import { spawnErrors } from './spawn-form.js'

const { writeMonster, mergeDefPatch } = createRequire(import.meta.url)('../monster-lab/monster-files.cjs')

const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra)
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/')

export function publishDraft(root, name, { force = false } = {}) {
  const v = readDraft(root, name)
  const defDir = path.join(root, 'renderer/data/monsters')
  const defFile = path.join(defDir, name + '.json')
  const idxFile = path.join(defDir, 'index.json')
  const published = readJson(defFile)
  const drawn = v.kind === 'drawn', story = v.kind === 'story'
  // an unchanged cut stays as the game has it: no cut, source, parts or rig is written
  const writeCut = drawn && (v.isNew || v.cutChanged)

  if (v.stale && !force) throw fail(409, `"${name}" changed in the game since this draft was started`, { stale: true })
  if (v.isNew && (published || (readJson(idxFile) ?? []).includes(name))) throw fail(409, `"${name}" is now a published monster`)
  if (writeCut) {
    try { checkCut(v.cut, name) } catch (e) { throw fail(400, e.message) }
    checkInstall({ root, name })
  }
  if (!story) {
    const errs = spawnErrors(v.def.spawn)
    if (errs.length) throw fail(400, `spawn: ${errs.join('; ')}`)
  }

  const before = snapshot(root)
  const dd = draftDir(root, name)
  if (writeCut) {
    const cutFile = path.join(root, 'assets/cuts', name + '.json')
    fs.mkdirSync(path.dirname(cutFile), { recursive: true })
    // compact, as the cutter (cut-routes.js, auto.mjs) writes it
    fs.writeFileSync(cutFile, JSON.stringify({ ...v.cut, source: `assets/cuts/${name}.png` }))
    fs.copyFileSync(path.join(dd, 'source.png'), path.join(root, 'assets/cuts', name + '.png'))
    buildCut({ root, name })
    installCut({ root, name })
  }
  const base = readJson(defFile) ?? newDef(name)
  let next
  if (story) next = { ...base, params: v.def.params ?? {} }
  else {
    next = mergeDefPatch(base, { params: v.def.params ?? {}, tuning: v.def.tuning ?? {}, stats: v.def.stats ?? {}, spawn: v.def.spawn ?? null, anims: v.def.anims ?? null })
    next.behavior = v.def.behavior ?? {}
  }
  writeMonster(defDir, name, next)
  discardDraft(root, name)

  const after = snapshot(root)
  const wrote = Object.keys(after).filter(f => before[f] !== after[f] || !(f in before))
  // a rewrite of identical bytes still counts as written for the def
  const always = [defFile]
  if (writeCut) always.push(path.join(root, 'assets/cuts', name + '.json'), path.join(root, 'assets/cuts', name + '.png'),
    path.join(root, 'renderer/assets/monsters', name + '-parts.js'), path.join(root, 'renderer/assets/monsters', name + '-parts.png'))
  for (const f of always) if (!wrote.includes(rel(root, f))) wrote.push(rel(root, f))
  return { ok: true, wrote: wrote.sort() }
}

// repo-relative path -> mtime-free content key, for the dirs publish may touch
function snapshot(root) {
  const out = {}
  for (const d of ['assets/cuts', 'renderer/assets/monsters', 'renderer/render/monster-rigs', 'renderer/data/monsters']) {
    const walk = r => {
      const full = path.join(root, r)
      if (!fs.existsSync(full)) return
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        const p = r + '/' + e.name
        if (e.isDirectory()) walk(p)
        else out[p] = fs.readFileSync(path.join(root, p)).toString('base64')
      }
    }
    walk(d)
  }
  return out
}
