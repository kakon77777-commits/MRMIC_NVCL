import test from 'node:test'
import assert from 'node:assert/strict'
import { HerdrCanvasRuntimePublisher } from '../dist/packages/provider-herdr/src/runtime-publisher.js'

function info(overrides={}){return{
  terminal_id:'terminal-claude',name:'Claude',agent:'claude',display_agent:'Claude',agent_status:'working',
  workspace_id:'herdr-ws',tab_id:'tab-claude',pane_id:'pane-claude',focused:false,
  launch_pending:false,interactive_ready:true,state_change_seq:5,revision:7,...overrides,
}}

function sink(){const sent=[],removed=[];return{
  sent,removed,
  target:{
    sendRuntimePresence:value=>sent.push(structuredClone(value)),
    removeRuntimePresence:(provider,providerResourceId)=>removed.push({provider,providerResourceId}),
  },
}}

test('Herdr runtime publisher forwards mapped AgentInfo through secure Canvas sink',()=>{
  const s=sink();const publisher=new HerdrCanvasRuntimePublisher(s.target,'epoch-1')
  assert.equal(publisher.publish(info()),true)
  assert.deepEqual(s.sent[0],{
    provider:'herdr',providerResourceId:'terminal-claude',runtimeEpochId:'epoch-1',status:'working',
    revision:7,sequence:5,kind:'claude',focused:false,interactiveReady:true,launchPending:false,
    coordinates:{workspaceId:'herdr-ws',tabId:'tab-claude',paneId:'pane-claude'},
  })
  assert.deepEqual(publisher.knownTerminalIds(),['terminal-claude'])
})

test('publisher suppresses exact duplicate runtime facts but forwards a new Herdr state',()=>{
  const s=sink();const publisher=new HerdrCanvasRuntimePublisher(s.target,'epoch-1')
  assert.equal(publisher.publish(info()),true)
  assert.equal(publisher.publish(info()),false)
  assert.equal(publisher.publish(info({agent_status:'blocked',revision:8,state_change_seq:6})),true)
  assert.equal(s.sent.length,2)
  assert.equal(s.sent[1].status,'blocked')
})

test('new runtime epoch clears dedupe so reset Herdr counters are republished',()=>{
  const s=sink();const publisher=new HerdrCanvasRuntimePublisher(s.target,'epoch-old')
  publisher.publish(info({revision:100,state_change_seq:100,agent_status:'done'}))
  publisher.setRuntimeEpoch('epoch-new')
  assert.equal(publisher.publish(info({revision:1,state_change_seq:1,agent_status:'idle'})),true)
  assert.equal(s.sent[1].runtimeEpochId,'epoch-new')
  assert.equal(s.sent[1].revision,1)
})

test('remove forwards provider identity and clears local dedupe entry',()=>{
  const s=sink();const publisher=new HerdrCanvasRuntimePublisher(s.target,'epoch-1')
  publisher.publish(info())
  assert.equal(publisher.remove('terminal-claude'),true)
  assert.deepEqual(s.removed,[{provider:'herdr',providerResourceId:'terminal-claude'}])
  assert.deepEqual(publisher.knownTerminalIds(),[])
})

test('publisher does not own semantic identity',()=>{
  const s=sink();const publisher=new HerdrCanvasRuntimePublisher(s.target,'epoch-1')
  publisher.publish({...info(),semanticAgentId:'user:neo',principalId:'forged'})
  assert.equal('semanticAgentId' in s.sent[0],false)
  assert.equal('principalId' in s.sent[0],false)
})
