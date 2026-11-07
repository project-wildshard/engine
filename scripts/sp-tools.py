#!/usr/bin/env python3
"""G582: temporary, pane-owned push cadence and lane watchdog."""
import argparse
import asyncio
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
TICKS = [('push', 'push-loop.py', 60)]


def environment(source):
    """Inherit the pane's tools, never a version-pinned Codex shim or arg0 path."""
    result = dict(source)
    result['PATH'] = os.pathsep.join(dict.fromkeys(
        entry for entry in source.get('PATH', os.defpath).split(os.pathsep)
        if entry and '/.codex/packages/' not in entry and '/.codex/tmp/' not in entry))
    return result


def common(root):
    return Path(subprocess.check_output(['git', 'rev-parse', '--path-format=absolute',
                                        '--git-common-dir'], cwd=root, text=True).strip())


def identity(pid):
    row = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                         text=True, capture_output=True)
    return row.stdout.strip() if row.returncode == 0 else None


def owner(state):
    try:
        row = json.loads(state.read_text())
        return row if row['identity'] and identity(row['pid']) == row['identity'] else None
    except (FileNotFoundError, ValueError, KeyError):
        return None


async def cadence(root, label, argv, interval, stop, env):
    """Never overlap ticks; stopping drains an active upload/check naturally."""
    log = root / 'tmp/sp-tools' / (label + '.log')
    log.parent.mkdir(parents=True, exist_ok=True)
    while not stop.is_set():
        started = time.monotonic()
        try:
            with log.open('a') as output:
                child = await asyncio.create_subprocess_exec(*argv, cwd=root, env=env,
                    stdout=output, stderr=subprocess.STDOUT)
                print(f'sp-tools: {label} pid {child.pid}', flush=True)
                rc = await child.wait()
                print(f'sp-tools: {label} exit {rc}', flush=True)
        except OSError as error:
            print(f'sp-tools: {label} refused: {error}', flush=True)
        try:
            await asyncio.wait_for(stop.wait(), max(1, interval - (time.monotonic() - started)))
        except asyncio.TimeoutError:
            pass


async def supervise(root, state):
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        loop.add_signal_handler(sig, stop.set)
    env = environment(os.environ)
    for tool in ('node', 'herdr'):
        if shutil.which(tool, path=env['PATH']) is None:
            raise RuntimeError(tool + ' is required in the pane PATH')
    jobs = [asyncio.create_task(cadence(root, label,
            [sys.executable, str(root / 'scripts' / script)], interval, stop, env))
            for label, script, interval in TICKS]
    watchdog = await asyncio.create_subprocess_exec('node', str(root / 'scripts/lane-watchdog.mjs'),
                cwd=root, env=env)
    row = {'pid': os.getpid(), 'identity': identity(os.getpid()),
           'pane': os.environ.get('HERDR_PANE_ID'), 'watchdog': watchdog.pid}
    state.write_text(json.dumps(row))
    print('sp-tools: ready; push 60s and lane watchdog (sp-x7 wake 900s); stop: scripts/sp-tools.sh stop', flush=True)
    # A dead watchdog ends the group visibly instead of leaving a half-alive owner.
    ended = asyncio.create_task(watchdog.wait())
    requested = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait([ended, requested], return_when=asyncio.FIRST_COMPLETED)
    finally:
        stop.set()
        if watchdog.returncode is None:
            watchdog.terminate()
        await watchdog.wait()
        requested.cancel()
        await asyncio.gather(*jobs)
        if owner(state) is not None:
            state.unlink(missing_ok=True)
        print('sp-tools: stopped; all owned ticks drained', flush=True)


def start(root, state):
    running = owner(state)
    if running is not None:
        print('sp-tools: already running in ' + str(running['pane']))
        return
    created = json.loads(subprocess.check_output(['herdr', 'pane', 'split', '--current',
        '--direction', 'down', '--cwd', str(root), '--no-focus'], text=True))
    pane = created['result']['pane']['pane_id']
    subprocess.run(['herdr', 'pane', 'rename', pane, 'sp-tools'], check=True)
    command = 'exec ' + shlex.join([str(root / 'scripts/sp-tools.sh'), 'run'])
    subprocess.run(['herdr', 'pane', 'run', pane, command], check=True)
    subprocess.run(['herdr', 'pane', 'wait-output', pane, '--match', 'sp-tools: ready;',
                    '--timeout', '30000'], check=True)
    print('sp-tools: pane ' + pane, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'run', 'stop', 'status'], nargs='?', default='start')
    args = parser.parse_args()
    state = common(ROOT) / 'sp-tools.json'
    if args.action == 'stop':
        running = owner(state)
        if running is None:
            print('sp-tools: stopped')
        else:
            os.kill(running['pid'], signal.SIGTERM)
            print('sp-tools: stopping; active ticks drain in pane ' + str(running['pane']))
        return
    if args.action == 'status':
        print(json.dumps(owner(state)))
        return
    if os.environ.get('HERDR_ENV') != '1':
        raise SystemExit('sp-tools requires a Herdr-managed pane')
    if args.action == 'start':
        start(ROOT, state)
        return
    with state.with_suffix('.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('sp-tools is already running')
        asyncio.run(supervise(ROOT, state))


if __name__ == '__main__':
    main()
