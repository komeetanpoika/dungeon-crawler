// Boots the game, starts Adventure, and asserts NPCs exist, move, and speak.
// Usage: DISPLAY=:0 node tools/verify-npcs.mjs   (≈15 s)
//
// Requires --dcdebug so game.js wires up window.__dc = { get state() {...} }
// (see renderer/game.js, main.cjs) — inert in a normal `npm start` launch.
import { _electron as electron } from 'playwright-core'

const app = await electron.launch({ args: ['.', '--dcdebug'], env: { ...process.env, DISPLAY: ':0' } })
try {
  const page = await app.firstWindow()
  page.on('pageerror', e => console.log('PAGEERROR', e.message))

  await page.waitForFunction(() => window.__dc?.state || document.querySelector('canvas'))
  // Start Adventure through the title menu (Adventure is the first item;
  // Enter both selects and confirms it — see renderer/ui/menu.js showTitle).
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)

  const snap = () => page.evaluate(() => {
    const s = window.__dc?.state
    return s ? s.entities.filter(e => e.type === 'npc').map(e => ({ id: e.id, px: e.px, py: e.py, hostile: e.hostile })) : null
  })

  const a = await snap()
  if (!a || !a.length) throw new Error('no npcs on the surface')
  await page.waitForTimeout(5000)
  const b = await snap()
  const moved = a.filter((e, i) => Math.hypot(e.px - b[i].px, e.py - b[i].py) > 8).length
  console.log(`npcs: ${a.length}, moved in 5s: ${moved}`)
  if (moved === 0) throw new Error('no npc moved')

  // Walk the player onto each peaceful NPC in turn and press F. Villagers
  // (species with `lines`) answer with a speech bubble anchored to them
  // (feedback.js speakFrom); animals (species with `react`) instead get a
  // reaction timer set on their own ai state — no NPC_SPECIES data is exposed
  // to the page, so try every peaceful npc and accept either signal as proof
  // F-interaction fires (renderer/systems/npc.js interactNpc).
  const ids = (await snap()).filter(e => !e.hostile).map(e => e.id)
  let sawBubble = false, sawReact = false
  for (const id of ids) {
    const teleported = await page.evaluate((id) => {
      const s = window.__dc.state
      const npc = s.entities.find(e => e.id === id)
      if (!npc) return false
      s.player.px = npc.px; s.player.py = npc.py
      npc._reactBefore = JSON.stringify({ r: npc.ai?.reactTimer, s: npc.ai?.startleTimer })
      return true
    }, id)
    if (!teleported) continue
    await page.keyboard.press('f')
    await page.waitForTimeout(300)
    const result = await page.evaluate((id) => {
      const s = window.__dc.state
      const npc = s.entities.find(e => e.id === id)
      const reacted = npc && JSON.stringify({ r: npc.ai?.reactTimer, s: npc.ai?.startleTimer }) !== npc._reactBefore
      return { bubble: s.feedback.bubble, reacted }
    }, id)
    if (result.bubble && result.bubble.kind === 'speech' && result.bubble.anchorId === id) {
      console.log(`F beside ${id}: speech bubble "${result.bubble.text}"`)
      sawBubble = true
      break
    }
    if (result.reacted) {
      console.log(`F beside ${id}: reaction cue (hop/startle timer set)`)
      sawReact = true
    }
  }
  if (!sawBubble && !sawReact) throw new Error('F beside a peaceful npc produced neither a speech bubble nor a reaction cue')
  console.log(`F-interaction: bubble=${sawBubble} react=${sawReact}`)

  console.log('VERIFY-NPCS OK')
} finally {
  await app.close()
}
