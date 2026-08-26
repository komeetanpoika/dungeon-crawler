#!/usr/bin/env node
// Arena-test journal/lessons/suggestions logger — see SKILL.md for the
// workflow. Pure text helpers are exported for tests; the CLI wraps them
// with file I/O rooted at this directory (override with ARENA_LOG_DIR).
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const DIR = process.env.ARENA_LOG_DIR ?? path.dirname(SELF)
const REPO = path.resolve(path.dirname(SELF), '../../..')
const JOURNAL = path.join(DIR, 'JOURNAL.md')
const SUGGESTIONS = path.join(DIR, 'SUGGESTIONS.md')
const CONFIG = path.join(REPO, 'arena-config.json')

// ── pure helpers ───────────────────────────────────────────────────────────

export function parseEntries(text) {
  const out = []
  const re = /^## Run (\d+) — (\S+) — (OPEN|CLOSED)$/gm
  let m
  while ((m = re.exec(text))) out.push({ id: Number(m[1]), date: m[2], status: m[3], index: m.index })
  return out
}

export function formatEntry({ id, date, question, criteria, config }) {
  return `\n## Run ${id} — ${date} — OPEN\n**Question:** ${question}\n**Criteria:** ${criteria}\n**Config:** ${config}\n**Score:** —\n**Notes:** —\n`
}

export function closeEntry(text, { score, notes }) {
  const entries = parseEntries(text)
  const open = entries.filter(e => e.status === 'OPEN')
  if (open.length === 0) throw new Error('no OPEN journal entry to close')
  const last = open[open.length - 1]
  const next = entries.find(e => e.index > last.index)
  const end = next ? next.index : text.length
  let block = text.slice(last.index, end)
  block = block.replace(' — OPEN', ' — CLOSED')
  block = block.replace(/^\*\*Score:\*\* —$/m, () => `**Score:** ${score}/5`)
  block = block.replace(/^\*\*Notes:\*\* —$/m, () => `**Notes:** ${notes}`)
  return text.slice(0, last.index) + block + text.slice(end)
}

export function formatSuggestion({ date, runId, text }) {
  return `- [NEW] ${date} (run ${runId ?? '—'}): ${text}\n`
}

export function summarizeConfig(raw) {
  if (raw == null) return '(default boss arena)'
  try {
    const cfg = JSON.parse(raw)
    const kinds = (cfg.enemies ?? []).map(e => e.kind + (e.variant ? `(${e.variant})` : ''))
    return kinds.length ? kinds.join(', ') : '(no enemies)'
  } catch { return '(default boss arena)' }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const today = () => new Date().toISOString().slice(0, 10)
const die = (msg) => { console.error(msg); process.exit(1) }

function cmdOpen() {
  const question = arg('question'), criteria = arg('criteria')
  if (!question || !criteria) die('usage: arena-log.mjs open --question "…" --criteria "…"')
  const text = fs.readFileSync(JOURNAL, 'utf8')
  const entries = parseEntries(text)
  const open = entries.filter(e => e.status === 'OPEN')
  if (open.length) console.error(
    `WARNING: ${open.length} OPEN entr${open.length > 1 ? 'ies' : 'y'} never closed (run ${open.map(e => e.id).join(', ')}) — a past test skipped its assessment.`)
  const id = (entries[entries.length - 1]?.id ?? 0) + 1
  const config = summarizeConfig(fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, 'utf8') : null)
  fs.appendFileSync(JOURNAL, formatEntry({ id, date: today(), question, criteria, config }))
  console.log(`opened run ${id}`)
}

function cmdClose() {
  const score = Number(arg('score')), notes = arg('notes')
  if (!Number.isInteger(score) || score < 1 || score > 5 || !notes)
    die('usage: arena-log.mjs close --score <1-5> --notes "…" [--suggest "…"]')
  const text = fs.readFileSync(JOURNAL, 'utf8')
  let closed
  try { closed = closeEntry(text, { score, notes }) } catch (e) { die(e.message) }
  fs.writeFileSync(JOURNAL, closed)
  const entries = parseEntries(closed)
  const runId = entries[entries.length - 1]?.id
  console.log(`closed run ${runId}: ${score}/5`)
  const suggestion = arg('suggest')
  if (suggestion) {
    fs.appendFileSync(SUGGESTIONS, formatSuggestion({ date: today(), runId, text: suggestion }))
    console.log('suggestion recorded')
  }
}

function cmdSuggest() {
  const text = arg('text')
  if (!text) die('usage: arena-log.mjs suggest --text "…"')
  const entries = parseEntries(fs.readFileSync(JOURNAL, 'utf8'))
  const runId = entries[entries.length - 1]?.id ?? null
  fs.appendFileSync(SUGGESTIONS, formatSuggestion({ date: today(), runId, text }))
  console.log('suggestion recorded')
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const cmd = process.argv[2]
  if (cmd === 'open') cmdOpen()
  else if (cmd === 'close') cmdClose()
  else if (cmd === 'suggest') cmdSuggest()
  else die('usage: arena-log.mjs <open|close|suggest> …')
}
