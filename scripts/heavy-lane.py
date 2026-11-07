#!/usr/bin/env python3
"""Machine-wide full-test / app-build lanes. flock lifetime follows the owned child, not a PID file."""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import json
import math
import os
from pathlib import Path
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


def queue_timeout(root, entry):
    slots = set(slot for resource in entry['resources'] for slot in (BUILD_SLOTS if resource == 'build' else (resource,)))
    holders = [holder(slot, read_entry(root / (slot + '.active.json'))) for slot in sorted(slots)]
    queued = read_entry(root / 'queue.json').get('queue', [])
    holders.extend('queue head ' + holder('/'.join(row['resources']), row) for row in queued
                   if row['token'] != entry['token'] and row['ticket'] < entry['ticket']
                   and set(row['resources']).intersection(entry['resources']) and alive(row['pid']))
    return TimeoutError('heavy-lane: timed out after 5 min waiting for resources; ' + '; '.join(holders))


# SF74 W1 (Jake, G280 / process audit 2026-10-09): no local full suite (since 2026-10-15 not even the push gate's). Lanes still ran 56 full
# suites in 6 h after the broadcast (lease queue median 134 s), so a lane's full-test / check request is refused here;
# CI (CI / GITHUB_ACTIONS), the gate's own descendants (inherited lease) and an explicit WS_FULL_SUITE=1 pass.
FULL_SUITE_REFUSAL = """heavy-lane: refused: lanes do not run the full suite (SF74 W1). CI runs it on every push; the push gate runs the
tests related to the pushed change. Run the tests of what you touched instead:
    pnpm exec vitest run test/<file>.test.ts …           (named test files)
    pnpm exec vitest related --run src/<changed file> …  (tests that import your changed files)
Override, for the coordinator only: WS_FULL_SUITE=1 <command>."""


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
    return all(any(owns(root, slot, token, family) for slot in BUILD_SLOTS) if resource == 'build'
               else owns(root, resource, token, family) for resource in resources)


def owns(root, resource, token, family):
    try:
        lease = json.loads((root / (resource + '.active.json')).read_text())
    except (OSError, ValueError):
        return False
    return lease.get('token') == token and bool(family.intersection([lease.get('runnerPid'), lease.get('childPid')]))


@contextlib.contextmanager
def scheduler(root, deadline=None):
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
                    raise TimeoutError('heavy-lane: timed out after 5 min waiting for scheduler; ' + holder('scheduler', owner))
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
    with scheduler(root, deadline) as state:
        ordered = sorted(state['queue'], key=lambda row: (row['priority'], row['ticket']))
        # FIFO per resource. An older request for the independent lane does not block us.
        for previous in ordered:
            if previous['token'] == entry['token']:
                break
            if set(previous['resources']).intersection(entry['resources']):
                return None
        held, leases = [], []
        for resource in sorted(entry['resources']):
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
        state['queue'] = [row for row in state['queue'] if row['token'] != entry['token']]
        entry['leases'] = leases
        for resource in leases:
            write_active(root, resource, entry)
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
        for resource in LANES:
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
    parser.add_argument('--max', type=float, default=30, help='owned command timeout in minutes; queue time is separate')
    argv = sys.argv[1:]
    separator = argv.index('--') if '--' in argv else len(argv)
    command = argv[separator + 1:]
    args = parser.parse_args(argv[:separator])
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
             'resources': resources, 'priority': 1,
             'cwd': os.getcwd(), 'command': command, 'queuedAt': time.time(),
             'lane': os.environ.get('SERVE_OWNER') or os.environ.get('HERDR_PANE_ID') or os.environ.get('CLAUDE_CODE_SESSION_ID') or os.environ.get('CODEX_SESSION_ID') or 'unknown'}
    held, child, started, load, code = None, None, None, None, 130
    deadline = time.monotonic() + WAIT_SECONDS
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        with scheduler(root, deadline) as state:
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
        entry['startedAt'] = started
        load = load_average()
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
        terminate(child)
        return 130
    except TimeoutError as error:
        print(str(error), file=sys.stderr, flush=True)
        return 124
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
        if args.kind == 'build' and started is not None:
            record_build(root, entry['queuedAt'], started, load, code)


if __name__ == '__main__':
    sys.exit(main())
