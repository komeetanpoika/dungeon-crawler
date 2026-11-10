// The Movement tab: the monster's real rig (through the /sg/ game mirror, on
// the draft's own parts) walking on a stage, with its PARAM_SCHEMA sliders.
// Slider edits change the live params at once and are saved to the draft's
// def.json 400 ms after the last one; flush() sends a pending save now. Only
// the keys the game's copy holds and the ones off their default are saved.
// A monster with a cut also gets the posing screen: the Idle / Walk / Attack
// switch, the posing view (pose-editor.js) over the selected phase card, the
// cards themselves (phase-cards.js), and the stage as the preview, driven by
// the preview clock with a timeline under it. Its animations live in a
// working copy, played by the engine as params.anims and saved whole as the
// def's anims in the same debounced save as the params. Code-drawn and story
// monsters keep the plain tab: the stage with its state buttons, no anims.
import { makeStage } from '/tools/monster-lab/stage.js'
import { buildParamsPanel } from '/tools/monster-lab/params-panel.js'
import { clampParams, sparseValues } from '/renderer/render/monster-rigs/schema.js'
import { ANIM_NAMES, cleanAnims, isActive, attackTiming, loopLength } from '/renderer/render/monster-rigs/anims.js'
import { startAnim, addPhase, deletePhase, setTime, setHit, setName, setPieces, resetPieces, resetCard, toSaved, timingSummary }
  from '/tools/monster-studio/anim-edit.js'
import { jointGroups } from '/tools/monster-studio/pose-math.js'
import { makePreviewClock, previewZoom } from '/tools/monster-studio/preview-clock.js'
import { mountPoseEditor, drawStill } from '/tools/monster-studio/pose-editor.js'
import { mountPhaseCards } from '/tools/monster-studio/phase-cards.js'
import { toast } from '/tools/tile-editor/toast.js'

const SAVE_DELAY = 400
const PLAIN_STAGE = 480       // the stage canvas on its own (code-drawn and story monsters)
const PREVIEW_STAGE = [380, 400] // the stage as the posing screen's preview
const PREVIEW_ORIGIN = { x: 0.5, y: 0.82 } // its entity centre: the feet near the bottom, room above for raised poses
const ANIM_LABEL = { idle: 'Idle', walk: 'Walk', attack: 'Attack' }
const MOVE_COLOURS = ['#5a8fd8', '#8a6bd8', '#3fa37a', '#d8a13f']
const BACK_COLOUR = '#6b7c93', HIT_COLOUR = '#e0533d'

export function mountMovementTab(rootEl, { api }) {
  rootEl.replaceChildren()
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e }
  const canvas = make('canvas', { width: PLAIN_STAGE, height: PLAIN_STAGE, className: 'movement-stage' })
  const simBar = make('div', { className: 'movement-bar' })
  const zoom = make('input', { type: 'range', min: 1, max: 4, step: 0.5, value: 2 })
  const floor = make('input', { type: 'checkbox', checked: true })
  const hitbox = make('input', { type: 'checkbox' })
  const stageBar = make('div', { className: 'movement-bar' },
    make('label', {}, 'zoom ', zoom),
    make('label', { className: 'check' }, floor, ' floor'),
    make('label', { className: 'check' }, hitbox, ' hitbox'))
  const message = make('p', { className: 'info' })
  const panel = make('div', { className: 'movement-sliders' })

  // the posing screen (hidden for a monster without a cut)
  const animBtns = ANIM_NAMES.map(n => { const b = make('button', { type: 'button', textContent: ANIM_LABEL[n] }); b.dataset.anim = n; return b })
  const weaponNote = make('span', { className: 'movement-warn' })
  const animBar = make('div', { className: 'movement-anims', hidden: true },
    make('span', { className: 'lbl', textContent: 'Animation:' }), ...animBtns, weaponNote)
  const posingCanvas = make('canvas', { width: 520, height: 440, className: 'movement-posing' })
  const readout = make('p', { className: 'movement-readout' })
  const resetPieceBtn = make('button', { type: 'button', textContent: 'Reset piece', title: 'Put the selected piece (and its joint-mates) back to rest on this card' })
  const resetCardBtn = make('button', { type: 'button', textContent: 'Reset card', title: 'Put every piece back to rest on this card' })
  const cardsEl = make('div', { className: 'movement-cards' })
  const poseCol = make('div', { className: 'movement-pose', hidden: true },
    posingCanvas, readout,
    make('div', { className: 'movement-bar' }, resetPieceBtn, resetCardBtn),
    make('p', { className: 'hint', textContent: 'Turn and stretch by dragging the dots. The yellow dots are the joints, as set in the Cuts tab.' }),
    cardsEl)
  const timeline = make('div', { className: 'movement-timeline' })
  const playhead = make('span', { className: 'playhead', hidden: true })
  const timelineText = make('p', { className: 'movement-tl-text' })
  const previewHead = make('h2', { textContent: 'Preview' })
  const preview = make('div', { className: 'movement-preview', hidden: true }, previewHead, timeline, timelineText)
  const builtInNote = make('p', { className: 'movement-note', hidden: true })

  const left = make('div', { className: 'movement-left' }, canvas, simBar, stageBar)
  const layout = make('div', { className: 'movement-layout' }, poseCol, left,
    make('div', { className: 'movement-side' }, preview, message, builtInNote, panel))
  rootEl.append(animBar, layout)

  const stage = makeStage(canvas, simBar)
  zoom.oninput = () => { stage.zoom = Number(zoom.value) }
  floor.onchange = () => { stage.backdrop = floor.checked }
  hitbox.onchange = () => { stage.overlay = hitbox.checked }

  let schema = []
  let name = null
  let params = null
  let baseline = {}          // the params keys the game's copy (or a new draft) holds
  let timer = null
  let dirty = false          // params (or anims) differ from what the draft holds
  let inflight = Promise.resolve()
  let sending = 0            // saves on their way
  let labelsFor = null       // the monster whose rig labels `schema` holds

  // posing state, for a monster with a cut
  let posable = false
  let figure = null          // { rig, engine, parts, params, groups } for the posing view and thumbnails
  let working = {}           // the animations as edited; the engine plays cleanAnims(working)
  let hasWeapon = true
  let animName = 'idle'
  let selectedCard = { idle: 0, walk: 0, attack: 0 }
  let selectedPiece = null
  let posingFor = null       // the monster the animation/card/piece choices above belong to
  let previewClock = makePreviewClock()
  let playheadAt = null

  const say = text => { message.textContent = text; panel.replaceChildren() }

  // One save of the current params (and anims); a failure keeps `dirty` so the next try resends.
  function send() {
    clearTimeout(timer); timer = null
    if (!dirty) return inflight
    const forName = name, patch = { params: sparseValues(schema, params, baseline) }
    if (posable) {
      const saved = toSaved(working)
      patch.anims = Object.keys(saved).length ? saved : null // nothing posed: no anims key in the def
    }
    dirty = false
    sending++
    inflight = inflight.catch(() => {}).then(async () => {
      try { await api.patchDef(forName, patch) } catch (err) { dirty = true; throw err } finally { sending-- }
    })
    return inflight
  }

  function queueSave() {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => send().catch(err => toast(`Movement not saved: ${err.message}`, 'error')), SAVE_DELAY)
  }

  function change(key, value) {
    params[key] = value
    queueSave()
  }

  // ---- the posing screen ----
  const posing = mountPoseEditor(posingCanvas, {
    onDrag(ids, values) { edit(setPieces(working, animName, cardIndex(), ids, values)) },
    onSelect(id) { selectedPiece = id; renderReadout() },
  })
  const cardsUi = mountPhaseCards(cardsEl, {
    onSelect(i) { selectedCard[animName] = i; renderPosing() },
    onTime(i, t) { edit(setTime(working, animName, i, t)) },
    onHit(i) { edit(setHit(working, i)) },
    onDelete(i) {
      const sel = cardIndex()
      edit(deletePhase(working, animName, i), i < sel ? sel - 1 : sel)
    },
    onAdd() {
      const { anims, index } = addPhase(working, animName, cardIndex())
      edit(anims, index)
    },
    onName(i, text) { edit(setName(working, animName, i, text)) },
    drawThumb(c, pose) { drawStill(c.getContext('2d'), figure, pose, c.width, c.height) },
  })

  const currentAnim = () => working[animName] ?? startAnim()
  const cardIndex = () => Math.min(selectedCard[animName] ?? 0, currentAnim().phases.length - 1)

  // Every edit: the new working copy, what the engine plays, then the screen and the save.
  function edit(next, sel) {
    working = next
    params.anims = cleanAnims(working)
    if (sel !== undefined) selectedCard[animName] = sel
    selectedCard[animName] = cardIndex()
    renderPosing()
    queueSave()
  }

  function renderPosing() {
    if (!posable) return
    for (const b of animBtns) b.classList.toggle('active', b.dataset.anim === animName)
    const anim = currentAnim(), i = cardIndex()
    posing.setPose(anim.phases[i].pose)
    cardsUi.render(anim, animName, i)
    renderReadout()
    renderTimeline()
    weaponNote.hidden = !(animName === 'attack' && !hasWeapon)
    weaponNote.textContent = `${name} has no weapon, so it never attacks in the game. Pick one on the Fight tab.`
    const plain = ANIM_NAMES.filter(n => !isActive(params.anims[n]))
    builtInNote.textContent = 'Arm swing, foot lift, leg swing, head nod, tail sway and attack reach only move animations without phases: '
      + `${plain.length ? plain.join(', ') : 'none'}.`
  }

  function renderReadout() {
    resetPieceBtn.disabled = !selectedPiece
    if (!selectedPiece) { readout.textContent = 'Pick a white dot to turn and stretch a piece.'; return }
    const ch = currentAnim().phases[cardIndex()].pose[selectedPiece] ?? {}
    const turn = ch.turn ?? 0, stretch = ch.stretch ?? 1
    readout.textContent = `${selectedPiece}: turned ${Math.round(turn)}°, stretched ${stretch.toFixed(2)}×`
  }

  function renderTimeline() {
    const sum = timingSummary(currentAnim(), animName)
    timeline.replaceChildren(...sum.moves.map(m => {
      const colour = m.index === 0 ? BACK_COLOUR : animName === 'attack' && m.hit ? HIT_COLOUR : MOVE_COLOURS[(m.index - 1) % MOVE_COLOURS.length]
      return make('div', {
        textContent: m.index === 0 ? '↺' : String(m.index + 1),
        title: m.index === 0 ? `back to start ${m.time.toFixed(2)} s` : `into card ${m.index + 1}: ${m.time.toFixed(2)} s`,
        style: `width:${(m.time / sum.total * 100).toFixed(2)}%;background:${colour}`,
      })
    }), playhead)
    const b = text => make('b', { textContent: text })
    if (!isActive(currentAnim())) timelineText.textContent = 'One pose so far, so the built-in motion plays. + Add phase to make it move.'
    else if (sum.missingHit) timelineText.textContent = 'No card is marked as the hit.'
    else if (animName === 'attack') timelineText.replaceChildren('Windup ', b(`${sum.windup.toFixed(2)} s`), " (the player's time to dodge) → ",
      make('b', { className: 'hit', textContent: 'blow lands' }), ' → back to start ', b(`${sum.followThrough.toFixed(2)} s`))
    else timelineText.replaceChildren('Loop ', b(`${sum.total.toFixed(2)} s`))
  }

  // where the preview is in the playing sequence; called each frame the stage draws
  function movePlayhead(p) {
    const anim = params?.anims?.[animName]
    let u = null
    if (isActive(anim)) {
      const total = loopLength(anim)
      if (animName !== 'attack') u = (p.animT % total) / total
      else {
        const tm = attackTiming(anim)
        if (tm && p.attack) u = (p.attack.phase === 'swing' ? tm.windup + Math.min(p.attack.t, tm.followThrough) : p.attack.t) / total
      }
    }
    if ((u === null) !== playhead.hidden) playhead.hidden = u === null
    if (u !== null && u !== playheadAt) { playheadAt = u; playhead.style.left = `${(Math.min(1, u) * 100).toFixed(2)}%` }
  }

  for (const b of animBtns) b.onclick = () => {
    if (!posable || b.dataset.anim === animName) return
    animName = b.dataset.anim // no flush: the three animations save together
    previewClock.select(animName, params.anims, stage.sim.t)
    renderPosing()
  }
  resetPieceBtn.onclick = () => {
    if (selectedPiece) edit(resetPieces(working, animName, cardIndex(), figure.groups.get(selectedPiece) ?? [selectedPiece]))
  }
  resetCardBtn.onclick = () => edit(resetCard(working, animName, cardIndex()))

  // The posing screen on or off; off is exactly the plain tab.
  function setPosable(on) {
    posable = on
    layout.classList.toggle('posable', on)
    animBar.hidden = poseCol.hidden = preview.hidden = builtInNote.hidden = !on
    left.hidden = on
    const [w, h] = on ? PREVIEW_STAGE : [PLAIN_STAGE, PLAIN_STAGE]
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    if (on) previewHead.after(canvas, simBar, stageBar)
    else left.append(canvas, simBar, stageBar)
    stage.setStateButtons(!on)
    stage.setOrigin(on ? PREVIEW_ORIGIN : undefined)
    if (!on) {
      stage.setPoseExtra(null)
      figure = null
      cardsUi.clear()
      posing.setFigure(null)
    }
  }

  // The drawing the rig draws from, loaded here so the posing view and the
  // thumbnails (which don't redraw on their own) can redraw when it arrives.
  function loadSheet(view, rig) {
    if (typeof rig._setSheetImage !== 'function') return
    const img = new Image()
    img.onload = () => { if (figure?.rig === rig) { posing.redraw(); cardsUi.redrawThumbs() } }
    img.src = `/sg/${view.name}@${view.rev}/renderer/assets/monsters/${view.name}-parts.png`
    rig._setSheetImage(img)
  }

  // The preview opens at a zoom its tallest pose (rig.drawnTop covers every
  // card) and its rest drawing with the lunge fit; the slider moves it on.
  function fitPreview(rig, parts) {
    const { w, h } = parts.figure
    const halfWidth = (w / 2 * params.size / h + params.lunge) * 32
    const z = previewZoom({ top: rig.drawnTop?.(params, 32) ?? null, halfWidth }, ...PREVIEW_STAGE, PREVIEW_ORIGIN,
      { min: Number(zoom.min), max: 2, step: Number(zoom.step) })
    zoom.value = String(z)
    stage.zoom = z
  }

  function startPosing(view, rig, engine, parts) {
    const fresh = posingFor !== view.name
    if (fresh) {
      animName = 'idle'
      selectedCard = { idle: 0, walk: 0, attack: 0 }
      selectedPiece = null
      posingFor = view.name
    }
    const groups = jointGroups(parts)
    if (!groups.has(selectedPiece)) selectedPiece = null
    working = cleanAnims(view.def.anims)
    params.anims = cleanAnims(working)
    hasWeapon = !!view.def.behavior?.weapon
    figure = { rig, engine, parts, params, groups }
    setPosable(true)
    if (fresh) fitPreview(rig, parts)
    previewClock = makePreviewClock({ faces: parts.faces })
    previewClock.select(animName, params.anims, stage.sim.t)
    playheadAt = null
    stage.setPoseExtra(sim => {
      const p = previewClock.pose(sim.t, params.anims)
      movePlayhead(p)
      return p
    })
    cardsUi.clear()
    posing.setFigure(figure)
    posing.select(selectedPiece)
    renderPosing()
  }

  return {
    async show(view) {
      await this.flush()
      name = view.name
      params = null
      schema = []
      labelsFor = null
      stage.setRig(null)
      setPosable(false)
      if (view.buildError) return say(`Fix the cut first: ${view.buildError}`)
      const base = `/sg/${view.name}@${view.rev}/renderer`
      let rig, engine = null, parts = null
      try {
        rig = await import(`${base}/render/monster-rigs/${view.def.rig}.js`)
        if (view.cut) {
          // the same URLs the rig's own imports resolve to, so the same instances
          const [eng, partsMod] = await Promise.all([import(`${base}/render/monster-rigs/cutout.js`), import(`${base}/assets/monsters/${view.name}-parts.js`)])
          if (typeof eng.pieceFrames === 'function' && partsMod.PARTS) [engine, parts] = [eng, partsMod.PARTS]
        }
      } catch (err) {
        return say(`Could not load the rig: ${err.message}`)
      }
      schema = rig.PARAM_SCHEMA
      labelsFor = view.name
      params = clampParams(schema, view.def.params ?? {})
      baseline = { ...((view.isNew ? view.def.params : view.published?.params) ?? {}) }
      message.textContent = ''
      if (engine) loadSheet(view, rig)
      stage.setRig(rig)
      stage.setParams(params)
      stage.setHalf(rig.hitHalf?.(params) ?? 8)
      buildParamsPanel(panel, schema, params, change)
      if (engine) startPosing(view, rig, engine, parts)
    },
    hide() {},
    flush() { return send() },
    pending: () => dirty || !!timer || sending > 0,
    // the rig's slider labels, only when they were loaded for this monster ({} otherwise)
    labels(forName) { return forName && forName === labelsFor ? Object.fromEntries(schema.map(p => [p.key, p.label])) : {} },
    // for scripts (the studio smoke): the animations as edited, and the posing view
    debug: { get working() { return working }, posing },
  }
}
