import { randomUUID } from 'node:crypto'
import {
  bearerTokenFromAuthorization,
  type AuthenticatedPrincipal,
  type IdentityResolver,
} from '../../identity-auth/src/index.js'
import {
  DurableObserverWorkspaceRegistry,
} from '../../observer-workspace/src/durable-registry.js'
import type {
  CreateObserverViewInput,
  EnterObserverSubcanvasInput,
  ObserverNestedVisibility,
  ObserverViewLifecycle,
  OpenRendezvousInput,
  SharedProjectionInteraction,
} from '../../observer-workspace/src/index.js'

export const OBSERVER_SELF_RESOURCE_URI = 'mrmic://observer/self'
export const OBSERVER_MCP_PATH = '/mcp/observer'
export const OBSERVER_HTTP_SNAPSHOT_PATH = '/api/observer/snapshot'
export const OBSERVER_HTTP_COMMAND_PATH = '/api/observer/command'
export const OBSERVER_MCP_PROTOCOL_VERSION = '2025-11-25'

export type ObserverProtocolCommand =
  | { kind: 'create_view'; input: CreateObserverViewInput }
  | { kind: 'set_foreground'; viewId: string; portalIds: string[] }
  | { kind: 'set_lifecycle'; viewId: string; lifecycle: ObserverViewLifecycle }
  | { kind: 'enter_subcanvas'; viewId: string; input: EnterObserverSubcanvasInput }
  | { kind: 'leave_subcanvas'; viewId: string }
  | { kind: 'set_nested_visibility'; viewId: string; canvasId: string; visibility: ObserverNestedVisibility }
  | { kind: 'set_nested_foreground'; viewId: string; canvasId: string; portalIds: string[] }
  | { kind: 'open_rendezvous'; input: OpenRendezvousInput }
  | { kind: 'invite'; rendezvousId: string; invitedPrincipalId: string }
  | { kind: 'join'; rendezvousId: string }
  | {
      kind: 'project_portal'
      rendezvousId: string
      input: {
        projectionId: string
        sourceViewId: string
        portalId: string
        interaction?: SharedProjectionInteraction
      }
    }
  | { kind: 'remove_projection'; rendezvousId: string; projectionId: string }
  | { kind: 'close_rendezvous'; rendezvousId: string }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => text(item, `${label}[${index}]`))
}

function nestedVisibility(value: unknown, label: string): ObserverNestedVisibility {
  const visibility = text(value, label) as ObserverNestedVisibility
  if (visibility !== 'inherit' && visibility !== 'hidden') throw new Error(`${label} is invalid`)
  return visibility
}

export function parseObserverProtocolCommand(value: unknown): ObserverProtocolCommand {
  const input = record(value, 'command')
  const kind = text(input.kind, 'command.kind')
  switch (kind) {
    case 'create_view':
      return { kind, input: record(input.input, 'command.input') as unknown as CreateObserverViewInput }
    case 'set_foreground':
      return { kind, viewId: text(input.viewId, 'command.viewId'), portalIds: stringArray(input.portalIds, 'command.portalIds') }
    case 'set_lifecycle': {
      const lifecycle = text(input.lifecycle, 'command.lifecycle') as ObserverViewLifecycle
      if (!['live', 'warm', 'frozen', 'sleeping'].includes(lifecycle)) throw new Error('command.lifecycle is invalid')
      return { kind, viewId: text(input.viewId, 'command.viewId'), lifecycle }
    }
    case 'enter_subcanvas': {
      const child = record(input.input, 'command.input')
      const visibility = child.visibility === undefined ? undefined : nestedVisibility(child.visibility, 'command.input.visibility')
      return {
        kind,
        viewId: text(input.viewId, 'command.viewId'),
        input: {
          parentCanvasId: text(child.parentCanvasId, 'command.input.parentCanvasId'),
          childCanvasId: text(child.childCanvasId, 'command.input.childCanvasId'),
          portalObjectId: text(child.portalObjectId, 'command.input.portalObjectId'),
          ...(visibility ? { visibility } : {}),
        },
      }
    }
    case 'leave_subcanvas':
      return { kind, viewId: text(input.viewId, 'command.viewId') }
    case 'set_nested_visibility':
      return {
        kind,
        viewId: text(input.viewId, 'command.viewId'),
        canvasId: text(input.canvasId, 'command.canvasId'),
        visibility: nestedVisibility(input.visibility, 'command.visibility'),
      }
    case 'set_nested_foreground':
      return {
        kind,
        viewId: text(input.viewId, 'command.viewId'),
        canvasId: text(input.canvasId, 'command.canvasId'),
        portalIds: stringArray(input.portalIds, 'command.portalIds'),
      }
    case 'open_rendezvous':
      return { kind, input: record(input.input, 'command.input') as unknown as OpenRendezvousInput }
    case 'invite':
      return { kind, rendezvousId: text(input.rendezvousId, 'command.rendezvousId'), invitedPrincipalId: text(input.invitedPrincipalId, 'command.invitedPrincipalId') }
    case 'join':
      return { kind, rendezvousId: text(input.rendezvousId, 'command.rendezvousId') }
    case 'project_portal': {
      const portalInput = record(input.input, 'command.input')
      const interaction = portalInput.interaction === undefined ? undefined : text(portalInput.interaction, 'command.input.interaction') as SharedProjectionInteraction
      if (interaction !== undefined && interaction !== 'inspect' && interaction !== 'interact') throw new Error('command.input.interaction is invalid')
      return {
        kind,
        rendezvousId: text(input.rendezvousId, 'command.rendezvousId'),
        input: {
          projectionId: text(portalInput.projectionId, 'command.input.projectionId'),
          sourceViewId: text(portalInput.sourceViewId, 'command.input.sourceViewId'),
          portalId: text(portalInput.portalId, 'command.input.portalId'),
          ...(interaction ? { interaction } : {}),
        },
      }
    }
    case 'remove_projection':
      return { kind, rendezvousId: text(input.rendezvousId, 'command.rendezvousId'), projectionId: text(input.projectionId, 'command.projectionId') }
    case 'close_rendezvous':
      return { kind, rendezvousId: text(input.rendezvousId, 'command.rendezvousId') }
    default:
      throw new Error(`unsupported observer command ${kind}`)
  }
}

export function executeObserverProtocolCommand(
  workspace: DurableObserverWorkspaceRegistry,
  value: unknown,
  principal: AuthenticatedPrincipal,
): unknown {
  const command = parseObserverProtocolCommand(value)
  switch (command.kind) {
    case 'create_view': return workspace.createPrivateView(command.input, principal)
    case 'set_foreground': return workspace.setForegroundStack(command.viewId, command.portalIds, principal)
    case 'set_lifecycle': return workspace.setViewLifecycle(command.viewId, command.lifecycle, principal)
    case 'enter_subcanvas': return workspace.enterSubcanvas(command.viewId, command.input, principal)
    case 'leave_subcanvas': return workspace.leaveSubcanvas(command.viewId, principal)
    case 'set_nested_visibility': return workspace.setNestedVisibility(command.viewId, command.canvasId, command.visibility, principal)
    case 'set_nested_foreground': return workspace.setNestedForegroundStack(command.viewId, command.canvasId, command.portalIds, principal)
    case 'open_rendezvous': return workspace.openRendezvous(command.input, principal)
    case 'invite': return workspace.invite(command.rendezvousId, command.invitedPrincipalId, principal)
    case 'join': return workspace.join(command.rendezvousId, principal)
    case 'project_portal': return workspace.projectPortal(command.rendezvousId, command.input, principal)
    case 'remove_projection': return workspace.removeProjection(command.rendezvousId, command.projectionId, principal)
    case 'close_rendezvous': return workspace.closeRendezvous(command.rendezvousId, principal)
  }
}

interface ObserverProtocolSession {
  id: string
  principalId: string
  initialized: boolean
  streams: Set<any>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function headerString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function sendJson(response: any, status: number, payload: unknown, sessionId?: string): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  })
  response.end(JSON.stringify(payload))
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolEnvelope(ok: boolean, data?: unknown, error?: string) {
  const structuredContent = ok ? { ok: true, data } : { ok: false, error: { code: 'OBSERVER_ERROR', message: error } }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: !ok,
  }
}

export interface ObserverProtocolGatewayOptions {
  workspace: DurableObserverWorkspaceRegistry
  identityResolver: IdentityResolver
}

export class ObserverProtocolGateway {
  readonly #workspace: DurableObserverWorkspaceRegistry
  readonly #identityResolver: IdentityResolver
  readonly #sessions = new Map<string, ObserverProtocolSession>()

  constructor(options: ObserverProtocolGatewayOptions) {
    this.#workspace = options.workspace
    this.#identityResolver = options.identityResolver
  }

  sessionCount(): number { return this.#sessions.size }

  async handleHttp(request: any, response: any): Promise<boolean> {
    const url = new URL(request.url ?? '/', `http://${request.headers?.host ?? 'localhost'}`)
    const isObserverHttp = url.pathname === OBSERVER_HTTP_SNAPSHOT_PATH || url.pathname === OBSERVER_HTTP_COMMAND_PATH
    const isObserverMcp = url.pathname === OBSERVER_MCP_PATH
    if (!isObserverHttp && !isObserverMcp) return false

    const principal = this.#principal(request)
    if (!principal) {
      sendJson(response, 401, { error: 'Valid PMW bearer principal required' })
      return true
    }

    if (isObserverHttp) {
      if (url.pathname === OBSERVER_HTTP_SNAPSHOT_PATH && request.method === 'GET') {
        sendJson(response, 200, { snapshot: this.#workspace.snapshotFor(principal) })
        return true
      }
      if (url.pathname === OBSERVER_HTTP_COMMAND_PATH && request.method === 'POST') {
        try {
          const body = await this.#readBody(request)
          const command = record(body, 'body').command
          sendJson(response, 200, { result: executeObserverProtocolCommand(this.#workspace, command, principal) })
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        }
        return true
      }
      response.writeHead(405, { allow: url.pathname === OBSERVER_HTTP_SNAPSHOT_PATH ? 'GET' : 'POST' })
      response.end()
      return true
    }

    return this.#handleMcp(request, response, principal)
  }

  async dispatchMcpForTesting(rpc: JsonRpcRequest, principal: AuthenticatedPrincipal): Promise<unknown> {
    return this.#dispatchMcp(rpc, principal)
  }

  #principal(request: any): AuthenticatedPrincipal | null {
    const token = bearerTokenFromAuthorization(request.headers?.authorization)
    return token ? this.#identityResolver.resolveToken(token) : null
  }

  async #handleMcp(request: any, response: any, principal: AuthenticatedPrincipal): Promise<boolean> {
    const requestedSessionId = headerString(request.headers?.['mcp-session-id'])?.trim()
    if (request.method === 'GET') {
      const session = requestedSessionId ? this.#sessions.get(requestedSessionId) : undefined
      if (!session || session.principalId !== principal.principalId) {
        sendJson(response, 401, { error: 'Valid observer MCP session required' })
        return true
      }
      const accept = String(request.headers?.accept ?? '')
      if (!accept.includes('text/event-stream')) {
        sendJson(response, 406, { error: 'GET /mcp/observer requires Accept: text/event-stream' }, session.id)
        return true
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'mcp-session-id': session.id,
      })
      response.write(': observer mcp stream connected\n\n')
      session.streams.add(response)
      request.on('close', () => session.streams.delete(response))
      return true
    }
    if (request.method === 'DELETE') {
      const session = requestedSessionId ? this.#sessions.get(requestedSessionId) : undefined
      if (!session || session.principalId !== principal.principalId) {
        sendJson(response, 401, { error: 'Valid observer MCP session required' })
        return true
      }
      for (const stream of session.streams) stream.end()
      this.#sessions.delete(session.id)
      response.writeHead(204)
      response.end()
      return true
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST, DELETE' })
      response.end()
      return true
    }

    let rpc: JsonRpcRequest
    try {
      const body = await this.#readBody(request)
      const input = record(body, 'MCP request')
      if (input.jsonrpc !== '2.0' || typeof input.method !== 'string') throw new Error('Invalid MCP request')
      rpc = input as unknown as JsonRpcRequest
    } catch (error) {
      sendJson(response, 400, rpcError(null, -32700, error instanceof Error ? error.message : String(error)))
      return true
    }

    if (rpc.method === 'initialize') {
      const params = rpc.params && typeof rpc.params === 'object' ? rpc.params : {}
      const requestedVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : OBSERVER_MCP_PROTOCOL_VERSION
      if (requestedVersion !== OBSERVER_MCP_PROTOCOL_VERSION) {
        sendJson(response, 200, rpcError(rpc.id ?? null, -32602, `Unsupported protocol version ${requestedVersion}`))
        return true
      }
      const session: ObserverProtocolSession = { id: randomUUID(), principalId: principal.principalId, initialized: false, streams: new Set() }
      this.#sessions.set(session.id, session)
      sendJson(response, 200, rpcResult(rpc.id ?? null, {
        protocolVersion: OBSERVER_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: 'mrmic-observer-workspace', version: '0.15.3' },
        instructions: 'Read only your authenticated observer snapshot; nested subcanvas navigation is fail-closed against Canvas topology authority.',
      }), session.id)
      return true
    }

    const session = requestedSessionId ? this.#sessions.get(requestedSessionId) : undefined
    if (!session || session.principalId !== principal.principalId) {
      sendJson(response, 401, rpcError(rpc.id ?? null, -32001, 'Unknown or cross-principal observer MCP session'))
      return true
    }
    if (rpc.method === 'notifications/initialized') {
      session.initialized = true
      response.writeHead(202, { 'mcp-session-id': session.id })
      response.end()
      return true
    }
    if (!session.initialized) {
      sendJson(response, 400, rpcError(rpc.id ?? null, -32002, 'Session is not initialized'), session.id)
      return true
    }
    if (rpc.id === undefined) {
      response.writeHead(202, { 'mcp-session-id': session.id })
      response.end()
      return true
    }
    sendJson(response, 200, await this.#dispatchMcp(rpc, principal), session.id)
    return true
  }

  async #dispatchMcp(rpc: JsonRpcRequest, principal: AuthenticatedPrincipal): Promise<unknown> {
    const id = rpc.id ?? null
    try {
      switch (rpc.method) {
        case 'ping': return rpcResult(id, {})
        case 'tools/list': return rpcResult(id, { tools: [
          {
            name: 'observer.get_snapshot',
            title: 'Get private observer snapshot',
            description: 'Return only views and rendezvous visible to the authenticated principal.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            name: 'observer.get_canvas_contexts',
            title: 'Resolve nested observer canvas contexts',
            description: 'Resolve root and nested Canvas contexts, active depth, independent foreground stacks and inherited effective visibility for one private view.',
            inputSchema: { type: 'object', required: ['viewId'], properties: { viewId: { type: 'string' } }, additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            name: 'observer.command',
            title: 'Apply observer workspace command',
            description: 'Apply one explicit observer-relative workspace transition under authenticated-principal authority.',
            inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'object', required: ['kind'] } }, additionalProperties: false },
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
        ] })
        case 'tools/call': {
          const params = record(rpc.params, 'params')
          const name = text(params.name, 'params.name')
          const args = params.arguments === undefined ? {} : record(params.arguments, 'params.arguments')
          if (name === 'observer.get_snapshot') return rpcResult(id, toolEnvelope(true, this.#workspace.snapshotFor(principal)))
          if (name === 'observer.get_canvas_contexts') {
            return rpcResult(id, toolEnvelope(true, this.#workspace.getResolvedCanvasContexts(text(args.viewId, 'viewId'), principal)))
          }
          if (name === 'observer.command') {
            try { return rpcResult(id, toolEnvelope(true, executeObserverProtocolCommand(this.#workspace, args.command, principal))) }
            catch (error) { return rpcResult(id, toolEnvelope(false, undefined, error instanceof Error ? error.message : String(error))) }
          }
          return rpcError(id, -32602, `Unknown observer tool ${name}`)
        }
        case 'resources/list': return rpcResult(id, { resources: [
          { uri: OBSERVER_SELF_RESOURCE_URI, name: 'Authenticated observer snapshot', mimeType: 'application/json', description: 'Principal-filtered private views and rendezvous membership.' },
        ] })
        case 'resources/templates/list': return rpcResult(id, { resourceTemplates: [
          { uriTemplate: 'mrmic://observer/rendezvous/{rendezvousId}', name: 'Visible observer rendezvous', mimeType: 'application/json', description: 'Read one rendezvous only when the authenticated principal is a member.' },
          { uriTemplate: 'mrmic://observer/view/{viewId}/contexts', name: 'Observer nested canvas contexts', mimeType: 'application/json', description: 'Read effective visibility and layered foreground context only for the authenticated principal private view.' },
        ] })
        case 'resources/read': {
          const params = record(rpc.params, 'params')
          const uri = text(params.uri, 'params.uri')
          if (uri === OBSERVER_SELF_RESOURCE_URI) {
            return rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(this.#workspace.snapshotFor(principal), null, 2) }] })
          }
          const rendezvousPrefix = 'mrmic://observer/rendezvous/'
          if (uri.startsWith(rendezvousPrefix)) {
            const rendezvousId = decodeURIComponent(uri.slice(rendezvousPrefix.length))
            const room = this.#workspace.getRendezvous(rendezvousId, principal)
            return rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(room, null, 2) }] })
          }
          const viewPrefix = 'mrmic://observer/view/'
          const viewSuffix = '/contexts'
          if (uri.startsWith(viewPrefix) && uri.endsWith(viewSuffix)) {
            const viewId = decodeURIComponent(uri.slice(viewPrefix.length, -viewSuffix.length))
            const contexts = this.#workspace.getResolvedCanvasContexts(viewId, principal)
            return rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ viewId, contexts }, null, 2) }] })
          }
          return rpcError(id, -32602, `Observer resource not found: ${uri}`)
        }
        default: return rpcError(id, -32601, `Method not found: ${rpc.method}`)
      }
    } catch (error) {
      return rpcError(id, -32603, error instanceof Error ? error.message : String(error))
    }
  }

  #readBody(request: any): Promise<unknown> {
    return new Promise((resolveBody, reject) => {
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => chunks.push(chunk))
      request.on('end', () => {
        try {
          const source = Buffer.concat(chunks).toString('utf8')
          resolveBody(source ? JSON.parse(source) : {})
        } catch (error) { reject(error) }
      })
      request.on('error', reject)
    })
  }
}
