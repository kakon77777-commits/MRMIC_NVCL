import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createIdentityResolverFromEnv } from '../../../packages/identity-auth/src/index.js'
import { DurableObserverWorkspaceRegistry } from '../../../packages/observer-workspace/src/durable-registry.js'
import { SqliteObserverWorkspaceEventStore } from '../../../packages/observer-workspace/src/durable-store.js'
import type { ObserverCanvasTopologyResolver } from '../../../packages/observer-workspace/src/topology.js'
import { ObserverProtocolGateway } from '../../../packages/observer-protocol/src/index.js'

export interface ObserverProtocolServerOptions {
  host?: string
  port?: number
  databasePath?: string
  topology?: ObserverCanvasTopologyResolver
}

export function createObserverProtocolServer(options: ObserverProtocolServerOptions = {}) {
  const identityResolver = createIdentityResolverFromEnv()
  if (!identityResolver) throw new Error('MRMIC_PMW_BINDINGS_JSON is required for the observer protocol server')
  const databasePath = options.databasePath ?? process.env.MRMIC_OBSERVER_DATABASE_PATH ?? resolve(process.cwd(), 'data/observer-workspace.sqlite')
  const store = new SqliteObserverWorkspaceEventStore(databasePath)
  const workspace = new DurableObserverWorkspaceRegistry(store, undefined, options.topology)
  const gateway = new ObserverProtocolGateway({ workspace, identityResolver })
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.MRMIC_OBSERVER_PORT ?? 4180)
  const server = createServer(async (request: any, response: any) => {
    try {
      if (await gateway.handleHttp(request, response)) return
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'Not found' }))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  return {
    gateway,
    workspace,
    async start(): Promise<{ url: string; host: string; port: number }> {
      return new Promise((resolveStart, reject) => {
        server.once?.('error', reject)
        server.listen(port, host, () => {
          const address = server.address?.()
          const actualPort = typeof address === 'object' && address ? Number(address.port) : port
          resolveStart({ url: `http://${host}:${actualPort}`, host, port: actualPort })
        })
      })
    },
    async close(): Promise<void> {
      await new Promise<void>((resolveClose, reject) => server.close((error: unknown) => error ? reject(error) : resolveClose()))
      store.close()
    },
  }
}

if (process.argv[1]?.includes('observer-protocol-server')) {
  const app = createObserverProtocolServer()
  app.start().then(started => console.log(`MRMIC observer protocol server listening at ${started.url}`))
}
