import { resolve } from 'node:path'
import { SqliteEventLedger } from '../../../packages/event-ledger/src/index.js'

const path = resolve('data/local.db')
const ledger = new SqliteEventLedger(path)
console.log(`Migration complete: ${path}; events=${ledger.count()}`)
ledger.close()
