import test from 'node:test'
import assert from 'node:assert/strict'
import { StateVectorSyncRoom, mergeStateVectors } from '../dist/packages/state-vector-sync/src/index.js'

function tx(id){return{id,canvasId:'c',actor:{actorType:'agent',actorId:'a'},intent:id,preconditions:[],operations:[],mode:'direct',createdAt:new Date().toISOString()}}

test('state-vector room applies updates idempotently and computes diffs',async()=>{let applied=0;const room=new StateVectorSyncRoom({roomId:'r',applyTransaction:t=>({ok:true,transactionId:t.id,canvasId:'c',revision:++applied,affectedObjectIds:[],beforeHash:'a',afterHash:'b'})});const u=room.nextUpdate('a',tx('t1'));const first=await room.apply(u),second=await room.apply(u);assert.equal(first.result.revision,1);assert.equal(second.result.revision,1);assert.equal(applied,1);assert.deepEqual(room.stateVector(),{a:1});assert.equal(room.diff({a:0}).length,1);assert.equal(room.diff({a:1}).length,0)})

test('state-vector rejects gaps and merges vectors',async()=>{const room=new StateVectorSyncRoom({roomId:'r',applyTransaction:t=>({ok:true,transactionId:t.id,canvasId:'c',revision:1,affectedObjectIds:[],beforeHash:'a',afterHash:'b'})});const u=room.nextUpdate('a',tx('t'));u.counter=2;await assert.rejects(()=>room.apply(u),/Counter gap/);assert.deepEqual(mergeStateVectors({a:2,b:1},{a:1,c:4}),{a:2,b:1,c:4})})

test('presence is ephemeral and emits removal',()=>{const room=new StateVectorSyncRoom({roomId:'r',applyTransaction:()=>{throw new Error('unused')}});const events=[];room.subscribe(e=>events.push(e));room.setPresence({clientId:'a',actorType:'agent',actorId:'a',label:'A',updatedAt:''});assert.equal(room.presenceSnapshot().length,1);room.removePresence('a');assert.equal(room.presenceSnapshot().length,0);assert.equal(events.at(-1).type,'presence_removed')})
