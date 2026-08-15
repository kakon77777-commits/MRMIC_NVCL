import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { CanvasStore } from '../dist/packages/canvas-core/src/index.js'
import { StateVectorSyncRoom } from '../dist/packages/state-vector-sync/src/index.js'
import { CanvasWebSocketHub } from '../dist/packages/websocket-sync/src/index.js'
import { StaticBearerIdentityResolver } from '../dist/packages/identity-auth/src/index.js'
import { RuntimePresenceRegistry } from '../dist/packages/runtime-presence/src/index.js'

function opened(ws){return new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})}
function message(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',listener);reject(new Error('message timeout'))},timeout);function listener(event){const value=JSON.parse(String(event.data));if(predicate(value)){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(value)}}ws.addEventListener('message',listener)})}
async function closeSocket(ws){if(!ws||ws.readyState===WebSocket.CLOSED)return;await new Promise(resolve=>{const timer=setTimeout(resolve,500);ws.addEventListener('close',()=>{clearTimeout(timer);resolve()},{once:true});try{ws.close()}catch{clearTimeout(timer);resolve()}})}
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

async function createRuntimeServer(){
  const now='2026-08-15T00:00:00.000Z'
  const store=new CanvasStore(
    {id:'visual-ws',title:'Runtime ingress test',rootCanvasId:'root',schemaVersion:'0.13.6',createdAt:now,updatedAt:now},
    {id:'root',workspaceId:'visual-ws',title:'Root',objectIds:[],revision:0,createdAt:now,updatedAt:now},
  )
  const room=new StateVectorSyncRoom({roomId:'visual-ws:root',applyTransaction:tx=>store.applyTransaction(tx)})
  const runtimePresence=new RuntimePresenceRegistry()
  const resolver=new StaticBearerIdentityResolver(bindings)
  const hub=new CanvasWebSocketHub(room,{identityResolver:resolver,allowAnonymousUserPresence:false,runtimePresenceRegistry:runtimePresence})
  const server=createServer((_request,response)=>{response.statusCode=404;response.end()})
  const upgradedSockets=new Set()
  server.on('upgrade',(request,socket,head)=>{
    upgradedSockets.add(socket)
    socket.on('close',()=>upgradedSockets.delete(socket))
    hub.handleUpgrade(request,socket,head)
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  server.unref()
  const address=server.address()
  if(!address||typeof address==='string')throw new Error('test server did not expose a TCP address')
  return {
    store,room,hub,runtimePresence,server,
    url:`ws://127.0.0.1:${address.port}/sync`,
    close:async()=>{
      for(const socket of upgradedSockets){try{socket.destroy()}catch{}}
      try{server.closeAllConnections?.()}catch{}
      try{server.closeIdleConnections?.()}catch{}
      await Promise.race([
        new Promise(resolve=>{try{server.close(()=>resolve())}catch{resolve()}}),
        new Promise(resolve=>setTimeout(resolve,300)),
      ])
    },
  }
}

test('authenticated Herdr runtime presence broadcasts across peers without mutating Canvas history',async()=>{
  const app=await createRuntimeServer();const claude=new WebSocket(app.url),codex=new WebSocket(app.url)
  try{
    await Promise.all([opened(claude),opened(codex)])
    const [claudeAck,codexAck]=await Promise.all([
      hello(claude,{clientId:'bridge-claude',authToken:bindings[0].token,presence:{label:'Claude',task:'Research'}}),
      hello(codex,{clientId:'observer-codex',authToken:bindings[1].token,presence:{label:'Codex',task:'Observe'}}),
    ])
    assert.equal(claudeAck.identity.semanticAgentId,'agent:claude-main')
    assert.equal(codexAck.identity.semanticAgentId,'agent:codex-reviewer')
    assert.ok(Array.isArray(codexAck.runtimePresence))

    const revisionBefore=app.store.getCanvas('root').revision
    const accepted=message(codex,m=>m.type==='runtime_presence'&&m.runtimePresence?.providerResourceId==='terminal-claude'&&m.runtimePresence?.status==='working')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:{...runtime(),principalId:'principal:forged',semanticAgentId:'user:neo',actorId:'user:neo',secret:'drop-me'}}))
    const seen=await accepted
    assert.equal(seen.runtimePresence.principalId,'principal:claude-runtime')
    assert.equal(seen.runtimePresence.semanticAgentId,'agent:claude-main')
    assert.equal(seen.runtimePresence.clientId,'bridge-claude')
    assert.equal(seen.runtimePresence.identityStatus,'verified')
    assert.equal('actorId' in seen.runtimePresence,false)
    assert.equal('secret' in seen.runtimePresence,false)
    assert.equal(app.store.getCanvas('root').revision,revisionBefore)

    let extraAccepted=0
    const countListener=event=>{const value=JSON.parse(String(event.data));if(value.type==='runtime_presence'&&value.runtimePresence?.providerResourceId==='terminal-claude')extraAccepted+=1}
    codex.addEventListener('message',countListener)
    const staleRejected=message(claude,m=>m.type==='runtime_presence_rejected'&&m.reason==='stale_revision')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({status:'done',revision:9,sequence:99})}))
    const stale=await staleRejected
    assert.equal(stale.runtimePresence.status,'working')
    await new Promise(resolve=>setTimeout(resolve,80))
    assert.equal(extraAccepted,0,'stale runtime fact must not broadcast as accepted state')
    codex.removeEventListener('message',countListener)

    const restartedSeen=message(codex,m=>m.type==='runtime_presence'&&m.runtimePresence?.runtimeEpochId==='epoch-2'&&m.runtimePresence?.status==='idle')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({runtimeEpochId:'epoch-2',status:'idle',revision:1,sequence:1})}))
    const restarted=await restartedSeen
    assert.equal(restarted.runtimePresence.revision,1)
    assert.equal(app.runtimePresence.snapshot().length,1)
    assert.equal(app.store.getCanvas('root').revision,revisionBefore)

    const removed=message(codex,m=>m.type==='runtime_presence_removed'&&m.runtimePresence?.providerResourceId==='terminal-claude')
    await closeSocket(claude)
    const removedState=await removed
    assert.equal(removedState.runtimePresence.semanticAgentId,'agent:claude-main')
    assert.equal(app.runtimePresence.snapshot().length,0)
    assert.equal(app.store.getCanvas('root').revision,revisionBefore)
  }finally{
    await closeSocket(claude);await closeSocket(codex);await app.close()
  }
})

test('new secure peer receives existing runtime presence in hello snapshot',async()=>{
  const app=await createRuntimeServer();const claude=new WebSocket(app.url),codex=new WebSocket(app.url)
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
    await closeSocket(claude);await closeSocket(codex);await app.close()
  }
})

test('viewer principal cannot publish runtime truth',async()=>{
  const app=await createRuntimeServer();const ws=new WebSocket(app.url)
  try{
    await opened(ws)
    await hello(ws,{clientId:'viewer-codex',authToken:bindings[1].token})
    const rejected=message(ws,m=>m.type==='error')
    ws.send(JSON.stringify({type:'runtime_presence',runtime:{...runtime(),providerResourceId:'terminal-codex',kind:'codex'}}))
    const error=await rejected
    assert.match(error.message,/viewer principal cannot publish runtime presence/)
    assert.equal(app.store.getCanvas('root').revision,0)
    assert.equal(app.runtimePresence.snapshot().length,0)
  }finally{
    await closeSocket(ws);await app.close()
  }
})
