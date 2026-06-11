import { SIZE, idx, wrapIndex, floodFill, rgbaToHex, hexToRgba } from './lib.js'

const MAX_UNDO = 50

export class PixelEditor {
  constructor(canvas, { onChange, onPickColor }) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.grid = new Array(SIZE * SIZE).fill(null)
    this.undoStack = []
    this.redoStack = []
    this.tool = 'pencil'
    this.color = '#5a5a72ff'
    this.wrap = true
    this.onChange = onChange
    this.onPickColor = onPickColor
    this.drawing = false
    canvas.addEventListener('pointerdown', e => this.#down(e))
    canvas.addEventListener('pointermove', e => this.#move(e))
    window.addEventListener('pointerup', () => { this.drawing = false })
    this.render()
  }

  #cellAt(e) {
    const r = this.canvas.getBoundingClientRect()
    let x = Math.floor((e.clientX - r.left) / r.width * SIZE)
    let y = Math.floor((e.clientY - r.top) / r.height * SIZE)
    if (this.wrap) { x = wrapIndex(x); y = wrapIndex(y) }
    else {
      x = Math.max(0, Math.min(SIZE - 1, x))
      y = Math.max(0, Math.min(SIZE - 1, y))
    }
    return { x, y }
  }

  #down(e) {
    // Pointer capture keeps move events coming outside the canvas, which is
    // what makes wrap-drawing past an edge work.
    this.canvas.setPointerCapture(e.pointerId)
    const { x, y } = this.#cellAt(e)
    if (this.tool === 'picker') {
      const c = this.grid[idx(x, y)]
      if (c && this.onPickColor) this.onPickColor(c)
      return
    }
    this.#snapshot()
    if (this.tool === 'fill') {
      this.grid = floodFill(this.grid, x, y, this.color, this.wrap)
      this.#changed()
      return
    }
    this.drawing = true
    this.#paint(x, y)
  }

  #move(e) {
    if (!this.drawing) return
    const { x, y } = this.#cellAt(e)
    this.#paint(x, y)
  }

  #paint(x, y) {
    const value = this.tool === 'eraser' ? null : this.color
    if (this.grid[idx(x, y)] === value) return
    this.grid[idx(x, y)] = value
    this.#changed()
  }

  #snapshot() {
    this.undoStack.push(this.grid.slice())
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
  }

  undo() {
    if (!this.undoStack.length) return
    this.redoStack.push(this.grid)
    this.grid = this.undoStack.pop()
    this.#changed()
  }

  redo() {
    if (!this.redoStack.length) return
    this.undoStack.push(this.grid)
    this.grid = this.redoStack.pop()
    this.#changed()
  }

  setGrid(grid) {
    this.#snapshot()
    this.grid = grid.slice()
    this.#changed()
  }

  #changed() {
    this.render()
    if (this.onChange) this.onChange()
  }

  render() {
    const { ctx, canvas } = this
    const z = canvas.width / SIZE
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const c = this.grid[idx(x, y)]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(x * z, y * z, z, z)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    for (let i = 1; i < SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * z, 0); ctx.lineTo(i * z, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * z); ctx.lineTo(canvas.width, i * z); ctx.stroke()
    }
  }

  // 16×16 canvas of the current grid — used for save and previews.
  toCanvas() {
    const c = document.createElement('canvas')
    c.width = SIZE; c.height = SIZE
    const imgData = c.getContext('2d').createImageData(SIZE, SIZE)
    this.grid.forEach((hex, i) => {
      if (!hex) return
      const [r, g, b, a] = hexToRgba(hex)
      imgData.data.set([r, g, b, a], i * 4)
    })
    c.getContext('2d').putImageData(imgData, 0, 0)
    return c
  }

  loadImageData(imgData) {
    const grid = new Array(SIZE * SIZE).fill(null)
    for (let i = 0; i < SIZE * SIZE; i++) {
      const [r, g, b, a] = imgData.data.slice(i * 4, i * 4 + 4)
      if (a > 0) grid[i] = rgbaToHex(r, g, b, a)
    }
    this.setGrid(grid)
  }
}
