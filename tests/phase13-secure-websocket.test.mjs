import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase2Server } from '../dist/apps/web/src/server.js'

function opened(ws){return new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})}
function message(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',listener);reject(new Error('message timeout'))},timeout);function listener(event){const value=JSON.parse(String(event.data));if(predicate(value)){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(value)}}ws.addEventListener('message',listener)})}
function close(ws){try{ws.close()}catch{}}

test('secure WebSocket mode binds forged presence and mutation actors to the verified PMW principal',async()=>{
  const previous=process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify([{
    token:'phase13-live-claude-binding-token',
    principalId:'principal:claude-local',
    role:'agent-direct',
    actorType:'agent',
    actorId:'mrmic:claude-binding',
    semanticAgentId:'agent:claude-main',
  }])
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start(); const url=started.url.replace('http','ws')+'/sync'; const ws=new WebSocket(url)
  try{
    await opened(ws)
    ws.send(JSON.stringify({type:'hello',clientId:'claude-live',authToken:'phase13-live-claude-binding-token',stateVector:{},presence:{clientId:'claude-live',actorType:'user',actorId:'user:neo',label:'Claude',updatedAt:''}}))
    const ack=await message(ws,m=>m.type==='hello_ack')
    assert.equal(ack.identity.verified,true)
    assert.equal(ack.identity.semanticAgentId,'agent:claude-main')
    const self=ack.presence.find(p=>p.clientId==='claude-live')
    assert.equal(self.actorType,'agent')
    assert.equal(self.actorId,'mrmic:claude-binding')
    assert.equal(self.semanticAgentId,'agent:claude-main')
    assert.equal(self.identityStatus,'verified')

    const update=app.room.nextUpdate('claude-live',app.createSeedTransaction())
    const seen=message(ws,m=>m.type==='update'&&m.update.updateId===update.updateId)
    ws.send(JSON.stringify({type:'update',update:{...update,transaction:{...update.transaction,actor:{actorType:'user',actorId:'user:neo'}}}}))
    const pushed=await seen
    assert.equal(pushed.update.transaction.actor.actorType,'agent')
    assert.equal(pushed.update.transaction.actor.actorId,'mrmic:claude-binding')
  }finally{
    close(ws); await app.close()
    if(previous===undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON=previous
  }
})

test('secure WebSocket mode rejects unauthenticated peers claiming AI presence',async()=>{
  const previous=process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify([{
    token:'phase13-live-codex-binding-token',
    principalId:'principal:codex-local',
    role:'agent-direct',
    actorType:'agent',
    actorId:'mrmic:codex-binding',
    semanticAgentId:'agent:codex-reviewer',
  }])
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start(); const ws=new WebSocket(started.url.replace('http','ws')+'/sync')
  try{
    await opened(ws)
    const rejected=message(ws,m=>m.type==='error')
    ws.send(JSON.stringify({type:'hello',clientId:'fake-ai',stateVector:{},presence:{clientId:'fake-ai',actorType:'agent',actorId:'agent:fake',label:'Fake',updatedAt:''}}))
    const error=await rejected
    assert.match(error.message,/authenticated principal|authenticated presence/)
    assert.equal(app.room.presenceSnapshot().some(p=>p.clientId==='fake-ai'),false)
  }finally{
    close(ws); await app.close()
    if(previous===undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON=previous
  }
})
