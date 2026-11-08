// Automatic first guess at a monster's pieces (pure, no DOM, no node:
// imports). On a downscaled copy of the mask: the torso core is the thick
// region around the deepest point; whatever sticks out of it is a limb, cut
// where it leaves the core (the line between the two corners where its
// outline meets the core's) unless a cross-section perpendicular to the walk
// out along it is much narrower; limbs are labelled by where they leave the
// core. `weapon` is never guessed. The user corrects the result in the cutter.
import { components, distanceTransform, supercoverLine } from './raster.js'
import { segment } from './segment.js'

const CORE_FRACTION = 0.5 // core = dist >= this * maxDist, grown by this * maxDist
const MIN_LIMB = 0.02 // attached limbs smaller than this share of the mask merge back
const CUT_SPAN = 0.4 // cross-sections are taken over this share of the limb's length
// The cut is the candidate nearest the core no wider than CUT_SLACK times (plus
// 1 work px) the narrowest cross-section: generous, so a limb keeps the
// shoulder ball or the thick base it leaves the core with (Kenney's ball
// joints, a tapering crayon arm) and only a clear neck moves the cut outward.
const CUT_SLACK = 3
const CUT_PUSH = 2 // cut ends sit this many work px past the silhouette
const STEP = 3 // the walk direction at a level spans this many levels either side
const HEAD_CONE = 35 // degrees either side of straight up
const ARM_BAND = 0.45 // arms leave the core above this share of its height (upper half, with a margin)
const SIDE_CONE = 150 // a side limb leaves at most this many degrees from straight up

// Box-filter the mask to W x H, a work pixel set when at least half its box is.
function shrink(mask, w, h, W, H) {
  if (W === w && H === h) return Uint8Array.from(mask)
  const out = new Uint8Array(W * H), sx = w / W, sy = h / H
  for (let Y = 0; Y < H; Y++) {
    const y0 = Math.floor(Y * sy), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((Y + 1) * sy)))
    for (let X = 0; X < W; X++) {
      const x0 = Math.floor(X * sx), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((X + 1) * sx)))
      let on = 0
      for (let y = y0; y < y1; y++) for (let x = x0, i = y * w + x0; x < x1; x++, i++) on += mask[i]
      out[Y * W + X] = 2 * on >= (y1 - y0) * (x1 - x0) ? 1 : 0
    }
  }
  return out
}

// Pixels within r of the region (Euclidean), via a padded distance transform.
function grow(region, W, H, r) {
  const P = Math.ceil(r) + 1, PW = W + 2 * P
  const inv = new Uint8Array(PW * (H + 2 * P)).fill(1)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (region[y * W + x]) inv[(y + P) * PW + x + P] = 0
  const d = distanceTransform(inv, PW, H + 2 * P)
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = d[(y + P) * PW + x + P] <= r ? 1 : 0
  return out
}

// Geodesic distance (2 per straight step, 3 per diagonal) inside one limb,
// from its pixels that touch the core. -> Int32Array, -1 outside the limb.
function walk(pixels, label, id, contact, W, H) {
  const geo = new Int32Array(W * H).fill(-1)
  const buckets = [contact.slice()]
  for (const p of contact) geo[p] = 0
  for (let d = 0; d < buckets.length; d++) {
    for (const p of buckets[d] || []) {
      if (geo[p] !== d) continue
      const x = p % W, y = (p - x) / W
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx, nd = d + (dx && dy ? 3 : 2)
        if (label[q] !== id || (geo[q] !== -1 && geo[q] <= nd)) continue
        geo[q] = nd;
        (buckets[nd] ||= []).push(q)
      }
    }
  }
  return geo
}

// Distance from (x, y) along (ux, uy) to the first off-mask sample.
function reach(m, W, H, x, y, ux, uy) {
  for (let t = 0.5; ; t += 0.5) {
    const px = Math.round(x + ux * t), py = Math.round(y + uy * t)
    if (px < 0 || py < 0 || px >= W || py >= H || !m[py * W + px]) return t
  }
}

// A cut through (x, y) along (ux, uy), reaching a and b px to either side
// before the silhouette; each end is pushed CUT_PUSH px past it.
const cutAt = (x, y, ux, uy, a, b) => ({
  width: a + b,
  ends: [[x + ux * (a + CUT_PUSH), y + uy * (a + CUT_PUSH)], [x - ux * (b + CUT_PUSH), y - uy * (b + CUT_PUSH)]],
})

// The line between the two corners where the limb's outline meets the core's:
// the farthest-apart contact pixels that touch the background.
function contactChord(m, contact, W, H) {
  const rim = contact.filter(p => {
    const x = p % W, y = (p - x) / W
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !m[ny * W + nx]) return true
    }
    return false
  })
  let A = -1, B = -1, far = 0
  for (let i = 0; i < rim.length; i++) for (let j = i + 1; j < rim.length; j++) {
    const p = rim[i], q = rim[j], d = (p % W - q % W) ** 2 + (((p / W) | 0) - ((q / W) | 0)) ** 2
    if (d > far) { far = d; A = p; B = q }
  }
  if (!far) return null
  const ax = A % W, ay = (A - ax) / W, bx = B % W, by = (B - bx) / W, len = Math.sqrt(far)
  return cutAt((ax + bx) / 2, (ay + by) / 2, (ax - bx) / len, (ay - by) / len, len / 2 + 0.5, len / 2 + 0.5)
}

// Does the cut keep a 4-flood from `from` away from `to`?
function separates(m, W, H, ends, from, to) {
  const wall = new Uint8Array(W * H)
  for (const [x, y] of supercoverLine(...ends.map(e => e.map(Math.round)))) {
    if (x >= 0 && y >= 0 && x < W && y < H) wall[y * W + x] = 1
  }
  if (wall[from]) return false
  const seen = new Uint8Array(W * H), stack = [from]
  seen[from] = 1
  while (stack.length) {
    const p = stack.pop()
    if (p === to) return false
    const x = p % W
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
      if (q < 0 || q >= W * H || seen[q] || wall[q] || !m[q]) continue
      seen[q] = 1; stack.push(q)
    }
  }
  return true
}

// One attached limb, in work px: contact point, length, cut, pivot, seed.
// `deep` is the torso's deepest pixel, which the cut must keep off the limb.
function measureLimb(m, dist, label, id, pixels, core, W, H, deep) {
  const contact = pixels.filter(p => {
    const x = p % W
    return (x > 0 && core[p - 1]) || (x < W - 1 && core[p + 1]) || core[p - W] || core[p + W]
  })
  const geo = walk(pixels, label, id, contact, W, H)
  let G = 0
  for (const p of pixels) if (geo[p] > G) G = geo[p]
  // seed: the far end of the limb, its deepest pixel so it maps back onto the mask
  let seed = -1
  for (const p of pixels) if (geo[p] >= 0.9 * G && (seed < 0 || dist[p] > dist[seed])) seed = p

  // walk outward in 1 px levels: each level's centroid, and its pixel nearest that
  const K = G >> 1
  const n = new Float64Array(K + 1), sx = new Float64Array(K + 1), sy = new Float64Array(K + 1)
  for (const p of pixels) {
    if (geo[p] < 0) continue
    const k = geo[p] >> 1, x = p % W
    n[k]++; sx[k] += x; sy[k] += (p - x) / W
  }
  const cx = sx.map((v, k) => (n[k] ? v / n[k] : NaN)), cy = sy.map((v, k) => (n[k] ? v / n[k] : NaN))
  const at = new Int32Array(K + 1).fill(-1), best = new Float64Array(K + 1).fill(Infinity)
  for (const p of pixels) {
    if (geo[p] < 0) continue
    const k = geo[p] >> 1, x = p % W, d = (x - cx[k]) ** 2 + ((p - x) / W - cy[k]) ** 2
    if (d < best[k]) { best[k] = d; at[k] = p }
  }

  // candidates nearest the core first: the contact chord, then the cross-sections
  // perpendicular to the walk over the first CUT_SPAN of the length
  const chord = contactChord(m, contact, W, H)
  const cuts = chord ? [chord] : []
  let narrow = Infinity
  for (let k = 0; k <= Math.floor(CUT_SPAN * K); k++) {
    if (at[k] < 0) continue
    let k0 = Math.max(0, k - STEP), k1 = Math.min(K, k + STEP)
    while (k0 < k && !n[k0]) k0++
    while (k1 > k && !n[k1]) k1--
    const dx = cx[k1] - cx[k0], dy = cy[k1] - cy[k0], len = Math.hypot(dx, dy)
    if (!len) continue
    const x = at[k] % W, y = (at[k] - x) / W, ux = -dy / len, uy = dx / len
    const c = cutAt(x, y, ux, uy, reach(m, W, H, x, y, ux, uy), reach(m, W, H, x, y, -ux, -uy))
    cuts.push(c)
    if (c.width < narrow) narrow = c.width
  }
  const cut = cuts.find(c => c.width <= narrow * CUT_SLACK + 1 && separates(m, W, H, c.ends, seed, deep))
  if (!cut) return null
  const [[x1, y1], [x2, y2]] = cut.ends
  return { contact: [cx[0], cy[0]], length: K, cut: cut.ends, pivot: [(x1 + x2) / 2, (y1 + y2) / 2], seed }
}

// The piece owning the pixel nearest a detached blob: rings out from the blob
// until one reaches an owned pixel, the closest of that ring winning.
function nearestOwner(blob, owner, loose, W, H) {
  const from = new Int32Array(W * H).fill(-1)
  for (const p of blob) from[p] = p
  let ring = blob
  while (ring.length) {
    const next = []
    let best = -1, bestD = Infinity
    for (const p of ring) {
      const x = p % W, y = (p - x) / W
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, q = ny * W + nx
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || from[q] >= 0) continue
        from[q] = from[p]
        if (owner[q] < 0 || loose[q]) { next.push(q); continue }
        const o = from[q], d = (nx - o % W) ** 2 + (ny - ((o / W) | 0)) ** 2
        if (d < bestD) { bestD = d; best = q }
      }
    }
    if (best >= 0) return owner[best]
    ring = next
  }
  return 0
}

export function findPieces(mask, w, h, { work = 256 } = {}) {
  const scale = Math.max(1, Math.max(w, h) / work)
  const W = Math.max(1, Math.round(w / scale)), H = Math.max(1, Math.round(h / scale))
  const kx = w / W, ky = h / H
  const m = shrink(mask, w, h, W, H)
  const dist = distanceTransform(m, W, H)

  // work px -> source px; a seed snaps onto the source mask inside its box
  const toSrc = ([X, Y]) => [Math.round((X + 0.5) * kx - 0.5), Math.round((Y + 0.5) * ky - 0.5)]
  const seedSrc = p => {
    const X = p % W, Y = (p - X) / W
    const [tx, ty] = toSrc([X, Y])
    let out = [tx, ty], bestD = Infinity
    for (let r = 0; bestD === Infinity && r <= Math.ceil(Math.max(kx, ky)) + 2; r++) {
      for (let y = Math.max(0, ty - r); y <= Math.min(h - 1, ty + r); y++) {
        for (let x = Math.max(0, tx - r); x <= Math.min(w - 1, tx + r); x++) {
          const d = (x - tx) ** 2 + (y - ty) ** 2
          if (mask[y * w + x] && d < bestD) { bestD = d; out = [x, y] }
        }
      }
    }
    return out
  }

  let deep = -1
  for (let i = 0; i < W * H; i++) if (m[i] && (deep < 0 || dist[i] > dist[deep])) deep = i
  const torsoSeed = deep < 0 ? [w >> 1, h >> 1] : seedSrc(deep)
  const torso = { id: 'torso', role: 'torso', side: null, parent: null, seed: torsoSeed, cut: null, pivot: torsoSeed.slice(), z: 0, claims: [] }
  if (deep < 0) return [torso]

  // torso core
  const r = CORE_FRACTION * dist[deep]
  const thick = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) thick[i] = dist[i] >= r ? 1 : 0
  const tl = components(thick, W, H).label
  const region = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) region[i] = tl[i] === tl[deep] ? 1 : 0
  const grown = grow(region, W, H, r)
  const core = new Uint8Array(W * H)
  let area = 0, coreN = 0, ccx = 0, ccy = 0, cy0 = H, cy1 = -1
  for (let i = 0; i < W * H; i++) {
    if (!m[i]) continue
    area++
    if (!grown[i]) continue
    core[i] = 1
    const x = i % W, y = (i - x) / W
    coreN++; ccx += x; ccy += y
    if (y < cy0) cy0 = y
    if (y > cy1) cy1 = y
  }
  ccx /= coreN; ccy /= coreN

  // candidate limbs: components of mask minus core
  const rest = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) rest[i] = m[i] && !core[i] ? 1 : 0
  const { label, sizes } = components(rest, W, H)
  const pixels = sizes.map(() => [])
  for (let i = 0; i < W * H; i++) if (label[i] >= 0) pixels[label[i]].push(i)
  const limbs = [], detached = []
  pixels.forEach((px, id) => {
    const touches = px.some(p => {
      const x = p % W
      return (x > 0 && core[p - 1]) || (x < W - 1 && core[p + 1]) || core[p - W] || core[p + W]
    })
    if (!touches) { detached.push(px); return }
    if (px.length < MIN_LIMB * area) return
    const limb = measureLimb(m, dist, label, id, px, core, W, H, deep)
    if (!limb) return
    const [ax, ay] = limb.contact
    limb.angle = Math.atan2(ax - ccx, ccy - ay) * 180 / Math.PI // 0 = up, + = right
    limbs.push(limb)
  })

  // labels. Attached pieces hang on the torso, even a second top limb the spec
  // puts on the head: segment() lets a cut piece take only pixels its parent
  // owns, and its are the torso's. Detached blobs hang on the nearest piece.
  const take = (list, pred) => { const out = list.filter(pred); for (const l of out) list.splice(list.indexOf(l), 1); return out }
  const pool = limbs.slice()
  const top = take(pool, l => Math.abs(l.angle) <= HEAD_CONE).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))
  const head = top.shift()
  const arms = take(pool, l => Math.abs(l.angle) < SIDE_CONE && l.contact[1] < cy0 + ARM_BAND * (cy1 - cy0))
  const legs = pool.sort((a, b) => b.contact[1] - a.contact[1]).splice(0, 2)
  const sides = take(pool, l => Math.abs(l.angle) < SIDE_CONE).sort((a, b) => b.length - a.length)
  const tail = sides.shift()
  const extras = [...top, ...sides, ...pool]

  const ids = new Set(['torso'])
  const uid = base => { let id = base, n = 2; while (ids.has(id)) id = `${base}_${n++}`; ids.add(id); return id }
  const pieces = [torso]
  const at = p => [p % W, (p / W) | 0], round = pt => pt.map(Math.round)
  const workPieces = [{ id: 'torso', parent: null, seed: at(deep), cut: null, pivot: at(deep), claims: [] }]
  const add = (limb, role, base) => {
    const pivot = toSrc(limb.pivot)
    const side = role === 'arm' || role === 'leg' ? (pivot[0] < torsoSeed[0] ? 'left' : 'right') : null
    const id = uid(side ? `${base}_${side[0]}` : base)
    pieces.push({
      id, role, side, parent: 'torso', seed: seedSrc(limb.seed),
      cut: limb.cut.map(toSrc), pivot, z: role === 'tail' ? -1 : 1, claims: [],
    })
    workPieces.push({ id, parent: 'torso', seed: at(limb.seed), cut: limb.cut.map(round), pivot: round(limb.pivot), claims: [] })
  }
  if (head) add(head, 'head', 'head')
  for (const l of arms) add(l, 'arm', 'arm')
  for (const l of legs) add(l, 'leg', 'leg')
  if (tail) add(tail, 'tail', 'tail')
  extras.forEach(l => add(l, 'extra', 'extra'))
  if (detached.length) {
    const { owner } = segment(m, W, H, workPieces) // the attached pieces at work size
    const loose = new Uint8Array(W * H)
    for (const px of detached) for (const p of px) loose[p] = 1
    for (const px of detached) {
      let deepest = px[0]
      for (const p of px) if (dist[p] > dist[deepest]) deepest = p
      const seed = seedSrc(deepest), parent = workPieces[nearestOwner(px, owner, loose, W, H)].id
      pieces.push({ id: uid('extra'), role: 'extra', side: null, parent, seed, cut: null, pivot: seed.slice(), z: 1, claims: [] })
    }
  }

  // a cut that does not hold at full size is dropped (its limb stays with the
  // torso, and anything hung on it moves to the torso)
  const { leaks } = segment(mask, w, h, pieces)
  const kept = pieces.filter(p => !leaks.includes(p.id))
  for (const p of kept) if (leaks.includes(p.parent)) p.parent = 'torso'
  return kept
}
