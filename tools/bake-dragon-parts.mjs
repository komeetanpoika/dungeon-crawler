// Bake the vector dragon boss's parts into one palette-locked pixel sprite sheet.
//
//   node tools/bake-dragon-parts.mjs           → writes *.generated.* only (safe)
//   node tools/bake-dragon-parts.mjs --force   → overwrites the shipped sheet + frame table
//
// The shipped sheet is meant to be hand-refined in a pixel editor afterwards, so
// the default is deliberately non-destructive: a stray re-run must never clobber
// hand-drawn art. Only --force writes the real files.
//
// How it works: renderer/render/dragonboss.js is drawn with vector canvas calls
// and keeps its part functions module-private. Rather than duplicating that art
// code here (which would immediately drift), the bake serves the repo over a
// local HTTP server, fetches the module's own source, appends an export of the
// private functions, and imports the patched text as a blob URL.
//
// What that does and does not guarantee: the DRAWING can never drift — every
// pixel comes from the shipping functions themselves. The TUNING CONSTANTS they
// are called with are transcribed by hand below (segment counts, width tapers,
// plate heights, the gradient shades, the flap/wiggle angles, and the box()
// reach literals), because in dragonboss.js they live inside inline arrow
// arguments closing over per-frame state. Retune the renderer and this file must
// be re-synced by hand; each site carries a `mirrors dragonboss.js:NNN` anchor.
// A stale flapAt/wigAt is the dangerous one: it bakes in a rotation that the
// placement code then applies a second time.
//
// Do not restructure the shipping draw path to hoist those constants out — that
// is the wrong trade for a one-shot tool. If baking ever becomes a routine build
// step, the transcription-free answer is to rebind shieldScale inside the
// patched module text and record the (w, h, top, bot, CTM) of every plate a
// single real drawDragonBoss() call emits.
//
// Each part is drawn alone into a small canvas at art resolution and quantised
// to DRAGON_PALETTE, then the parts are shelf-packed into one sheet.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { DRAGON_PALETTE } from '../renderer/data/dragon-palette.js'
import { readPng } from './png-read.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FORCE = process.argv.includes('--force')

const SHEET_PNG = path.join(ROOT, 'renderer/assets/tiles/dragon_boss_parts.png')
const TABLE_JS = path.join(ROOT, 'renderer/data/dragon-parts.js')
const outFile = (p, ext) => FORCE ? p : p.replace(new RegExp(`\\${ext}$`), `.generated${ext}`)

// 1 art pixel = ART_PX screen px. The rest of the tileset is 16x16 art in a 32px
// tile (i.e. 2); 4 is deliberately chunkier, because the boss is a 3x4-tile
// creature and half-tile-resolution scales read as mush at that size.
const ART_PX = 4
const S = 32                 // tile size the vector renderer is tuned against
const T_BAKE = 0             // animation time the parts are frozen at
const WRAP = 256             // shelf-pack wrap width, in art px

// ── local static server (the page must be same-origin with the module fetch) ──
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]))
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

const browser = await chromium.launch()
let baked
try {
  const page = await browser.newPage()
  // Navigate to the served origin first, so the fetch() below is same-origin.
  await page.goto(`http://127.0.0.1:${PORT}/renderer/index.html`)
  await page.evaluate(async (url) => {
    const src = await (await fetch(url)).text()
    const patched = `${src}\nwindow.__P = { shieldScale, scaleBody, wing, foot, head, flameCone }\n`
    await import(URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })))
  }, `http://127.0.0.1:${PORT}/renderer/render/dragonboss.js`)

  baked = await page.evaluate(({ PALETTE, ART_PX, S, T_BAKE, WRAP }) => {
    const P = window.__P
    const MARGIN = 2         // art px of guaranteed transparent border around every part

    // Alpha is all-or-nothing: anything below half opacity disappears entirely
    // (and is zeroed on every channel), anything above becomes solid and snaps
    // to the nearest palette entry. Pixel art has no soft edges — a downsample's
    // feathered rim is exactly what makes baked art look like a downsample.
    function quantise(ctx, w, h) {
      const img = ctx.getImageData(0, 0, w, h), d = img.data
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue }
        d[i + 3] = 255
        let best = 0, bd = Infinity
        for (let p = 0; p < PALETTE.length; p++) {
          const [r, g, b] = PALETTE[p]
          const dist = (d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2
          if (dist < bd) { bd = dist; best = p }
        }
        d[i] = PALETTE[best][0]; d[i + 1] = PALETTE[best][1]; d[i + 2] = PALETTE[best][2]
      }
      ctx.putImageData(img, 0, 0)
      return img
    }

    // Canvas box from how far the art reaches around its own origin, in SCREEN px
    // (left/right/up/down), converted to art px with a transparent margin. The
    // scale rows of scaleBody deliberately overflow the body outline, so every
    // reach below is measured from the drawn art, not from the logical shape.
    // Undersize one and the silhouette gets shorn — the clear-border report at
    // the end of this file is what catches that, and it exits non-zero.
    function box(l, r, u, d) {
      const ox = Math.ceil(l / ART_PX) + MARGIN
      const oy = Math.ceil(u / ART_PX) + MARGIN
      return { w: ox + Math.ceil(r / ART_PX) + MARGIN, h: oy + Math.ceil(d / ART_PX) + MARGIN, ox, oy }
    }

    // Transparent border left on each side. 0 anywhere means the art is touching
    // the frame edge and is probably cut.
    function clearMargins(img, w, h) {
      let x0 = w, y0 = h, x1 = -1, y1 = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (img.data[(y * w + x) * 4 + 3] === 0) continue
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
      return x1 < 0 ? null : { left: x0, right: w - 1 - x1, top: y0, bottom: h - 1 - y1 }
    }

    // (ox, oy) is the joint the part rotates about: exactly the translate the
    // bake used, so placement code can rotate the sprite about that pixel.
    function bake(b, draw) {
      const c = document.createElement('canvas')
      c.width = b.w; c.height = b.h
      const ctx = c.getContext('2d')
      ctx.save()
      ctx.translate(b.ox, b.oy)
      ctx.scale(1 / ART_PX, 1 / ART_PX)     // the vector code's units are screen px
      draw(ctx)
      ctx.restore()
      const img = quantise(ctx, b.w, b.h)
      return { ...b, img, margins: clearMargins(img, b.w, b.h) }
    }

    // Per-segment gradient — transcribed, mirrors dragonboss.js:79-80.
    const shade = (front, dk) => [
      `rgb(${(70 + front * 26) * dk | 0},${(22 + front * 12) * dk | 0},${(16 + front * 7) * dk | 0})`,
      `rgb(${(150 + front * 50) * dk | 0},${(56 + front * 24) * dk | 0},${(44 + front * 14) * dk | 0})`,
    ]
    // wing() and foot() bake their own animated rotation into the drawing. Each
    // part must come out UNROTATED so the placement code owns the angle, so both
    // are wrapped in the exact inverse of what they are about to apply. These two
    // are the transcriptions that hurt most if they go stale: a wrong angle here
    // is silently applied twice at draw time.
    const flapAt = t => Math.sin(t * 1.5) * 0.12 + 0.22      // mirrors dragonboss.js:88 (rotate(-flap))
    const wigAt = (t, bx) => Math.sin(t * 2.0 + bx) * 0.05   // mirrors dragonboss.js:119-121 (rotate(wig))

    const parts = {}

    // Body: already centred on the origin and unrotated.
    parts.body = bake(box(2.2 * S, 2.2 * S, 3.3 * S, 2.7 * S),
      ctx => P.scaleBody(ctx, 3 * S, 4 * S, S))

    // Neck plates: shieldScale is centred and unrotated; scaledChain supplies
    // the width taper and the per-segment shading.
    // Transcribed, mirrors dragonboss.js:200-206 — segs 5, segLen S*0.7 (plate
    // height segLen*1.7, see :81), width taper S*0.95 - i*S*0.07, dk 1.0.
    for (let i = 0; i < 5; i++) {
      const w = S * 0.95 - i * S * 0.07, h = S * 0.7 * 1.7
      const [top, bot] = shade(1 - i / 5, 1.0)
      parts[`neck${i}`] = bake(box(w / 2 + 2, w / 2 + 2, h / 2 + 2, h / 2 + 2),
        ctx => P.shieldScale(ctx, w, h, top, bot))
    }
    // Tail plates 0..4. Joints 5 and 6 taper to 3.8 and 2.4 art px — an
    // undrawable smear — so they are fused into one elongated tail_tip sprite.
    // Transcribed, mirrors dragonboss.js:194-195 — segs 7, segLen S*0.8 (plate
    // height segLen*1.7, see :81), width taper (7-i)/7*S*1.2 + 4, dk 0.95.
    for (let i = 0; i < 5; i++) {
      const w = (7 - i) / 7 * S * 1.2 + 4, h = S * 0.8 * 1.7
      const [top, bot] = shade(1 - i / 7, 0.95)
      parts[`tail${i}`] = bake(box(w / 2 + 2, w / 2 + 2, h / 2 + 2, h / 2 + 2),
        ctx => P.shieldScale(ctx, w, h, top, bot))
    }
    {
      const w = Math.max((7 - 5) / 7 * S * 1.2 + 4, 3 * ART_PX), h = S * 0.8 * 1.7 * 2
      const [top, bot] = shade(1 - 5 / 7, 0.95)
      parts.tail_tip = bake(box(w / 2 + 2, w / 2 + 2, h / 2 + 2, h / 2 + 2),
        ctx => P.shieldScale(ctx, w, h, top, bot))
    }

    // Head: ang = -PI/2 makes head()'s internal rotate(ang + PI/2) a no-op, so
    // the head bakes in its own frame (-y = snout, +y = neck).
    parts.head = bake(box(1.2 * S, 1.2 * S, 1.8 * S, 1.6 * S),
      ctx => P.head(ctx, { x: 0, y: 0, ang: -Math.PI / 2 }, S))

    // Wing: cancel the flap. Origin is the shoulder pivot, near the left edge.
    parts.wing = bake(box(0.2 * S, 7.2 * S, 3.2 * S, 2.4 * S),
      ctx => { ctx.rotate(flapAt(T_BAKE)); P.wing(ctx, 0, 0, 1, T_BAKE, S) })

    // Foot: bx=1, by=0 forces foot()'s out = atan2(by, bx) to 0; translate(-1, 0)
    // undoes its translate(bx, by). It ALSO applies rotate(wig), which is not 0
    // at bx=1 (sin(1)*0.05 ≈ 2.4°), so cancel that first — rotate before
    // translate, so the two translates meet and annihilate.
    parts.foot = bake(box(0.5 * S, 1.7 * S, 1.0 * S, 1.0 * S),
      ctx => { ctx.rotate(-wigAt(T_BAKE, 1)); ctx.translate(-1, 0); P.foot(ctx, 1, 0, 1, T_BAKE, S) })

    // Flame: apex at the origin, aimed along +x. Already unrotated.
    parts.flame = bake(box(0.1 * S, 5.4 * S, 2.0 * S, 2.0 * S),
      ctx => P.flameCone(ctx, 0, 0, 0, S))

    // Every part, in the order the packer walks them. NOT a draw order: the
    // renderer builds its own sequence, and within a chain scaledChain draws
    // ascending (dragonboss.js:77), so plate 0 is the bottom layer.
    const order = [
      'body', 'head', 'wing', 'foot', 'flame',
      'neck0', 'neck1', 'neck2', 'neck3', 'neck4',
      'tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail_tip',
    ]

    // Shelf-pack, 1 px gutter, wrapping at WRAP.
    const GUT = 1
    let cx = 0, cy = 0, shelf = 0, sheetW = 0
    for (const name of order) {
      const p = parts[name]
      if (cx > 0 && cx + p.w > WRAP) { cx = 0; cy += shelf + GUT; shelf = 0 }
      p.x = cx; p.y = cy
      cx += p.w + GUT
      shelf = Math.max(shelf, p.h)
      sheetW = Math.max(sheetW, cx - GUT)
    }
    const sheetH = cy + shelf

    const sheet = document.createElement('canvas')
    sheet.width = sheetW; sheet.height = sheetH
    const sctx = sheet.getContext('2d')
    // putImageData, not drawImage: a straight pixel copy with no blending, so
    // the strict 0-or-255 alpha survives into the PNG.
    for (const name of order) sctx.putImageData(parts[name].img, parts[name].x, parts[name].y)

    const table = {}
    for (const name of order) {
      const { x, y, w, h, ox, oy, margins } = parts[name]
      table[name] = { x, y, w, h, ox, oy, margins }
    }
    return { order, table, sheetW, sheetH, dataUrl: sheet.toDataURL('image/png') }
  }, { PALETTE: DRAGON_PALETTE, ART_PX, S, T_BAKE, WRAP })
} finally {
  await browser.close()
  server.close()
}

// ── write the sheet + the frame table ────────────────────────────────────────
const pngPath = outFile(SHEET_PNG, '.png')
const jsPath = outFile(TABLE_JS, '.js')
fs.writeFileSync(pngPath, Buffer.from(baked.dataUrl.split(',')[1], 'base64'))

const rows = baked.order.map(name => {
  const f = baked.table[name]
  return `  ${(name + ':').padEnd(11)} { x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h}, ox: ${f.ox}, oy: ${f.oy} },`
}).join('\n')

fs.writeFileSync(jsPath, `// GENERATED by tools/bake-dragon-parts.mjs — do not expect a re-bake to preserve
// edits made here. Re-bake with:  node tools/bake-dragon-parts.mjs --force
//
// It is safe to hand-edit this file (and the sheet PNG) afterwards: the game
// reads only what is here, so once a part has been redrawn by hand, adjust its
// frame here and stop re-baking that part. The plain (no --force) bake writes
// *.generated.* precisely so it can be compared without destroying hand work.
//
// ART_PX is ${ART_PX}: one art pixel is ${ART_PX} screen px. The rest of the tileset is 16x16
// art in a 32px tile (i.e. 2) — the dragon is deliberately chunkier, because at
// tileset resolution its scales read as mush. Its source of truth is
// tools/bake-dragon-parts.mjs; change it there and re-bake, because a re-bake
// overwrites whatever is written here.
//
// Each frame: x/y/w/h locate it in the sheet; ox/oy is the joint the part
// rotates about, in sprite-local art px.
//
// Two things to know before redrawing anything:
//  - There is ONE wing and ONE foot here. The renderer mirrors and rotates them
//    into two wings and four feet, so asymmetric detail drawn into either will
//    show up mirrored on the other side.
//  - ox/oy correctness is the one invariant no test can check. Move art within
//    its frame without updating them and the part is silently misplaced at
//    runtime — the sheet will still look perfectly fine on its own.
export const ART_PX = ${ART_PX}
export const SHEET_SPRITE = 'dragon_parts'

export const PARTS = {
${rows}
}

// Every part in the sheet. Not a draw order — the renderer builds its own.
export const PART_NAMES = [
${baked.order.map(n => `  '${n}',`).join('\n')}
]
`)

// ── report: how much clear border each part actually kept ────────────────────
// The scales overflow the body outline on purpose, so a too-small canvas shears
// the silhouette. A margin of 0 on any side means the art is touching the frame
// edge and is probably cut.
console.log(`sheet ${baked.sheetW}x${baked.sheetH} art px -> ${path.relative(ROOT, pngPath)}`)
console.log('part         frame      origin    clear border L/R/T/B')
let tight = []
for (const name of baked.order) {
  const f = baked.table[name], m = f.margins
  if (!m) { tight.push(`${name} (EMPTY)`); continue }
  const min = Math.min(m.left, m.right, m.top, m.bottom)
  if (min === 0) tight.push(name)
  console.log(`  ${name.padEnd(10)} ${`${f.w}x${f.h}`.padEnd(9)} ${`${f.ox},${f.oy}`.padEnd(9)} ` +
              `${m.left} ${m.right} ${m.top} ${m.bottom}${min === 0 ? '   <-- touching the edge' : ''}`)
}
// Non-zero exit, not just a warning: this report is the only automated check
// that box()'s reach values still match the art, and it prints above the
// success line where it is easy to scroll past.
if (tight.length) {
  console.log(`\nWARNING: art touches the frame edge on: ${tight.join(', ')} — grow that part's box.`)
  process.exitCode = 1
}

// Round-trip the written PNG so the report reflects the file, not just the canvas.
const png = readPng(pngPath)
let soft = 0
for (let i = 3; i < png.pixels.length; i += 4) if (png.pixels[i] !== 0 && png.pixels[i] !== 255) soft++
console.log(`\nwrote ${path.relative(ROOT, jsPath)} (${baked.order.length} parts); ` +
            `PNG reads back ${png.width}x${png.height}, ${soft} partial-alpha pixels`)
if (!FORCE) {
  console.log('\nNOTE: no --force, so nothing shipped was touched — wrote *.generated.* only.' +
              (fs.existsSync(SHEET_PNG) ? `\n      ${path.relative(ROOT, SHEET_PNG)} already exists and may contain hand-drawn art.` : ''))
}
