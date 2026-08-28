#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

PROTOCOL = 'hdsrc-process/0.1'


class ProcessClient:
    def __init__(self, python: str, host_script: Path, registry: Path, profile_root: Path, materialization_root: Path, hdsrc_src: Path) -> None:
        env = dict(os.environ)
        env.pop('HDSRC_TEST_STUB_RUNTIME', None)
        current = env.get('PYTHONPATH')
        env['PYTHONPATH'] = str(hdsrc_src) if not current else os.pathsep.join((str(hdsrc_src), current))
        self.proc = subprocess.Popen(
            [
                python,
                str(host_script),
                '--registry', str(registry),
                '--profile-root', str(profile_root),
                '--materialization-root', str(materialization_root),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            bufsize=1,
            env=env,
        )
        self.next_id = 1
        self.request('initialize', {'client': 'hdsrc-v010-validator', 'version': '0.2'})

    def request(self, method: str, params: dict[str, Any]) -> Any:
        if self.proc.poll() is not None:
            stderr = self.proc.stderr.read() if self.proc.stderr else ''
            raise RuntimeError(f'HDSRC host exited before {method}: {stderr}')
        request_id = self.next_id
        self.next_id += 1
        assert self.proc.stdin is not None and self.proc.stdout is not None
        payload = {'protocol': PROTOCOL, 'id': request_id, 'method': method, 'params': params}
        self.proc.stdin.write(json.dumps(payload, separators=(',', ':'), sort_keys=True) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            stderr = self.proc.stderr.read() if self.proc.stderr else ''
            raise RuntimeError(f'HDSRC host returned EOF during {method}: {stderr}')
        response = json.loads(line)
        if response.get('protocol') != PROTOCOL or response.get('id') != request_id:
            raise RuntimeError(f'HDSRC protocol correlation failure during {method}: {response}')
        if 'error' in response:
            error = response['error']
            exc = RuntimeError(f"{error.get('code')}: {error.get('message')}")
            setattr(exc, 'provider_code', error.get('code'))
            setattr(exc, 'retryable', bool(error.get('retryable', False)))
            raise exc
        return response.get('result')

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.request('shutdown', {})
            except Exception:
                pass
        if self.proc.stdin:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=3)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def build_fast_state(hdsrc_root: Path, output: Path) -> dict[str, Any]:
    sys.path.insert(0, str(hdsrc_root / 'src'))
    try:
        from hdsrc_exp.codec import encode_hds1
        from hdsrc_exp.compiler import compile_symbolic_state
        from hdsrc_exp.dataset import make_structured_corpus

        corpus = make_structured_corpus(64, 64, 8, 8, 31001)
        state = compile_symbolic_state(corpus, 4, 10000, 'hdsrc-rel/0.1')
        payload = encode_hds1(state)
        output.write_bytes(payload)
        return {'dimension': state.dimension, 'nodeCount': len(state.vector_ids), 'relations': len(state.relations), 'k': state.k_neighbors}
    finally:
        if sys.path and sys.path[0] == str(hdsrc_root / 'src'):
            sys.path.pop(0)


def materialization_request(state_id: str, *, span: int, reuse: int) -> dict[str, Any]:
    return {
        'schema': 'hdsrc-materialization-request/v1',
        'stateRef': f'hdsrc://state/{state_id}',
        'workload': {
            'schema': 'hdsrc-workload-hint/v1',
            'goalClass': 'relation_inspection',
            'observationMode': 'machine_carrier',
            'queryDirection': 'block',
            'expectedSpan': span,
            'expectedReuse': reuse,
            'latencyClass': 'interactive',
        },
    }


def expect_provider_error(call, code: str) -> dict[str, Any]:
    try:
        call()
    except RuntimeError as exc:
        actual = getattr(exc, 'provider_code', None)
        if actual != code:
            raise AssertionError(f'expected {code}, got {actual}: {exc}') from exc
        return {'code': actual, 'retryable': bool(getattr(exc, 'retryable', False))}
    raise AssertionError(f'expected provider error {code}')


def run(args: argparse.Namespace) -> dict[str, Any]:
    hdsrc_root = Path(args.hdsrc_root).resolve()
    host_script = Path(args.host_script).resolve()
    source_4096 = hdsrc_root / 'artifacts' / 'codes' / 'dim_4096.hds1'
    if not source_4096.is_file():
        raise FileNotFoundError(source_4096)
    if not (hdsrc_root / 'artifacts_image_v010' / 'predictive_cost_model_v0.10.json').is_file():
        raise FileNotFoundError('HDSRC v0.10 profile artifacts missing')

    with tempfile.TemporaryDirectory(prefix='hdsrc-v010-bridge-validation-') as temp_raw:
        temp = Path(temp_raw)
        fast_path = temp / 'fast.hds1'
        state_4096 = temp / 'state4096.hds1'
        fast_stats = build_fast_state(hdsrc_root, fast_path)
        shutil.copyfile(source_4096, state_4096)
        registry = temp / 'registry.json'
        materialization_root = temp / 'materializations'
        registry.write_text(json.dumps({
            'schema': 'hdsrc-local-registry/v1',
            'states': [
                {'stateId': 'state:fast', 'stateRevision': 1, 'hds1Path': str(fast_path), 'readPrincipals': ['principal:validator']},
                {'stateId': 'state:4096', 'stateRevision': 10, 'hds1Path': str(state_4096), 'readPrincipals': ['principal:validator']},
            ],
        }, indent=2), encoding='utf-8')
        principal = 'principal:validator'
        client = ProcessClient(args.python, host_script, registry, hdsrc_root, materialization_root, hdsrc_root / 'src')
        try:
            capabilities = client.request('capabilities', {})
            if capabilities.get('canonicalMutation') is not False:
                raise AssertionError('production HDSRC host is not read-only')

            fast_state = client.request('state', {'ref': 'hdsrc://state/state:fast', 'principalId': principal})
            high_state = client.request('state', {'ref': 'hdsrc://state/state:4096', 'principalId': principal})
            fast_request = materialization_request('state:fast', span=4, reuse=16)
            high_request = materialization_request('state:4096', span=8, reuse=16)
            fast_plan = client.request('plan_materialization', {'request': fast_request, 'principalId': principal})
            high_plan = client.request('plan_materialization', {'request': high_request, 'principalId': principal})
            if fast_plan.get('decision') != 'fast_path' or fast_plan.get('confidence', {}).get('requiresOracle') is not False:
                raise AssertionError(f'expected real HPCM2 fast path, got {fast_plan}')
            if high_plan.get('decision') != 'oracle_fallback' or high_plan.get('confidence', {}).get('requiresOracle') is not True:
                raise AssertionError(f'expected real HPCM2 oracle fallback, got {high_plan}')

            fast_resolved = client.request('materialize', {'request': fast_request, 'principalId': principal})
            high_resolved = client.request('materialize', {'request': high_request, 'principalId': principal})
            if fast_resolved.get('oracleUsed') is not False:
                raise AssertionError('fast real materialization unexpectedly used oracle')
            if high_resolved.get('oracleUsed') is not True:
                raise AssertionError('4096D real materialization did not use oracle')

            high_manifest = high_resolved['materialization']
            high_machine = client.request('read_resource', {'uri': high_manifest['machineResourceUri'], 'principalId': principal})
            high_bytes = base64.b64decode(high_machine['base64'], validate=True)
            actual_digest = 'sha256:' + hashlib.sha256(high_bytes).hexdigest()
            if actual_digest != high_manifest['materializationDigest']:
                raise AssertionError('4096D carrier digest mismatch')
            partial = client.request('partial_relation_block_row', {
                'ref': high_resolved['materializationRef'],
                'blockRow': 0,
                'principalId': principal,
            })
            if not (0 < int(partial['compressedBytesRead']) < int(partial['carrierBytes'])):
                raise AssertionError(f'partial I/O did not remain partial: {partial}')
            if int(partial['carrierBytes']) != len(high_bytes):
                raise AssertionError('partial reader carrier byte count mismatch')

            high_ref = high_resolved['materializationRef']
            high_machine_uri = high_manifest['machineResourceUri']
        finally:
            client.close()

        restarted = ProcessClient(args.python, host_script, registry, hdsrc_root, materialization_root, hdsrc_root / 'src')
        try:
            persisted = restarted.request('materialization', {'ref': high_ref, 'principalId': principal})
            persisted_machine = restarted.request('read_resource', {'uri': high_machine_uri, 'principalId': principal})
            if persisted != high_manifest or base64.b64decode(persisted_machine['base64'], validate=True) != high_bytes:
                raise AssertionError('materialization persistence changed across restart')
        finally:
            restarted.close()

        stale_copy = state_4096.read_bytes()
        state_4096.write_bytes(stale_copy + b'-changed')
        stale_client = ProcessClient(args.python, host_script, registry, hdsrc_root, materialization_root, hdsrc_root / 'src')
        try:
            stale = expect_provider_error(lambda: stale_client.request('materialization', {'ref': high_ref, 'principalId': principal}), 'STALE_STATE')
        finally:
            stale_client.close()
        state_4096.write_bytes(stale_copy)

        identity = high_manifest['materializationId'].removeprefix('mat:')
        machine_path = materialization_root / identity / 'machine.hmbt1.tif'
        original_machine = machine_path.read_bytes()
        machine_path.write_bytes(original_machine + b'\x00')
        tamper_client = ProcessClient(args.python, host_script, registry, hdsrc_root, materialization_root, hdsrc_root / 'src')
        try:
            tamper = expect_provider_error(lambda: tamper_client.request('read_resource', {'uri': high_machine_uri, 'principalId': principal}), 'INTEGRITY_FAILURE')
        finally:
            tamper_client.close()

        return {
            'schema': 'hdsrc-local-process-bridge-validation/v0.2',
            'hdsrcRoot': str(hdsrc_root),
            'source4096Sha256': hashlib.sha256(source_4096.read_bytes()).hexdigest(),
            'fastState': {**fast_stats, **fast_state, 'decision': fast_plan, 'resolved': {
                'oracleUsed': fast_resolved['oracleUsed'],
                'logicalScale': fast_resolved['materialization']['logicalScale'],
                'spatializationId': fast_resolved['materialization']['spatializationId'],
                'materializationDigest': fast_resolved['materialization']['materializationDigest'],
            }},
            'state4096': {**high_state, 'decision': high_plan, 'resolved': {
                'oracleUsed': high_resolved['oracleUsed'],
                'logicalScale': high_manifest['logicalScale'],
                'spatializationId': high_manifest['spatializationId'],
                'materializationDigest': high_manifest['materializationDigest'],
                'carrierBytes': len(high_bytes),
            }, 'partial': {
                'relations': len(partial['relations']),
                'compressedBytesRead': partial['compressedBytesRead'],
                'carrierBytes': partial['carrierBytes'],
            }},
            'restartPersistence': True,
            'staleState': stale,
            'tamperedCarrier': tamper,
            'canonicalMutation': False,
            'testStubRuntimeUsed': False,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--hdsrc-root', required=True)
    parser.add_argument('--host-script', default='scripts/hdsrc_process_host.py')
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--output')
    args = parser.parse_args()
    result = run(args)
    payload = json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + '\n'
    if args.output:
        Path(args.output).write_text(payload, encoding='utf-8')
    sys.stdout.write(payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
