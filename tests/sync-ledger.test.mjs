import test from 'node:test'
import assert from 'node:assert/strict'
import { SqliteSyncUpdateLog } from '../dist/packages/sync-ledger/src/index.js'

test('sync update log persists ordered updates without duplicates',()=>{const log=new SqliteSyncUpdateLog(':memory:');const update={updateId:'u1',roomId:'r',clientId:'a',counter:1,transaction:{id:'t',canvasId:'c',actor:{actorType:'agent',actorId:'a'},intent:'x',preconditions:[],operations:[],mode:'direct',createdAt:'2026-01-01T00:00:00Z'},createdAt:'2026-01-01T00:00:00Z',result:{ok:true,transactionId:'t',canvasId:'c',revision:1,affectedObjectIds:[],beforeHash:'a',afterHash:'b'}};log.append(update);log.append(update);assert.equal(log.count('r'),1);assert.equal(log.list('r')[0].updateId,'u1');log.close()})
