import { createPhase2Server } from '../../web/src/server.js'

function waitMessage(ws: WebSocket, predicate: (value:any)=>boolean, timeout=3000):Promise<any>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),timeout); const listener=(event:MessageEvent)=>{const value=JSON.parse(String(event.data)); if(predicate(value)){clearTimeout(timer); ws.removeEventListener('message',listener); resolve(value)}}; ws.addEventListener('message',listener)})}

const app=createPhase2Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'})
const started=await app.start(); const wsUrl=started.url.replace('http','ws')+'/sync'
const a=new WebSocket(wsUrl), b=new WebSocket(wsUrl)
await Promise.all([new Promise<void>(r=>a.addEventListener('open',()=>r(),{once:true})),new Promise<void>(r=>b.addEventListener('open',()=>r(),{once:true}))])
a.send(JSON.stringify({type:'hello',clientId:'agent-a',stateVector:{},presence:{clientId:'agent-a',actorType:'agent',actorId:'agent-a',label:'Agent A',updatedAt:new Date().toISOString()}}))
b.send(JSON.stringify({type:'hello',clientId:'agent-b',stateVector:{},presence:{clientId:'agent-b',actorType:'agent',actorId:'agent-b',label:'Agent B',updatedAt:new Date().toISOString()}}))
await Promise.all([waitMessage(a,m=>m.type==='hello_ack'),waitMessage(b,m=>m.type==='hello_ack')])
const tx=app.createSeedTransaction(); const update=app.room.nextUpdate('agent-a',tx)
const received=waitMessage(b,m=>m.type==='update'&&m.update.updateId===update.updateId)
a.send(JSON.stringify({type:'update',update})); await received
const vector=app.room.stateVector(); b.close(); await new Promise(r=>setTimeout(r,80))
const repair=app.createRepairTransaction(); const update2=app.room.nextUpdate('agent-a',repair); a.send(JSON.stringify({type:'update',update:update2})); await waitMessage(a,m=>m.type==='update'&&m.update.updateId===update2.updateId)
const b2=new WebSocket(wsUrl); await new Promise<void>(r=>b2.addEventListener('open',()=>r(),{once:true})); b2.send(JSON.stringify({type:'hello',clientId:'agent-b2',stateVector:vector,presence:{clientId:'agent-b2',actorType:'agent',actorId:'agent-b2',label:'Agent B reconnected',updatedAt:new Date().toISOString()}}))
const ack=await waitMessage(b2,m=>m.type==='hello_ack')
const report={phase:'2',server:started.url,updates:app.room.updateCount(),stateVector:app.room.stateVector(),reconnectMissing:ack.missingUpdates.length,presence:app.room.presenceSnapshot().map((x:any)=>x.clientId),canvasRevision:app.store.getCanvas(app.rootCanvas.id).revision,objects:app.store.listObjects(app.rootCanvas.id).length}
console.log(JSON.stringify(report,null,2)); a.close(); b2.close(); await app.close()
