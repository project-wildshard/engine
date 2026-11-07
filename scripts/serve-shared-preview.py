#!/usr/bin/env python3
"""One pinned preview per SHA; concurrent lanes borrow it until their last release."""
from collections import deque
import contextlib
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
import threading
import urllib.request

WAIT_SECONDS = 300


def read(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def write(path, state):
    temporary = path.with_suffix('.new')
    temporary.write_text(json.dumps(state))
    temporary.replace(path)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def holder(state):
    started = state.get('started', time.time())
    return 'lane=%s slot=preview:%s pid=%s age=%.1fs start=%s command=%s' % (
        state.get('owner', 'unknown'), state.get('sha', 'unknown'), state.get('pid', 'unknown'),
        max(0, time.time() - started), datetime.fromtimestamp(started, timezone.utc).isoformat(),
        state.get('command', 'unknown'))


@contextlib.contextmanager
def lock(path):
    deadline = time.monotonic() + WAIT_SECONDS
    with path.with_suffix('.lock').open('a+') as lease:
        while True:
            try:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('serve-build: timed out after 5 min waiting for shared preview; ' + holder(read(path)))
                time.sleep(min(.1, max(0, deadline - time.monotonic())))
        yield


def verify(state, registry):
    row = (registry / str(state['port'])).read_text().split(maxsplit=4)
    if int(row[0]) != state['pid'] or row[2] != state['out'] or not alive(state['pid']):
        raise ValueError('Shared preview registry owner changed')
    # The build stamp is the pinned mirror's short SHA plus build time. Match its
    # exact value on disk and HTTP; full SHA and build options are held by this lease.
    expected = read(Path(state['out']) / 'dist/version.json')
    if not str(expected.get('build', '')).startswith(state['sha'][:7] + '-'):
        raise ValueError('Shared preview build does not match pinned SHA')
    with urllib.request.urlopen('http://127.0.0.1:%s/version.json' % state['port'], timeout=2) as response:
        actual = json.load(response)
    if actual != expected:
        raise ValueError('Shared preview HTTP build differs from its pinned dist')


def run(registry, sha, mode, owner, command):
    if re.fullmatch('[a-f0-9]{40}', sha) is None:
        raise ValueError('Shared preview requires a full commit SHA')
    directory = registry / '.shared'
    directory.mkdir(exist_ok=True)
    path = directory / (sha + '.json')
    with lock(path):
        state = read(path)
        if state.get('status') in ('building', 'failed'):
            raise ValueError('Shared preview did not complete; no automatic retry; ' + holder(state))
        if state.get('status') == 'ready' and alive(state['pid']):
            if state['mode'] != mode or state.get('coverage') != 'all':
                raise ValueError('Existing SHA preview has incompatible mode/coverage; ' + holder(state))
            verify(state, registry)
            state['owners'] = sorted(set([*state['owners'], owner]))
            write(path, state)
            print('serve-build: reuse pinned preview; ' + holder(state), file=sys.stderr)
            print('http://127.0.0.1:%s/' % state['port'])
            return 0
        state = dict(status='building', sha=sha, mode=mode, coverage='all', owner=owner,
                     owners=[owner], pid=os.getpid(), started=time.time(), command=shlex.join(command))
        write(path, state)
        env = dict(os.environ, SERVE_SHARED_SHA=sha)
        child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        errors = deque(maxlen=60)
        def forward_errors():
            for line in child.stderr:
                errors.append(line); sys.stderr.write(line); sys.stderr.flush()
        forwarding = threading.Thread(target=forward_errors, daemon=True)
        forwarding.start()
        def interrupted(_signum, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        try:
            output = child.stdout.read()
            child.wait(); forwarding.join()
            child.stdout.close(); child.stderr.close()
            if child.returncode != 0:
                print('serve-build: child failed (%s); stderr tail:' % child.returncode, file=sys.stderr)
                print(''.join(errors).rstrip() or '(no stderr emitted)', file=sys.stderr)
                if output.strip():
                    print('serve-build: child stdout tail:\n' + '\n'.join(output.splitlines()[-60:]), file=sys.stderr)
                state['status'] = 'failed'; write(path, state)
                return child.returncode if child.returncode > 0 else 128 - child.returncode
            urls = re.findall(r'^http://127\.0\.0\.1:(\d+)/$', output, re.MULTILINE)
            if len(urls) != 1:
                raise ValueError('Preview did not publish exactly one URL')
            port = int(urls[0])
            row = (registry / str(port)).read_text().split(maxsplit=4)
            state.update(status='ready', pid=int(row[0]), port=port, out=row[2])
            verify(state, registry)
            (Path(state['out']) / '.shared-preview').write_text(sha)
            write(path, state)
            print(output, end='')
            return 0
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=5)
            state['status'] = 'failed'; write(path, state)
            raise


def retire(registry, port, observed, command, busy_ok=False):
    """Bind teardown to one registry row while excluding port reassignment."""
    with (registry / ('.port-%s.lock' % port)).open('a+') as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if busy_ok:
                return 0
            raise ValueError('Preview reservation still owns port %s; refusing teardown: %s' % (port, observed.strip()))
        entry = registry / port
        if not entry.exists() or entry.read_text() != observed:
            print('serve-build: preview :%s changed before release; no teardown' % port)
            return 0
        row = observed.split(maxsplit=4)
        env = dict(os.environ, SERVE_SHARED_STOP='1', SERVE_STOP_PID=row[0], SERVE_STOP_OUT=row[2])
        return subprocess.run(command, env=env, check=False).returncode


def reap_entry(registry, port, pid, output, command):
    """A stale PID observation cannot retire a replacement registry row."""
    try:
        observed = (registry / port).read_text()
    except FileNotFoundError:
        return 0
    row = observed.split(maxsplit=4)
    if len(row) < 5 or row[0] != pid or row[2] != output:
        return 0
    return retire(registry, port, observed, command, busy_ok=True)


def reap_output(registry, base, output, dry=False):
    """Port leases protect build directories even during registry handoff."""
    path = Path(output)
    match = re.fullmatch(r'.*-(\d+)', path.name.split('.stopped-', 1)[0])
    if path.is_symlink() or path.parent.resolve() != Path(base).resolve() or match is None:
        return 0
    port = str(int(match[1]))
    if not 1 <= int(port) <= 65535 or not path.is_dir():
        return 0
    registry.mkdir(parents=True, exist_ok=True)
    with (registry / ('.port-%s.lock' % port)).open('a+') as lease:
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        for entry in registry.glob('[0-9]*'):
            if entry.is_file():
                row = entry.read_text().split(maxsplit=4)
                if len(row) >= 3 and Path(row[2]).resolve() == path.resolve():
                    return 0
        if dry:
            print('would remove %s' % path)
        else:
            shutil.rmtree(path)
            print('reaped orphan preview output %s' % path)
    return 0


def release(registry, port, owner, all_mine, command):
    entry = registry / port
    try:
        observed = entry.read_text()
    except FileNotFoundError:
        return 0  # Already released; never fall through to a stale Bash row.
    row = observed.split(maxsplit=4)
    if len(row) < 5:
        raise ValueError('Malformed preview registry row')
    expected_pid = os.environ.get('SERVE_STOP_OBSERVED_PID')
    if expected_pid is not None and (row[0] != expected_pid or row[2] != os.environ.get('SERVE_STOP_OBSERVED_OUT')):
        print('serve-build: preview changed since stop was requested; no teardown')
        return 0
    marker = Path(row[2]) / '.shared-preview'
    if marker.exists():
        sha = marker.read_text().strip()
        if re.fullmatch('[a-f0-9]{40}', sha) is None:
            raise ValueError('Invalid shared preview marker; refusing legacy teardown')
        paths = [registry / '.shared' / (sha + '.json')]
    else:
        candidates = [(path, read(path)) for path in (registry / '.shared').glob('*.json')]
        candidates = [(path, state) for path, state in candidates if str(state.get('port')) == port]
        # A missing output also removes its marker. Ports are reused, so an
        # older record for this port cannot select its borrower or teardown.
        paths = [path for path, state in candidates
                 if state.get('pid') == int(row[0]) and state.get('out') == row[2]]
        if candidates and not paths:
            # An ordinary preview can reuse a former shared port. Only its
            # observed, owned registry row permits ignoring wholly unrelated
            # records; a partial shared identity still refuses teardown.
            ordinary = (row[3] == owner and expected_pid == row[0]
                        and os.environ.get('SERVE_STOP_OBSERVED_OUT') == row[2]
                        and Path(row[2]).is_dir()
                        and all(state.get('pid') != int(row[0]) and state.get('out') != row[2]
                                for _, state in candidates))
            if not ordinary:
                raise ValueError('No matching shared preview identity; refusing teardown')
    for path in paths:
        with lock(path):
            state = read(path)
            if state.get('status') != 'ready':
                raise ValueError('Shared preview is not ready for release; ' + holder(state))
            if str(state.get('port')) != port:
                print('serve-build: shared preview changed before release; no teardown')
                return 0
            if owner not in state['owners']:
                if all_mine:
                    return 0
                raise ValueError('Caller %s does not hold this shared preview; borrowers=%s; %s' %
                                 (owner, ','.join(state['owners']), holder(state)))
            if int(row[0]) != state['pid'] or row[2] != state['out']:
                raise ValueError('Refuse to stop a replaced shared preview owner')
            remaining = [name for name in state['owners'] if name != owner]
            if remaining:
                state['owners'] = remaining
                write(path, state)
                print('serve-build: released :%s; retained by %s' % (port, ', '.join(remaining)))
                return 0
            result = retire(registry, port, observed, command)
            if result == 0:
                path.unlink()
            return result
    if all_mine and row[3] != owner:
        return 0
    return retire(registry, port, observed, command)


def main():
    action, directory, *args = sys.argv[1:]
    registry = Path(directory)
    try:
        if action == 'run':
            sha, mode, owner, *command = args
            return run(registry, sha, mode, owner, command)
        if action == 'reap-entry':
            port, pid, output, *command = args
            return reap_entry(registry, port, pid, output, command)
        if action == 'reap-output':
            base, output, *flags = args
            return reap_output(registry, base, output, flags == ['--dry-run'])
        port, owner, all_mine, *command = args
        return release(registry, port, owner, all_mine == '1', command)
    except TimeoutError as error:
        print(error, file=sys.stderr); return 124
    except (ValueError, OSError) as error:
        print('serve-build: ' + str(error), file=sys.stderr); return 1
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    sys.exit(main())
