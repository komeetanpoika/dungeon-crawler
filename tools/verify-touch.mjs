// On-demand mobile-layout verification for the web release.
// Usage: node tools/verify-touch.mjs   (from the repo root)
// Boots the static server on :8123, drives chromium in three contexts:
// mobile landscape (controls work), mobile portrait (rotate overlay),
// desktop (no controls). Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = 8123
const URL = `http://localhost:${PORT}`
let failures = 0

function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const server = spawn('node', ['tools/web-server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
})
await new Promise(r => setTimeout(r, 800))

let browser = null
try {
  browser = await chromium.launch()
  // --- Mobile landscape: controls visible, joystick + attack emit keys ---
  const mobile = await browser.newContext({
    viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true,
  })
  const page = await mobile.newPage()
  await page.goto(URL)
  await page.waitForSelector('#game-canvas')
  // #touch-controls is a zero-height wrapper (children are position:fixed),
  // so visibility checks must target a sized child like the joystick zone.
  check('mobile: joystick zone visible',
    await page.locator('#joystick-zone').isVisible())
  check('mobile: rotate overlay hidden in landscape',
    !(await page.locator('#rotate-overlay').isVisible()))

  // The title menu overlay (z-index 10) sits above the controls (z-index 5)
  // and would swallow the drag — hide it; the touch layer dispatches key
  // events regardless of game phase. init() loads sprites asynchronously
  // before calling showTitle(), so wait for the overlay to actually appear
  // first — hiding it too early loses a race against that async render and
  // the overlay reappears mid-interaction.
  await page.locator('#menu-overlay').waitFor({ state: 'visible' })
  await page.evaluate(() => { document.getElementById('menu-overlay').style.display = 'none' })
  // Record every keydown the touch layer dispatches.
  await page.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', e => window.__keys.push(e.key))
  })
  // Drag right inside the joystick zone (pointer events; the module accepts
  // any pointerType, so mouse-driven pointers are fine for verification).
  await page.mouse.move(150, 300)
  await page.mouse.down()
  await page.mouse.move(210, 300, { steps: 5 })
  await page.mouse.up()
  // Press the attack button.
  const attack = await page.locator('#touch-attack').boundingBox()
  await page.mouse.click(attack.x + attack.width / 2, attack.y + attack.height / 2)
  const keys = await page.evaluate(() => window.__keys)
  check("mobile: joystick drag right dispatched 'd'", keys.includes('d'))
  check("mobile: attack button dispatched Space", keys.includes(' '))

  // --- Mobile: attack button revives after a blur-interrupted press ---
  // Task 4 fixed a bug where a button interrupted mid-press by window blur
  // could wedge (pointer state never reset, so subsequent presses no-op).
  // Reset the key log so this check counts only its own two keydowns,
  // independent of the earlier attack-button check above.
  await page.evaluate(() => { window.__keys = [] })
  await page.mouse.move(attack.x + attack.width / 2, attack.y + attack.height / 2)
  await page.mouse.down()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up() // should be a no-op for the button — pointer state was reset
  await page.mouse.click(attack.x + attack.width / 2, attack.y + attack.height / 2)
  const keysAfterBlur = await page.evaluate(() => window.__keys)
  const spaceCount = keysAfterBlur.filter(k => k === ' ').length
  check('mobile: attack button revives after blur-interrupted press', spaceCount === 2)

  await mobile.close()

  // --- Mobile portrait: rotate overlay shown ---
  const portrait = await browser.newContext({
    viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true,
  })
  const p2 = await portrait.newPage()
  await p2.goto(URL)
  check('portrait: rotate overlay visible',
    await p2.locator('#rotate-overlay').isVisible())
  await portrait.close()

  // --- Desktop: no controls, no overlay ---
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const p3 = await desktop.newPage()
  await p3.goto(URL)
  check('desktop: touch controls hidden',
    !(await p3.locator('#joystick-zone').isVisible()))
  check('desktop: rotate overlay hidden',
    !(await p3.locator('#rotate-overlay').isVisible()))
  await desktop.close()
} finally {
  try { if (browser) await browser.close() } finally {
    if (server && !server.killed) server.kill('SIGKILL')
  }
}

console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
