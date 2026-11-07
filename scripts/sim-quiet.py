#!/usr/bin/env python3
"""G670: the official Simulator reader alone owns a bounded quiet window."""
import fcntl
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
READER = 'scripts/sim-grid-entry.mjs'
FLOOR_READER = 'scripts/frame-floor.mjs'
READERS = {READER, FLOOR_READER}


def scratch(path, repo):
    value = Path(path).resolve()
    return value.is_relative_to(repo / 'tmp') or value.is_relative_to(Path('/tmp').resolve())


def process_info(pid):
    try:
        row = subprocess.check_output(['ps', '-p', str(pid), '-o', 'ppid=', '-o', 'command='],
                                      text=True, stderr=subprocess.DEVNULL, timeout=2).strip().split(maxsplit=1)
        parent, command = int(row[0]), shlex.split(row[1])
        proc = Path('/proc') / str(pid) / 'cwd'
        if proc.exists():
            cwd = proc.resolve()
        else:
            out = subprocess.check_output(['lsof', '-b', '-w', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                                          text=True, stderr=subprocess.DEVNULL, timeout=2)
            cwd = next((Path(line[1:]).resolve() for line in out.splitlines() if line.startswith('n')), None)
        return {'parent': parent, 'args': command, 'cwd': cwd}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def official_simulator(pid, repo, reader=READER):
    if not isinstance(reader, str) or reader not in READERS:
        return False
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    info = process_info(pid)
    if info is None or info['cwd'] is None or scratch(info['cwd'], repo):
        return False
    args = info['args']
    if len(args) < 2 or Path(args[0]).name != 'node' or args[1].startswith('-'):
        return False
    if (info['cwd'] / args[1]).resolve() != (repo / reader).resolve():
        return False
    if reader == FLOOR_READER and (not {'--worker', '--surface=sim', '--quiet'}.issubset(args[2:])
                                   or [arg for arg in args[2:] if arg.startswith('--surface=')] != ['--surface=sim']):
        return False
    for _ in range(12):
        if info['cwd'] is not None and scratch(info['cwd'], repo):
            return False
        argv = info['args']
        if len(argv) > 1 and Path(argv[0]).name in {'node', 'python3', 'python', 'bash', 'sh', 'zsh'}:
            operand = next((arg for arg in argv[1:] if not arg.startswith('-')), '')
            if Path(operand).suffix in {'.py', '.mjs', '.cjs', '.js', '.ts', '.sh'}:
                if scratch((info['cwd'] or repo) / operand, repo):
                    return False
        if info['parent'] <= 1:
            break
        info = process_info(info['parent'])
        if info is None:
            break
    return True


def quiet_marker_active(path, now=None):
    try:
        age = (time.time() if now is None else now) - path.stat().st_mtime
        if age < 0 or age >= 600:
            return False
        marker = json.loads(path.read_text())
        reader = marker.get('script')
        if marker.get('schema') != 1 or marker.get('kind') != 'simulator-reading' or not isinstance(reader, str) or reader not in READERS:
            return False
        repo = path.parent.parent.resolve()
        return official_simulator(marker.get('pid'), repo) if reader == READER else official_simulator(marker.get('pid'), repo, reader)
    except (OSError, ValueError, AttributeError):
        return False


def take(common, pid, timeout=300, reader=READER):
    """Drain one push tick before publication; a timeout fails without retry."""
    if not isinstance(reader, str) or reader not in READERS:
        raise RuntimeError('Unknown official Simulator reader')
    deadline = time.monotonic() + timeout
    with (common / 'push-loop.lock').open('a') as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('G612: Simulator quiet push-drain timed out after 5 min; do not retry')
                time.sleep(.1)
        path = common / 'quiet'
        if path.exists():
            old = path.read_text()
            try:
                old_pid = json.loads(old).get('pid')
            except (ValueError, AttributeError) as error:
                raise RuntimeError('G670: unofficial quiet marker; its owner must release it') from error
            if not isinstance(old_pid, int) or isinstance(old_pid, bool) or old_pid <= 0:
                raise RuntimeError('G670: unofficial quiet marker; its owner must release it')
            try:
                os.kill(old_pid, 0)
            except ProcessLookupError:
                if path.read_text() == old:
                    path.unlink()
            else:
                raise RuntimeError('G670: another live owner already holds quiet')
        marker = {'schema': 1, 'kind': 'simulator-reading', 'script': reader,
                  'owner': Path(reader).stem, 'pid': pid}
        with path.open('x') as output:
            json.dump(marker, output)


def release(common, pid):
    path = common / 'quiet'
    try:
        text = path.read_text()
        marker = json.loads(text)
        reader = marker.get('script')
        if marker.get('pid') == pid and marker.get('kind') == 'simulator-reading' and isinstance(reader, str) and reader in READERS:
            if path.read_text() == text:
                path.unlink()
    except FileNotFoundError:
        pass


def main():
    if sys.argv[1:] == ['status']:
        common = Path(subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip())
        print(json.dumps({'active': quiet_marker_active(common / 'quiet')}))
        return
    if len(sys.argv) not in {3, 4} or sys.argv[1] not in {'verify', 'take', 'release'}:
        raise RuntimeError('usage: sim-quiet.py status | verify|take|release <official reader pid> [reader]')
    pid = int(sys.argv[2])
    reader = sys.argv[3] if len(sys.argv) == 4 else READER
    if pid != os.getppid() or not os.environ.get('SIM_UDID') or not official_simulator(pid, ROOT, reader):
        raise RuntimeError('G670: quiet is reserved for the official Simulator reader; tmp/ callers refuse')
    common = Path(subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip())
    if sys.argv[1] == 'take':
        take(common, pid, reader=reader)
    elif sys.argv[1] == 'release':
        release(common, pid)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(2) from error
