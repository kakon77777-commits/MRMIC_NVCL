import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthenticatedMcpGateway } from '../dist/packages/mcp-auth-gateway/src/index.js'
import { StaticBearerIdentityResolver } from '../dist/packages/identity-auth/src/index.js'

const CLAUDE_TOKEN = 'claude-token-0000000000000001'
const CODEX_TOKEN = 'codex-token-00000000000000001'

function resolver() {
  return new StaticBearerIdentityResolver([
    {
      token: CLAUDE_TOKEN,
      principalId: 'principal:claude',
      role: 'agent-direct',
      actorType: 'agent',
      actorId: 'mrmic:claude-binding',
      semanticAgentId: 'agent:claude-main',
    },
    {
      token: CODEX_TOKEN,
      principalId: 'principal:codex',
      role: 'viewer',
      actorType: 'agent',
      actorId: 'mrmic:codex-binding',
      semanticAgentId: 'agent:codex-reviewer',
    },
  ])
}

class FakeResponse {
  statusCode = 0
  headers = new Map()
  body = ''
  ended = false
  writeHead(status, headers = {}) {
    this.statusCode = status
    for (const [key, value] of Object.entries(headers)) this.headers.set(key.toLowerCase(), value)
  }
  getHeader(name) { return this.headers.get(String(name).toLowerCase()) }
  end(body = '') { this.body += String(body); this.ended = true }
}

class FakeMcpServer {
  seen = []
  nextSession = 1
  async handleHttp(request, response) {
    this.seen.push({
      method: request.method,
      role: request.headers['x-mrmic-role'],
      actorId: request.headers['x-mrmic-actor-id'],
      principalId: request.headers['x-mrmic-principal-id'],
      semanticAgentId: request.headers['x-mrmic-semantic-agent-id'],
      sessionId: request.headers['mcp-session-id'],
    })
    if (!request.headers['mcp-session-id'] && request.method === 'POST') {
      response.writeHead(200, { 'mcp-session-id': `session-${this.nextSession++}` })
      response.end('{}')
      return true
    }
    response.writeHead(request.method === 'DELETE' ? 204 : 200)
    response.end()
    return true
  }
}

function request({ method = 'POST', token, sessionId, headers = {}, url = '/mcp' } = {}) {
  return {
    method,
    url,
    headers: {
      host: 'localhost',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...headers,
    },
  }
}

test('secure MCP gateway overwrites forged legacy actor and role headers', async () => {
  const inner = new FakeMcpServer()
  const gateway = new AuthenticatedMcpGateway({ inner, identityResolver: resolver() })
  const response = new FakeResponse()

  await gateway.handleHttp(request({
    token: CLAUDE_TOKEN,
    headers: { 'x-mrmic-role': 'owner', 'x-mrmic-actor-id': 'user:neo' },
  }), response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.getHeader('mcp-session-id'), 'session-1')
  assert.equal(gateway.sessionCount(), 1)
  assert.deepEqual(inner.seen[0], {
    method: 'POST',
    role: 'agent-direct',
    actorId: 'mrmic:claude-binding',
    principalId: 'principal:claude',
    semanticAgentId: 'agent:claude-main',
    sessionId: undefined,
  })
})

test('MCP session is pinned to the principal that initialized it', async () => {
  const inner = new FakeMcpServer()
  const gateway = new AuthenticatedMcpGateway({ inner, identityResolver: resolver() })
  const initResponse = new FakeResponse()
  await gateway.handleHttp(request({ token: CLAUDE_TOKEN }), initResponse)

  const sameResponse = new FakeResponse()
  await gateway.handleHttp(request({ token: CLAUDE_TOKEN, sessionId: 'session-1' }), sameResponse)
  assert.equal(sameResponse.statusCode, 200)
  assert.equal(inner.seen.length, 2)

  const takeoverResponse = new FakeResponse()
  await gateway.handleHttp(request({ token: CODEX_TOKEN, sessionId: 'session-1' }), takeoverResponse)
  assert.equal(takeoverResponse.statusCode, 403)
  assert.equal(inner.seen.length, 2)
})

test('secure MCP gateway rejects missing or invalid bearer credentials before inner server', async () => {
  const inner = new FakeMcpServer()
  const gateway = new AuthenticatedMcpGateway({ inner, identityResolver: resolver() })

  const missing = new FakeResponse()
  await gateway.handleHttp(request(), missing)
  assert.equal(missing.statusCode, 401)

  const invalid = new FakeResponse()
  await gateway.handleHttp(request({ token: 'invalid-token-000000000000' }), invalid)
  assert.equal(invalid.statusCode, 401)
  assert.equal(inner.seen.length, 0)
})

test('gateway fails closed for sessions it did not create and forgets deleted sessions', async () => {
  const inner = new FakeMcpServer()
  const gateway = new AuthenticatedMcpGateway({ inner, identityResolver: resolver() })

  const unknown = new FakeResponse()
  await gateway.handleHttp(request({ token: CLAUDE_TOKEN, sessionId: 'old-session' }), unknown)
  assert.equal(unknown.statusCode, 401)

  const init = new FakeResponse()
  await gateway.handleHttp(request({ token: CLAUDE_TOKEN }), init)
  assert.equal(gateway.sessionCount(), 1)

  const deleted = new FakeResponse()
  await gateway.handleHttp(request({ method: 'DELETE', token: CLAUDE_TOKEN, sessionId: 'session-1' }), deleted)
  assert.equal(deleted.statusCode, 204)
  assert.equal(gateway.sessionCount(), 0)
})

test('non-MCP paths pass through untouched', async () => {
  const inner = new FakeMcpServer()
  const gateway = new AuthenticatedMcpGateway({ inner, identityResolver: resolver() })
  const response = new FakeResponse()
  const handled = await gateway.handleHttp(request({ token: CLAUDE_TOKEN, url: '/api/state' }), response)
  assert.equal(handled, false)
  assert.equal(inner.seen.length, 0)
})
