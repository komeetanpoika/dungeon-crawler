// Shared toolkit for the static overworld map generators.
//
// Map format (JSON): {
//   name, biome, technique, notes, w, h,
//   palette: [skinName...],            // index into renderer/assets/tiles
//   ground:  h rows of w palette indices,
//   prop:    h rows of w palette indices, -1 = none (drawn over ground),
//   walk:    h strings of w chars, '1' walkable,
//   pois:    [{kind, x, y, label}],
//   playerSpawn: {x, y},
// }

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Value noise with fBm — hash-gridded lattice, bilinear-smoothstep blend.
export function makeNoise(rng) {
  const perm = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]] }
  const hash = (x, y) => perm[(perm[x & 255] + y) & 255] / 255
  const fade = t => t * t * (3 - 2 * t)
  const at = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
    const u = fade(xf), v = fade(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x, y, { freq = 0.08, octaves = 3 } = {}) => {
    let sum = 0, amp = 1, tot = 0, f = freq
    for (let o = 0; o < octaves; o++) { sum += at(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2 }
    return sum / tot
  }
}

// 2-tall tree pairs: [top, trunk]. Kenney draws these as one tree across two
// cells; either half alone is the half-tree bug the asset review flagged.
export const TREE_PAIRS = [
  ['ow_tree_pine_top', 'ow_tree_pine_trunk'],
  ['ow_tree_autumn_top', 'ow_tree_autumn_trunk'],
]

// The approved house assembly (asset review round 2): 3-wide, 3-tall — roof
// top row, eaves/slate row, edged wall row with the door in the middle. No
// gables and no window tiles, both rejected in review. (x, y) is the top-left.
export function stampHouse3(b, rng, x, y, kind = 'red') {
  const K = {
    red: {
      roof: ['ow_roof_red_l', 'ow_roof_red_m', 'ow_roof_red_r'],
      eaves: ['ow_roof_red_el', 'ow_roof_red_em', 'ow_roof_red_er'],
      walls: ['ow_house_wall_l', 'ow_house_wall_r'],
      doors: ['ow_house_door_gray', 'ow_house_door'],
    },
    brown: {
      roof: ['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'],
      eaves: ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'],
      walls: ['ow_house_wall_brown_l', 'ow_house_wall_brown_r'],
      doors: ['ow_house_door_brown'],
    },
    stone: {
      roof: ['ow_roof_gray_l', 'ow_roof_gray_m', 'ow_roof_gray_r'],
      eaves: ['ow_roof_slate_l', 'ow_roof_slate_m', 'ow_roof_slate_r'],
      walls: ['ow_house_wall_stone_l', 'ow_house_wall_stone_r'],
      doors: ['ow_house_arch_stone'],
    },
  }[kind]
  const door = K.doors[Math.floor(rng() * K.doors.length)]
  for (let i = 0; i < 3; i++) { b.p(x + i, y, K.roof[i]); b.p(x + i, y + 1, K.eaves[i]) }
  b.p(x, y + 2, K.walls[0]); b.p(x + 1, y + 2, door); b.p(x + 2, y + 2, K.walls[1])
}

// Plant a tree at (x, y). A kit lists 2-tall [top, trunk] pairs and complete
// 1-tile trees; the pair needs the cell above free, otherwise a 1-tile tree
// goes in instead.
export function plantTree(b, rng, x, y, kit) {
  const pick = a => a[Math.floor(rng() * a.length)]
  const above = b.in(x, y - 1) && b.walkable(x, y - 1) && b.prop[y - 1][x] === -1
  if (kit.tall?.length && above && rng() < (kit.tallChance ?? 0.6)) {
    const [top, trunk] = pick(kit.tall)
    b.p(x, y - 1, top)
    b.p(x, y, trunk)
  } else b.p(x, y, pick(kit.small))
}

// Clearings, paths, healing bridges and reachability carves all clearProp one
// cell at a time, which can sever a 2-tall tree. Sweep out both orphan halves;
// run this after the last prop-clearing step.
export function pruneBrokenTrees(b) {
  const trunkOf = new Map(TREE_PAIRS)
  const topOf = new Map(TREE_PAIRS.map(([top, trunk]) => [trunk, top]))
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const n = b.palette[b.prop[y][x]]
    if (trunkOf.has(n) && b.palette[b.prop[y + 1]?.[x]] !== trunkOf.get(n)) b.clearProp(x, y)
    else if (topOf.has(n) && b.palette[b.prop[y - 1]?.[x]] !== topOf.get(n)) b.clearProp(x, y)
  }
}

export class MapBuilder {
  constructor(name, biome, technique, w, h) {
    Object.assign(this, { name, biome, technique, w, h, notes: '' })
    this.palette = []
    this.pidx = new Map()
    this.ground = Array.from({ length: h }, () => new Array(w).fill(0))
    this.prop = Array.from({ length: h }, () => new Array(w).fill(-1))
    this.walkG = Array.from({ length: h }, () => new Array(w).fill(true))
    this.pois = []
    this.playerSpawn = { x: 1, y: 1 }
  }
  skin(name) {
    if (!this.pidx.has(name)) { this.pidx.set(name, this.palette.length); this.palette.push(name) }
    return this.pidx.get(name)
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h }
  g(x, y, skin) { if (this.in(x, y)) this.ground[y][x] = this.skin(skin) }
  // prop implies blocking unless walkable: true (e.g. flowers, path props)
  p(x, y, skin, { walkable = false } = {}) {
    if (!this.in(x, y)) return
    this.prop[y][x] = this.skin(skin)
    if (!walkable) this.walkG[y][x] = false
  }
  clearProp(x, y) { if (this.in(x, y)) { this.prop[y][x] = -1; this.walkG[y][x] = true } }
  block(x, y) { if (this.in(x, y)) this.walkG[y][x] = false }
  unblock(x, y) { if (this.in(x, y)) this.walkG[y][x] = true }
  walkable(x, y) { return this.in(x, y) && this.walkG[y][x] }
  poi(kind, x, y, label) { this.pois.push({ kind, x, y, label }) }

  // Nearest walkable open cell by expanding square search — for snapping
  // hand-guessed coordinates onto actual land.
  nearestOpen(x, y) {
    for (let r = 0; r < Math.max(this.w, this.h); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = x + dx, ny = y + dy
        if (this.in(nx, ny) && this.walkG[ny][nx] && this.prop[ny][nx] === -1) return { x: nx, y: ny }
      }
    }
    return { x, y }
  }

  // Scatter n points, min separation sep, on cells passing `ok`.
  scatter(rng, n, sep, ok, tries = 4000) {
    const out = []
    for (let t = 0; t < tries && out.length < n; t++) {
      const x = 2 + Math.floor(rng() * (this.w - 4)), y = 2 + Math.floor(rng() * (this.h - 4))
      if (!ok(x, y)) continue
      if (out.every(q => Math.abs(q.x - x) + Math.abs(q.y - y) >= sep)) out.push({ x, y })
    }
    return out
  }

  // All connected walkable components, largest first.
  components() {
    const seen = Array.from({ length: this.h }, () => new Array(this.w).fill(false))
    const out = []
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (seen[y][x] || !this.walkG[y][x]) continue
      const cells = []
      const stack = [[x, y]]
      seen[y][x] = true
      while (stack.length) {
        const [cx, cy] = stack.pop()
        cells.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy
          if (this.in(nx, ny) && !seen[ny][nx] && this.walkG[ny][nx]) { seen[ny][nx] = true; stack.push([nx, ny]) }
        }
      }
      out.push(cells)
    }
    return out.sort((a, b) => b.length - a.length)
  }

  // Reconnect the map: pockets below minKeep are filled solid (fill(x, y)
  // plants the biome's blocker), larger ones get a corridor carved to the
  // NEAREST other component — not the largest, which could sit across the
  // whole map and turn "shortest crossing" into a wall-to-wall causeway.
  // Pairwise nearest joins repeat until one component remains.
  healFragmentation({ minKeep = 30, fill = null, groundSkin = null } = {}) {
    for (let guard = 0; guard < 500; guard++) {
      const comps = this.components()
      if (comps.length <= 1) return
      const pocket = comps[1]
      if (pocket.length < minKeep && fill) {
        for (const [cx, cy] of pocket) { fill(cx, cy); this.block(cx, cy) }
      } else {
        const other = Array.from({ length: this.h }, () => new Array(this.w).fill(false))
        for (const comp of comps) if (comp !== pocket) for (const [cx, cy] of comp) other[cy][cx] = true
        this.bridgeToMain(other, pocket, groundSkin)
      }
    }
  }

  // Shortest crossing from a pocket to the target grid: multi-source BFS
  // out of the pocket, first target cell reached wins, blocked cells along the
  // backtracked path are opened (skinned as causeway/bridge). groundSkin may
  // be a string (always repaint) or (x, y) => skin|null (e.g. pier over water
  // only, so a bridge through a tree pocket doesn't pave the forest floor).
  bridgeToMain(main, pocketCells, groundSkin) {
    const key = (x, y) => y * this.w + x
    const prev = new Map()
    let queue = []
    for (const [cx, cy] of pocketCells) { prev.set(key(cx, cy), null); queue.push([cx, cy]) }
    while (queue.length) {
      const next = []
      for (const [cx, cy] of queue) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy
          if (!this.in(nx, ny) || prev.has(key(nx, ny))) continue
          prev.set(key(nx, ny), [cx, cy])
          if (main[ny][nx]) {
            let at = [cx, cy]
            while (at) {
              const [ax, ay] = at
              if (!this.walkG[ay][ax]) {
                const skin = typeof groundSkin === 'function' ? groundSkin(ax, ay) : groundSkin
                this.clearProp(ax, ay)
                if (skin) this.g(ax, ay, skin)
                this.unblock(ax, ay)
              }
              at = prev.get(key(ax, ay))
            }
            return
          }
          next.push([nx, ny])
        }
      }
      queue = next
    }
  }

  // Largest connected walkable component; returns a same-shape boolean grid.
  largestComponent() {
    const seen = Array.from({ length: this.h }, () => new Array(this.w).fill(false))
    let best = null
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (seen[y][x] || !this.walkG[y][x]) continue
      const cells = []
      const stack = [[x, y]]
      seen[y][x] = true
      while (stack.length) {
        const [cx, cy] = stack.pop()
        cells.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy
          if (this.in(nx, ny) && !seen[ny][nx] && this.walkG[ny][nx]) { seen[ny][nx] = true; stack.push([nx, ny]) }
        }
      }
      if (!best || cells.length > best.length) best = cells
    }
    const grid = Array.from({ length: this.h }, () => new Array(this.w).fill(false))
    for (const [cx, cy] of best ?? []) grid[cy][cx] = true
    return grid
  }

  // Nearest cell of the largest component to (x, y).
  nearestReachable(main, x, y) {
    let best = null, bd = Infinity
    for (let cy = 0; cy < this.h; cy++) for (let cx = 0; cx < this.w; cx++) {
      if (!main[cy][cx]) continue
      const d = Math.abs(cx - x) + Math.abs(cy - y)
      if (d < bd) { bd = d; best = { x: cx, y: cy } }
    }
    return best
  }

  // Carve an L-shaped walkable path (x first, then y), clearing props and
  // repainting ground. Used both for roads and as the reachability fixer.
  carveL(x0, y0, x1, y1, groundSkin, width = 1) {
    const paint = (x, y) => {
      for (let dy = -(width >> 1); dy <= (width >> 1); dy++)
        for (let dx = -(width >> 1); dx <= (width >> 1); dx++) {
          if (!this.in(x + dx, y + dy)) continue
          const skin = typeof groundSkin === 'function' ? groundSkin(x + dx, y + dy) : groundSkin
          this.clearProp(x + dx, y + dy)
          if (skin) this.g(x + dx, y + dy, skin)
          this.unblock(x + dx, y + dy)
        }
    }
    let x = x0, y = y0
    while (x !== x1) { paint(x, y); x += x < x1 ? 1 : -1 }
    while (y !== y1) { paint(x, y); y += y < y1 ? 1 : -1 }
    paint(x, y)
  }

  // Make every POI and the spawn reach the largest component by carving.
  ensureReachable(groundSkin) {
    for (const p of [...this.pois, this.playerSpawn]) {
      const main = this.largestComponent()
      // POIs may sit on a blocking prop (a cave mouth in rocks) — adjacency is
      // enough. The spawn must itself be standable.
      const strict = p === this.playerSpawn
      const onMain = main[p.y]?.[p.x] ||
        (!strict && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => main[p.y + dy]?.[p.x + dx]))
      if (onMain) continue
      const near = this.nearestReachable(main, p.x, p.y)
      if (near) this.carveL(near.x, near.y, p.x, p.y, groundSkin)
    }
  }

  toJSON() {
    return {
      name: this.name, biome: this.biome, technique: this.technique, notes: this.notes,
      w: this.w, h: this.h, palette: this.palette,
      ground: this.ground, prop: this.prop,
      walk: this.walkG.map(row => row.map(v => v ? '1' : '0').join('')),
      pois: this.pois, playerSpawn: this.playerSpawn,
    }
  }
}

// Sanity: spawn + every POI must sit in (or adjacent to) one connected
// walkable region. Returns a list of problems; generators fix or fail loudly.
export function validate(b) {
  const main = b.largestComponent()
  const okAt = (x, y) => main[y]?.[x] ||
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => main[y + dy]?.[x + dx])
  const problems = []
  if (!main[b.playerSpawn.y]?.[b.playerSpawn.x]) problems.push('spawn not in main component')
  for (const p of b.pois) if (!okAt(p.x, p.y)) problems.push(`poi ${p.label} unreachable`)
  const total = b.walkG.flat().filter(Boolean).length
  const inMain = main.flat().filter(Boolean).length
  if (inMain / total < 0.9) problems.push(`main component only ${(inMain / total * 100).toFixed(0)}% of walkable`)
  return problems
}
