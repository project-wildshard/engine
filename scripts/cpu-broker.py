#!/usr/bin/env python3
"""A run owns one broker; every isolated file still owns a separate FIFO grant."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('cpu_admission', Path(__file__).with_name('cpu-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


async def serve(root, capacity):
    token = secrets.token_hex(24)
    stopping = asyncio.Event()
    clients = set()

    async def own(reader, writer):
        current = asyncio.current_task()
        clients.add(current)
        entry = None
        try:
            raw = await asyncio.wait_for(reader.readline(), timeout=300)
            request = json.loads(raw)
            if not isinstance(request, dict) or request.get('token') != token:
                raise ValueError('Invalid CPU broker capability')
            weight, repo = request.get('slots'), request.get('repo')
            slots = capacity if weight == 'all' else weight
            if type(slots) is not int or not 1 <= slots <= capacity or not isinstance(repo, str) or len(repo) > 8192:
                raise ValueError('Invalid CPU broker request')
            entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'repo': str(Path(repo).resolve()), 'slots': slots}
            began = time.monotonic()
            deadline = began + 300
            while not admission.acquire_cpu(root, entry, capacity, deadline):
                if reader.at_eof():
                    return
                if time.monotonic() >= deadline:
                    raise TimeoutError('CPU admission exceeded five minutes waiting for owned work')
                await asyncio.sleep(.01)
            proof = {'lease': entry['token'], 'slots': slots, 'capacity': capacity, 'queueSeconds': time.monotonic() - began}
            writer.write((json.dumps(proof) + '\n').encode())
            await writer.drain()
            # EOF releases on ordinary teardown and when a test fork is killed.
            await reader.read(1)
        except (ValueError, OSError, TimeoutError, RuntimeError) as error:
            writer.write((json.dumps({'error': str(error)}) + '\n').encode())
            try:
                await writer.drain()
            except (ConnectionError, OSError):
                pass
        finally:
            if entry is not None:
                admission.release_cpu(root, entry['token'])
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
            clients.discard(current)

    server = await asyncio.start_server(own, '127.0.0.1', 0, limit=16384)
    port = server.sockets[0].getsockname()[1]
    loop = asyncio.get_running_loop()

    def control_closed():
        if not os.read(sys.stdin.fileno(), 1):
            stopping.set()

    loop.add_reader(sys.stdin.fileno(), control_closed)
    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, stopping.set)
    print(json.dumps({'port': port, 'token': token}), flush=True)
    try:
        await stopping.wait()
    finally:
        loop.remove_reader(sys.stdin.fileno())
        server.close()
        await server.wait_closed()
        pending = list(clients)
        for client in pending:
            client.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--capacity', type=int)
    args = parser.parse_args()
    maximum = max(1, (os.cpu_count() or 1) - 2)
    capacity = maximum if args.capacity is None else args.capacity
    if not 1 <= capacity <= maximum:
        parser.error('capacity may only lower the machine budget')
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    asyncio.run(serve(root, capacity))


if __name__ == '__main__':
    main()
