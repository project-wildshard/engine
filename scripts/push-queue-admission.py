#!/usr/bin/env python3
"""Wait outside the normal hook; never acquire, forge or bypass its lease."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys
import time

spec = importlib.util.spec_from_file_location('heavy_lane', Path(__file__).with_name('heavy-lane.py'))
lane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lane)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True)
    parser.add_argument('--seconds', type=float, default=6000)
    args = parser.parse_args()
    if not 0 < args.seconds <= 6000:
        parser.error('admission wait must be positive and at most 100 minutes')
    root = Path(os.environ.get('WS_HEAVY_SCHEDULER_ROOT', str(Path.home() / '.wildshard-heavy-lanes'))).resolve()
    root.mkdir(parents=True, exist_ok=True)
    checkout = str(Path(args.checkout).resolve())
    began = time.monotonic()
    announced = False
    while True:
        state = lane.status(root)
        active = [row for row in state['active'] if row['resource'] == 'full-test'
                  or row['resource'].startswith('full-test-') and row.get('cwd') == checkout]
        queued = [row for row in state['queue'] if 'full-test' in row['resources']
                  and (not row.get('checkout') or row['checkout'] == checkout)]
        if not active and not queued:
            print(f'push-queue: admission ready after {time.monotonic() - began:.2f}s; normal hook still owns its actual lease', flush=True)
            return 0
        if not announced:
            print('push-queue: waiting before hook for a conflicting full-test owner or FIFO predecessor', flush=True)
            announced = True
        if time.monotonic() - began >= args.seconds:
            print('push-queue: bounded pre-hook admission wait exhausted; no hook proof or upload', file=sys.stderr)
            return 1
        time.sleep(min(.1, args.seconds))


if __name__ == '__main__':
    raise SystemExit(main())
