#!/usr/bin/env python3
"""Run a command with a complete disk log and only a verdict/failing tail.

python3 scripts/quiet_logs.py --label vitest -- pnpm exec vitest run test/x.test.ts
WS_QUIET=1 enables this in build, gen and shardfile entry points.
The push gate accepts an explicit trailing --quiet, retaining raw parser output by default.
WS_LOG_DIR may point to a persistent lane log directory (default: .git/command-logs).
"""
import argparse
from collections import deque
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time


def requested(argv):
    return os.environ.get('WS_QUIET_ACTIVE') != '1' and (
        os.environ.get('WS_QUIET') == '1' or '--quiet' in argv)


def run_logged(label, command):
    directory = os.environ.get('WS_LOG_DIR')
    if directory is None:
        common = subprocess.check_output(
            ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip()
        directory = str(Path(common) / 'command-logs')
    logs = Path(directory).resolve()
    logs.mkdir(parents=True, exist_ok=True)
    name = re.sub(r'[^a-zA-Z0-9_.-]', '-', label)
    started = time.monotonic()
    with tempfile.NamedTemporaryFile(mode='w', prefix=name + '-', suffix='.log', dir=logs, delete=False) as log:
        path = Path(log.name)
        print('command: ' + repr(command), file=log, flush=True)
        child = None
        previous = {}

        def forward(signum, _frame):
            if child is not None:
                try:
                    os.killpg(child.pid, signum)
                except ProcessLookupError:
                    pass

        try:
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous[signum] = signal.signal(signum, forward)
            child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                     env=dict(os.environ, WS_QUIET_ACTIVE='1'), start_new_session=True)
            code = child.wait()
            code = code if code >= 0 else 128 - code
        except OSError as error:
            print(str(error), file=log)
            code = 127
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
    if code == 0:
        print(f'{label}: PASS ({time.monotonic() - started:.1f}s)', flush=True)
    else:
        print(f'{label}: FAIL (exit {code}); full log: {path}', file=sys.stderr, flush=True)
        with path.open(errors='replace') as log:
            sys.stderr.writelines(deque(log, maxlen=40))
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('give a command after --')
    sys.exit(run_logged(args.label, command))
