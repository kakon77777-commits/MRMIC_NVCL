#!/usr/bin/env python3
import json
import os
import sys

PROTOCOL = "hdsrc-process/0.1"
MODE = os.environ.get("HDSRC_ORIGIN_MODE", "stale")
METHODS = [
    "capabilities",
    "state",
    "plan_materialization",
    "materialize",
    "materialization",
    "read_resource",
    "partial_relation_block_row",
]


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    request_id = request.get("id")
    if method == "initialize":
        emit({
            "protocol": PROTOCOL,
            "id": request_id,
            "result": {
                "protocol": PROTOCOL,
                "host": "hdsrc-origin-fixture",
                "readOnly": True,
                "methods": METHODS,
            },
        })
        continue
    if method == "capabilities":
        emit({
            "protocol": PROTOCOL,
            "id": request_id,
            "result": {
                "schema": "hdsrc-provider-capabilities/v1",
                "providerVersion": "origin-fixture",
                "stateProfiles": ["HDSRC-SymbolicState"],
                "carrierProfiles": ["HMBT1"],
                "planningProfiles": ["HPCM2"],
                "observationModes": ["human_preview", "machine_carrier", "structured_manifest"],
                "partialRead": True,
                "oracleFallback": True,
                "canonicalMutation": False,
            },
        })
        continue
    code = "STALE_STATE" if MODE == "stale" else "PROVIDER_UNAVAILABLE"
    emit({
        "protocol": PROTOCOL,
        "id": request_id,
        "error": {
            "code": code,
            "message": f"remote fixture {code}",
            "retryable": True,
        },
    })
