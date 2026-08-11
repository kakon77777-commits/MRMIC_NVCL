declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): { digest(encoding: 'hex' | 'base64'): string }
  }
  export function randomUUID(): string
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
  export class StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...paths: string[]): string
}

declare module 'node:http' {
  export function createServer(handler: (request: any, response: any) => void | Promise<void>): any
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string): Uint8Array
  export function writeFileSync(path: string, data: string | Uint8Array): void
  export function writeFileSync(path: string, data: string | Uint8Array, encoding: string): void
  export function appendFileSync(path: string, data: string | Uint8Array): void
  export function unlinkSync(path: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>
  export function statSync(path: string): { isFile(): boolean; mtimeMs: number }
}

declare module 'node:child_process' {
  export function spawn(command: string, args?: string[], options?: Record<string, unknown>): any
}

declare module 'node:readline' {
  export function createInterface(options: { input: any; crlfDelay?: number }): any
}

declare module 'node:path' {
  export function extname(path: string): string
  export function join(...paths: string[]): string
}

declare const Buffer: {
  concat(chunks: Uint8Array[]): { toString(encoding: string): string }
  from(data: Uint8Array | string, encoding?: string): Uint8Array & { toString(encoding?: string): string }
}

declare const process: {
  cwd(): string
  platform: string
  argv: string[]
  env: Record<string, string | undefined>
  exitCode?: number
  exit(code?: number): never
}
