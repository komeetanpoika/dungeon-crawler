// tools/monster-lab/monster-files.cjs
// Read/write for renderer/data/monsters/. CJS so both the Electron main
// process (load-monsters IPC) and the lab dev server share one implementation.
const fs = require('fs')
const path = require('path')

const NAME_RE = /^[a-z0-9_]+$/

function readMonsters(dir) {
  const warnings = []
  let names
  try { names = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) }
  catch { return { defs: [], warnings: ['monsters: no readable index.json'] } }
  if (!Array.isArray(names)) return { defs: [], warnings: ['monsters: index.json is not an array'] }
  const defs = []
  for (const name of names) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) { warnings.push(`monsters: bad index name "${name}" — skipped`); continue }
    try { defs.push(JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'))) }
    catch { warnings.push(`monsters: ${name}.json missing or invalid — skipped`) }
  }
  return { defs, warnings }
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

function writeMonster(dir, name, data) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`invalid monster name "${name}"`)
  fs.mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, name + '.json'), JSON.stringify({ ...data, name }, null, 2))
  const idx = path.join(dir, 'index.json')
  let names = []
  try { names = JSON.parse(fs.readFileSync(idx, 'utf8')) } catch {}
  if (!Array.isArray(names)) names = []
  if (!names.includes(name)) names.push(name)
  names.sort()
  atomicWrite(idx, JSON.stringify(names, null, 2))
  return { ok: true, name }
}

module.exports = { readMonsters, writeMonster, NAME_RE }
