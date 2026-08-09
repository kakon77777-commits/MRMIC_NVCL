const NS = 'http://www.w3.org/2000/svg'
const $ = selector => document.querySelector(selector)

const canvas = $('#canvas')
const shell = $('#canvas-shell')
const objectsGroup = $('#objects')
const previewGroup = $('#preview')
const selectionGroup = $('#selection')
const cursorGroup = $('#remote-cursors')
const connection = $('#connection')
const revisionLabel = $('#revision')
const zoomLabel = $('#zoom')
const modePill = $('#mode-pill')
const frameIdLabel = $('#frame-id')
const frameAgeLabel = $('#frame-age')
const eventsPanel = $('#events')
const toast = $('#toast')

let state = { objects: [], canvas: { id: 'canvas-root', revision: 0 }, sync: { stateVector: {}, presence: [] }, lab: { history: { undo: 0, redo: 0 } } }
let viewport = { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }
let observation = null
let observationMode = 'pixel'
let selectedId = null
let activeTool = 'select'
let interaction = null
let socket = null
let presence = new Map()
let toastTimer = null
let viewportCommitTimer = null
let viewportCommitInFlight = false

const clientId = sessionStorage.getItem('mrmic-client-id') || `browser-${crypto.randomUUID().slice(0, 8)}`
sessionStorage.setItem('mrmic-client-id', clientId)
let stateVector = JSON.parse(localStorage.getItem(`mrmic-vector:${clientId}`) || '{}')
const cursorColor = `hsl(${Math.abs([...clientId].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360} 75% 48%)`

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  return node
}

function actionId(kind) {
  return `phase7-${kind}-${crypto.randomUUID()}`
}

function showToast(message, error = false) {
  clearTimeout(toastTimer)
  toast.textContent = message
  toast.className = `toast show${error ? ' error' : ''}`
  toastTimer = setTimeout(() => { toast.className = 'toast' }, 2600)
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`)
    error.code = payload.code
    throw error
  }
  return payload
}

async function freshObservation(mode = observationMode) {
  const payload = await jsonRequest(`/api/lab/observe?mode=${encodeURIComponent(mode)}`)
  observation = payload.observation
  updateObservationUi()
  return observation
}

async function fetchState() {
  const payload = await jsonRequest('/api/state')
  state = payload
  viewport = { ...viewport, ...payload.viewport, width: shell.clientWidth, height: shell.clientHeight }
  if (selectedId && !state.objects.some(object => object.id === selectedId)) selectedId = null
  render()
  await fetchEvents()
}

async function fetchEvents() {
  const payload = await jsonRequest('/api/events')
  eventsPanel.replaceChildren(...payload.events.slice(-9).reverse().map(event => {
    const card = document.createElement('div')
    card.className = 'event'
    const title = document.createElement('strong')
    title.textContent = event.intent
    const detail = document.createElement('span')
    detail.textContent = `${event.actor.actorId} · ${event.objectIds.join(', ') || 'no objects'}`
    card.append(title, detail)
    return card
  }))
}

function updateObservationUi() {
  modePill.textContent = observationMode.toUpperCase()
  if (!observation) {
    frameIdLabel.textContent = 'frame 尚未取得'
    frameAgeLabel.textContent = 'age —'
    return
  }
  frameIdLabel.textContent = `frame ${observation.frameId.slice(0, 8)}`
  const age = Math.max(0, Date.now() - Date.parse(observation.observedAt))
  frameAgeLabel.textContent = `age ${age} ms`
}

function showEvidence(evidence) {
  const guard = $('#guard-status')
  const passed = evidence.transitionGuard === 'passed' && evidence.freshnessVerified
  guard.className = `guard ${passed ? 'pass' : 'fail'}`
  guard.textContent = passed ? 'Freshness 與 Transition Guard：PASS' : 'Transition Guard：FAIL'
  $('#evidence-action').textContent = evidence.actionId
  $('#evidence-freshness').textContent = `${evidence.freshnessMs} ms · ${evidence.freshnessVerified ? 'fresh' : 'stale'}`
  $('#evidence-frames').textContent = `${evidence.beforeFrameId.slice(0, 8)} → ${evidence.afterFrameId.slice(0, 8)}`
  $('#evidence-hash').textContent = `${evidence.beforeStateHash.slice(0, 8)} → ${evidence.afterStateHash.slice(0, 8)}`
}

function currentTransform(object) {
  if (!interaction || interaction.objectId !== object.id) return object.transform
  if (interaction.kind === 'move') return { ...object.transform, x: interaction.currentX, y: interaction.currentY }
  if (interaction.kind === 'resize') return { ...object.transform, width: interaction.currentWidth, height: interaction.currentHeight }
  return object.transform
}

function applyShapeStyle(node, object) {
  node.setAttribute('fill', object.style.fill || 'none')
  node.setAttribute('stroke', object.style.stroke || 'none')
  node.setAttribute('stroke-width', object.style.strokeWidth ?? 0)
  node.setAttribute('opacity', object.style.opacity ?? 1)
  node.setAttribute('vector-effect', 'non-scaling-stroke')
}

function renderObject(object) {
  const t = currentTransform(object)
  const group = svgElement('g', { 'data-object-id': object.id, class: 'object-shape' })
  const centerX = t.x + t.width / 2
  const centerY = t.y + t.height / 2
  if (t.rotation) group.setAttribute('transform', `rotate(${t.rotation} ${centerX} ${centerY})`)

  let shape
  if (['rectangle', 'frame', 'group'].includes(object.type)) {
    shape = svgElement('rect', { x: t.x, y: t.y, width: t.width, height: t.height, rx: object.metadata.cornerRadius ?? 10 })
    if (object.type === 'frame') shape.setAttribute('stroke-dasharray', '11 7')
    if (object.type === 'group') shape.setAttribute('stroke-dasharray', '4 6')
  } else if (object.type === 'ellipse') {
    shape = svgElement('ellipse', { cx: centerX, cy: centerY, rx: t.width / 2, ry: t.height / 2 })
  } else if (object.type === 'line') {
    shape = svgElement('line', { x1: t.x, y1: t.y, x2: t.x + t.width, y2: t.y + t.height })
  } else if (object.type === 'freehand') {
    shape = svgElement('path', { d: object.content?.pathData || `M ${t.x} ${t.y} L ${t.x + t.width} ${t.y + t.height}` })
    shape.setAttribute('fill', 'none')
  } else if (object.type === 'text' || object.type === 'agent_note') {
    shape = svgElement('text', {
      x: t.x,
      y: t.y + (object.style.fontSize ?? 28),
      'font-size': object.style.fontSize ?? 28,
      'font-family': object.style.fontFamily || 'Inter, Noto Sans TC, system-ui, sans-serif',
      'font-weight': object.metadata.fontWeight ?? 700,
    })
    shape.textContent = object.content?.text || ''
  } else if (object.type === 'subcanvas') {
    shape = svgElement('rect', { x: t.x, y: t.y, width: t.width, height: t.height, rx: 14 })
    shape.setAttribute('stroke-dasharray', '8 6')
    const label = svgElement('text', { x: t.x + 18, y: t.y + 36, fill: '#5b21b6', 'font-size': 18, 'font-weight': 750 })
    label.textContent = `↳ ${object.content?.text || 'Subcanvas'}`
    group.append(shape, label)
    applyShapeStyle(shape, object)
    return group
  } else {
    shape = svgElement('rect', { x: t.x, y: t.y, width: t.width, height: t.height, rx: 8 })
  }

  applyShapeStyle(shape, object)
  group.append(shape)
  return group
}

function renderSelection() {
  selectionGroup.replaceChildren()
  const object = state.objects.find(item => item.id === selectedId)
  if (!object) return
  const t = currentTransform(object)
  selectionGroup.append(
    svgElement('rect', { class: 'selection-box', x: t.x - 5, y: t.y - 5, width: t.width + 10, height: t.height + 10, rx: 8 }),
    svgElement('circle', { class: 'resize-handle', 'data-resize-handle': object.id, cx: t.x + t.width + 5, cy: t.y + t.height + 5, r: 7 }),
  )
}

function renderPreview() {
  previewGroup.replaceChildren()
  if (!interaction || interaction.kind !== 'draw') return
  const box = normalizedBox(interaction.start, interaction.current)
  let node
  if (interaction.tool === 'ellipse') node = svgElement('ellipse', { cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2 })
  else if (interaction.tool === 'freehand') node = svgElement('path', { d: pathData(interaction.points), fill: 'none' })
  else node = svgElement('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8 })
  node.setAttribute('class', 'preview-shape')
  node.setAttribute('fill', interaction.tool === 'freehand' ? 'none' : '#c7d2fe')
  previewGroup.append(node)
}

function renderPresence() {
  cursorGroup.replaceChildren(...[...presence.values()].filter(item => item.clientId !== clientId && item.cursor).map(item => {
    const group = svgElement('g')
    const dot = svgElement('circle', { cx: item.cursor.x, cy: item.cursor.y, r: 7, fill: item.color || '#ef4444', stroke: 'white', 'stroke-width': 2 })
    const label = svgElement('text', { x: item.cursor.x + 10, y: item.cursor.y - 10, fill: item.color || '#ef4444', 'font-size': 14, 'font-weight': 700 })
    label.textContent = item.label
    group.append(dot, label)
    return group
  }))
}

function renderInspector() {
  const object = state.objects.find(item => item.id === selectedId)
  $('#empty-inspector').hidden = Boolean(object)
  $('#object-controls').hidden = !object
  if (!object) return
  $('#object-name').textContent = object.id
  $('#object-type').textContent = object.type
  $('#object-text').value = object.content?.text || ''
  $('#object-text').disabled = !['text', 'agent_note', 'subcanvas'].includes(object.type)
  $('#object-fill').value = validHex(object.style.fill, '#ffffff')
  $('#object-stroke').value = validHex(object.style.stroke, '#172033')
  $('#inspector').textContent = JSON.stringify(object, null, 2)
}

function render() {
  canvas.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width / viewport.zoom} ${viewport.height / viewport.zoom}`)
  canvas.dataset.tool = activeTool
  objectsGroup.replaceChildren(...state.objects.slice().sort((a, b) => a.transform.zIndex - b.transform.zIndex).map(renderObject))
  renderPreview()
  renderSelection()
  renderPresence()
  renderInspector()
  revisionLabel.textContent = `revision ${state.canvas.revision}`
  zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`
  $('#undo').disabled = !(state.lab?.history?.undo > 0)
  $('#redo').disabled = !(state.lab?.history?.redo > 0)
}

function validHex(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function normalizedBox(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

function toWorld(event) {
  const bounds = canvas.getBoundingClientRect()
  return {
    x: viewport.x + (event.clientX - bounds.left) / bounds.width * (viewport.width / viewport.zoom),
    y: viewport.y + (event.clientY - bounds.top) / bounds.height * (viewport.height / viewport.zoom),
  }
}

function pathData(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

async function executeLabAction(action, frame, quiet = false) {
  try {
    const result = await jsonRequest('/api/lab/action', {
      method: 'POST',
      body: JSON.stringify({
        mode: observationMode,
        action: {
          actionId: action.actionId || actionId(action.type),
          frameId: frame.frameId,
          canvasId: frame.canvasId,
          expectedCanvasRevision: frame.canvasRevision,
          actor: { actorType: 'user', actorId: clientId, instanceId: 'phase7-browser' },
          ...action,
        },
      }),
    })
    observation = result.observation
    showEvidence(result.evidence)
    await fetchState()
    updateObservationUi()
    if (!quiet) showToast(`${result.evidence.actionType} 已完成並驗證`)
    return result
  } catch (error) {
    await fetchState().catch(() => {})
    await freshObservation().catch(() => {})
    showToast(`${error.code || 'ERROR'}：${error.message}`, true)
    throw error
  }
}

async function createText(point) {
  const frame = await freshObservation()
  await executeLabAction({
    type: 'create',
    object: {
      type: 'text',
      transform: { x: point.x, y: point.y, width: 180, height: 42 },
      style: { fill: '#172033', stroke: 'none', fontSize: 28 },
      content: { text: '文字' },
      metadata: { role: 'user-text' },
    },
  }, frame)
  activateTool('select')
}

async function onPointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return
  canvas.focus()
  const point = toWorld(event)
  const resizeId = event.target.closest?.('[data-resize-handle]')?.dataset.resizeHandle
  const objectId = event.target.closest?.('[data-object-id]')?.dataset.objectId

  if (resizeId && activeTool === 'select') {
    const object = state.objects.find(item => item.id === resizeId)
    if (!object) return
    selectedId = resizeId
    interaction = {
      kind: 'resize', objectId: resizeId, pointerId: event.pointerId, start: point,
      originalWidth: object.transform.width, originalHeight: object.transform.height,
      currentWidth: object.transform.width, currentHeight: object.transform.height,
      framePromise: freshObservation(),
    }
  } else if (objectId && activeTool === 'select') {
    const object = state.objects.find(item => item.id === objectId)
    if (!object) return
    selectedId = objectId
    interaction = {
      kind: 'move', objectId, pointerId: event.pointerId, start: point,
      originalX: object.transform.x, originalY: object.transform.y,
      currentX: object.transform.x, currentY: object.transform.y,
      framePromise: freshObservation(),
    }
  } else if (activeTool === 'text') {
    selectedId = null
    render()
    await createText(point)
    return
  } else if (['rectangle', 'ellipse', 'freehand'].includes(activeTool)) {
    selectedId = null
    interaction = {
      kind: 'draw', tool: activeTool, pointerId: event.pointerId, start: point, current: point,
      points: [point], framePromise: freshObservation(),
    }
  } else {
    selectedId = objectId || null
    interaction = {
      kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      originX: viewport.x, originY: viewport.y,
    }
    canvas.classList.add('dragging')
  }

  canvas.setPointerCapture(event.pointerId)
  render()
}

function onPointerMove(event) {
  const point = toWorld(event)
  sendPresence(point)
  if (!interaction || interaction.pointerId !== event.pointerId) return
  if (interaction.kind === 'move') {
    interaction.currentX = interaction.originalX + point.x - interaction.start.x
    interaction.currentY = interaction.originalY + point.y - interaction.start.y
  } else if (interaction.kind === 'resize') {
    interaction.currentWidth = Math.max(12, interaction.originalWidth + point.x - interaction.start.x)
    interaction.currentHeight = Math.max(12, interaction.originalHeight + point.y - interaction.start.y)
  } else if (interaction.kind === 'draw') {
    interaction.current = point
    if (interaction.tool === 'freehand') interaction.points.push(point)
  } else if (interaction.kind === 'pan') {
    viewport.x = interaction.originX - (event.clientX - interaction.clientX) / viewport.zoom
    viewport.y = interaction.originY - (event.clientY - interaction.clientY) / viewport.zoom
  }
  render()
}

async function onPointerUp(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return
  const finished = interaction
  interaction = null
  canvas.classList.remove('dragging')
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  render()

  try {
    if (finished.kind === 'move') {
      const frame = await finished.framePromise
      if (Math.hypot(finished.currentX - finished.originalX, finished.currentY - finished.originalY) > .5) {
        await executeLabAction({ type: 'move', objectId: finished.objectId, x: finished.currentX, y: finished.currentY }, frame)
      }
    } else if (finished.kind === 'resize') {
      const frame = await finished.framePromise
      await executeLabAction({ type: 'resize', objectId: finished.objectId, width: finished.currentWidth, height: finished.currentHeight }, frame)
    } else if (finished.kind === 'draw') {
      const frame = await finished.framePromise
      const box = normalizedBox(finished.start, finished.current)
      if (finished.tool === 'freehand' && finished.points.length > 1) {
        const xs = finished.points.map(point => point.x)
        const ys = finished.points.map(point => point.y)
        await executeLabAction({
          type: 'create',
          object: {
            type: 'freehand',
            transform: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) },
            style: { fill: 'none', stroke: '#4338ca', strokeWidth: 4 },
            content: { pathData: pathData(finished.points) },
            metadata: { role: 'user-freehand' },
          },
        }, frame)
      } else if (box.width > 3 && box.height > 3) {
        await executeLabAction({
          type: 'create',
          object: {
            type: finished.tool,
            transform: box,
            style: finished.tool === 'ellipse'
              ? { fill: '#fde68a', stroke: '#d97706', strokeWidth: 3 }
              : { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 3 },
            metadata: { role: 'user-shape' },
          },
        }, frame)
      }
    } else if (finished.kind === 'pan') {
      scheduleViewportCommit()
    }
  } catch {
    // The visible toast contains the fail-closed reason.
  }
}

function activateTool(tool) {
  activeTool = tool
  canvas.dataset.tool = tool
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool))
}

function scheduleViewportCommit() {
  clearTimeout(viewportCommitTimer)
  viewportCommitTimer = setTimeout(() => { void commitViewport() }, 140)
}

async function commitViewport() {
  if (viewportCommitInFlight) {
    scheduleViewportCommit()
    return
  }
  viewportCommitInFlight = true
  try {
    const frame = await freshObservation()
    await executeLabAction({ type: 'viewport', viewport: { ...viewport } }, frame, true)
  } catch {
    // executeLabAction already surfaced the error.
  } finally {
    viewportCommitInFlight = false
  }
}

function onWheel(event) {
  event.preventDefault()
  const bounds = canvas.getBoundingClientRect()
  const screenX = event.clientX - bounds.left
  const screenY = event.clientY - bounds.top
  const beforeX = viewport.x + screenX / viewport.zoom
  const beforeY = viewport.y + screenY / viewport.zoom
  const nextZoom = Math.min(8, Math.max(.1, viewport.zoom * Math.exp(-event.deltaY * .0012)))
  viewport.x = beforeX - screenX / nextZoom
  viewport.y = beforeY - screenY / nextZoom
  viewport.zoom = nextZoom
  render()
  scheduleViewportCommit()
}

async function deleteSelected() {
  const object = state.objects.find(item => item.id === selectedId)
  if (!object) return
  const frame = await freshObservation()
  await executeLabAction({ type: 'delete', objectId: object.id }, frame)
  selectedId = null
}

async function applyProperties() {
  const object = state.objects.find(item => item.id === selectedId)
  if (!object) return
  let frame = await freshObservation()
  const styleResult = await executeLabAction({ type: 'restyle', objectId: object.id, style: { fill: $('#object-fill').value, stroke: $('#object-stroke').value } }, frame, true)
  if (['text', 'agent_note', 'subcanvas'].includes(object.type) && $('#object-text').value !== (object.content?.text || '')) {
    frame = styleResult.observation
    await executeLabAction({ type: 'set_text', objectId: object.id, text: $('#object-text').value }, frame, true)
  }
  showToast('物件屬性已更新')
}

async function historyAction(kind) {
  try {
    const frame = await freshObservation()
    const result = await jsonRequest(`/api/lab/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ actionId: actionId(kind), frameId: frame.frameId, mode: observationMode }),
    })
    observation = result.observation
    showEvidence(result.evidence)
    await fetchState()
    updateObservationUi()
    showToast(`${kind.toUpperCase()} 已完成`)
  } catch (error) {
    showToast(`${error.code || 'ERROR'}：${error.message}`, true)
  }
}

async function resetBenchmark() {
  const button = $('#benchmark-reset')
  button.disabled = true
  try {
    const frame = await freshObservation()
    const result = await jsonRequest('/api/lab/benchmark/reset', {
      method: 'POST',
      body: JSON.stringify({ actionId: actionId('benchmark-reset'), frameId: frame.frameId, mode: observationMode }),
    })
    observation = result.observation
    selectedId = null
    showEvidence(result.evidence)
    await fetchState()
    updateObservationUi()
    $('#benchmark-result').className = 'result-chip neutral'
    $('#benchmark-result').textContent = '等待拖曳'
    showToast('基準題已載入')
  } catch (error) {
    showToast(`${error.code || 'ERROR'}：${error.message}`, true)
  } finally {
    button.disabled = false
  }
}

async function verifyBenchmark() {
  try {
    const payload = await jsonRequest('/api/lab/benchmark/verify')
    const result = payload.verification
    const chip = $('#benchmark-result')
    chip.className = `result-chip ${result.passed ? 'pass' : 'fail'}`
    chip.textContent = result.passed ? 'PASS：目標完全位於框內' : `FAIL：中心距離 ${Math.round(result.centerDistance)}`
  } catch (error) {
    showToast(error.message, true)
  }
}

function fitAll() {
  if (!state.objects.length) return
  const minX = Math.min(...state.objects.map(object => object.transform.x))
  const minY = Math.min(...state.objects.map(object => object.transform.y))
  const maxX = Math.max(...state.objects.map(object => object.transform.x + object.transform.width))
  const maxY = Math.max(...state.objects.map(object => object.transform.y + object.transform.height))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  viewport.zoom = Math.min(shell.clientWidth / (width + 180), shell.clientHeight / (height + 180), 2)
  viewport.x = minX - 90 / viewport.zoom
  viewport.y = minY - 90 / viewport.zoom
  render()
  scheduleViewportCommit()
}

function sendPresence(cursor) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({
    type: 'presence',
    presence: {
      clientId,
      actorType: 'user',
      actorId: clientId,
      label: `Browser ${clientId.slice(-4)}`,
      color: cursorColor,
      cursor,
      viewport,
      selectedObjectIds: selectedId ? [selectedId] : [],
      task: `Phase 7 ${activeTool}`,
      updatedAt: new Date().toISOString(),
    },
  }))
}

function saveVector(vector) {
  stateVector = { ...stateVector, ...vector }
  localStorage.setItem(`mrmic-vector:${clientId}`, JSON.stringify(stateVector))
}

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`)
  socket.addEventListener('open', () => {
    connection.textContent = '已同步'
    connection.classList.add('live')
    socket.send(JSON.stringify({
      type: 'hello', clientId, stateVector,
      presence: { clientId, actorType: 'user', actorId: clientId, label: `Browser ${clientId.slice(-4)}`, color: cursorColor, viewport, selectedObjectIds: [], task: 'Connected', updatedAt: new Date().toISOString() },
    }))
  })
  socket.addEventListener('close', () => {
    connection.textContent = '重新連線中'
    connection.classList.remove('live')
    setTimeout(connect, 800)
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.type === 'hello_ack') {
      saveVector(message.stateVector)
      presence = new Map(message.presence.map(item => [item.clientId, item]))
      void fetchState()
    } else if (message.type === 'update') {
      saveVector(message.stateVector)
      void fetchState()
    } else if (message.type === 'presence') {
      presence.set(message.presence.clientId, message.presence)
      renderPresence()
    } else if (message.type === 'presence_removed') {
      presence.delete(message.clientId)
      renderPresence()
    }
  })
}

async function runAutonomous(path, button, runningText) {
  button.disabled = true
  const original = button.textContent
  button.textContent = runningText
  try {
    const result = await jsonRequest(path, { method: 'POST', body: '{}' })
    $('#nvcl-result').textContent = JSON.stringify(result, null, 2)
    await fetchState()
    await freshObservation()
  } catch (error) {
    $('#nvcl-result').textContent = error.message
    showToast(error.message, true)
  } finally {
    button.disabled = false
    button.textContent = original
  }
}

canvas.addEventListener('pointerdown', event => { void onPointerDown(event) })
canvas.addEventListener('pointermove', onPointerMove)
canvas.addEventListener('pointerup', event => { void onPointerUp(event) })
canvas.addEventListener('pointercancel', event => { void onPointerUp(event) })
canvas.addEventListener('wheel', onWheel, { passive: false })

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => activateTool(button.dataset.tool)))
$('#observation-mode').addEventListener('change', async event => {
  observationMode = event.target.value
  updateObservationUi()
  await freshObservation()
})
$('#refresh').addEventListener('click', async () => { await fetchState(); await freshObservation(); showToast('已取得新影格') })
$('#fit').addEventListener('click', fitAll)
$('#undo').addEventListener('click', () => { void historyAction('undo') })
$('#redo').addEventListener('click', () => { void historyAction('redo') })
$('#benchmark-reset').addEventListener('click', () => { void resetBenchmark() })
$('#benchmark-verify').addEventListener('click', () => { void verifyBenchmark() })
$('#delete-object').addEventListener('click', () => { void deleteSelected() })
$('#apply-properties').addEventListener('click', () => { void applyProperties() })
$('#run-nvcl').addEventListener('click', event => { void runAutonomous('/api/nvcl/reference', event.currentTarget, '執行中…') })
$('#run-recursive').addEventListener('click', event => { void runAutonomous('/api/nvcl/recursive', event.currentTarget, '遞歸執行中…') })

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
  if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); void historyAction(event.shiftKey ? 'redo' : 'undo'); return }
  if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); void historyAction('redo'); return }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); void deleteSelected(); return }
  const shortcuts = { v: 'select', h: 'pan', r: 'rectangle', o: 'ellipse', t: 'text', p: 'freehand' }
  const tool = shortcuts[event.key.toLowerCase()]
  if (tool) activateTool(tool)
  if (event.key === 'Escape') { interaction = null; selectedId = null; render() }
})

window.addEventListener('resize', () => {
  viewport.width = shell.clientWidth
  viewport.height = shell.clientHeight
  render()
  scheduleViewportCommit()
})

setInterval(updateObservationUi, 250)

async function start() {
  activateTool('select')
  connect()
  await fetchState()
  await freshObservation()
}

start().catch(error => showToast(error.message, true))
