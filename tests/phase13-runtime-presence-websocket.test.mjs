import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('Phase 13.6 authenticated runtime ingress passes real isolated WebSocket E2E',()=>{
  const fixture=resolve(process.cwd(),'tests','fixtures','phase13-runtime-presence-e2e-child.mjs')
  const result=spawnSync(process.execPath,[fixture],{
    cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{...process.env},
  })
  assert.equal(result.error?.code,'ETIMEDOUT',false,`child E2E timed out\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  assert.equal(result.status,0,`child E2E failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  assert.match(result.stdout,/real WebSocket E2E PASS/)
})
