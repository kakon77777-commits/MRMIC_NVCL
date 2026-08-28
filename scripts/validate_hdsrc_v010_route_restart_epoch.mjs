#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import { HdsrcRuntimeManager } from '../dist/packages/provider-hdsrc/src/runtime-manager.js'
import { routeHdsrcObservation } from '../dist/packages/provider-hdsrc/src/observation-router.js'

const PRINCIPAL = 'principal:route-restart-validator'
const ACCESS = Object.freeze({
  principalId: PRINCIPAL,
  allowHdsrcRead: true,
  trustedMachine: true,
})

function parseArgs(argv) {
  const result = {
    hdsrcRoot: undefined,
    hostScript: resolve('scripts/hdsrc_process_host.py'),
    python: process.platform === 'win32' ? 'python' : 'python3',
    output: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--hdsrc-root') result.hdsrcRoot = value, index += 1
    else if (flag === '--host-script') result.hostScript = value, index += 1
    else if (flag === '--python') result.python = value, index += 1
    else if (flag === '--output') result.output = value, index += 1
    else throw new Error(`unknown or incomplete argument: ${flag}`)
  }
  if (!result.hdsrcRoot) throw new Error('--hdsrc-root is required')
  return result
}

async function writePidCaptureExecutable(path, pidFile, python) {
  const script = `#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\nPath(${JSON.stringify(pidFile)}).write_text(json.dumps({"pid": os.getpid(), "stub": os.environ.get("HDSRC_TEST_STUB_RUNTIME"), "pythonPath": os.environ.get("PYTHONPATH")}, sort_keys=True, separators=(",", ":")), encoding="utf-8")\nos.execv(${JSON.stringify(python)}, [${JSON.stringify(python)}, *sys.argv[1:]])\n`
  await writeFile(path, script, 'utf8')
  await chmod(path, 0o755)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function intent() {
  return {
    schema: 'hdsrc-observation-intent/v1',
    stateRef: 'hdsrc://state/state:4096',
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: 8,
    expectedReuse: 16,
    latencyClass: 'interactive',
  }
}

async function validate(args) {
  if (process.platform === 'win32') {
    throw new Error('this deterministic routed-restart validator currently requires POSIX process signals')
  }

  const hdsrcRoot = resolve(args.hdsrcRoot)
  const hostScript = resolve(args.hostScript)
  const source4096 = resolve(hdsrcRoot, 'artifacts/codes/dim_4096.hds1')
  await readFile(source4096)

  const temp = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-v03-route-restart-'))
  try {
    const registry = resolve(temp, 'registry.json')
    const materializationRoot = resolve(temp, 'materializations')
    const binding = resolve(temp, 'runtime-binding.json')
    const pidFile = resolve(temp, 'runtime-child.json')
    const executable = resolve(temp, 'python-with-pid')
    await mkdir(materializationRoot, { recursive: true })
    await writePidCaptureExecutable(executable, pidFile, resolve(args.python))

    await writeFile(registry, JSON.stringify({
      schema: 'hdsrc-local-registry/v1',
      states: [{
        stateId: 'state:4096',
        stateRevision: 10,
        hds1Path: source4096,
        readPrincipals: [PRINCIPAL],
      }],
    }, null, 2), 'utf8')

    await writeFile(binding, JSON.stringify({
      schema: 'hdsrc-runtime-binding/v1',
      runtimeId: 'hdsrc:local:v0.10-route-restart',
      protocol: 'hdsrc-process/0.1',
      executable,
      hostScript,
      registry,
      profileRoot: hdsrcRoot,
      materializationRoot,
      timeoutMs: 120000,
      maxResourceBytes: 67108864,
    }, null, 2), 'utf8')

    const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding } })
    let firstChild
    let killedAfterMaterialization = false
    try {
      const routingManager = {
        status: () => manager.status(),
        async materializeResolved(request, access) {
          const resolved = await manager.materializeResolved(request, access)
          const status = manager.status()
          if (status.state !== 'ready' || status.runtimeEpoch !== 1) {
            throw new Error(`expected materialization on runtime epoch 1, got ${JSON.stringify(status)}`)
          }
          firstChild = await readJson(pidFile)
          if (firstChild.stub !== null || firstChild.pythonPath !== null) {
            throw new Error(`production child environment was not sanitized: ${JSON.stringify(firstChild)}`)
          }
          process.kill(Number(firstChild.pid), 'SIGKILL')
          killedAfterMaterialization = true
          await new Promise(resolveWait => setTimeout(resolveWait, 50))
          return resolved
        },
        readResource: (uri, access) => manager.readResource(uri, access),
        readPartialRelationBlockRow: (ref, blockRow, access) => manager.readPartialRelationBlockRow(ref, blockRow, access),
      }

      const routed = await routeHdsrcObservation(intent(), ACCESS, routingManager)
      const finalStatus = manager.status()
      const secondChild = await readJson(pidFile)

      if (!killedAfterMaterialization) throw new Error('fault injection did not execute')
      if (routed.mode !== 'machine_carrier') throw new Error(`unexpected routed mode ${routed.mode}`)
      if (routed.decision.decision !== 'oracle_fallback' || routed.oracleUsed !== true) {
        throw new Error(`real 4096D route did not preserve oracle evidence: ${JSON.stringify(routed.decision)}`)
      }
      if (routed.runtimeEpoch !== 2) {
        throw new Error(`routed observation reported stale runtime epoch ${routed.runtimeEpoch}`)
      }
      if (finalStatus.state !== 'ready' || finalStatus.runtimeEpoch !== 2) {
        throw new Error(`manager did not finish ready on epoch 2: ${JSON.stringify(finalStatus)}`)
      }
      if (Number(secondChild.pid) === Number(firstChild.pid)) {
        throw new Error('safe resource read did not restart into a new production child')
      }
      if (secondChild.stub !== null || secondChild.pythonPath !== null) {
        throw new Error(`restarted production child environment was not sanitized: ${JSON.stringify(secondChild)}`)
      }

      return {
        schema: 'hdsrc-routed-restart-epoch-validation/v0.3',
        decision: routed.decision.decision,
        oracleUsed: routed.oracleUsed,
        materializationEpoch: 1,
        finalRuntimeEpoch: routed.runtimeEpoch,
        managerRuntimeEpoch: finalStatus.runtimeEpoch,
        childRestarted: Number(secondChild.pid) !== Number(firstChild.pid),
        machineBytes: routed.resource.bytes.length,
        canonicalMutation: false,
        testStubRuntimeUsed: false,
      }
    } finally {
      manager.stop()
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await validate(args)
  const payload = `${JSON.stringify(result, null, 2)}\n`
  if (args.output) await writeFile(resolve(args.output), payload, 'utf8')
  process.stdout.write(payload)
}

main().catch(error => {
  console.error(error?.stack ?? error)
  process.exitCode = 1
})
