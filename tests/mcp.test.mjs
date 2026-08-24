import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase3Server } from '../dist/apps/web/src/server.js'

async function createMcpClient(baseUrl, role='owner', actorId='test-mcp') {
  let sessionId = ''
  let id = 1
  async function raw(body, extraHeaders={}) {
    const response = await fetch(baseUrl + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sessionId ? {'Mcp-Session-Id': sessionId} : {}), ...extraHeaders },
      body: JSON.stringify(body),
    })
    const next = response.headers.get('mcp-session-id')
    if (next) sessionId = next
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) : undefined }
  }
  const initialized = await raw({jsonrpc:'2.0',id:id++,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}},{'x-mrmic-role':role,'x-mrmic-actor-id':actorId})
  assert.equal(initialized.response.status,200)
  assert.ok(sessionId)
  const ack = await raw({jsonrpc:'2.0',method:'notifications/initialized'})
  assert.equal(ack.response.status,202)
  return {
    get sessionId(){return sessionId},
    async rpc(method,params={}) { const result=await raw({jsonrpc:'2.0',id:id++,method,params}); return result.body },
  }
}

function opened(ws){return new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})}
function message(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeEventListener('message',listener);reject(new Error('message timeout'))},timeout);function listener(event){const value=JSON.parse(String(event.data));if(predicate(value)){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(value)}}ws.addEventListener('message',listener)})}

function createArgs(id='mcp-box') { return { canvasId:'canvas-root', intent:'MCP test creation', objects:[{id,type:'rectangle',transform:{x:40,y:50,width:120,height:80,zIndex:2},style:{fill:'#ddd6fe',stroke:'#6d28d9'},metadata:{role:'test'}}] } }

test('MCP initialize, tool listing, resource listing, and resource reads work over Streamable HTTP subset',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url)
    const tools=await client.rpc('tools/list'); assert.equal(tools.result.tools.length,26); assert.ok(tools.result.tools.some(t=>t.name==='canvas.patch_objects')); assert.ok(tools.result.tools.some(t=>t.name==='lab.observe')); assert.ok(tools.result.tools.some(t=>t.name==='lab.observe_adaptive')); assert.ok(tools.result.tools.some(t=>t.name==='lab.observe_passive')); assert.ok(tools.result.tools.some(t=>t.name==='lab.rank_observation_policies')); assert.ok(tools.result.tools.some(t=>t.name==='lab.act')); assert.ok(tools.result.tools.some(t=>t.name==='lab.rasterize'))
    const resources=await client.rpc('resources/list'); assert.equal(resources.result.resources.length,6); assert.ok(resources.result.resources.some(resource=>resource.uri==='mrmic://capabilities'))
    const uri=`canvas://workspace/${encodeURIComponent(app.workspace.id)}`
    const read=await client.rpc('resources/read',{uri}); assert.equal(read.result.contents[0].mimeType,'application/json'); assert.match(read.result.contents[0].text,/MRMIC NVCL Phase 13/)
  }finally{await app.close()}
})

test('adaptive MCP observations keep governor state isolated inside one session', async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'viewer','adaptive-viewer')
    const first=await client.rpc('tools/call',{name:'lab.observe_adaptive',arguments:{governorId:'watch',keyframeInterval:8}})
    assert.equal(first.result.isError,false)
    assert.equal(first.result.structuredContent.data.governance.disposition,'keyframe')
    assert.equal(first.result.structuredContent.data.observation.objects,undefined)
    assert.equal(first.result.structuredContent.resourceLinks.length,1)
    const second=await client.rpc('tools/call',{name:'lab.observe_adaptive',arguments:{governorId:'watch'}})
    assert.equal(second.result.structuredContent.data.governance.disposition,'skip')
    assert.equal(second.result.structuredContent.resourceLinks.length,0)
    const independentClient=await createMcpClient(started.url,'viewer','independent-viewer')
    const independent=await independentClient.rpc('tools/call',{name:'lab.observe_adaptive',arguments:{governorId:'watch'}})
    assert.equal(independent.result.structuredContent.data.governance.disposition,'keyframe')
    const reset=await client.rpc('tools/call',{name:'lab.observe_adaptive',arguments:{governorId:'watch',reset:true}})
    assert.equal(reset.result.structuredContent.data.governance.disposition,'keyframe')
    assert.equal(JSON.stringify(reset.result.structuredContent.data).includes('objectId'),false)
  }finally{await app.close()}
})

test('passive MCP timelines remain pixel-only and isolated by session and reset', async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'viewer','passive-viewer')
    const first=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'watch',keyframeInterval:8}})
    const firstData=first.result.structuredContent.data
    assert.equal(first.result.isError,false)
    assert.equal(firstData.sample.governance.disposition,'keyframe')
    assert.equal(firstData.sample.observation.objects,undefined)
    assert.equal(firstData.emitted.length,1)
    assert.equal(firstData.emitted[0].disposition,'keyframe')
    assert.equal(first.result.structuredContent.resourceLinks.length,1)

    const second=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'watch'}})
    const secondData=second.result.structuredContent.data
    assert.equal(secondData.sample.governance.disposition,'skip')
    assert.equal(secondData.emitted.length,0)
    assert.equal(secondData.stats.samples,2)
    assert.equal(second.result.structuredContent.resourceLinks.length,0)

    const independentClient=await createMcpClient(started.url,'viewer','passive-independent')
    const independent=await independentClient.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'watch'}})
    assert.equal(independent.result.structuredContent.data.sample.governance.disposition,'keyframe')

    const reset=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'watch',reset:true}})
    const resetData=reset.result.structuredContent.data
    assert.equal(resetData.sample.sampleIndex,1)
    assert.equal(resetData.sample.sceneEpoch,1)
    assert.equal(resetData.emitted[0].eventIndex,1)
    assert.equal(resetData.stats.samples,1)
    assert.equal(JSON.stringify(resetData).includes('objectId'),false)

    const flushed=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'watch',flush:true}})
    assert.deepEqual(flushed.result.structuredContent.data.emitted,[])
    assert.equal(flushed.result.structuredContent.data.stats.samples,1)
  }finally{await app.close()}
})

test('passive MCP timeline can opt into transient-preserving A-B-A boundaries', async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const blank=await app.lab.observe('pixel'); await app.lab.resetBenchmark('phase12-mcp-hybrid-reset',blank.frameId,'pixel')
    const client=await createMcpClient(started.url,'viewer','hybrid-viewer')
    await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'hybrid',boundaryMode:'transient_preserving',differenceThreshold:0.0001,blockDifferenceThreshold:0.02,keyframeInterval:50,coalesceWindowMs:500}})
    const baseline=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'hybrid'}})
    const baselineObservation=baseline.result.structuredContent.data.sample.observation
    const transientAction=await app.lab.execute({actionId:'phase12-mcp-transient-on',frameId:baselineObservation.frameId,canvasId:baselineObservation.canvasId,expectedCanvasRevision:baselineObservation.canvasRevision,type:'gesture',coordinateSpace:'frame_pixel',gesture:{kind:'restyle',at:{x:145,y:285},style:{fill:'#f59e0b',stroke:'#92400e',strokeWidth:7}}},'pixel')
    const transient=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'hybrid'}})
    assert.equal(transient.result.structuredContent.data.emitted.length,0)
    const transientObservation=transient.result.structuredContent.data.sample.observation
    assert.equal(transientObservation.renderSha256,transientAction.observation.renderSha256)
    await app.lab.execute({actionId:'phase12-mcp-transient-restore',frameId:transientObservation.frameId,canvasId:transientObservation.canvasId,expectedCanvasRevision:transientObservation.canvasRevision,type:'gesture',coordinateSpace:'frame_pixel',gesture:{kind:'restyle',at:{x:145,y:285},style:{fill:'#ef4444',stroke:'#991b1b',strokeWidth:4}}},'pixel')
    const restored=await client.rpc('tools/call',{name:'lab.observe_passive',arguments:{timelineId:'hybrid'}})
    const data=restored.result.structuredContent.data
    assert.equal(data.emitted.length,1)
    assert.equal(data.emitted[0].boundaryReason,'return_to_recent_visual_state')
    assert.equal(data.emitted[0].raster.sourceRenderSha256,transientObservation.renderSha256)
    assert.equal(data.stats.transientInterruptions,1)
    assert.equal(JSON.stringify(data).includes('objectId'),false)
  }finally{await app.close()}
})

test('viewer can rank supplied policy evidence without observing or mutating canvas state', async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'viewer','policy-ranker')
    const beforeRevision=app.store.getCanvas(app.rootCanvas.id).revision
    const call=await client.rpc('tools/call',{name:'lab.rank_observation_policies',arguments:{policies:[
      {policy:'always_full',actions:10,transitionGuardsPassed:10,perceptualActions:10,perceptuallyDeliveredActions:10,exactPostStatesRetained:10,transientStateRetained:true,alwaysFullBytes:1000,deliveredBytes:1000},
      {policy:'static_crop',actions:10,transitionGuardsPassed:10,perceptualActions:10,perceptuallyDeliveredActions:9,exactPostStatesRetained:6,transientStateRetained:true,alwaysFullBytes:1000,deliveredBytes:250},
      {policy:'governor_roi',actions:10,transitionGuardsPassed:10,perceptualActions:10,perceptuallyDeliveredActions:10,exactPostStatesRetained:10,transientStateRetained:true,alwaysFullBytes:1000,deliveredBytes:400},
      {policy:'passive_timeline',actions:10,transitionGuardsPassed:10,perceptualActions:10,perceptuallyDeliveredActions:10,exactPostStatesRetained:7,transientStateRetained:false,alwaysFullBytes:1000,deliveredBytes:200},
      {policy:'hybrid_transient',actions:10,transitionGuardsPassed:10,perceptualActions:10,perceptuallyDeliveredActions:10,exactPostStatesRetained:7,transientStateRetained:true,alwaysFullBytes:1000,deliveredBytes:180},
    ]}})
    const ranking=call.result.structuredContent.data.ranking
    assert.equal(call.result.isError,false)
    assert.equal(ranking.protocolVersion,'mrmic-observation-policy-ranking-v1')
    assert.equal(ranking.recommendedPolicy,'governor_roi')
    assert.equal(ranking.cards.length,5)
    assert.equal(ranking.cards.some(card=>card.policy==='hybrid_transient'),true)
    assert.equal(ranking.cards[0].score>ranking.cards[1].score,true)
    assert.match(ranking.boundary,/does not authorize actions/)
    assert.equal(app.store.getCanvas(app.rootCanvas.id).revision,beforeRevision)
    assert.equal(app.lab.trajectory.length,0)
  }finally{await app.close()}
})

test('viewer sessions can read but cannot mutate canvas state',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'viewer','viewer-1')
    const call=await client.rpc('tools/call',{name:'canvas.create_objects',arguments:createArgs('viewer-box')})
    assert.equal(call.result.isError,true); assert.equal(call.result.structuredContent.error.code,'PERMISSION_DENIED'); assert.equal(app.store.listObjects(app.rootCanvas.id).length,0)
    const labCall=await client.rpc('tools/call',{name:'lab.act',arguments:{action:{}}})
    assert.equal(labCall.result.isError,true); assert.equal(labCall.result.structuredContent.error.code,'PERMISSION_DENIED')
  }finally{await app.close()}
})

test('MCP mutation becomes synchronized room update and reaches WebSocket peers',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start(); const ws=new WebSocket(started.url.replace('http','ws')+'/sync')
  try{
    await opened(ws); ws.send(JSON.stringify({type:'hello',clientId:'observer',stateVector:{},presence:{clientId:'observer',actorType:'agent',actorId:'observer',label:'Observer',updatedAt:''}})); await message(ws,m=>m.type==='hello_ack')
    const client=await createMcpClient(started.url,'agent-direct','mcp-agent')
    const seen=message(ws,m=>m.type==='update'&&m.update.transaction.actor.actorId==='mcp-agent')
    const call=await client.rpc('tools/call',{name:'canvas.create_objects',arguments:createArgs('synced-box')})
    const pushed=await seen
    assert.equal(call.result.structuredContent.ok,true); assert.equal(pushed.update.result.revision,1); assert.equal(app.room.updateCount(),1); assert.equal(app.store.getObject('synced-box').metadata.role,'test')
  }finally{try{ws.close()}catch{};await app.close()}
})

test('resource subscriptions emit resources/updated notifications on the MCP SSE stream',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start(); const controller=new AbortController()
  try{
    const client=await createMcpClient(started.url,'agent-direct','subscriber')
    const uri=`canvas://workspace/${encodeURIComponent(app.workspace.id)}/canvas/${encodeURIComponent(app.rootCanvas.id)}`
    const sub=await client.rpc('resources/subscribe',{uri}); assert.deepEqual(sub.result,{})
    const streamResponse=await fetch(started.url+'/mcp',{headers:{accept:'text/event-stream','Mcp-Session-Id':client.sessionId},signal:controller.signal})
    assert.equal(streamResponse.status,200)
    const reader=streamResponse.body.getReader(); const decoder=new TextDecoder(); let buffer=''
    const waitNotification=(async()=>{const deadline=Date.now()+3000;while(Date.now()<deadline){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.includes('notifications/resources/updated')&&buffer.includes(uri))return buffer}throw new Error('SSE notification timeout')})()
    const call=await client.rpc('tools/call',{name:'canvas.create_objects',arguments:createArgs('notified-box')}); assert.equal(call.result.isError,false)
    const text=await waitNotification; assert.match(text,/notifications\/resources\/updated/)
  }finally{controller.abort();await app.close()}
})

test('owner can snapshot, mutate, and restore the canvas state',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'owner','owner-1')
    await client.rpc('tools/call',{name:'canvas.create_objects',arguments:createArgs('restore-box')})
    const snap=await client.rpc('tools/call',{name:'canvas.create_snapshot',arguments:{canvasId:app.rootCanvas.id}}); const snapshotId=snap.result.structuredContent.data.snapshotId
    const object=app.store.getObject('restore-box')
    await client.rpc('tools/call',{name:'canvas.patch_objects',arguments:{canvasId:app.rootCanvas.id,expectedCanvasRevision:app.store.getCanvas(app.rootCanvas.id).revision,patches:[{objectId:object.id,expectedRevision:object.revision,patch:{transform:{x:900}}}]}})
    assert.equal(app.store.getObject('restore-box').transform.x,900)
    const restored=await client.rpc('tools/call',{name:'canvas.restore_snapshot',arguments:{snapshotId}}); assert.equal(restored.result.structuredContent.ok,true); assert.equal(app.store.getObject('restore-box').transform.x,40)
  }finally{await app.close()}
})
