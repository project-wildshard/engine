#!/usr/bin/env python3
"""Weighted CPU admission using the existing machine scheduler, never a second lock domain."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('heavy_lane', Path(__file__).with_name('heavy-lane.py'))
lane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lane)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['hold', 'run'])
    parser.add_argument('--slots', default='1')
    parser.add_argument('--repo', default=os.getcwd())
    parser.add_argument('--capacity', type=int)
    argv = sys.argv[1:]
    split = argv.index('--') if '--' in argv else len(argv)
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    maximum = max(1, (os.cpu_count() or 1) - 2)
    capacity = args.capacity if args.capacity is not None else maximum
    if not 1 <= capacity <= maximum:
        parser.error('capacity may only lower the machine budget')
    slots = capacity if args.slots == 'all' else int(args.slots)
    if not 1 <= slots <= capacity or args.mode == 'run' and not command:
        parser.error('give a valid weight and a command for run')
    root = Path(os.environ.get('WS_CPU_ROOT', os.environ.get('WS_HEAVY_SCHEDULER_ROOT', str(Path.home() / '.wildshard-heavy-lanes')))).resolve()
    root.mkdir(parents=True, exist_ok=True)
    entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'repo': str(Path(args.repo).resolve()), 'slots': slots}
    began = time.monotonic()
    deadline = began + 300
    owner = os.getppid()
    child = None

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        while True:
            if os.getppid() != owner:
                return 130
            with lane.scheduler(root, deadline) as state:
                known = state.setdefault('cpuCapacity', capacity)
                if known != capacity:
                    raise RuntimeError('CPU admission policy differs from the active scheduler')
                pending = state.setdefault('cpuQueue', [])
                active = state.setdefault('cpuActive', [])
                pending[:] = [row for row in pending if lane.alive(row['pid'])]
                active[:] = [row for row in active if lane.alive(row['pid'])]
                if not any(row['token'] == entry['token'] for row in pending):
                    entry['ticket'] = state.setdefault('cpuNext', 0)
                    state['cpuNext'] += 1
                    pending.append(entry)
                # FIFO reservations prevent an exclusive/timing proof starving
                # behind a continuous stream of smaller file requests.
                head = min(pending, key=lambda row: row['ticket'])
                if head['token'] == entry['token'] and sum(row['slots'] for row in active) + slots <= capacity:
                    pending[:] = [row for row in pending if row['token'] != entry['token']]
                    active.append(entry)
                    granted = True
                else:
                    granted = False
            if granted:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError('CPU admission exceeded five minutes waiting for owned work')
            time.sleep(.01)
        if args.mode == 'hold':
            print(json.dumps({'lease': entry['token'], 'slots': slots, 'capacity': capacity, 'queueSeconds': time.monotonic() - began}), flush=True)
            # The actual worker owns this pipe. EOF releases even after a kill.
            sys.stdin.buffer.read()
            return 0
        env = {**os.environ, 'WS_CPU_SLOTS': str(slots)}
        child = subprocess.Popen(command, env=env, start_new_session=True)
        code = child.wait()
        return code if code >= 0 else 128 - code
    except KeyboardInterrupt:
        lane.terminate(child)
        return 130
    except (TimeoutError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        with lane.scheduler(root) as state:
            for key in ('cpuQueue', 'cpuActive'):
                state[key] = [row for row in state.get(key, []) if row['token'] != entry['token'] and lane.alive(row['pid'])]


if __name__ == '__main__':
    raise SystemExit(main())
