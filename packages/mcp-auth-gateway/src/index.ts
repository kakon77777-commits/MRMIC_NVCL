import {
  bearerTokenFromAuthorization,
  type AuthenticatedPrincipal,
  type IdentityResolver,
} from '../../identity-auth/src/index.js'

export interface McpHttpHandler {
  handleHttp(request: any, response: any): Promise<boolean>
}

export interface AuthenticatedMcpGatewayOptions {
  inner: McpHttpHandler
  identityResolver: IdentityResolver
  path?: string
}

interface SessionBinding {
  principalId: string
  semanticAgentId?: string
}

function headerValue(headers: Record<string, unknown>, name: string): unknown {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}

function asHeaderString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function requestPath(request: any): string {
  try {
    return new URL(request.url ?? '/', `http://${request.headers?.host ?? 'localhost'}`).pathname
  } catch {
    return '/'
  }
}

function sessionIdFromRequest(request: any): string | undefined {
  const value = asHeaderString(headerValue(request.headers ?? {}, 'mcp-session-id'))
  return value?.trim() || undefined
}

function sendJson(response: any, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

function bindLegacyHeaders(request: any, principal: AuthenticatedPrincipal): void {
  request.headers ??= {}
  request.headers['x-mrmic-role'] = principal.role
  request.headers['x-mrmic-actor-id'] = principal.actor.actorId
  request.headers['x-mrmic-principal-id'] = principal.principalId
  if (principal.semanticAgentId) request.headers['x-mrmic-semantic-agent-id'] = principal.semanticAgentId
  else delete request.headers['x-mrmic-semantic-agent-id']
}

function responseSessionId(response: any): string | undefined {
  if (typeof response.getHeader !== 'function') return undefined
  const value = response.getHeader('mcp-session-id')
  return asHeaderString(value)?.trim() || undefined
}

/**
 * AuthenticatedMcpGateway enforces PMW identity before delegating to the
 * existing MRMIC MCP server. It deliberately leaves MCP method semantics in
 * the existing server and only owns authentication/session-principal binding.
 *
 * Security invariants:
 * - every /mcp request requires a valid bearer principal;
 * - caller supplied x-mrmic-role / x-mrmic-actor-id are overwritten;
 * - an MCP session is pinned to the principal that created it;
 * - a gateway restart invalidates old MCP sessions (fail closed).
 */
export class AuthenticatedMcpGateway implements McpHttpHandler {
  readonly #inner: McpHttpHandler
  readonly #identityResolver: IdentityResolver
  readonly #path: string
  readonly #sessions = new Map<string, SessionBinding>()

  constructor(options: AuthenticatedMcpGatewayOptions) {
    this.#inner = options.inner
    this.#identityResolver = options.identityResolver
    this.#path = options.path ?? '/mcp'
  }

  sessionCount(): number { return this.#sessions.size }

  async handleHttp(request: any, response: any): Promise<boolean> {
    if (requestPath(request) !== this.#path) return false

    const token = bearerTokenFromAuthorization(headerValue(request.headers ?? {}, 'authorization'))
    const principal = token ? this.#identityResolver.resolveToken(token) : null
    if (!principal) {
      sendJson(response, 401, { error: 'Valid PMW bearer principal required' })
      return true
    }

    const requestedSessionId = sessionIdFromRequest(request)
    if (requestedSessionId) {
      const bound = this.#sessions.get(requestedSessionId)
      if (!bound) {
        sendJson(response, 401, { error: 'Unknown MCP session at authentication gateway; reinitialize' })
        return true
      }
      if (bound.principalId !== principal.principalId) {
        sendJson(response, 403, { error: 'MCP session belongs to another authenticated principal' })
        return true
      }
    }

    bindLegacyHeaders(request, principal)
    const handled = await this.#inner.handleHttp(request, response)
    if (!handled) return false

    const createdSessionId = responseSessionId(response)
    if (!requestedSessionId && createdSessionId) {
      this.#sessions.set(createdSessionId, {
        principalId: principal.principalId,
        ...(principal.semanticAgentId ? { semanticAgentId: principal.semanticAgentId } : {}),
      })
    }

    if (request.method === 'DELETE' && requestedSessionId) this.#sessions.delete(requestedSessionId)
    return true
  }
}
