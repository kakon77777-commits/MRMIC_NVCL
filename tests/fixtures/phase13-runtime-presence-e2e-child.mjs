import assert from 'node:assert/strict'
import { createPhase2Server } from '../../dist/apps/web/src/server.js'

const bindings=[
  {token:'phase13-6-claude-runtime-token',principalId:'principal:claude-runtime',role:'agent-direct',actorType:'agent',actorId:'mrmic:claude-runtime',semanticAgentId:'agent:claude-main'},
  {token:'phase13-6-codex-observer-token',principalId:'principal:codex-observer',role:'viewer',actorType:'agent',actorId:'mrmic:codex-observer',semanticAgentId:'agent:codex-reviewer'},
]

function trace(step){console.error(`[phase13.6-e2e] ${step}`)}
function runtime(overrides={}){return{
  provider:'herdr',providerResourceId:'terminal-claude',runtimeEpochId:'epoch-1',status:'working',
  revision:10,sequence:20,kind:'claude',focused:false,interactiveReady:true,launchPending:false,
  coordinates:{workspaceId:'herdr-ws',tabId:'herdr-tab',paneId:'herdr-pane'},...overrides,
}}

function opened(ws,timeout=2000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>cleanup(new Error('WebSocket open timeout')),timeout)
  const onOpen=()=>cleanup()
  const onError=()=>cleanup(new Error('WebSocket open error'))
  const onClose=event=>cleanup(new Error(`WebSocket closed before open: ${event.code} ${event.reason??''}`))
  function cleanup(error){
    clearTimeout(timer);ws.removeEventListener('open',onOpen);ws.removeEventListener('error',onError);ws.removeEventListener('close',onClose)
    if(error)reject(error);else resolve()
  }
  ws.addEventListener('open',onOpen,{once:true});ws.addEventListener('error',onError,{once:true});ws.addEventListener('close',onClose,{once:true})
})}

function message(ws,predicate,timeout=2000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.removeEventListener('message',listener);reject(new Error('message timeout'))},timeout)
  function listener(event){
    const value=JSON.parse(String(event.data))
    if(predicate(value)){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(value)}
  }
  ws.addEventListener('message',listener)
})}

async function closeSocket(ws){
  if(!ws||ws.readyState===WebSocket.CLOSED)return
  await new Promise(resolve=>{
    const timer=setTimeout(resolve,250)
    ws.addEventListener('close',()=>{clearTimeout(timer);resolve()},{once:true})
    try{ws.close()}catch{clearTimeout(timer);resolve()}
  })
}

async function hello(ws,input){
  const pending=message(ws,m=>m.type==='hello_ack')
  ws.send(JSON.stringify({type:'hello',stateVector:{},...input}))
  return await pending
}

async function main(){
  process.env.MRMIC_PMW_BINDINGS_JSON=JSON.stringify(bindings)
  trace('starting real Phase2 host')
  const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
  const started=await app.start()
  const url=started.url.replace('http','ws')+'/sync'
  trace(`host started ${url}`)

  const claude=new WebSocket(url)
  const codex=new WebSocket(url)
  let late
  try{
    await Promise.all([opened(claude),opened(codex)])
    trace('Claude and Codex sockets open')
    const [claudeAck,codexAck]=await Promise.all([
      hello(claude,{clientId:'bridge-claude',authToken:bindings[0].token,presence:{label:'Claude',task:'Research'}}),
      hello(codex,{clientId:'observer-codex',authToken:bindings[1].token,presence:{label:'Codex',task:'Observe'}}),
    ])
    assert.equal(claudeAck.identity.semanticAgentId,'agent:claude-main')
    assert.equal(codexAck.identity.semanticAgentId,'agent:codex-reviewer')
    assert.ok(Array.isArray(codexAck.runtimePresence))
    trace('verified hello complete')

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
    trace('runtime broadcast and identity binding verified')

    late=new WebSocket(url)
    await opened(late)
    const lateAck=await hello(late,{clientId:'late-codex',authToken:bindings[1].token,presence:{label:'Late Codex'}})
    const snapshot=lateAck.runtimePresence.find(item=>item.providerResourceId==='terminal-claude')
    assert.equal(snapshot.status,'working')
    assert.equal(snapshot.semanticAgentId,'agent:claude-main')
    trace('late-peer runtime snapshot verified')

    const viewerRejected=message(codex,m=>m.type==='error'&&String(m.message).includes('viewer principal cannot publish runtime presence'))
    codex.send(JSON.stringify({type:'runtime_presence',runtime:{...runtime(),providerResourceId:'terminal-codex',kind:'codex'}}))
    await viewerRejected
    trace('viewer runtime publication rejected')

    let staleBroadcast=false
    const staleListener=event=>{
      const value=JSON.parse(String(event.data))
      if(value.type==='runtime_presence'&&value.runtimePresence?.providerResourceId==='terminal-claude'&&value.runtimePresence?.status==='done')staleBroadcast=true
    }
    codex.addEventListener('message',staleListener)
    const staleRejected=message(claude,m=>m.type==='runtime_presence_rejected'&&m.reason==='stale_revision')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({status:'done',revision:9,sequence:99})}))
    const stale=await staleRejected
    assert.equal(stale.runtimePresence.status,'working')
    await new Promise(resolve=>setTimeout(resolve,80))
    codex.removeEventListener('message',staleListener)
    assert.equal(staleBroadcast,false)
    trace('stale runtime update rejected without broadcast')

    const restartedSeen=message(codex,m=>m.type==='runtime_presence'&&m.runtimePresence?.runtimeEpochId==='epoch-2'&&m.runtimePresence?.status==='idle')
    claude.send(JSON.stringify({type:'runtime_presence',runtime:runtime({runtimeEpochId:'epoch-2',status:'idle',revision:1,sequence:1})}))
    const restarted=await restartedSeen
    assert.equal(restarted.runtimePresence.revision,1)
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,revisionBefore)
    trace('runtime epoch reset verified')

    const removed=message(codex,m=>m.type==='runtime_presence_removed'&&m.runtimePresence?.providerResourceId==='terminal-claude')
    await closeSocket(claude)
    const removedState=await removed
    assert.equal(removedState.runtimePresence.semanticAgentId,'agent:claude-main')
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,revisionBefore)
    trace('disconnect removal verified')

    console.log('phase13.6 runtime-presence real WebSocket E2E PASS')
  }finally{
    await closeSocket(claude);await closeSocket(codex);await closeSocket(late)
    trace('forcing child exit after verified shared session')
  }
}

main().then(()=>process.exit(0)).catch(error=>{
  console.error(error?.stack??String(error))
  process.exit(1)
})
