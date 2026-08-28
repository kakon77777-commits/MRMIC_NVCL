#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { discoverHdsrcRuntime } from '../dist/packages/provider-hdsrc/src/runtime-discovery.js'
import { HdsrcRuntimeManager } from '../dist/packages/provider-hdsrc/src/runtime-manager.js'
import { routeHdsrcObservation } from '../dist/packages/provider-hdsrc/src/observation-router.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const DEFAULT_HOST = resolve(REPO_ROOT, 'scripts/hdsrc_process_host.py')
const REBINDING_VALIDATOR = resolve(REPO_ROOT, 'scripts/validate_hdsrc_v010_rebinding.py')
const PRINCIPAL = 'principal:runtime-manager-validator'
const ACCESS = Object.freeze({
  principalId: PRINCIPAL,
  allowHdsrcRead: true,
  trustedStructured: true,
  trustedMachine: true,
})

function parseArgs(argv) {
  const result = {
    hdsrcRoot: undefined,
    python: process.platform === 'win32' ? 'python' : 'python3',
    releaseZip: undefined,
    hostScript: DEFAULT_HOST,
    output: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--hdsrc-root') result.hdsrcRoot = value, index += 1
    else if (flag === '--python') result.python = value, index += 1
    else if (flag === '--release-zip') result.releaseZip = value, index += 1
    else if (flag === '--host-script') result.hostScript = value, index += 1
    else if (flag === '--output') result.output = value, index += 1
    else throw new Error(`unknown or incomplete argument: ${flag}`)
  }
  if (!result.hdsrcRoot) throw new Error('--hdsrc-root is required')
  if (!result.releaseZip) throw new Error('--release-zip is required')
  return result
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function sha256File(path) {
  return sha256(await readFile(path))
}

function runPython(python, args, options = {}) {
  const result = spawnSync(python, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`Python command failed (${result.status}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function generateState(python, hdsrcRoot, output, { nodes, dimension, k, seed }) {
  const code = String.raw`
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
nodes, dimension, k, seed = map(int, sys.argv[3:7])
sys.path.insert(0, str(root / 'src'))
from hdsrc_exp.codec import encode_hds1
from hdsrc_exp.compiler import compile_symbolic_state
from hdsrc_exp.dataset import make_structured_corpus
corpus = make_structured_corpus(nodes, dimension, min(8, dimension), min(8, nodes), seed)
state = compile_symbolic_state(corpus, k, 10000, 'hdsrc-rel/0.1')
out.write_bytes(encode_hds1(state))
print(f'{state.dimension},{len(state.vector_ids)},{len(state.relations)},{state.k_neighbors}')
`
  const stdout = runPython(python, [
    '-c', code, hdsrcRoot, output,
    String(nodes), String(dimension), String(k), String(seed),
  ], {
    env: {
      ...process.env,
      PYTHONPATH: resolve(hdsrcRoot, 'src'),
      HDSRC_TEST_STUB_RUNTIME: undefined,
    },
  }).trim()
  const [actualDimension, actualNodes, relations, actualK] = stdout.split(',').map(Number)
  return {
    dimension: actualDimension,
    nodeCount: actualNodes,
    relations,
    k: actualK,
  }
}

async function writePidCaptureExecutable(path, pidFile, python) {
  const script = `#!/usr/bin/env python3\nimport json, os, sys\nfrom pathlib import Path\nPath(${JSON.stringify(pidFile)}).write_text(json.dumps({"pid": os.getpid(), "stub": os.environ.get("HDSRC_TEST_STUB_RUNTIME"), "pythonPath": os.environ.get("PYTHONPATH")}, sort_keys=True, separators=(",", ":")), encoding="utf-8")\nos.execv(${JSON.stringify(python)}, [${JSON.stringify(python)}, *sys.argv[1:]])\n`
  await writeFile(path, script, 'utf8')
  await chmod(path, 0o755)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function expectProviderError(fn, code) {
  try {
    await fn()
  } catch (error) {
    if (error?.code !== code) {
      throw new Error(`expected ${code}, got ${error?.code ?? error}: ${error?.message ?? ''}`)
    }
    return { code: error.code, retryable: error.retryable === true }
  }
  throw new Error(`expected provider error ${code}`)
}

function structuredIntent(stateId, { span, reuse }) {
  return {
    schema: 'hdsrc-observation-intent/v1',
    stateRef: `hdsrc://state/${stateId}`,
    goalClass: 'relation_inspection',
    observationMode: 'structured_manifest',
    queryDirection: 'block',
    expectedSpan: span,
    expectedReuse: reuse,
    latencyClass: 'interactive',
  }
}

function machineIntent(stateId, { span, reuse, partialRelationBlockRow }) {
  return {
    schema: 'hdsrc-observation-intent/v1',
    stateRef: `hdsrc://state/${stateId}`,
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: span,
    expectedReuse: reuse,
    latencyClass: 'interactive',
    ...(partialRelationBlockRow !== undefined ? { partialRelationBlockRow } : {}),
  }
}

function materializationRef(manifest) {
  const suffix = '/machine'
  if (!manifest.machineResourceUri.endsWith(suffix)) throw new Error('machineResourceUri has no /machine suffix')
  return manifest.machineResourceUri.slice(0, -suffix.length)
}

function assertDecision(result, mode) {
  if (result.decision.decision !== mode) {
    throw new Error(`expected ${mode}, got ${result.decision.decision}`)
  }
  if ((mode === 'oracle_fallback') !== result.oracleUsed) {
    throw new Error(`oracleUsed mismatch for ${mode}`)
  }
}

function runRebindingValidator({ python, hdsrcRoot, hostScript }) {
  const stdout = runPython(python, [
    REBINDING_VALIDATOR,
    '--hdsrc-root', hdsrcRoot,
    '--host-script', hostScript,
    '--python', python,
  ], {
    env: {
      ...process.env,
      HDSRC_TEST_STUB_RUNTIME: undefined,
    },
  })
  const result = JSON.parse(stdout)
  if (result.structuralFailClosed !== true
    || result.metadataRebindingAccepted !== true
    || result.structuralCarrierRead?.code !== 'INTEGRITY_FAILURE'
    || result.testStubRuntimeUsed !== false) {
    throw new Error(`v0.2 rebinding validation regressed: ${stdout}`)
  }
  return result
}

async function validate(args) {
  if (process.platform === 'win32') {
    throw new Error('this deterministic real-runtime fault-injection validator currently requires POSIX process signals')
  }

  const hdsrcRoot = resolve(args.hdsrcRoot)
  const releaseZip = resolve(args.releaseZip)
  const hostScript = resolve(args.hostScript)
  const source4096 = resolve(hdsrcRoot, 'artifacts/codes/dim_4096.hds1')
  const modelProfile = resolve(hdsrcRoot, 'artifacts_image_v010/predictive_cost_model_v0.10.json')
  await readFile(source4096)
  await readFile(modelProfile)

  const temp = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-v03-real-'))
  try {
    const fastPath = resolve(temp, 'fast.hds1')
    const highPath = resolve(temp, 'state4096.hds1')
    const changedHighPath = resolve(temp, 'changed4096.hds1')
    const registryPath = resolve(temp, 'registry.json')
    const materializationRoot = resolve(temp, 'materializations')
    const bindingPath = resolve(temp, 'runtime-binding.json')
    const pidFile = resolve(temp, 'runtime-child.json')
    const executableWrapper = resolve(temp, 'python-with-pid')

    const fastStats = generateState(args.python, hdsrcRoot, fastPath, {
      nodes: 64, dimension: 64, k: 4, seed: 31001,
    })
    const changed4096Stats = generateState(args.python, hdsrcRoot, changedHighPath, {
      nodes: 72, dimension: 4096, k: 8, seed: 92801,
    })
    await copyFile(source4096, highPath)
    await mkdir(materializationRoot, { recursive: true })
    await writePidCaptureExecutable(executableWrapper, pidFile, resolve(args.python))

    await writeFile(registryPath, JSON.stringify({
      schema: 'hdsrc-local-registry/v1',
      states: [
        {
          stateId: 'state:fast',
          stateRevision: 1,
          hds1Path: fastPath,
          readPrincipals: [PRINCIPAL],
        },
        {
          stateId: 'state:4096',
          stateRevision: 10,
          hds1Path: highPath,
          readPrincipals: [PRINCIPAL],
        },
      ],
    }, null, 2), 'utf8')

    await writeFile(bindingPath, JSON.stringify({
      schema: 'hdsrc-runtime-binding/v1',
      runtimeId: 'hdsrc:local:v0.10-validation',
      protocol: 'hdsrc-process/0.1',
      executable: executableWrapper,
      hostScript,
      registry: registryPath,
      profileRoot: hdsrcRoot,
      materializationRoot,
      timeoutMs: 120000,
      maxResourceBytes: 67108864,
    }, null, 2), 'utf8')

    const explicit = await discoverHdsrcRuntime({ explicitBindingPath: bindingPath, env: {}, platform: process.platform })
    if (explicit.source !== 'explicit') throw new Error('explicit runtime binding was not selected')
    const environment = await discoverHdsrcRuntime({
      env: { HDSRC_RUNTIME_BINDING: bindingPath },
      platform: process.platform,
    })
    if (environment.source !== 'environment' || environment.bindingPath !== explicit.bindingPath) {
      throw new Error('environment runtime binding probe did not select the same configured runtime')
    }

    const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: bindingPath } })
    try {
      const discovered = await manager.discover()
      if (manager.status().state !== 'discovered' || manager.status().runtimeEpoch !== 0) {
        throw new Error('discovery unexpectedly started the HDSRC process')
      }
      if (discovered.runtimeId !== 'hdsrc:local:v0.10-validation') throw new Error('runtimeId mismatch')

      const capabilities = await manager.capabilities()
      if (capabilities.canonicalMutation !== false) throw new Error('HDSRC runtime advertised canonical mutation')
      const firstStatus = manager.status()
      if (firstStatus.state !== 'ready' || firstStatus.runtimeEpoch !== 1) {
        throw new Error(`first runtime start did not establish epoch 1: ${JSON.stringify(firstStatus)}`)
      }
      const firstChild = await readJson(pidFile)
      if (firstChild.stub !== null || firstChild.pythonPath !== null) {
        throw new Error(`production child environment was not sanitized: ${JSON.stringify(firstChild)}`)
      }

      const fast = await routeHdsrcObservation(structuredIntent('state:fast', { span: 4, reuse: 16 }), ACCESS, manager)
      assertDecision(fast, 'fast_path')
      if (fast.mode !== 'structured_manifest'
        || fast.materialization.logicalScale !== 8
        || fast.materialization.spatializationId !== 'RCM_PP') {
        throw new Error(`unexpected real HPCM2 fast materialization: ${JSON.stringify(fast)}`)
      }

      const highManifest = await routeHdsrcObservation(structuredIntent('state:4096', { span: 8, reuse: 16 }), ACCESS, manager)
      assertDecision(highManifest, 'oracle_fallback')
      if (highManifest.mode !== 'structured_manifest'
        || highManifest.materialization.logicalScale !== 32
        || highManifest.materialization.spatializationId !== 'RCM_PP') {
        throw new Error(`unexpected real HMR1 4096D materialization: ${JSON.stringify(highManifest)}`)
      }

      const highMachine = await routeHdsrcObservation(machineIntent('state:4096', { span: 8, reuse: 16 }), ACCESS, manager)
      assertDecision(highMachine, 'oracle_fallback')
      if (highMachine.mode !== 'machine_carrier') throw new Error('4096D full machine route returned wrong mode')

      const highPartial = await routeHdsrcObservation(machineIntent('state:4096', {
        span: 8, reuse: 16, partialRelationBlockRow: 0,
      }), ACCESS, manager)
      assertDecision(highPartial, 'oracle_fallback')
      if (highPartial.mode !== 'partial_relation_block_row') throw new Error('4096D partial route returned wrong mode')
      if (!(highPartial.partial.compressedBytesRead > 0
        && highPartial.partial.compressedBytesRead < highPartial.partial.carrierBytes
        && highPartial.partial.carrierBytes === highMachine.resource.bytes.length)) {
        throw new Error(`partial HMBT1 I/O did not remain partial: ${JSON.stringify(highPartial.partial)}`)
      }

      const stateBeforeRestart = await manager.state('hdsrc://state/state:4096', ACCESS)
      process.kill(Number(firstChild.pid), 'SIGKILL')
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
      const stateAfterRestart = await manager.state('hdsrc://state/state:4096', ACCESS)
      const afterRestartStatus = manager.status()
      const secondChild = await readJson(pidFile)
      if (afterRestartStatus.state !== 'ready' || afterRestartStatus.runtimeEpoch !== 2) {
        throw new Error(`transport restart did not produce runtime epoch 2: ${JSON.stringify(afterRestartStatus)}`)
      }
      if (Number(secondChild.pid) === Number(firstChild.pid)) throw new Error('runtime restart reused the same process id')
      if (secondChild.stub !== null || secondChild.pythonPath !== null) {
        throw new Error('restarted production child environment was not sanitized')
      }
      for (const field of ['stateId', 'stateRevision', 'stateDigest', 'dimension']) {
        if (stateAfterRestart[field] !== stateBeforeRestart[field]) {
          throw new Error(`runtime restart changed HDSRC state ${field}`)
        }
      }

      const highRef = materializationRef(highManifest.materialization)
      const originalHighBytes = await readFile(highPath)
      await copyFile(changedHighPath, highPath)
      const staleState = await expectProviderError(
        () => manager.materialization(highRef, ACCESS),
        'STALE_STATE',
      )
      if (manager.status().state !== 'ready' || manager.status().runtimeEpoch !== 2) {
        throw new Error('remote STALE_STATE incorrectly degraded/restarted the manager')
      }

      await writeFile(highPath, Buffer.concat([originalHighBytes, Buffer.from('-malformed')]))
      const malformedState = await expectProviderError(
        () => manager.state('hdsrc://state/state:4096', ACCESS),
        'INTEGRITY_FAILURE',
      )
      if (manager.status().state !== 'ready' || manager.status().runtimeEpoch !== 2) {
        throw new Error('remote INTEGRITY_FAILURE incorrectly degraded/restarted the manager')
      }
      await writeFile(highPath, originalHighBytes)

      const rebinding = runRebindingValidator({
        python: args.python,
        hdsrcRoot,
        hostScript,
      })

      return {
        schema: 'hdsrc-runtime-manager-real-validation/v0.3',
        lineage: {
          releaseZipSha256: await sha256File(releaseZip),
          canonical4096Hds1Sha256: await sha256File(source4096),
        },
        discovery: {
          explicitSource: explicit.source,
          environmentSource: environment.source,
          sameBinding: environment.bindingPath === explicit.bindingPath,
          discoveryStartedProcess: false,
        },
        runtime: {
          firstEpoch: firstStatus.runtimeEpoch,
          restartEpoch: afterRestartStatus.runtimeEpoch,
          boundedRestartObserved: true,
          hds1IdentityPreservedAcrossRestart: true,
          productionChildEnvironmentSanitized: true,
          canonicalMutation: capabilities.canonicalMutation,
        },
        fastState: {
          ...fastStats,
          decision: fast.decision.decision,
          oracleUsed: fast.oracleUsed,
          logicalScale: fast.materialization.logicalScale,
          spatializationId: fast.materialization.spatializationId,
        },
        state4096: {
          dimension: stateBeforeRestart.dimension,
          stateRevision: stateBeforeRestart.stateRevision,
          decision: highManifest.decision.decision,
          decisionReason: highManifest.decision.confidence.reason ?? null,
          oracleUsed: highManifest.oracleUsed,
          logicalScale: highManifest.materialization.logicalScale,
          spatializationId: highManifest.materialization.spatializationId,
          carrierBytes: highMachine.resource.bytes.length,
          partialCompressedBytesRead: highPartial.partial.compressedBytesRead,
          partialCarrierBytes: highPartial.partial.carrierBytes,
          partialRatio: highPartial.partial.compressedBytesRead / highPartial.partial.carrierBytes,
        },
        changed4096State: changed4096Stats,
        staleState,
        malformedHds1: malformedState,
        rebinding: {
          metadataRebindingAccepted: rebinding.metadataRebindingAccepted,
          structuralFailClosed: rebinding.structuralFailClosed,
          structuralCarrierRead: rebinding.structuralCarrierRead,
          testStubRuntimeUsed: rebinding.testStubRuntimeUsed,
        },
        testStubRuntimeUsed: false,
      }
    } finally {
      manager.stop()
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

const args = parseArgs(process.argv.slice(2))
const result = await validate(args)
const payload = `${JSON.stringify(result, null, 2)}\n`
if (args.output) await writeFile(resolve(args.output), payload, 'utf8')
process.stdout.write(payload)
