import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase2Server } from '../dist/apps/web/src/server.js'

function opened(ws){return new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})}
function message(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',listener);reject(new Error('message timeout'))},timeout);function listener(event){const value=JSON.parse(String(event.data));if(predicate(value)){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(value)}}ws.addEventListener('message',listener)})}
function close(ws){try{ws.close()}catch{}}
async function hello(ws,input){const pending=message(ws,m=>m.type==='hello_ack');ws.send(JSON.stringify({type:'hello',stateVector:{},...input}));return await pending}

const bindings=[
  {
    token:'phase13-6-claude-runtime-token', principalId:'principal:claude-runtime', role:'agent-direct',
    actorType:'agent', actorId:'mrmic:claude-runtime', semanticAgentId:'agent:claude-main',
  },
  {
    token:'phase13-6-codex-observer-token', principalId:'principal:codex-observer', role:'viewer',
    actorType:'agent', actorId:'mrmic:codex-observer', semanticAgentId:'agent:codex-reviewer',
  },
]

function runtime(overrides={}){return{
  provider:'herdr', providerResourceId:'terminal-claude', runtimeEpochId:'epoch-1',
  status:'working', revision:10, sequence:20, kind:'claude', focused:false,
  interactiveReady:true, launchPending:false,
  coordinates:{workspaceId:'herdr-ws',tabId:'herdr-tab',paneId:'herdr-pane'},
  ...overrides,
}}

test('authenticated Herdr runtime presence broadcasts across peers without mutating Canvas history',async()=>{
  const previous=process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify(bindings)
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start(); const url=started.url.replace('http','ws')+'/sync'
  const claude=new WebSocket(url), codex=new WebSocket(url)
  try{
    await Promise.all([opened(claude),opened(codex)])
    const [claudeAck,codexAck]=await Promise.all([
      hello(claude,{clientId:'bridge-claude',authToken:bindings[0].token,presence:{label:'Claude',task:'Research'}}),
      hello(codex,{clientId:'observer-codex',authToken:bindings[1].token,presence:{label:'Codex',task:'Observe'}}),
    ])
    assert.equal(claudeAck.identity.semanticAgentId,'agent:claude-main')
    assert.equal(codexAck.identity.semanticAgentId,'agent:codex-reviewer')
    assert.ok(Array.isArray(codexAck.runtimePresence))

    const revisionBefore=app.store.getCanvas(app.rootCanvas.id).revision
    const accepted=message(codex,m=>m.type==='runtime_presence'&&m.runtimePresence?.providerResourceId==='terminal-claude'&&m.runtimePresence?.status==='working')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:{...runtime(),principalId:'principal:forged',semanticAgentId:'user:neo',actorId:'user:neo',secret:'drop-me'}}))
    const seen=await accepted
    assert.equal(seen.runtimePresence.principalId,'principal:claude-runtime')
    assert.equal(seen.runtimePresence.semanticAgentId,'agent:claude-main')
    assert.equal(seen.runtimePresence.clientId,'bridge-claude')
    assert.equal(seen.runtimePresence.identityStatus,'verified')
    assert.equal('actorId' in seen.runtimePresence,false)
    assert.equal('secret' in seen.runtimePresence,false)
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,revisionBefore)

    let codexAcceptedCount=1
    const countListener=event=>{const value=JSON.parse(String(event.data));if(value.type==='runtime_presence'&&value.runtimePresence?.providerResourceId==='terminal-claude')codexAcceptedCount+=1}
    codex.addEventListener('message',countListener)
    const staleRejected=message(claude,m=>m.type==='runtime_presence_rejected'&&m.reason==='stale_revision')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({status:'done',revision:9,sequence:99})}))
    const stale=await staleRejected
    assert.equal(stale.runtimePresence.status,'working')
    await new Promise(resolve=>setTimeout(resolve,80))
    assert.equal(codexAcceptedCount,1,'stale runtime fact must not broadcast as accepted state')
    codex.removeEventListener('message',countListener)

    const restartedSeen=message(codex,m=>m.type==='runtime_presence'&&m.runtimePresence?.runtimeEpochId==='epoch-2'&&m.runtimePresence?.status==='idle')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({runtimeEpochId:'epoch-2',status:'idle',revision:1,sequence:1})}))
    const restarted=await restartedSeen
    assert.equal(restarted.runtimePresence.revision,1)
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,revisionBefore)

    const removed=message(codex,m=>m.type==='runtime_presence_removed'&&m.runtimePresence?.providerResourceId==='terminal-claude')
    close(claude)
    const removedState=await removed
    assert.equal(removedState.runtimePresence.semanticAgentId,'agent:claude-main')
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,revisionBefore)
  }finally{
    close(claude);close(codex);await app.close()
    if(previous===undefined)delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON=previous
  }
})

test('new secure peer receives existing runtime presence in hello snapshot',async()=>{
  const previous=process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify(bindings)
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start(); const url=started.url.replace('http','ws')+'/sync'
  const claude=new WebSocket(url), codex=new WebSocket(url)
  try{
    await opened(claude)
    await hello(claude,{clientId:'bridge-claude',authToken:bindings[0].token})
    const accepted=message(claude,m=>m.type==='runtime_presence'&&m.runtimePresence?.providerResourceId==='terminal-claude')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime()}))
    await accepted

    await opened(codex)
    const ack=await hello(codex,{clientId:'observer-codex',authToken:bindings[1].token})
    const state=ack.runtimePresence.find(item=>item.providerResourceId==='terminal-claude')
    assert.equal(state.status,'working')
    assert.equal(state.semanticAgentId,'agent:claude-main')
  }finally{
    close(claude);close(codex);await app.close()
    if(previous===undefined)delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON=previous
  }
})

test('viewer principal cannot publish runtime truth',async()=>{
  const previous=process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify(bindings)
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start(); const ws=new WebSocket(started.url.replace('http','ws')+'/sync')
  try{
    await opened(ws)
    await hello(ws,{clientId:'viewer-codex',authToken:bindings[1].token})
    const rejected=message(ws,m=>m.type==='error')
    ws.send(JSON.stringify({type:'runtime_presence',runtime:{...runtime(),providerResourceId:'terminal-codex',kind:'codex'}}))
    const error=await rejected
    assert.match(error.message,/viewer principal cannot publish runtime presence/)
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,0)
  }finally{
    close(ws);await app.close()
    if(previous===undefined)delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON=previous
  }
})
