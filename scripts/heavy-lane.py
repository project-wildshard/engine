#!/usr/bin/env python3
"""Machine-wide full-test / app-build lanes. flock lifetime follows the owned child, not a PID file."""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import json
import hashlib
import math
import os
import re
import socket
import stat
from pathlib import Path
import resource as process_resource
import shutil
import signal
import subprocess
import sys
import time
import uuid

# G620: three app-build slots; pre-push never acquires a build lease.
# Keep the original build lock as slot one so running old wrappers remain accounted for.
BUILD_SLOTS = ('build', 'build-2', 'build-3')
RESOURCES = {'full-test': ('full-test',), 'build': ('build',), 'check': ('full-test', 'build')}
LANES = ('full-test', *BUILD_SLOTS)
WAIT_SECONDS = 5 * 60


def read_metadata(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError('nonregular/oversized Git metadata')
        data = os.read(fd, 4097)
        if len(data) > 4096:
            raise ValueError('oversized Git metadata')
        return data.decode('utf-8').strip()
    finally:
        os.close(fd)


def identity(cwd):
    """Read Git's local identity without launching Git or reading configuration."""
    root = Path(cwd).resolve()
    unavailable = {'repo': None, 'worktree': str(root), 'branch': None, 'plan': None}
    try:
        for candidate in (root, *root.parents):
            marker = candidate / '.git'
            if marker.is_dir():
                git = marker
            elif os.path.lexists(marker):
                text = read_metadata(marker)
                if not text.startswith('gitdir: '):
                    raise ValueError('invalid Git marker')
                git = (candidate / text[8:]).resolve()
            else:
                continue
            head = read_metadata(git / 'HEAD')
            branch = head.removeprefix('ref: refs/heads/') if head.startswith('ref: refs/heads/') else None
            common_file = git / 'commondir'
            common = (git / read_metadata(common_file)).resolve() if os.path.lexists(common_file) else git
            return {'repo': str(common.parent), 'worktree': str(candidate), 'branch': branch,
                    'plan': branch.removeprefix('plan/') if branch and branch.startswith('plan/') else None}
    except (OSError, ValueError, RuntimeError):
        unavailable['identityUnavailable'] = True
    return unavailable


def command_label(command):
    """Keep useful argv, never inline program bodies, credentials or URL queries."""
    values, private = [], False
    for value in command[:32]:
        value = str(value)
        sensitive = re.search(r'(?i)(?:token|password|secret|authorization|credential|api[-_]?key)', value)
        if private:
            values.append('<redacted>')
            private = False
        elif re.match(r'^(?:--eval|--print)=|^-[cep].+', value):
            values.append('<inline-program>')
        elif value in ('-c', '-e', '-p', '--eval', '--print'):
            values.append(value)
            private = True
        elif sensitive:
            values.append('<redacted>')
            private = bool(re.fullmatch(r'--?[A-Za-z_-]+', value))
        elif '://' in value:
            values.append('<url>')
        else:
            values.append(value[:256])
    return values


def owner_kind(entry):
    refs = os.environ.get('WS_PUSH_REFS', '')
    if any(line.startswith('refs/tags/') for line in refs.splitlines()):
        return 'tag'
    if entry.get('observationKind') == 'release':
        return 'release'
    if any('release-check.mjs' in str(arg) or str(arg).endswith('/release.sh') for arg in entry['command']):
        return 'release'
    return 'manual'


def record_full_test(root, entry, event, **metrics):
    """One append per event across every worktree using this scheduler root.

    A missing/unwritable log is observable but cannot turn a command red or green.
    Files copied from another machine retain machine/token IDs for deduplication.
    """
    if 'full-test' not in entry['resources']:
        return
    try:
        row = {'schema': 'full-test-day/1', 'event': event, 'token': entry['token'],
               'at': datetime.now(timezone.utc).isoformat(), 'epoch': time.time(),
               'machine': socket.gethostname(), 'pid': entry['pid'],
               'childPid': entry.get('childPid'), 'lane': entry['lane'],
               'kind': owner_kind(entry), 'resources': list(entry['resources']),
               'cwd': entry['cwd'], 'command': command_label(entry['command']),
               **identity(entry['cwd']), **metrics}
        data = (json.dumps(row, separators=(',', ':')) + '\n').encode()
        path = root / 'full-test-day.log'
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
                raise ValueError('unsafe full-test observation file')
            if os.write(fd, data) != len(data):
                raise OSError('short observation append')
        finally:
            os.close(fd)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print('heavy-lane: full-test observation unavailable: ' + str(error), file=sys.stderr)


def holder(resource, entry):
    pid = entry.get('pid', 'unavailable')
    command = entry.get('command')
    started = entry.get('startedAt', entry.get('queuedAt'))
    if command is None and isinstance(pid, int):
        try:
            command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
        except subprocess.CalledProcessError:
            pass
    if isinstance(started, (int, float)):
        started = datetime.fromtimestamp(started, timezone.utc).isoformat()
    age = entry.get('startedAt', entry.get('queuedAt'))
    age = '%.1fs' % max(0, time.time() - age) if isinstance(age, (int, float)) else 'unavailable'
    return 'slot=%s pid=%s lane=%s age=%s command=%s start=%s' % (resource, pid, entry.get('lane', 'unknown'), age, json.dumps(command), started or 'unavailable')


def read_entry(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def wait_label(seconds):
    return '5 min' if seconds == 5 * 60 else '%gs' % seconds


def reap_dead(root, slot):
    """True (and the lease file removed) when a slot's lease names a runner and child that both exited and its lock is free.

    A SIGKILLed owner never runs its cleanup, so its `.active.json` outlives it; its flock went with it, so the slot is free.
    A lock still held with both pids dead is an orphaned grandchild that inherited the fd: a real holder, kept and named.
    The check and the unlink run under the slot's own lock, so a new owner's lease is never removed."""
    path = root / (slot + '.active.json')
    try:
        with (root / (slot + '.lock')).open('a+') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            entry = read_entry(path)
            pids = [entry.get(key) for key in ('runnerPid', 'childPid') if entry.get(key) is not None]
            if not pids or not all(isinstance(pid, int) and 0 < pid < 2**31 for pid in pids) or any(alive(pid) for pid in pids):
                return False
            path.unlink(missing_ok=True)
            return True
    except OSError:
        return False


def queue_timeout(root, entry):
    slots = set(slot for resource in entry['resources'] for slot in (BUILD_SLOTS if resource == 'build' else (resource,)))
    if 'full-test' in slots:
        slots.update(path.name[:-len('.active.json')] for path in root.glob('full-test-*.active.json'))
    # 2026-11-13: a killed push gate's lease was named as the holder for 2.8 h and hid the real one
    holders = [holder(slot, read_entry(root / (slot + '.active.json'))) for slot in sorted(slots) if not reap_dead(root, slot)]
    queued = read_entry(root / 'queue.json').get('queue', [])
    holders.extend('queue head ' + holder('/'.join(row['resources']), row) for row in queued
                   if row['token'] != entry['token'] and row['ticket'] < entry['ticket']
                   and set(row['resources']).intersection(entry['resources']) and alive(row['pid']))
    wait = entry.get('admissionWaitSeconds', WAIT_SECONDS)
    label = wait_label(wait)
    return TimeoutError('heavy-lane: timed out after ' + label + ' waiting for resources; ' + '; '.join(holders))


# SF74 W1 (Jake, G280 / process audit 2026-10-09): no local full suite (since 2026-10-15 not even the push gate's). Lanes still ran 56 full
# suites in 6 h after the broadcast (lease queue median 134 s), so a lane's full-test / check request is refused here;
# CI (CI / GITHUB_ACTIONS), the gate's own descendants (inherited lease) and an explicit WS_FULL_SUITE=1 pass.
FULL_SUITE_REFUSAL = """heavy-lane: refused: lanes do not run the full suite (SF74 W1). CI runs it on every push; the push gate runs the
tests related to the pushed change. Run the tests of what you touched instead:
    pnpm exec vitest run test/<file>.test.ts …           (named test files)
    pnpm exec vitest related --run src/<changed file> …  (tests that import your changed files)
Override, for the coordinator only: WS_FULL_SUITE=1 <command>."""


def store_reservation():
    """True while a pnpm store prune holds the store (meta scripts/prune-store.sh, GVS G10), else None.

    The prune holds an exclusive flock on this file, and its `pnpm store prune` child inherits it, so the
    reservation lasts exactly as long as anything of the prune runs: no PID to go stale or be reused."""
    path = Path(os.environ.get('WS_STORE_RESERVATION') or Path.home() / '.cache/wildshard/store-maintenance.lock')
    try:
        probe = path.open('rb')
    except OSError:
        return None
    with probe:
        try:
            fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(probe, fcntl.LOCK_UN)
    return None


def full_suite_allowed():
    return bool(os.environ.get('CI') or os.environ.get('GITHUB_ACTIONS')) or os.environ.get('WS_FULL_SUITE') == '1'


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def ancestors():
    rows = subprocess.check_output(['ps', '-Ao', 'pid=,ppid='], text=True)
    parents = {int(p): int(pp) for p, pp in (line.split() for line in rows.splitlines())}
    current, result = os.getpid(), set()
    while current > 1 and current not in result:
        result.add(current)
        current = parents.get(current, 0)
    return result


def inherited(root, resources):
    token = os.environ.get('WS_HEAVY_TOKEN')
    if not token:
        return False
    family = ancestors()
    view = Path(os.environ.get('WS_HEAVY_ROOT', str(root)))
    return all(any(owns(view, slot, token, family) for slot in BUILD_SLOTS) if resource == 'build'
               else owns(view, resource, token, family) for resource in resources)


def conflicts(a, b):
    common = set(a['resources']).intersection(b['resources'])
    if common == {'full-test'} and a.get('checkout') and b.get('checkout') and a['checkout'] != b['checkout']:
        return False
    return bool(common)


def owns(root, resource, token, family):
    try:
        lease = json.loads((root / (resource + '.active.json')).read_text())
    except (OSError, ValueError):
        return False
    return lease.get('token') == token and bool(family.intersection([lease.get('runnerPid'), lease.get('childPid')]))


@contextlib.contextmanager
def scheduler(root, deadline=None, wait_seconds=WAIT_SECONDS):
    if deadline is None:
        deadline = time.monotonic() + WAIT_SECONDS
    with (root / 'scheduler.lock').open('a+') as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    lock.seek(0)
                    try:
                        owner = json.load(lock)
                    except ValueError:
                        owner = {}
                    raise TimeoutError('heavy-lane: timed out after ' + wait_label(wait_seconds) + ' waiting for scheduler; ' + holder('scheduler', owner))
                time.sleep(min(.1, remaining))
        lock.seek(0)
        lock.truncate()
        json.dump({'pid': os.getpid(), 'command': sys.argv, 'startedAt': time.time()}, lock)
        lock.flush()
        path = root / 'queue.json'
        try:
            state = json.loads(path.read_text())
        except FileNotFoundError:
            state = {'next': 0, 'queue': []}
        state['queue'] = [entry for entry in state['queue'] if alive(entry['pid'])]
        yield state
        temporary = root / ('queue.' + str(os.getpid()) + '.tmp')
        temporary.write_text(json.dumps(state))
        temporary.replace(path)


def write_active(root, resource, entry):
    path = root / (resource + '.active.json')
    temporary = root / (resource + '.' + str(os.getpid()) + '.tmp')
    temporary.write_text(json.dumps(entry))
    temporary.replace(path)


def write_compat(root, entry):
    """Older guards know only build.active.json. Give each owner its own truthful marker view."""
    view = root / 'leases' / entry['token']
    view.mkdir(parents=True, exist_ok=True)
    entry['compatRoot'] = str(view)
    for resource in entry['resources']:
        write_active(view, resource, entry)
    return view


def clear_compat(root, entry):
    view = root / 'leases' / entry['token']
    for resource in entry['resources']:
        path = view / (resource + '.active.json')
        if path.exists() and json.loads(path.read_text()).get('token') == entry['token']:
            path.unlink()
    for directory in (view, view.parent):
        try:
            directory.rmdir()
        except OSError:
            pass  # Another lease or an older nested status command may still own entries.


def remove_ticket(root, token, deadline=None):
    with scheduler(root, deadline) as state:
        state['queue'] = [entry for entry in state['queue'] if entry['token'] != token]


def acquire(root, entry, deadline=None):
    with scheduler(root, deadline, entry.get('admissionWaitSeconds', WAIT_SECONDS)) as state:
        ordered = sorted(state['queue'], key=lambda row: (row['priority'], row['ticket']))
        # FIFO per resource. An older request for the independent lane does not block us.
        for previous in ordered:
            if previous['token'] == entry['token']:
                break
            if conflicts(previous, entry):
                return None
        held, leases = [], []
        for resource in sorted(entry['resources']):
            if resource == 'full-test' and entry.get('checkout'):
                barrier = (root / 'full-test.lock').open('a+')
                try:
                    fcntl.flock(barrier, fcntl.LOCK_SH | fcntl.LOCK_NB)
                except BlockingIOError:
                    barrier.close()
                    for fd in held:
                        fd.close()
                    return None
                held.append(barrier)
                resource = 'full-test-' + hashlib.sha256(entry['checkout'].encode()).hexdigest()[:16]
            slots = BUILD_SLOTS if resource == 'build' else (resource,)
            selected = None
            for slot in slots:
                lock = (root / (slot + '.lock')).open('a+')
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    lock.close()
                    continue
                selected = (slot, lock)
                break
            if selected is None:
                for fd in held:
                    fd.close()
                return None
            leases.append(selected[0]); held.append(selected[1])
        entry['leases'] = leases
        for resource in leases:
            write_active(root, resource, entry)
        # GVS G10 (J230): a store prune reserves the store first, then scans for live leases; this lease is
        # visible before it checks, so one of the two always sees the other. While a prune runs, stay queued.
        if store_reservation() is not None:
            for resource in leases:
                (root / (resource + '.active.json')).unlink(missing_ok=True)
            for fd in held:
                fd.close()
            entry.pop('leases', None)
            return None
        state['queue'] = [row for row in state['queue'] if row['token'] != entry['token']]
        return held


def load_average():
    try:
        return os.getloadavg()
    except OSError:
        return None


def inherited_fds():
    """Forward the lock descriptors that an exec would preserve to an observed nested command."""
    result = []
    for name in os.listdir('/dev/fd'):
        if name.isdigit() and int(name) > 2:
            try:
                if os.get_inheritable(int(name)):
                    result.append(int(name))
            except OSError:
                pass
    return tuple(result)


def record_build(root, queued, started, load, code, inherited_lease=False):
    """Continuous report-only log. Never change the command verdict."""
    try:
        ended = time.time()
        with scheduler(root):
            path = root / 'build-day.log'
            if not path.exists():
                path.write_text(json.dumps({'schema': 'build-day/1', 'startedAt': started}) + '\n')
            with path.open() as stream:
                header = json.loads(stream.readline())
            if not isinstance(header, dict) or header.get('schema') != 'build-day/1':
                raise ValueError('invalid build observation header')
            with path.open('a') as stream:
                stream.write(json.dumps({'startedAt': started, 'endedAt': ended,
                    'queueSeconds': started - queued, 'buildSeconds': ended - started,
                    'loadStart': load, 'loadEnd': load_average(), 'exitCode': code,
                    'inherited': inherited_lease, 'cwd': os.getcwd()}) + '\n')
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('heavy-lane: build observation unavailable: ' + str(error), file=sys.stderr)


def terminate(child):
    if child is None:
        return
    # start_new_session gives this command its own process group; never match unrelated commands by name.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        child.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def status(root):
    with scheduler(root) as state:
        active = []
        scoped = tuple(path.name[:-len('.active.json')] for path in root.glob('full-test-*.active.json'))
        for resource in (*LANES, *scoped):
            with (root / (resource + '.lock')).open('a+') as fd:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    try:
                        active.append({'resource': resource, **json.loads((root / (resource + '.active.json')).read_text())})
                    except (OSError, ValueError):
                        active.append({'resource': resource, 'state': 'held'})
        return {'active': active, 'queue': sorted(state['queue'], key=lambda row: (row['priority'], row['ticket']))}


def mirror_first(command, wrapper):
    """Hoist explicit mirror admission; self-managed check/serve tools own inner leases."""
    if not command:
        return None
    interpreter = Path(command[0]).name
    script_at = 1 if interpreter in ('node', 'nodejs', 'bash', 'sh', 'python3', 'python') else 0
    if len(command) <= script_at:
        return None
    script = Path(command[script_at]).name
    if script == 'build-mirror.mjs' and (script_at == 0 or interpreter in ('node', 'nodejs')):
        action = command[script_at + 1] if len(command) > script_at + 1 else None
        if action == 'run' and '--' in command:
            split = command.index('--')
            return [*command[:split + 1], *wrapper, *command[split + 1:]]
        if action == 'sync':
            return command
    if script == 'serve-build.sh' and '--inside' not in command:
        return command
    return None


def launch_command(kind, command, env):
    """G668: foreground gen/build callers keep normal QoS; background work yields."""
    if kind == 'full-test' and env.get('WS_PUSH_GATE_PROFILE') == 'full-v1':
        # J192: a real queued push owns the complete CPU profile, not a focused lane.
        return command
    launch = command if 'build' in RESOURCES[kind] else ['nice', '-n', '10', *command]
    normal = 'build' in RESOURCES[kind] and (env.get('WS_HEAVY_BACKGROUND') != '1' or env.get('WS_HEAVY_RULER') == '1')
    if not normal and shutil.which('taskpolicy'):
        launch = ['taskpolicy', '-c', 'utility', *launch]
    return launch


def main():
    from quiet_logs import requested, run_logged
    args_before_command = sys.argv[1:sys.argv.index('--')] if '--' in sys.argv else sys.argv[1:]
    if requested(args_before_command):
        return run_logged('heavy-lane', [sys.executable, __file__,
                          *[arg for arg in args_before_command if arg != '--quiet'],
                          *([] if '--' not in sys.argv else sys.argv[sys.argv.index('--'):])])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=[*RESOURCES, 'status'])
    parser.add_argument('--quiet', action='store_true', help='log output; print only a verdict or failing tail')
    parser.add_argument('--background', action='store_true', help='yield unattended generation/builds with utility QoS')
    parser.add_argument('--checkout-scope', action='store_true', help='one coordinated push per checkout, with shared CPU admission')
    parser.add_argument('--observation-kind', choices=['release'], help='report-only caller provenance; never affects admission or checks')
    parser.add_argument('--admission-wait-seconds', type=float, default=None,
                        help='FIFO resource wait (default 300), separate from command time; at most 100 minutes')
    parser.add_argument('--max', type=float, default=30, help='owned command timeout in minutes; queue time is separate')
    argv = sys.argv[1:]
    separator = argv.index('--') if '--' in argv else len(argv)
    command = argv[separator + 1:]
    args = parser.parse_args(argv[:separator])
    admission_wait_seconds = WAIT_SECONDS if args.admission_wait_seconds is None else args.admission_wait_seconds
    if not math.isfinite(admission_wait_seconds) or not 0 < admission_wait_seconds <= 6000:
        parser.error('admission wait must be positive and at most 6000 seconds')
    if args.admission_wait_seconds is not None and args.kind != 'full-test':
        parser.error('explicit admission waiting is only supported for full-test gates')
    if args.checkout_scope and args.kind != 'full-test':
        parser.error('checkout scope is only valid for a coordinated full-test gate')
    if args.background:
        os.environ['WS_HEAVY_BACKGROUND'] = '1'
    root = Path(os.environ.get('WS_HEAVY_SCHEDULER_ROOT', os.environ.get('WS_HEAVY_ROOT', str(Path.home() / '.wildshard-heavy-lanes')))).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.kind == 'status':
        print(json.dumps(status(root), indent=2))
        return 0
    if not command or not math.isfinite(args.max) or args.max <= 0:
        parser.error('give a command after -- and a positive --max')
    resources = RESOURCES[args.kind]
    owns_lane = inherited(root, resources)
    ordered = mirror_first(command, [sys.executable, str(Path(__file__).resolve()), *argv[:separator], '--'])
    if ordered is not None:
        if os.environ.get('WS_HEAVY_TOKEN'):
            parser.error('mirror admission must precede the outer heavy lease; move this command outside that lease')
        if args.kind in ('full-test', 'check') and not full_suite_allowed():
            print(FULL_SUITE_REFUSAL, file=sys.stderr)
            return 2
        print('heavy-lane: mirror admission precedes build lease', file=sys.stderr, flush=True)
        code = subprocess.call(ordered)
        return code if code >= 0 else 128 - code
    if owns_lane:
        env = dict(os.environ)
        if args.kind == 'build':
            # This is the actual app build inside an existing gate/build lease, not another lease.
            started, load, code = time.time(), load_average(), 127
            try:
                code = subprocess.call(launch_command(args.kind, command, env), env=env, pass_fds=inherited_fds())
            finally:
                record_build(root, started, started, load, code, inherited_lease=True)
            return code if code >= 0 else 128 - code
        os.execvpe(command[0], command, env)
    if args.kind in ('full-test', 'check') and not full_suite_allowed():
        print(FULL_SUITE_REFUSAL, file=sys.stderr)
        return 2
    if os.environ.get('WS_HEAVY_TOKEN'):
        parser.error('cannot upgrade an inherited lane; release it before requesting different resources')
    token = uuid.uuid4().hex
    entry = {'token': token, 'pid': os.getpid(), 'runnerPid': os.getpid(), 'childPid': None,
             'admissionWaitSeconds': admission_wait_seconds,
             'resources': resources, 'priority': 1,
             'observationKind': args.observation_kind,
             'cwd': os.getcwd(), 'command': command, 'queuedAt': time.time(),
             'lane': os.environ.get('WS_LANE_NAME') or os.environ.get('SERVE_OWNER') or os.environ.get('HERDR_PANE_ID') or os.environ.get('CLAUDE_CODE_SESSION_ID') or os.environ.get('CODEX_SESSION_ID') or 'unknown'}
    if args.checkout_scope:
        if os.environ.get('WS_CPU_ADMISSION') != '1':
            parser.error('checkout-scoped pushes require CPU admission')
        entry['checkout'] = str(Path.cwd().resolve())
    held, child, started, load, code = None, None, None, None, 130
    queued_mono, acquired_mono = time.monotonic(), None
    cpu_before = process_resource.getrusage(process_resource.RUSAGE_CHILDREN)
    record_full_test(root, entry, 'request')
    deadline = time.monotonic() + admission_wait_seconds
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        with scheduler(root, deadline, admission_wait_seconds) as state:
            entry['ticket'] = state['next']
            state['next'] += 1
            state['queue'].append(entry)
        print('heavy-lane: queued ' + args.kind + ' ticket ' + str(entry['ticket']), file=sys.stderr, flush=True)
        while held is None:
            if time.monotonic() >= deadline:
                raise queue_timeout(root, entry)
            held = acquire(root, entry, deadline)
            if held is None:
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        started = time.time()
        acquired_mono = time.monotonic()
        entry['startedAt'] = started
        load = load_average()
        record_full_test(root, entry, 'acquire', queueSeconds=acquired_mono - queued_mono, loadStart=load)
        print('heavy-lane: acquired ' + args.kind + ' after %.2fs queue' % (started - entry['queuedAt']), file=sys.stderr, flush=True)
        compat = write_compat(root, entry)
        env = {**os.environ, 'WS_HEAVY_TOKEN': token, 'WS_HEAVY_ROOT': str(compat),
               'WS_HEAVY_SCHEDULER_ROOT': str(root)}
        # Nested wrappers inherit their owner's QoS; CI has no taskpolicy.
        launch = launch_command(args.kind, command, env)
        child = subprocess.Popen(launch, env=env, start_new_session=True,
                                 pass_fds=tuple(fd.fileno() for fd in held))
        entry['childPid'] = child.pid
        with scheduler(root):
            write_compat(root, entry)
            for resource in entry['leases']:
                write_active(root, resource, entry)
        try:
            code = child.wait(timeout=args.max * 60)
        except subprocess.TimeoutExpired:
            print('heavy-lane: owned command timed out', file=sys.stderr)
            terminate(child)
            code = 124
        print('heavy-lane: finished ' + args.kind + ' in %.2fs' % (time.time() - started), file=sys.stderr, flush=True)
        return code if code >= 0 else 128 - code
    except KeyboardInterrupt:
        code = 130
        terminate(child)
        return 130
    except TimeoutError as error:
        code = 124
        print(str(error), file=sys.stderr, flush=True)
        return 124
    except Exception:
        code = 1
        raise
    finally:
        try:
            # A failed admission never starts a second wait during cleanup.
            remove_ticket(root, token, time.monotonic() if held is None else None)
        except TimeoutError as error:
            print('heavy-lane: ticket cleanup deferred until process exit; ' + str(error), file=sys.stderr)
        if held is not None:
            with scheduler(root):
                for resource in entry['leases']:
                    path = root / (resource + '.active.json')
                    if path.exists() and json.loads(path.read_text()).get('token') == token:
                        path.unlink()
                clear_compat(root, entry)
            for fd in held:
                fd.close()
            usage = process_resource.getrusage(process_resource.RUSAGE_CHILDREN)
            record_full_test(root, entry, 'release', queueSeconds=acquired_mono - queued_mono,
                heldSeconds=time.monotonic() - acquired_mono, loadEnd=load_average(),
                exitCode=code if code >= 0 else 128 - code,
                userSeconds=max(0, usage.ru_utime - cpu_before.ru_utime),
                systemSeconds=max(0, usage.ru_stime - cpu_before.ru_stime))
        else:
            record_full_test(root, entry, 'not-acquired', queueSeconds=time.monotonic() - queued_mono,
                exitCode=code, loadEnd=load_average())
        if args.kind == 'build' and started is not None:
            record_build(root, entry['queuedAt'], started, load, code)


if __name__ == '__main__':
    sys.exit(main())
