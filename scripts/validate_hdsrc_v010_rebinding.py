#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from validate_hdsrc_v010_bridge import ProcessClient, _build_compiled_state, expect_provider_error, materialization_request


def identity_hex(manifest: dict) -> str:
    payload = '|'.join((
        manifest['stateDigest'],
        str(int(manifest['stateRevision'])),
        manifest['workloadDigest'],
        str(int(manifest['logicalScale'])),
        manifest['spatializationId'],
        manifest['materializationDigest'],
    )).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def run(args: argparse.Namespace) -> dict:
    hdsrc_root = Path(args.hdsrc_root).resolve()
    host_script = Path(args.host_script).resolve()
    with tempfile.TemporaryDirectory(prefix='hdsrc-v010-rebinding-') as temp_raw:
        temp = Path(temp_raw)
        state_path = temp / 'state.hds1'
        _build_compiled_state(hdsrc_root, state_path, nodes=64, dimension=64, k=4, seed=31001)
        registry = temp / 'registry.json'
        materialization_root = temp / 'materializations'
        registry.write_text(json.dumps({
            'schema': 'hdsrc-local-registry/v1',
            'states': [{
                'stateId': 'state:rebind',
                'stateRevision': 1,
                'hds1Path': str(state_path),
                'readPrincipals': ['principal:validator'],
            }],
        }, indent=2), encoding='utf-8')
        principal = 'principal:validator'
        client = ProcessClient(args.python, host_script, registry, hdsrc_root, materialization_root, hdsrc_root / 'src')
        try:
            request = materialization_request('state:rebind', span=4, reuse=16)
            resolved = client.request('materialize', {'request': request, 'principalId': principal})
            manifest = dict(resolved['materialization'])
            original_identity = manifest['materializationId'].removeprefix('mat:')
            original_folder = materialization_root / original_identity
            original_machine = (original_folder / 'machine.hmbt1.tif').read_bytes()
            original_preview = (original_folder / 'preview.svg').read_bytes()

            tampered = bytearray(original_machine)
            if len(tampered) < 64:
                raise AssertionError('real HMBT1 carrier unexpectedly too small for rebinding control')
            tamper_index = len(tampered) // 2
            tampered[tamper_index] ^= 0x01
            manifest['materializationDigest'] = 'sha256:' + hashlib.sha256(tampered).hexdigest()
            rebound_identity = identity_hex(manifest)
            rebound_id = f'mat:{rebound_identity}'
            rebound_ref = f'hdsrc://state/state:rebind/materializations/{rebound_id}'
            manifest['materializationId'] = rebound_id
            manifest['machineResourceUri'] = f'{rebound_ref}/machine'
            manifest['previewResourceUri'] = f'{rebound_ref}/preview'

            rebound_folder = materialization_root / rebound_identity
            rebound_folder.mkdir(parents=True, exist_ok=False)
            (rebound_folder / 'machine.hmbt1.tif').write_bytes(bytes(tampered))
            (rebound_folder / 'preview.svg').write_bytes(original_preview)
            (rebound_folder / 'manifest.json').write_text(
                json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=False),
                encoding='utf-8',
            )

            accepted_manifest = client.request('materialization', {'ref': rebound_ref, 'principalId': principal})
            if accepted_manifest != manifest:
                raise AssertionError('self-consistent rebound manifest did not survive metadata validation')
            structural_error = expect_provider_error(
                lambda: client.request('read_resource', {'uri': manifest['machineResourceUri'], 'principalId': principal}),
                'INTEGRITY_FAILURE',
            )
        finally:
            client.close()

        return {
            'schema': 'hdsrc-local-process-rebinding-validation/v0.2',
            'originalCarrierSha256': hashlib.sha256(original_machine).hexdigest(),
            'reboundCarrierSha256': hashlib.sha256(tampered).hexdigest(),
            'metadataRebindingAccepted': True,
            'structuralCarrierRead': structural_error,
            'structuralFailClosed': True,
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
