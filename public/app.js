(() => {
  'use strict'

  const TOKEN_STORAGE_KEY = 'brobot.dashboard.token'
  const MAX_RENDERED_LOGS = 300

  const byId = (id) => document.getElementById(id)
  const elements = {
    accessButton: byId('access-button'),
    accessCancel: byId('access-cancel'),
    accessCopy: byId('access-copy'),
    accessDialog: byId('access-dialog'),
    accessError: byId('access-error'),
    accessForm: byId('access-form'),
    accessToken: byId('access-token'),
    commandFeedback: byId('command-feedback'),
    commandForm: byId('command-form'),
    commandInput: byId('command-input'),
    commandSubmit: byId('command-submit'),
    connectionChip: byId('connection-chip'),
    connectionLabel: byId('connection-label'),
    console: byId('console'),
    dimension: byId('dimension-label'),
    experience: byId('experience-value'),
    foodBar: byId('food-bar'),
    foodValue: byId('food-value'),
    gameMode: byId('gamemode-label'),
    healthBar: byId('health-bar'),
    healthValue: byId('health-value'),
    inventoryCount: byId('inventory-count'),
    inventoryEmpty: byId('inventory-empty'),
    inventoryGrid: byId('inventory-grid'),
    inventorySearch: byId('inventory-search'),
    lastUpdated: byId('last-updated'),
    logCount: byId('log-count'),
    oxygen: byId('oxygen-value'),
    pauseLogs: byId('pause-logs'),
    playerCount: byId('player-count'),
    playerList: byId('player-list'),
    playersEmpty: byId('players-empty'),
    positionNote: byId('position-note'),
    positionX: byId('position-x'),
    positionY: byId('position-y'),
    positionZ: byId('position-z'),
    serverAddress: byId('server-address'),
    syncLabel: byId('sync-label'),
    syncState: byId('sync-state'),
    taskActive: byId('task-active'),
    taskElapsed: byId('task-elapsed'),
    taskEmpty: byId('task-empty'),
    taskId: byId('task-id'),
    taskLabel: byId('task-label'),
    taskState: byId('task-state'),
    toastRegion: byId('toast-region'),
    uptime: byId('uptime-label'),
    version: byId('version-label'),
    worldTitle: byId('world-title')
  }

  const state = {
    authLocked: false,
    commandHistory: [],
    commandHistoryIndex: 0,
    healthUptime: undefined,
    instanceId: undefined,
    inventory: [],
    lastLogId: 0,
    lastStatusAt: 0,
    logFilter: 'all',
    logs: [],
    logsPaused: false,
    pollInFlight: false,
    status: undefined,
    token: readStoredToken()
  }

  class ApiError extends Error {
    constructor(status, message, payload) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.payload = payload
    }
  }

  function readStoredToken() {
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  }

  function storeToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      // Storage may be disabled. The in-memory token still works for this tab.
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {})
    headers.set('Accept', 'application/json')
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    let response
    try {
      response = await fetch(path, {
        ...options,
        headers,
        cache: 'no-store',
        credentials: 'same-origin'
      })
    } catch {
      throw new ApiError(0, 'The local dashboard service is not responding')
    }

    const raw = await response.text()
    let payload = null
    if (raw) {
      try { payload = JSON.parse(raw) } catch { payload = raw }
    }

    if (response.status === 401) {
      state.authLocked = true
      showAccessDialog(true)
    }
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && typeof payload.error === 'string'
        ? payload.error
        : `Dashboard request failed (${response.status})`
      throw new ApiError(response.status, message, payload)
    }
    return payload
  }

  function setSync(mode, label) {
    elements.syncState.classList.remove('live', 'error')
    if (mode) elements.syncState.classList.add(mode)
    elements.syncLabel.textContent = label
  }

  function setConnection(status) {
    const chip = elements.connectionChip
    chip.classList.remove('offline', 'connecting', 'online')
    if (status.spawned) {
      chip.classList.add('online')
      elements.connectionLabel.textContent = 'ONLINE'
    } else if (status.connected) {
      chip.classList.add('connecting')
      elements.connectionLabel.textContent = 'JOINING'
    } else {
      chip.classList.add('offline')
      elements.connectionLabel.textContent = 'OFFLINE'
    }
  }

  function formatLabel(value, fallback = '—') {
    if (typeof value !== 'string' || !value) return fallback
    const clean = value.replace(/^minecraft:/, '').replaceAll('_', ' ')
    return clean.replace(/\b\w/g, (letter) => letter.toUpperCase())
  }

  function formatCoordinate(value) {
    if (!Number.isFinite(value)) return '—'
    const rounded = Math.round(value * 10) / 10
    return Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)
  }

  function formatDuration(totalSeconds, includeHours = true) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0
    const seconds = Math.floor(totalSeconds % 60)
    const minutes = Math.floor(totalSeconds / 60) % 60
    const hours = Math.floor(totalSeconds / 3_600)
    const parts = [minutes, seconds].map((value) => String(value).padStart(2, '0'))
    if (includeHours) parts.unshift(String(hours).padStart(2, '0'))
    return parts.join(':')
  }

  function updateSegmentBar(element, rawValue) {
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(20, rawValue)) : 0
    const filledSegments = Math.ceil(value / 2)
    for (const [index, segment] of [...element.children].entries()) {
      segment.classList.toggle('filled', index < filledSegments)
    }
    element.setAttribute('aria-valuenow', String(Math.round(value)))
  }

  function renderTask(task) {
    if (!task) {
      elements.taskEmpty.hidden = false
      elements.taskActive.hidden = true
      elements.taskState.textContent = 'IDLE'
      elements.taskState.className = 'task-state idle'
      return
    }

    elements.taskEmpty.hidden = true
    elements.taskActive.hidden = false
    const taskState = task.state === 'cancelling' ? 'cancelling' : 'running'
    elements.taskState.textContent = taskState.toUpperCase()
    elements.taskState.className = `task-state ${taskState}`
    elements.taskLabel.textContent = task.label || 'Unnamed task'
    elements.taskId.textContent = `#${Number.isFinite(task.id) ? task.id : '—'}`
    updateTaskClock()
  }

  function updateTaskClock() {
    const task = state.status && state.status.currentTask
    if (!task) return
    const base = Number.isFinite(task.elapsedMs) ? task.elapsedMs : 0
    const elapsedSincePoll = Math.max(0, Date.now() - state.lastStatusAt)
    elements.taskElapsed.textContent = formatDuration((base + elapsedSincePoll) / 1_000, false)
  }

  function renderStatus(status) {
    state.status = status
    state.lastStatusAt = Date.now()
    setConnection(status)

    elements.worldTitle.textContent = status.username || 'BroBot'
    elements.serverAddress.textContent = status.server || 'Local server'
    elements.version.textContent = status.version ? `Minecraft ${status.version}` : (status.connected ? 'Negotiating version' : 'Waiting for bot')
    elements.dimension.textContent = formatLabel(status.dimension || (status.position && status.position.dimension), 'Unknown')
    elements.gameMode.textContent = formatLabel(status.gameMode)

    const health = Number.isFinite(status.health) ? Math.round(status.health * 10) / 10 : undefined
    const food = Number.isFinite(status.food) ? Math.round(status.food * 10) / 10 : undefined
    elements.healthValue.textContent = health === undefined ? '—' : String(health)
    elements.foodValue.textContent = food === undefined ? '—' : String(food)
    elements.oxygen.textContent = Number.isFinite(status.oxygen) ? `${Math.round(status.oxygen)} / 20` : '—'
    elements.experience.textContent = Number.isFinite(status.experience) ? String(status.experience) : '—'
    updateSegmentBar(elements.healthBar, health)
    updateSegmentBar(elements.foodBar, food)

    const position = status.position
    elements.positionX.textContent = formatCoordinate(position && position.x)
    elements.positionY.textContent = formatCoordinate(position && position.y)
    elements.positionZ.textContent = formatCoordinate(position && position.z)
    elements.positionNote.textContent = position
      ? `${formatLabel(position.dimension || status.dimension, 'Current world')} · live position`
      : 'Position appears after the bot spawns.'

    renderTask(status.currentTask)
    state.inventory = Array.isArray(status.inventory) ? status.inventory : []
    renderInventory()
    renderPlayers(Array.isArray(status.players) ? status.players : [])

    elements.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    setSync('live', 'Live local data')
  }

  function stringHash(value) {
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
    }
    return Math.abs(hash)
  }

  function shortItemName(name) {
    return String(name || '?')
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((word) => word[0] || '')
      .join('')
      .slice(0, 2) || '?'
  }

  function createInventoryItem(item) {
    const article = document.createElement('article')
    article.className = 'inventory-item'

    const block = document.createElement('span')
    block.className = 'item-block'
    block.style.setProperty('--item-hue', String(stringHash(item.name || item.displayName || '') % 360))
    block.textContent = shortItemName(item.name || item.displayName)
    block.setAttribute('aria-hidden', 'true')

    const copy = document.createElement('span')
    copy.className = 'item-copy'
    const title = document.createElement('strong')
    title.textContent = item.displayName || formatLabel(item.name, 'Unknown item')
    title.title = title.textContent
    const slots = document.createElement('small')
    const slotList = Array.isArray(item.slots) ? item.slots : []
    slots.textContent = slotList.length === 1 ? `slot ${slotList[0]}` : `${slotList.length || 1} slots`
    copy.append(title, slots)

    const count = document.createElement('span')
    count.className = 'item-count'
    count.textContent = `×${Number.isFinite(item.count) ? item.count : 0}`
    article.append(block, copy, count)
    return article
  }

  function renderInventory() {
    const search = elements.inventorySearch.value.trim().toLowerCase()
    const items = state.inventory.filter((item) => {
      if (!search) return true
      return `${item.name || ''} ${item.displayName || ''}`.toLowerCase().includes(search)
    })
    const total = state.inventory.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0)
    elements.inventoryCount.textContent = `${total} ${total === 1 ? 'item' : 'items'}`
    elements.inventoryGrid.replaceChildren(...items.map(createInventoryItem))
    elements.inventoryGrid.hidden = items.length === 0
    elements.inventoryEmpty.hidden = items.length !== 0
    if (items.length === 0 && search && state.inventory.length > 0) {
      elements.inventoryEmpty.querySelector('strong').textContent = 'No matching items'
      elements.inventoryEmpty.querySelector('p').textContent = `Nothing matches “${elements.inventorySearch.value.trim()}”.`
    } else {
      elements.inventoryEmpty.querySelector('strong').textContent = 'Inventory is empty'
      elements.inventoryEmpty.querySelector('p').textContent = 'Collected blocks and tools will appear here.'
    }
  }

  function createPlayerRow(player) {
    const row = document.createElement('div')
    row.className = 'player-row'
    const head = document.createElement('span')
    head.className = 'player-head'
    head.style.setProperty('--player-hue', String(stringHash(player) % 360))
    head.textContent = player.slice(0, 2)
    head.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'player-name'
    name.textContent = player
    name.title = player
    const dot = document.createElement('span')
    dot.className = 'online-dot'
    dot.setAttribute('aria-label', 'Online')
    row.append(head, name, dot)
    return row
  }

  function renderPlayers(players) {
    elements.playerCount.textContent = `${players.length} online`
    elements.playerList.replaceChildren(...players.map(createPlayerRow))
    elements.playerList.hidden = players.length === 0
    elements.playersEmpty.hidden = players.length !== 0
  }

  function safeDataText(data) {
    if (typeof data === 'string') return data
    try { return JSON.stringify(data) } catch { return String(data) }
  }

  function createLogEntry(entry) {
    const row = document.createElement('div')
    const level = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info'
    row.className = 'log-entry'
    row.dataset.level = level

    const time = document.createElement('time')
    time.className = 'log-time'
    const timestamp = new Date(entry.timestamp)
    time.dateTime = Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString()
    time.textContent = Number.isNaN(timestamp.getTime())
      ? '--:--:--'
      : timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

    const levelLabel = document.createElement('span')
    levelLabel.className = 'log-level'
    levelLabel.textContent = level

    const scope = document.createElement('span')
    scope.className = 'log-scope'
    scope.textContent = entry.scope || 'bot'
    scope.title = scope.textContent

    const message = document.createElement('span')
    message.className = 'log-message'
    message.textContent = entry.message || ''
    if (entry.data !== undefined) {
      const data = document.createElement('small')
      data.className = 'log-data'
      data.textContent = safeDataText(entry.data)
      message.append(data)
    }
    row.append(time, levelLabel, scope, message)
    return row
  }

  function renderLogs() {
    const wasNearBottom = elements.console.scrollHeight - elements.console.scrollTop - elements.console.clientHeight < 60
    const visible = state.logFilter === 'all'
      ? state.logs
      : state.logs.filter((entry) => entry.level === state.logFilter)

    if (visible.length === 0) {
      const placeholder = document.createElement('div')
      placeholder.className = 'console-placeholder'
      const caret = document.createElement('span')
      caret.className = 'terminal-caret'
      caret.setAttribute('aria-hidden', 'true')
      placeholder.append(caret, document.createTextNode(state.logs.length ? 'No events match this filter.' : 'Waiting for local activity…'))
      elements.console.replaceChildren(placeholder)
    } else {
      elements.console.replaceChildren(...visible.map(createLogEntry))
    }

    elements.logCount.textContent = `${state.logs.length} ${state.logs.length === 1 ? 'event' : 'events'}`
    if (wasNearBottom && !state.logsPaused) elements.console.scrollTop = elements.console.scrollHeight
  }

  async function pollStatus() {
    if (state.authLocked || state.pollInFlight || document.hidden) return
    state.pollInFlight = true
    try {
      const status = await api('/api/status')
      if (status && typeof status === 'object') renderStatus(status)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        setSync('error', error.message || 'Local service unavailable')
      }
    } finally {
      state.pollInFlight = false
    }
  }

  async function pollLogs() {
    if (state.authLocked || state.logsPaused || document.hidden) return
    try {
      const payload = await api(`/api/logs?after=${state.lastLogId}&limit=100`)
      const entries = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.logs) ? payload.logs : [])
      if (!entries.length) return

      const known = new Set(state.logs.map((entry) => entry.id))
      for (const entry of entries) {
        if (!entry || !Number.isFinite(entry.id) || known.has(entry.id)) continue
        known.add(entry.id)
        state.logs.push(entry)
        state.lastLogId = Math.max(state.lastLogId, entry.id)
      }
      if (state.logs.length > MAX_RENDERED_LOGS) state.logs.splice(0, state.logs.length - MAX_RENDERED_LOGS)
      renderLogs()
    } catch (error) {
      if (!(error instanceof ApiError && (error.status === 401 || error.status === 0))) {
        showToast(error.message || 'Could not update logs', true)
      }
    }
  }

  async function pollHealth() {
    if (state.authLocked || document.hidden) return
    try {
      const health = await api('/api/health')
      if (Number.isFinite(health && health.uptimeSeconds)) {
        const instanceChanged = typeof health.instanceId === 'string' && state.instanceId && health.instanceId !== state.instanceId
        if (instanceChanged || (Number.isFinite(state.healthUptime) && health.uptimeSeconds < state.healthUptime)) {
          state.lastLogId = 0
          state.logs = []
          renderLogs()
        }
        if (typeof health.instanceId === 'string') state.instanceId = health.instanceId
        state.healthUptime = health.uptimeSeconds
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) setSync('error', 'Local service unavailable')
    }
  }

  function showAccessDialog(required = false) {
    elements.accessCopy.textContent = required
      ? 'This dashboard requires the bearer token from your local configuration.'
      : 'Set or replace the bearer token used for local dashboard requests.'
    elements.accessError.textContent = required && state.token ? 'The saved access key was not accepted.' : ''
    elements.accessToken.value = ''
    if (!elements.accessDialog.open) elements.accessDialog.showModal()
    window.setTimeout(() => elements.accessToken.focus(), 0)
  }

  async function unlockDashboard(event) {
    event.preventDefault()
    const token = elements.accessToken.value.trim()
    state.token = token
    storeToken(token)
    state.authLocked = false
    elements.accessError.textContent = ''

    try {
      await api('/api/health')
      elements.accessDialog.close()
      showToast(token ? 'Dashboard unlocked.' : 'Dashboard access key cleared.')
      await Promise.allSettled([pollStatus(), pollLogs()])
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        elements.accessError.textContent = 'That access key was not accepted. Check dashboard.authToken.'
      } else {
        elements.accessError.textContent = error.message || 'Could not reach the local dashboard service.'
      }
    }
  }

  function resultMessage(result) {
    if (!result || typeof result !== 'object') return result === null ? 'Command completed.' : String(result)
    if (Array.isArray(result.messages) && result.messages.length) return result.messages.join(' · ')
    if (typeof result.message === 'string') return result.message
    if (typeof result.error === 'string') return result.error
    return result.ok === false ? 'The command could not be completed.' : 'Command completed.'
  }

  async function runCommand(event) {
    event.preventDefault()
    const command = elements.commandInput.value.trim()
    if (!command) {
      elements.commandInput.focus()
      return
    }

    elements.commandSubmit.disabled = true
    elements.commandFeedback.className = 'command-feedback'
    elements.commandFeedback.textContent = `Running “${command}”…`
    try {
      const result = await api('/api/command', {
        method: 'POST',
        body: JSON.stringify({ command })
      })
      state.commandHistory.push(command)
      if (state.commandHistory.length > 50) state.commandHistory.shift()
      state.commandHistoryIndex = state.commandHistory.length
      elements.commandInput.value = ''
      const successful = !result || typeof result !== 'object' || result.ok !== false
      elements.commandFeedback.classList.add(successful ? 'success' : 'error')
      elements.commandFeedback.textContent = resultMessage(result)
      showToast(resultMessage(result), !successful)
      await Promise.allSettled([pollStatus(), pollLogs()])
    } catch (error) {
      elements.commandFeedback.classList.add('error')
      elements.commandFeedback.textContent = error.message || 'Command failed.'
      if (!(error instanceof ApiError && error.status === 401)) showToast(error.message || 'Command failed.', true)
    } finally {
      elements.commandSubmit.disabled = false
      elements.commandInput.focus()
    }
  }

  function navigateCommandHistory(event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (!state.commandHistory.length) return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? -1 : 1
    state.commandHistoryIndex = Math.max(0, Math.min(state.commandHistory.length, state.commandHistoryIndex + delta))
    elements.commandInput.value = state.commandHistory[state.commandHistoryIndex] || ''
    elements.commandInput.setSelectionRange(elements.commandInput.value.length, elements.commandInput.value.length)
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div')
    toast.className = `toast${isError ? ' error' : ''}`
    toast.textContent = message
    elements.toastRegion.append(toast)
    window.setTimeout(() => toast.remove(), 4_000)
  }

  function initializeBars() {
    for (const bar of [elements.healthBar, elements.foodBar]) {
      const segments = Array.from({ length: 10 }, () => document.createElement('span'))
      bar.replaceChildren(...segments)
    }
  }

  function bindEvents() {
    elements.commandForm.addEventListener('submit', runCommand)
    elements.commandInput.addEventListener('keydown', navigateCommandHistory)
    elements.inventorySearch.addEventListener('input', renderInventory)
    elements.accessButton.addEventListener('click', () => showAccessDialog(false))
    elements.accessForm.addEventListener('submit', unlockDashboard)
    elements.accessCancel.addEventListener('click', () => elements.accessDialog.close())

    document.querySelectorAll('[data-fill-command]').forEach((button) => {
      button.addEventListener('click', () => {
        elements.commandInput.value = button.dataset.fillCommand || ''
        elements.commandInput.focus()
      })
    })

    document.querySelectorAll('[data-log-level]').forEach((button) => {
      button.addEventListener('click', () => {
        state.logFilter = button.dataset.logLevel || 'all'
        document.querySelectorAll('[data-log-level]').forEach((item) => item.classList.toggle('active', item === button))
        renderLogs()
      })
    })

    elements.pauseLogs.addEventListener('click', () => {
      state.logsPaused = !state.logsPaused
      elements.pauseLogs.setAttribute('aria-pressed', String(state.logsPaused))
      elements.pauseLogs.querySelector('span:first-child').textContent = state.logsPaused ? '▶' : 'Ⅱ'
      elements.pauseLogs.querySelector('span:last-child').textContent = state.logsPaused ? 'Resume' : 'Pause'
      if (!state.logsPaused) void pollLogs()
    })

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        elements.commandInput.focus()
        elements.commandInput.select()
      }
    })

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void Promise.allSettled([pollStatus(), pollLogs(), pollHealth()])
    })
  }

  function tickClocks() {
    const status = state.status
    if (status && Number.isFinite(status.uptimeSeconds)) {
      elements.uptime.textContent = formatDuration(status.uptimeSeconds + Math.max(0, Date.now() - state.lastStatusAt) / 1_000)
    }
    updateTaskClock()
  }

  function start() {
    initializeBars()
    bindEvents()
    renderInventory()
    renderPlayers([])
    renderLogs()
    void Promise.allSettled([pollStatus(), pollLogs(), pollHealth()])
    window.setInterval(pollStatus, 1_500)
    window.setInterval(pollLogs, 1_250)
    window.setInterval(pollHealth, 10_000)
    window.setInterval(tickClocks, 1_000)
  }

  start()
})()
