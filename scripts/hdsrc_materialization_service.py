from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any, Callable
from xml.sax.saxutils import escape

from hdsrc_runtime_adapter import HdsrcRuntimeAdapter


class MaterializationServiceError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = bool(retryable)


class HdsrcMaterializationService:
    def __init__(
        self,
        *,
        profile_root: Path,
        materialization_root: Path,
        load_state: Callable[[Any], tuple[Any, str]],
    ) -> None:
        self.profile_root = Path(profile_root).resolve()
        self.materialization_root = Path(materialization_root).resolve()
        self.materialization_root.mkdir(parents=True, exist_ok=True)
        self._load_state = load_state
        self._runtime: HdsrcRuntimeAdapter | None = None

    @property
    def runtime(self) -> HdsrcRuntimeAdapter:
        if self._runtime is None:
            self._runtime = HdsrcRuntimeAdapter(self.profile_root)
        return self._runtime

    def plan(self, entry: Any, request: dict[str, Any]) -> dict[str, Any]:
        workload = self._request_workload(entry, request)
        state, _state_digest = self._load_state(entry)
        try:
            return self.runtime.plan(state, workload).decision
        except MaterializationServiceError:
            raise
        except Exception as exc:
            raise MaterializationServiceError('MATERIALIZATION_FAILED', f'HDSRC planning failed: {exc}') from exc

    def materialize(self, entry: Any, request: dict[str, Any]) -> dict[str, Any]:
        workload = self._request_workload(entry, request)
        state, state_digest = self._load_state(entry)
        workload_digest = 'sha256:' + hashlib.sha256(_canonical_json(workload)).hexdigest()
        try:
            plan = self.runtime.plan(state, workload)
            resolved = self.runtime.materialize(state, workload, plan)
        except MaterializationServiceError:
            raise
        except Exception as exc:
            raise MaterializationServiceError('MATERIALIZATION_FAILED', f'HDSRC materialization failed: {exc}') from exc

        carrier_digest = 'sha256:' + hashlib.sha256(resolved.carrier_bytes).hexdigest()
        identity_payload = '|'.join((
            state_digest,
            str(int(entry.state_revision)),
            workload_digest,
            str(int(resolved.block_size)),
            str(resolved.algorithm),
        )).encode('utf-8')
        identity_hex = hashlib.sha256(identity_payload).hexdigest()
        materialization_id = f'mat:{identity_hex}'
        resource_root = f'hdsrc://state/{entry.state_id}/materializations/{materialization_id}'
        manifest = {
            'schema': 'hdsrc-materialization/v1',
            'materializationId': materialization_id,
            'stateId': entry.state_id,
            'stateRevision': int(entry.state_revision),
            'stateDigest': state_digest,
            'materializationDigest': carrier_digest,
            'carrierProfile': 'HMBT1',
            'spatializationId': str(resolved.algorithm),
            'logicalScale': int(resolved.block_size),
            'workloadDigest': workload_digest,
            'machineResourceUri': f'{resource_root}/machine',
            'previewResourceUri': f'{resource_root}/preview',
        }
        folder = self.materialization_root / identity_hex
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'machine.hmbt1.tif').write_bytes(resolved.carrier_bytes)
        (folder / 'preview.svg').write_bytes(_preview_svg(manifest, resolved.oracle_used))
        (folder / 'manifest.json').write_bytes(_canonical_json(manifest))
        return {
            'decision': plan.decision,
            'materializationRef': resource_root,
            'materialization': manifest,
            'oracleUsed': bool(resolved.oracle_used),
        }

    def materialization(self, entry: Any, ref: str) -> dict[str, Any]:
        identity_hex = self._identity_from_ref(entry, ref)
        manifest_path = self.materialization_root / identity_hex / 'manifest.json'
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        except FileNotFoundError as exc:
            raise MaterializationServiceError('RESOURCE_NOT_FOUND', f'HDSRC materialization {ref} not found') from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise MaterializationServiceError('INTEGRITY_FAILURE', f'HDSRC materialization manifest is unreadable: {ref}') from exc
        self._validate_current(entry, manifest)
        return manifest

    def read_resource(self, entry: Any, uri: str, *, max_bytes: int) -> dict[str, Any]:
        if uri.endswith('/machine'):
            ref = uri[:-len('/machine')]
            filename = 'machine.hmbt1.tif'
            mime_type = 'application/x-hdsrc-hmbt1'
        elif uri.endswith('/preview'):
            ref = uri[:-len('/preview')]
            filename = 'preview.svg'
            mime_type = 'image/svg+xml'
        else:
            raise MaterializationServiceError('RESOURCE_NOT_FOUND', f'HDSRC resource {uri} not found')
        identity_hex = self._identity_from_ref(entry, ref)
        manifest = self.materialization(entry, ref)
        path = self.materialization_root / identity_hex / filename
        try:
            payload = path.read_bytes()
        except OSError as exc:
            raise MaterializationServiceError('RESOURCE_NOT_FOUND', f'HDSRC resource {uri} not found') from exc
        if len(payload) > int(max_bytes):
            raise MaterializationServiceError('PROVIDER_UNAVAILABLE', 'HDSRC resource exceeds configured byte limit')
        if filename == 'machine.hmbt1.tif':
            digest = 'sha256:' + hashlib.sha256(payload).hexdigest()
            if digest != manifest.get('materializationDigest'):
                raise MaterializationServiceError('INTEGRITY_FAILURE', 'HDSRC machine carrier digest mismatch')
        return {
            'uri': uri,
            'mimeType': mime_type,
            'base64': base64.b64encode(payload).decode('ascii'),
        }

    def _request_workload(self, entry: Any, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or request.get('schema') != 'hdsrc-materialization-request/v1':
            raise MaterializationServiceError('INVALID_REQUEST', 'materialization request schema is invalid')
        expected_ref = f'hdsrc://state/{entry.state_id}'
        if request.get('stateRef') != expected_ref:
            raise MaterializationServiceError('INVALID_REQUEST', 'materialization request stateRef does not match authorized state')
        workload = request.get('workload')
        if not isinstance(workload, dict) or workload.get('schema') != 'hdsrc-workload-hint/v1':
            raise MaterializationServiceError('INVALID_REQUEST', 'workload schema is invalid')
        return workload

    def _identity_from_ref(self, entry: Any, ref: str) -> str:
        prefix = f'hdsrc://state/{entry.state_id}/materializations/mat:'
        if not isinstance(ref, str) or not ref.startswith(prefix):
            raise MaterializationServiceError('RESOURCE_NOT_FOUND', f'HDSRC materialization {ref} not found')
        identity_hex = ref[len(prefix):]
        if len(identity_hex) != 64 or any(ch not in '0123456789abcdef' for ch in identity_hex):
            raise MaterializationServiceError('RESOURCE_NOT_FOUND', f'HDSRC materialization {ref} not found')
        return identity_hex

    def _validate_current(self, entry: Any, manifest: dict[str, Any]) -> None:
        if manifest.get('stateId') != entry.state_id or manifest.get('stateRevision') != int(entry.state_revision):
            raise MaterializationServiceError('STALE_STATE', 'persisted HDSRC materialization state revision is stale', True)
        _state, current_digest = self._load_state(entry)
        if manifest.get('stateDigest') != current_digest:
            raise MaterializationServiceError('STALE_STATE', 'persisted HDSRC materialization source digest is stale', True)
        materialization_id = manifest.get('materializationId')
        if not isinstance(materialization_id, str) or not materialization_id.startswith('mat:'):
            raise MaterializationServiceError('INTEGRITY_FAILURE', 'persisted HDSRC materialization identity is invalid')


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def _preview_svg(manifest: dict[str, Any], oracle_used: bool) -> bytes:
    state_id = escape(str(manifest['stateId']))
    block = int(manifest['logicalScale'])
    spatial = escape(str(manifest['spatializationId']))
    mode = 'oracle' if oracle_used else 'fast'
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180">'
        '<rect width="640" height="180" fill="white"/>'
        '<text x="24" y="48" font-family="monospace" font-size="24">HDSRC HMBT1</text>'
        f'<text x="24" y="82" font-family="monospace" font-size="16">state={state_id}</text>'
        f'<text x="24" y="112" font-family="monospace" font-size="16">block={block} spatial={spatial}</text>'
        f'<text x="24" y="142" font-family="monospace" font-size="16">decision={mode}</text>'
        '</svg>'
    )
    return svg.encode('utf-8')
