#!/usr/bin/env python3
import json
import sys
import time

PROTOCOL = "hdsrc-process/0.1"
mode = sys.argv[1] if len(sys.argv) > 1 else "echo"


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def read_message():
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line)


if mode == "exit":
    sys.exit(7)

if mode == "malformed":
    message = read_message()
    if message is not None:
        sys.stdout.write("not-json\n")
        sys.stdout.flush()
    time.sleep(0.2)
    sys.exit(0)

if mode == "sleep":
    message = read_message()
    if message is not None:
        time.sleep(2)
    sys.exit(0)

if mode == "reverse":
    first = read_message()
    second = read_message()
    if first is not None and second is not None:
        for message in (second, first):
            emit({
                "protocol": PROTOCOL,
                "id": message["id"],
                "result": message.get("params", {}),
            })
    sys.exit(0)

for line in sys.stdin:
    message = json.loads(line)
    emit({
        "protocol": PROTOCOL,
        "id": message["id"],
        "result": message.get("params", {}),
    })
