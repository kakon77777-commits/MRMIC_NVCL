import type { RuntimePresenceInput } from '../../runtime-presence/src/index.js'
import type { HerdrAgentInfo } from './index.js'
import { herdrAgentInfoToRuntimePresence } from './runtime-ingress.js'

export interface RuntimePresenceSink {
  sendRuntimePresence(runtime: RuntimePresenceInput | Record<string, unknown>): void
  removeRuntimePresence(provider: string, providerResourceId: string): void
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

/**
 * Thin publisher used by an external Herdr/PMW Bridge.
 *
 * It owns no semantic identity and does not poll Herdr itself. The bridge
 * supplies current AgentInfo; this class only maps/deduplicates provider facts
 * and forwards them through the already-authenticated Canvas client.
 */
export class HerdrCanvasRuntimePublisher {
  readonly #sink: RuntimePresenceSink
  #runtimeEpochId: string
  readonly #lastFingerprintByTerminal = new Map<string, string>()

  constructor(sink: RuntimePresenceSink, runtimeEpochId: string) {
    this.#sink = sink
    this.#runtimeEpochId = required(runtimeEpochId, 'runtimeEpochId')
  }

  get runtimeEpochId(): string { return this.#runtimeEpochId }

  setRuntimeEpoch(runtimeEpochId: string): void {
    const next = required(runtimeEpochId, 'runtimeEpochId')
    if (next === this.#runtimeEpochId) return
    this.#runtimeEpochId = next
    this.#lastFingerprintByTerminal.clear()
  }

  publish(info: HerdrAgentInfo): boolean {
    const runtime = herdrAgentInfoToRuntimePresence(info, this.#runtimeEpochId)
    const fingerprint = JSON.stringify(runtime)
    if (this.#lastFingerprintByTerminal.get(runtime.providerResourceId) === fingerprint) return false
    this.#sink.sendRuntimePresence(runtime)
    this.#lastFingerprintByTerminal.set(runtime.providerResourceId, fingerprint)
    return true
  }

  remove(terminalId: string): boolean {
    const id = required(terminalId, 'terminalId')
    const known = this.#lastFingerprintByTerminal.delete(id)
    this.#sink.removeRuntimePresence('herdr', id)
    return known
  }

  forget(terminalId: string): boolean {
    return this.#lastFingerprintByTerminal.delete(required(terminalId, 'terminalId'))
  }

  knownTerminalIds(): string[] {
    return [...this.#lastFingerprintByTerminal.keys()].sort()
  }
}
