import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { parseEntries, formatEntry, closeEntry, formatSuggestion, summarizeConfig } from '../.claude/skills/arena-test/arena-log.mjs'

const HEADER = '# Arena Test Journal\n'

describe('arena-log pure helpers', () => {
  it('formatEntry → parseEntries roundtrip', () => {
    const text = HEADER + formatEntry({ id: 1, date: '2026-07-02', question: 'Q?', criteria: 'C', config: 'cyclops' })
    const entries = parseEntries(text)
    assert.equal(entries.length, 1)
    assert.deepEqual([entries[0].id, entries[0].date, entries[0].status], [1, '2026-07-02', 'OPEN'])
  })

  it('closeEntry closes the newest OPEN entry with score and notes', () => {
    let text = HEADER
      + formatEntry({ id: 1, date: '2026-07-01', question: 'A?', criteria: 'a', config: '-' })
      + formatEntry({ id: 2, date: '2026-07-02', question: 'B?', criteria: 'b', config: '-' })
    text = closeEntry(text, { score: 4, notes: 'mostly met' })
    const entries = parseEntries(text)
    assert.equal(entries[0].status, 'OPEN', 'older entry untouched')
    assert.equal(entries[1].status, 'CLOSED')
    assert.ok(text.includes('**Score:** 4/5'))
    assert.ok(text.includes('**Notes:** mostly met'))
  })

  it('closeEntry throws when nothing is OPEN', () => {
    const closed = closeEntry(HEADER + formatEntry({ id: 1, date: 'd', question: 'q', criteria: 'c', config: '-' }), { score: 5, notes: 'n' })
    assert.throws(() => closeEntry(closed, { score: 5, notes: 'n' }), /no OPEN/)
  })

  it('formatSuggestion links the run id', () => {
    assert.equal(formatSuggestion({ date: '2026-07-02', runId: 3, text: 'add hp per enemy' }),
      '- [NEW] 2026-07-02 (run 3): add hp per enemy\n')
  })

  it('summarizeConfig lists enemy kinds, handles missing/invalid input', () => {
    assert.equal(summarizeConfig('{"enemies":[{"kind":"cyclops"},{"kind":"monster","variant":"medium"}]}'), 'cyclops, monster(medium)')
    assert.equal(summarizeConfig('{"enemies":[]}'), '(no enemies)')
    assert.equal(summarizeConfig(null), '(default boss arena)')
    assert.equal(summarizeConfig('not json'), '(default boss arena)')
  })
})

describe('arena-log CLI', () => {
  it('open appends an entry; close closes it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-log-'))
    fs.writeFileSync(path.join(dir, 'JOURNAL.md'), HEADER)
    fs.writeFileSync(path.join(dir, 'SUGGESTIONS.md'), '# Suggestions\n')
    const script = path.resolve('.claude/skills/arena-test/arena-log.mjs')
    const env = { ...process.env, ARENA_LOG_DIR: dir }

    let r = spawnSync('node', [script, 'open', '--question', 'Q?', '--criteria', 'C'], { env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    let journal = fs.readFileSync(path.join(dir, 'JOURNAL.md'), 'utf8')
    assert.equal(parseEntries(journal)[0].status, 'OPEN')

    r = spawnSync('node', [script, 'close', '--score', '5', '--notes', 'met', '--suggest', 'idea'], { env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    journal = fs.readFileSync(path.join(dir, 'JOURNAL.md'), 'utf8')
    assert.equal(parseEntries(journal)[0].status, 'CLOSED')
    assert.ok(fs.readFileSync(path.join(dir, 'SUGGESTIONS.md'), 'utf8').includes('idea'))
  })

  it('open warns about existing OPEN entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-log-'))
    fs.writeFileSync(path.join(dir, 'JOURNAL.md'), HEADER + formatEntry({ id: 1, date: 'd', question: 'q', criteria: 'c', config: '-' }))
    fs.writeFileSync(path.join(dir, 'SUGGESTIONS.md'), '# Suggestions\n')
    const script = path.resolve('.claude/skills/arena-test/arena-log.mjs')
    const r = spawnSync('node', [script, 'open', '--question', 'Q2?', '--criteria', 'C2'],
      { env: { ...process.env, ARENA_LOG_DIR: dir }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stderr, /OPEN/, 'warning about the unclosed entry goes to stderr')
  })
})
