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


async def serve(root, capacity, cohort_slots=None):
    token = secrets.token_hex(24)
    stopping = asyncio.Event()
    clients = set()
    cohort_queue = []
    cohort_active = {}

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
            # In an admitted full run the finite grants share a small cohort
            # budget. An all-slot proof drains it, then still asks the machine
            # for its entire capacity. Locally queued files leave CPU to peers.
            cohort_weight = cohort_slots if weight == 'all' else slots
            if cohort_slots is not None and cohort_weight > cohort_slots:
                raise ValueError('CPU request exceeds the cohort CPU budget')
            browser = request.get('browser', False)
            if type(browser) is not bool or browser and slots != min(4, capacity):
                raise ValueError('Invalid browser CPU request')
            holder = request.get('pid')
            if holder is not None and (type(holder) is not int or not 1 < holder < 2 ** 31):
                raise ValueError('Invalid CPU broker request')
            # FL30: the holder is the client process, the owner this broker's parent (the run); either gone frees it.
            entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'owner': os.getppid(), 'repo': str(Path(repo).resolve()), 'slots': slots}
            if browser:
                entry['browser'] = True
                entry['browserWeight'] = slots
            if holder is not None:
                entry['holder'] = holder
            lease = entry['token']
            if cohort_slots is not None:
                cohort_queue.append(lease)
            began = time.monotonic()
            deadline = began + 300
            while True:
                if reader.at_eof():
                    return
                if stopping.is_set():
                    raise RuntimeError('CPU broker is stopping')
                if cohort_slots is not None and lease not in cohort_active:
                    if cohort_queue[0] == lease and sum(cohort_active.values()) + cohort_weight <= cohort_slots:
                        cohort_queue.pop(0)
                        cohort_active[lease] = cohort_weight
                if (cohort_slots is None or lease in cohort_active) and admission.acquire_cpu(root, entry, capacity, deadline):
                    break
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
                lease = entry['token']
                admission.release_cpu(root, lease)
                cohort_active.pop(lease, None)
                if lease in cohort_queue:
                    cohort_queue.remove(lease)
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
    def signalled(name):
        # CPU-BROKER: say who stopped it; a gate that stops a run signals the broker too.
        print('CPU broker: stopped by ' + name.name, file=sys.stderr, flush=True)
        stopping.set()

    for name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(name, signalled, name)
    print(json.dumps({'port': port, 'token': token}), flush=True)
    try:
        await stopping.wait()
    finally:
        loop.remove_reader(sys.stdin.fileno())
        server.close()
        # Release the grants first: since Python 3.12 wait_closed also waits for every open connection, so
        # waiting before the cancel never returns while a client holds a lease (FL30).
        while clients:
            pending = list(clients)
            for client in pending:
                client.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await asyncio.sleep(0)
        await server.wait_closed()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--capacity', type=int)
    parser.add_argument('--cohort-slots', type=int)
    args = parser.parse_args()
    maximum = max(1, (os.cpu_count() or 1) - 2)
    capacity = maximum if args.capacity is None else args.capacity
    if not 1 <= capacity <= maximum:
        parser.error('capacity may only lower the machine budget')
    if args.cohort_slots is not None and args.cohort_slots < 1:
        parser.error('cohort slots must be a positive limit')
    cohort_slots = None if args.cohort_slots is None else min(args.cohort_slots, capacity)
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    asyncio.run(serve(root, capacity, cohort_slots))


if __name__ == '__main__':
    main()
