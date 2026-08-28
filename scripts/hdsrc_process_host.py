#!/usr/bin/env python3
"""Read-only HDSRC JSONL process host for MRMIC/NVCL.

This adapter intentionally owns no canonical HDSRC state. It resolves states from a
static registry, delegates HDS1 decoding to the installed HDSRC Python runtime, and
speaks the versioned hdsrc-process/0.1 protocol on stdout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from hdsrc_exp.codec import decode_hds1


PROTOCOL = "hdsrc-process/0.1"
HOST_NAME = "hdsrc-local-process"
REGISTRY_SCHEMA = "hdsrc-local-registry/v1"


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = bool(retryable)


@dataclass(frozen=True)
class StateEntry:
    state_id: str
    state_revision: int
    hds1_path: Path
    read_principals: frozenset[str]


@dataclass(frozen=True)
class HostConfig:
    registry_path: Path
    profile_root: Path
    materialization_root: Path
    states: dict[str, StateEntry]


class HdsrcProcessHost:
    def __init__(self, config: HostConfig) -> None:
        self.config = config
        self._handlers: dict[str, Callable[[dict[str, Any]], Any]] = {
            "initialize": self._initialize,
            "capabilities": self._capabilities,
            "state": self._state,
            "shutdown": self._shutdown,
        }
        self._shutdown_requested = False

    @property
    def methods(self) -> tuple[str, ...]:
        return tuple(self._handlers.keys())

    @property
    def shutdown_requested(self) -> bool:
        return self._shutdown_requested

    def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        handler = self._handlers.get(method)
        if handler is None:
            raise ProviderError("INVALID_REQUEST", f"unsupported HDSRC process method: {method}")
        return handler(params)

    def _initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        # Client/version are informational only. They never confer HDSRC authority.
        _optional_text(params.get("client"), "client")
        _optional_text(params.get("version"), "version")
        return {
            "protocol": PROTOCOL,
            "host": HOST_NAME,
            "readOnly": True,
            "methods": list(self.methods),
        }

    def _capabilities(self, params: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema": "hdsrc-provider-capabilities/v1",
            "providerVersion": "0.10-local-process",
            "stateProfiles": ["HDSRC-SymbolicState"],
            "carrierProfiles": [
                "HIC1",
                "SNIC1",
                "SFPIC1",
                "HDT1",
                "HST1",
                "HCT1",
                "HBT1",
                "HMBT1",
            ],
            "planningProfiles": ["HRT1", "HMSP1", "HMR1", "HPCM1", "HPCM2"],
            "observationModes": [
                "human_preview",
                "machine_carrier",
                "structured_manifest",
            ],
            "partialRead": True,
            "oracleFallback": True,
            "canonicalMutation": False,
        }

    def _state(self, params: dict[str, Any]) -> dict[str, Any]:
        ref = _required_text(params.get("ref"), "ref")
        principal_id = _required_text(params.get("principalId"), "principalId")
        entry = self._entry_for_ref(ref)
        self._authorize(entry, principal_id)

        try:
            hds1_bytes = entry.hds1_path.read_bytes()
        except OSError as exc:
            raise ProviderError(
                "PROVIDER_UNAVAILABLE",
                f"HDSRC state bytes are unavailable for {entry.state_id}",
                True,
            ) from exc

        try:
            state = decode_hds1(hds1_bytes)
            dimension = int(state.dimension)
        except Exception as exc:
            raise ProviderError(
                "INTEGRITY_FAILURE",
                f"HDSRC state {entry.state_id} failed canonical HDS1 decode",
                False,
            ) from exc

        if dimension < 1:
            raise ProviderError("INTEGRITY_FAILURE", "decoded HDSRC dimension must be positive")

        state_digest = "sha256:" + hashlib.sha256(hds1_bytes).hexdigest()
        return {
            "schema": "hdsrc-state-ref/v1",
            "stateId": entry.state_id,
            "stateRevision": entry.state_revision,
            "stateDigest": state_digest,
            "dimension": dimension,
            "authority": "hdsrc",
        }

    def _shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        self._shutdown_requested = True
        return {"shuttingDown": True}

    def _entry_for_ref(self, ref: str) -> StateEntry:
        for entry in self.config.states.values():
            if ref == f"hdsrc://state/{entry.state_id}":
                return entry
        raise ProviderError("RESOURCE_NOT_FOUND", f"HDSRC state {ref} not found")

    @staticmethod
    def _authorize(entry: StateEntry, principal_id: str) -> None:
        if principal_id not in entry.read_principals:
            raise ProviderError("UNAUTHORIZED", "HDSRC read access denied")


def _required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProviderError("INVALID_REQUEST", f"{label} must be a non-empty string")
    return value.strip()


def _optional_text(value: Any, label: str) -> str | None:
    if value is None:
        return None
    return _required_text(value, label)


def _load_registry(path: Path) -> dict[str, StateEntry]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot load HDSRC registry {path}") from exc

    if not isinstance(raw, dict) or raw.get("schema") != REGISTRY_SCHEMA:
        raise RuntimeError("HDSRC registry schema is invalid")
    states = raw.get("states")
    if not isinstance(states, list) or not states:
        raise RuntimeError("HDSRC registry states must be a non-empty array")

    result: dict[str, StateEntry] = {}
    registry_root = path.parent.resolve()
    for index, value in enumerate(states):
        if not isinstance(value, dict):
            raise RuntimeError(f"HDSRC registry states[{index}] must be an object")
        allowed_keys = {"stateId", "stateRevision", "hds1Path", "readPrincipals"}
        if set(value.keys()) != allowed_keys:
            raise RuntimeError(f"HDSRC registry states[{index}] fields are invalid")

        state_id = value.get("stateId")
        revision = value.get("stateRevision")
        hds1_value = value.get("hds1Path")
        principals = value.get("readPrincipals")
        if not isinstance(state_id, str) or not state_id.strip():
            raise RuntimeError(f"HDSRC registry states[{index}].stateId is invalid")
        state_id = state_id.strip()
        if state_id in result:
            raise RuntimeError(f"duplicate HDSRC stateId {state_id}")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
            raise RuntimeError(f"HDSRC registry states[{index}].stateRevision is invalid")
        if not isinstance(hds1_value, str) or not hds1_value.strip():
            raise RuntimeError(f"HDSRC registry states[{index}].hds1Path is invalid")
        if not isinstance(principals, list):
            raise RuntimeError(f"HDSRC registry states[{index}].readPrincipals is invalid")
        if any(not isinstance(item, str) or not item.strip() for item in principals):
            raise RuntimeError(f"HDSRC registry states[{index}].readPrincipals contains invalid entries")
        normalized_principals = [item.strip() for item in principals]
        if len(set(normalized_principals)) != len(normalized_principals):
            raise RuntimeError(f"HDSRC registry states[{index}].readPrincipals must be unique")

        hds1_path = Path(hds1_value.strip())
        if not hds1_path.is_absolute():
            hds1_path = registry_root / hds1_path
        hds1_path = hds1_path.resolve()

        result[state_id] = StateEntry(
            state_id=state_id,
            state_revision=revision,
            hds1_path=hds1_path,
            read_principals=frozenset(normalized_principals),
        )
    return result


def _load_config(args: argparse.Namespace) -> HostConfig:
    registry_path = Path(args.registry).expanduser().resolve()
    profile_root = Path(args.profile_root).expanduser().resolve()
    materialization_root = Path(args.materialization_root).expanduser().resolve()
    if not profile_root.exists() or not profile_root.is_dir():
        raise RuntimeError(f"HDSRC profile root is unavailable: {profile_root}")
    materialization_root.mkdir(parents=True, exist_ok=True)
    states = _load_registry(registry_path)
    return HostConfig(
        registry_path=registry_path,
        profile_root=profile_root,
        materialization_root=materialization_root,
        states=states,
    )


def _parse_request(line: str) -> tuple[int, str, dict[str, Any]]:
    try:
        message = json.loads(line)
    except json.JSONDecodeError as exc:
        raise RuntimeError("malformed JSON request") from exc
    if not isinstance(message, dict):
        raise RuntimeError("request must be a JSON object")

    request_id = message.get("id")
    if not isinstance(request_id, int) or isinstance(request_id, bool) or request_id < 1:
        raise RuntimeError("request id must be a positive integer")
    if message.get("protocol") != PROTOCOL:
        raise ProviderError("INVALID_REQUEST", f"protocol must be {PROTOCOL}")
    method = message.get("method")
    if not isinstance(method, str) or not method.strip():
        raise ProviderError("INVALID_REQUEST", "method must be a non-empty string")
    params = message.get("params")
    if not isinstance(params, dict):
        raise ProviderError("INVALID_REQUEST", "params must be an object")
    return request_id, method.strip(), params


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()


def _emit_result(request_id: int, result: Any) -> None:
    _emit({"protocol": PROTOCOL, "id": request_id, "result": result})


def _emit_error(request_id: int, error: ProviderError) -> None:
    _emit(
        {
            "protocol": PROTOCOL,
            "id": request_id,
            "error": {
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
            },
        }
    )


def _run(host: HdsrcProcessHost) -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id: int | None = None
        try:
            request_id, method, params = _parse_request(line)
            result = host.dispatch(method, params)
            _emit_result(request_id, result)
            if host.shutdown_requested:
                return 0
        except ProviderError as exc:
            if request_id is None:
                # If JSON was parseable enough to expose a valid id, preserve correlation.
                try:
                    candidate = json.loads(line).get("id")
                    if isinstance(candidate, int) and not isinstance(candidate, bool) and candidate > 0:
                        request_id = candidate
                except Exception:
                    request_id = None
            if request_id is None:
                print(exc.message, file=sys.stderr, flush=True)
                return 2
            _emit_error(request_id, exc)
        except Exception as exc:
            print(f"fatal HDSRC process protocol error: {exc}", file=sys.stderr, flush=True)
            return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only HDSRC local JSONL process host")
    parser.add_argument("--registry", required=True)
    parser.add_argument("--profile-root", required=True)
    parser.add_argument("--materialization-root", required=True)
    args = parser.parse_args()
    try:
        config = _load_config(args)
        return _run(HdsrcProcessHost(config))
    except Exception as exc:
        print(f"HDSRC process host startup failed: {exc}", file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
