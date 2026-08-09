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
    const tools=await client.rpc('tools/list'); assert.equal(tools.result.tools.length,15); assert.ok(tools.result.tools.some(t=>t.name==='canvas.patch_objects'))
    const resources=await client.rpc('resources/list'); assert.equal(resources.result.resources.length,5)
    const uri=`canvas://workspace/${encodeURIComponent(app.workspace.id)}`
    const read=await client.rpc('resources/read',{uri}); assert.equal(read.result.contents[0].mimeType,'application/json'); assert.match(read.result.contents[0].text,/MRMIC NVCL Phase 6/)
  }finally{await app.close()}
})

test('viewer sessions can read but cannot mutate canvas state',async()=>{
  const app=createPhase3Server({port:0,databasePath:':memory:',syncDatabasePath:':memory:'}); const started=await app.start()
  try{
    const client=await createMcpClient(started.url,'viewer','viewer-1')
    const call=await client.rpc('tools/call',{name:'canvas.create_objects',arguments:createArgs('viewer-box')})
    assert.equal(call.result.isError,true); assert.equal(call.result.structuredContent.error.code,'PERMISSION_DENIED'); assert.equal(app.store.listObjects(app.rootCanvas.id).length,0)
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
