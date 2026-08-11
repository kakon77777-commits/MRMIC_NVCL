import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type {
  MultimodalProvider,
  MultimodalProviderResponse,
  PixelProviderRequest,
  ProviderUsage,
} from '../../multimodal-agent-runtime/src/index.js'
import type { PixelGesture } from '../../multimodal-lab/src/index.js'

const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000

interface JsonMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message?: string; [key: string]: unknown }
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface NotificationWaiter {
  resolve(value: JsonMessage): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

export function resolveCodexExecutable(localAppData = process.env.LOCALAPPDATA): string | undefined {
  if (!localAppData) return undefined
  const base = resolve(localAppData, 'OpenAI', 'Codex', 'bin')
  if (!existsSync(base)) return undefined
  const candidates: Array<{ path: string; mtimeMs: number; versionDirectory: string }> = []
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = resolve(base, entry.name, process.platform === 'win32' ? 'codex.exe' : 'codex')
      if (!existsSync(path)) continue
      const stats = statSync(path)
      if (stats.isFile()) candidates.push({ path, mtimeMs: stats.mtimeMs, versionDirectory: entry.name })
    }
  } catch {
    return undefined
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.versionDirectory.localeCompare(a.versionDirectory))
  return candidates[0]?.path
}

class AppServerClient {
  readonly #child: any
  readonly #lines: any
  readonly #pending = new Map<number, PendingRequest>()
  readonly #notifications: JsonMessage[] = []
  readonly #waiters: NotificationWaiter[] = []
  #nextId = 1
  #closed = false

  constructor(executable: string) {
    this.#child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      shell: false,
    })
    if (!this.#child.stdin || !this.#child.stdout) throw new Error('Codex app-server stdio is unavailable')
    this.#lines = createInterface({ input: this.#child.stdout, crlfDelay: Infinity })
    this.#lines.on('line', (line: string) => this.#onLine(line))
    this.#child.on('error', (error: Error) => this.#failAll(error))
    this.#child.on('exit', (code: number | null) => this.#failAll(new Error(`Codex app-server exited with code ${code ?? 'unknown'}`)))
  }

  async initialize(timeoutMs: number): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'mrmic-nvcl', title: 'MRMIC NVCL Pixel Agent', version: '0.9.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }, timeoutMs)
    this.notify('initialized', {})
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('Codex app-server client is closed'))
    const id = this.#nextId++
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        rejectRequest(new Error(`${method} timed out`))
      }, timeoutMs)
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
      this.#write({ id, method, params })
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.#write({ method, params })
  }

  nextNotification(timeoutMs: number): Promise<JsonMessage> {
    const queued = this.#notifications.shift()
    if (queued) return Promise.resolve(queued)
    if (this.#closed) return Promise.reject(new Error('Codex app-server client is closed'))
    return new Promise((resolveNotification, rejectNotification) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex(waiter => waiter.resolve === resolveNotification)
        if (index >= 0) this.#waiters.splice(index, 1)
        rejectNotification(new Error('Codex notification timed out'))
      }, timeoutMs)
      this.#waiters.push({ resolve: resolveNotification, reject: rejectNotification, timer })
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try { this.#lines.close() } catch { /* no-op */ }
    try { this.#child.stdin.end() } catch { /* no-op */ }
    try { this.#child.stdin.destroy() } catch { /* no-op */ }
    try { this.#child.stdout.destroy() } catch { /* no-op */ }
    try { this.#child.kill() } catch { /* no-op */ }
    this.#failAll(new Error('Codex app-server client closed'))
  }

  #write(message: Record<string, unknown>): void {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #onLine(line: string): void {
    let message: JsonMessage
    try {
      message = JSON.parse(line) as JsonMessage
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(text(message.error.message) ?? 'Codex app-server request failed'))
      else pending.resolve(message.result)
      return
    }
    const waiter = this.#waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    } else {
      this.#notifications.push(message)
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.#waiters.length = 0
  }
}

export function codexGestureOutputSchema(): Record<string, unknown> {
  const properties = {
    type: { type: 'string', enum: ['gesture', 'stop'] },
    coordinateSpace: { type: 'string', enum: ['normalized_frame'] },
    gestureKind: { type: 'string', enum: ['drag', 'resize', 'delete', 'pan', 'zoom', 'none'] },
    fromX: { type: 'number' },
    fromY: { type: 'number' },
    toX: { type: 'number' },
    toY: { type: 'number' },
    atX: { type: 'number' },
    atY: { type: 'number' },
    factor: { type: 'number' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    success: { type: 'boolean' },
    reason: { type: 'string' },
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  }
}

export function normalizeCodexUsage(value: unknown): ProviderUsage | undefined {
  const usage = record(record(value).tokenUsage)
  const last = record(usage.last)
  const inputTokens = positiveInteger(last.inputTokens)
  const cachedInputTokens = positiveInteger(last.cachedInputTokens)
  const outputTokens = positiveInteger(last.outputTokens)
  const reasoningOutputTokens = positiveInteger(last.reasoningOutputTokens)
  const totalTokens = positiveInteger(last.totalTokens)
  if ([inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens].some(item => item === undefined)) return undefined
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}

function parseAssistantJson(value: string): unknown {
  const trimmed = value.trim()
  const unwrapped = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed
  return JSON.parse(unwrapped)
}

function normalizeCodexDecision(value: unknown): MultimodalProviderResponse['decision'] {
  const output = record(value)
  if (output.type === 'stop') {
    return {
      type: 'stop',
      success: output.success === true,
      reason: text(output.reason) ?? text(output.summary) ?? 'Provider stopped without a reason',
    }
  }
  const coordinateSpace = output.coordinateSpace === 'normalized_frame' ? 'normalized_frame' : undefined
  const kind = text(output.gestureKind)
  const from = { x: Number(output.fromX), y: Number(output.fromY) }
  const to = { x: Number(output.toX), y: Number(output.toY) }
  const at = { x: Number(output.atX), y: Number(output.atY) }
  let gesture: PixelGesture
  if (kind === 'drag' || kind === 'resize' || kind === 'pan') gesture = { kind, from, to }
  else if (kind === 'delete') gesture = { kind, at }
  else if (kind === 'zoom') gesture = { kind, at, factor: Number(output.factor) }
  else throw new Error(`Codex returned unsupported gesture kind ${kind ?? 'missing'}`)
  if (!coordinateSpace) throw new Error('Codex returned an invalid coordinate space')
  return {
    type: 'gesture',
    coordinateSpace,
    gesture,
    confidence: Number(output.confidence),
    summary: text(output.summary) ?? 'Codex visual gesture',
  }
}

function imageModels(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(record(value).data)
    ? (record(value).data as unknown[]).filter(item => Array.isArray(record(item).inputModalities) && (record(item).inputModalities as unknown[]).includes('image')).map(record)
    : []
}

export interface CodexAccountProviderOptions {
  executable?: string
  model?: string
  timeoutMs?: number
  cwd?: string
  detail?: 'auto' | 'high' | 'original'
}

export interface CodexProviderProbe {
  provider: 'openai_codex_account'
  executableAvailable: boolean
  executable?: string
  appServer: 'available' | 'unavailable' | 'probe_failed'
  imageModels: string[]
  selectedModel?: string
  credentialFilesAccessed: false
}

export class CodexAccountMultimodalProvider implements MultimodalProvider {
  readonly name = 'openai_codex_account'
  readonly #executable?: string
  readonly #model?: string
  readonly #timeoutMs: number
  readonly #cwd: string
  readonly #detail: 'auto' | 'high' | 'original'

  constructor(options: CodexAccountProviderOptions = {}) {
    this.#executable = options.executable ?? resolveCodexExecutable()
    this.#model = options.model
    this.#timeoutMs = Math.max(5_000, Math.min(180_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    this.#cwd = resolve(options.cwd ?? process.cwd())
    this.#detail = options.detail ?? 'high'
  }

  async probe(): Promise<CodexProviderProbe> {
    if (!this.#executable) return { provider: this.name, executableAvailable: false, appServer: 'unavailable', imageModels: [], credentialFilesAccessed: false }
    const client = new AppServerClient(this.#executable)
    try {
      await client.initialize(Math.min(this.#timeoutMs, 15_000))
      const models = imageModels(await client.request('model/list', { includeHidden: false, limit: 100 }, Math.min(this.#timeoutMs, 15_000)))
      const ids = models.map(item => text(item.id) ?? text(item.model)).filter((item): item is string => Boolean(item))
      return {
        provider: this.name,
        executableAvailable: true,
        executable: this.#executable,
        appServer: 'available',
        imageModels: ids,
        ...(this.#selectModel(models) ? { selectedModel: this.#selectModel(models) } : {}),
        credentialFilesAccessed: false,
      }
    } catch {
      return { provider: this.name, executableAvailable: true, executable: this.#executable, appServer: 'probe_failed', imageModels: [], credentialFilesAccessed: false }
    } finally {
      client.close()
    }
  }

  async generate(request: PixelProviderRequest): Promise<MultimodalProviderResponse> {
    if (!this.#executable) throw new Error('Codex CLI executable is unavailable')
    const image = Buffer.from(request.frame.imageBase64, 'base64')
    if (image.byteLength === 0 || image.byteLength > MAX_IMAGE_BYTES) throw new Error('Pixel frame size is outside provider bounds')
    const tempPath = resolve(this.#cwd, `.mrmic-codex-frame-${randomUUID()}.png`)
    const client = new AppServerClient(this.#executable)
    writeFileSync(tempPath, image)
    try {
      await client.initialize(Math.min(this.#timeoutMs, 15_000))
      const models = imageModels(await client.request('model/list', { includeHidden: false, limit: 100 }, Math.min(this.#timeoutMs, 15_000)))
      const selectedModel = this.#selectModel(models)
      if (!selectedModel) throw new Error('Codex App Server returned no image-capable model')
      const threadResult = record(await client.request('thread/start', {
        model: selectedModel,
        cwd: this.#cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        environments: [],
        dynamicTools: [],
        baseInstructions: 'You are a bounded visual action planner. Never use tools or modify files. Inspect only the supplied image and return one schema-valid decision.',
        developerInstructions: 'Do not infer or emit object IDs. Use normalized frame coordinates in [0,1]. Choose a reversible gesture that advances the supplied goal. Return JSON only.',
      }, this.#timeoutMs))
      const threadId = text(record(threadResult.thread).id)
      if (!threadId) throw new Error('Codex thread/start did not return a thread ID')
      const prompt = [
        `Goal: ${request.goal}`,
        `Iteration: ${request.iteration}/${request.maxIterations}`,
        `Frame size: ${request.frame.width}x${request.frame.height}.`,
        'Inspect the image. Return a normalized-frame gesture. Do not mention or emit object IDs.',
        request.previous ? `Previous safe feedback: ${JSON.stringify(request.previous)}.` : 'There is no previous action feedback.',
      ].join('\n')
      const turnResult = record(await client.request('turn/start', {
        threadId,
        input: [
          { type: 'text', text: prompt, text_elements: [] },
          { type: 'localImage', path: tempPath, detail: this.#detail },
        ],
        outputSchema: codexGestureOutputSchema(),
        approvalPolicy: 'never',
      }, this.#timeoutMs))
      const turnId = text(record(turnResult.turn).id)
      if (!turnId) throw new Error('Codex turn/start did not return a turn ID')

      const deadline = Date.now() + this.#timeoutMs
      let assistantText: string | undefined
      let usage: ProviderUsage | undefined
      let turnCompleted = false
      let completionGraceDeadline: number | undefined
      const notificationTrace: string[] = []
      while (Date.now() < deadline) {
        const remaining = Math.max(1, Math.min(deadline - Date.now(), completionGraceDeadline ? completionGraceDeadline - Date.now() : this.#timeoutMs))
        if (remaining <= 0) break
        let message: JsonMessage
        try {
          message = await client.nextNotification(remaining)
        } catch {
          if (assistantText && turnCompleted) break
          throw new Error(`Codex inference notification timeout after ${notificationTrace.join(', ') || 'no notifications'}`)
        }
        const params = record(message.params)
        notificationTrace.push(message.method ?? 'unknown')
        if (notificationTrace.length > 16) notificationTrace.shift()
        if (message.method === 'item/completed' && params.threadId === threadId && params.turnId === turnId) {
          const item = record(params.item)
          if (item.type === 'agentMessage') assistantText = text(item.text) ?? assistantText
        } else if (message.method === 'thread/tokenUsage/updated' && params.threadId === threadId && params.turnId === turnId) {
          usage = normalizeCodexUsage(params) ?? usage
        } else if (message.method === 'turn/completed' && params.threadId === threadId && text(record(params.turn).id) === turnId) {
          const turn = record(params.turn)
          if (Array.isArray(turn.items)) {
            const agentMessage = turn.items.map(record).find(item => item.type === 'agentMessage')
            assistantText = text(agentMessage?.text) ?? assistantText
          }
          if (turn.status === 'failed') {
            const turnError = record(turn.error)
            throw new Error(`Codex inference failed: ${text(turnError.message) ?? 'unknown turn error'}`)
          }
          turnCompleted = true
          completionGraceDeadline = Date.now() + 1_500
        } else if (message.method === 'error' && params.threadId === threadId && params.turnId === turnId && params.willRetry === false) {
          const turnError = record(params.error)
          throw new Error(`Codex inference failed: ${text(turnError.message) ?? 'unknown app-server error'}`)
        }
        if (assistantText && turnCompleted && usage) break
      }
      if (!assistantText) throw new Error('Codex inference completed without an agent message')
      return {
        decision: normalizeCodexDecision(parseAssistantJson(assistantText)),
        model: selectedModel,
        ...(usage ? { usage } : {}),
      }
    } finally {
      client.close()
      try { unlinkSync(tempPath) } catch { /* best-effort bounded cleanup */ }
    }
  }

  #selectModel(models: Array<Record<string, unknown>>): string | undefined {
    if (this.#model) {
      const match = models.find(item => item.id === this.#model || item.model === this.#model)
      return match ? text(match.id) ?? text(match.model) : undefined
    }
    const selected = models.find(item => item.isDefault === true) ?? models[0]
    return selected ? text(selected.id) ?? text(selected.model) : undefined
  }
}
