// Browser smoke test of Monster Studio over every tab. Local only (needs
// Chromium via playwright-core, takes minutes because the Fight tab boots the
// real game under software rendering); not part of `npm test`.
//   node tools/monster-studio/smoke.mjs
// Runs against a temp copy of the project data, so the real repo is never written.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createLabServer } from '../monster-lab/server.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const COPIED = ['renderer/data/monsters', 'assets/cuts', 'renderer/assets/monsters', 'renderer/render/monster-rigs']
const FIGHT_TIMEOUT = 180000

let tmp
const inTmp = (...p) => path.join(tmp, ...p)
const readJson = (...p) => JSON.parse(fs.readFileSync(inTmp(...p), 'utf8'))

let server, browser
const pageErrors = []

class StepFailed extends Error {}
const expect = (cond, msg) => { if (!cond) throw new StepFailed(msg) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, what, timeout = 10000) {
  const end = Date.now() + timeout
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new StepFailed(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

async function main() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-smoke-'))
  for (const d of COPIED) fs.cpSync(path.join(repo, d), path.join(tmp, d), { recursive: true })
  server = createLabServer({ root: repo, cutsRoot: tmp })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', e => pageErrors.push(e.message))
  page.setDefaultTimeout(15000)

  const tabBtn = name => page.locator(`#tabs button[data-tab=${name}]`)
  const openViaDialog = async name => {
    await page.click('#open')
    await page.locator('#open-game button', { hasText: new RegExp(`^${name}`) }).click()
    await page.waitForFunction(n => window.studio.state.view?.name === n, name)
  }
  const activeTab = () => page.evaluate(() => window.studio.state.tab)
  // the Fight tab's game: wait until the bench panel exists inside the iframe
  const fightFrame = async () => {
    const t0 = Date.now()
    await tabBtn('fight').click()
    await page.waitForSelector('iframe.fight-frame')
    const frame = page.frameLocator('iframe.fight-frame')
    await frame.locator('#bench-panel').waitFor({ timeout: FIGHT_TIMEOUT })
    return { frame, seconds: Math.round((Date.now() - t0) / 1000) }
  }
  const healthInput = frame => frame.locator('#bench-panel .bp-row', { has: page.locator('label', { hasText: /^Health$/ }) }).locator('input')

  const steps = [
    ['open boarhound via Open…', async () => {
      await page.goto(base + '/studio')
      await page.waitForFunction(() => window.studio)
      await openViaDialog('boarhound')
      await page.waitForFunction(() => window.studio.state.tab === 'movement')
      expect(await activeTab() === 'movement', `active tab is ${await activeTab()}, not movement`)
      expect(await tabBtn('drawing').isDisabled(), 'Drawing tab button should be disabled for a code-drawn monster')
      expect(await tabBtn('cuts').isDisabled(), 'Cuts tab button should be disabled for a code-drawn monster')
      return 'Movement active, Drawing/Cuts disabled'
    }],
    ['movement slider reaches the draft', async () => {
      const slider = page.locator('.movement-sliders input[type=range]').first()
      await slider.waitFor()
      const rigName = readJson('renderer/data/monsters/boarhound.json').rig
      const label = await slider.evaluate(el => el.closest('.row').querySelector('label').textContent)
      const key = await page.evaluate(async ([rig, label]) => {
        const { PARAM_SCHEMA } = await import(`/renderer/render/monster-rigs/${rig}.js`)
        return PARAM_SCHEMA.find(p => p.label === label)?.key
      }, [rigName, label])
      expect(key, `no PARAM_SCHEMA entry labelled "${label}"`)
      const value = await slider.evaluate(el => {
        const min = Number(el.min), max = Number(el.max), cur = Number(el.value)
        const v = Math.abs(cur - max) > Math.abs(cur - min) ? max : min
        el.value = String(v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return v
      })
      await tabBtn('publish').click() // immediately: the tab switch itself must flush the pending save
      await page.waitForFunction(() => window.studio.state.tab === 'publish')
      const params = readJson('drafts/monsters/boarhound/def.json').params // read once, no polling
      expect(params[key] === value, `draft params.${key} is ${params[key]}, expected ${value}`)
      return `tab switch flushed params.${key} = ${value}`
    }],
    ['fight tab runs the game in studio mode', async () => {
      const { frame, seconds } = await fightFrame()
      const iframeEl = await page.$('iframe.fight-frame')
      const fr = await iframeEl.contentFrame()
      await fr.evaluate(() => { window.__smokeMarker = 1 }) // step 4 must see a fresh page without it
      expect(await fr.evaluate(() => window.saveAPI?.isStudio === true), 'saveAPI.isStudio is not true in the game')
      expect((await frame.locator('#bench-panel').textContent()).includes('Fight — health and speed apply on respawn'), 'bench panel lacks the Fight section')
      const hp = healthInput(frame)
      await hp.fill('9')
      await hp.dispatchEvent('change')
      await sleep(1000)
      await until(() => { try { return readJson('drafts/monsters/boarhound/def.json').stats.hp === 9 } catch { return false } }, 'draft stats.hp to be 9', 5000)
      return `game booted in ${seconds}s, draft hp 9`
    }],
    ['discard resets the Fight panel to the game value', async () => {
      await tabBtn('publish').click()
      await page.click('text=Discard draft')
      await page.waitForSelector('#ask[open]')
      await page.click('#ask-ok')
      // the studio re-opens the monster from the game, so a fresh draft may reappear: check it no longer holds 9
      await until(() => { try { return readJson('drafts/monsters/boarhound/def.json').stats.hp !== 9 } catch { return true } }, 'the discarded draft to go', 8000)
      await openViaDialog('boarhound')
      const { frame, seconds } = await fightFrame()
      const fr = await (await page.$('iframe.fight-frame')).contentFrame()
      expect(await fr.evaluate(() => window.__smokeMarker === undefined), 'the Fight iframe is the old page from step 3, not a fresh boot')
      const want = readJson('renderer/data/monsters/boarhound.json').stats.hp
      const v = await healthInput(frame).inputValue()
      expect(Number(v) === want && want !== 9, `Health reads ${v}, expected the published ${want}`)
      return `Health reads ${want} = published (fresh game booted in ${seconds}s)`
    }],
    ['story monster has no Fight tab', async () => {
      await openViaDialog('nakki')
      expect(await tabBtn('fight').isDisabled(), 'Fight tab button should be disabled for nakki')
      return 'Fight disabled'
    }],
    ['new drawing, publish into the open maps', async () => {
      await page.click('#open')
      await page.setInputFiles('#open-file', path.join(repo, 'tools/monster-cutter/fixtures/big-tusk.png'))
      await until(() => fs.existsSync(inTmp('drafts/monsters/big_tusk/cut.json')), 'drafts/monsters/big_tusk/cut.json', 30000)
      await tabBtn('publish').click()
      await page.waitForSelector('.publish-layout')
      const rows = page.locator('.spawn-row')
      const open = rows.nth(1)
      await open.locator('input[type=checkbox]').check()
      await open.locator('input[type=number]').nth(0).fill('7')
      await open.locator('input[type=number]').nth(1).fill('18')
      await open.locator('input[type=number]').nth(2).fill('1')
      await sleep(700)
      await page.click('text=Publish into the game')
      await page.waitForSelector('.result', { timeout: 30000 })
      for (const f of ['assets/cuts/big_tusk.json', 'renderer/render/monster-rigs/big_tusk.js', 'renderer/data/monsters/big_tusk.json'])
        expect(fs.existsSync(inTmp(f)), `${f} was not published`)
      const def = readJson('renderer/data/monsters/big_tusk.json')
      expect(JSON.stringify(def.spawn?.openMaps) === JSON.stringify({ depths: [7, 18], count: 1 }), `spawn.openMaps is ${JSON.stringify(def.spawn?.openMaps)}, expected depths [7,18] count 1`)
      const idx = fs.readFileSync(inTmp('renderer/data/monsters/index.json'), 'utf8')
      expect(idx.includes('big_tusk'), 'index.json does not list big_tusk')
      return `published, spawn ${JSON.stringify(def.spawn)}`
    }],
  ]

  let n = 0
  for (const [title, fn] of steps) {
    n++
    const t0 = Date.now()
    try {
      const note = await fn()
      console.log(`ok   ${n}. ${title} - ${note} (${Math.round((Date.now() - t0) / 1000)}s)`)
    } catch (err) {
      console.error(`FAIL ${n}. ${title} - ${err.message}`)
      if (!(err instanceof StepFailed)) console.error(err.stack)
      if (pageErrors.length) console.error('page errors:', JSON.stringify(pageErrors))
      return 1
    }
  }
  if (pageErrors.length) console.log('note: page errors seen:', JSON.stringify(pageErrors))
  return 0
}

let code = 1
try { code = await main() } catch (err) { console.error('smoke script error:', err.stack) } finally {
  await browser?.close().catch(() => {})
  await new Promise(r => (server ? server.close(r) : r()))
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(code)
