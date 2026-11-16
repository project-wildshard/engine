#!/usr/bin/env python3
"""Weighted CPU admission using the existing machine scheduler, never a second lock domain."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import stat
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('heavy_lane', Path(__file__).with_name('heavy-lane.py'))
lane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lane)


# TEST-SPEED FL30: an orphaned run (owner reparented to pid 1) whose whole process tree made no CPU progress for
# this long has lost its lease. A busy one never does. The proof shortens it; real runs keep 60 s.
ORPHAN_IDLE_SECONDS = float(os.environ.get('WS_CPU_ORPHAN_IDLE_SECONDS') or 60)
SAMPLE_SECONDS = min(2.0, ORPHAN_IDLE_SECONDS / 4)
_sampled = [float('-inf')]


def _cpu_seconds(text):
    """ps time: [[dd-]hh:]mm:ss[.cc] on Linux and macOS alike."""
    days, _, clock = text.rpartition('-')
    total = 0.0
    for part in clock.split(':'):
        total = total * 60 + float(part)
    return total + (int(days) * 86400 if days else 0)


def _proc_table():
    """Linux: /proc gives CPU time in clock ticks; ps there rounds it to whole seconds (J206 review)."""
    tick, table = os.sysconf('SC_CLK_TCK'), {}
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        try:
            fields = Path('/proc', name, 'stat').read_text().rpartition(')')[2].split()
            table[int(name)] = (int(fields[1]), (int(fields[11]) + int(fields[12])) / tick)
        except (OSError, ValueError, IndexError):
            continue
    return table or None


def _process_table():
    """pid -> (ppid, cpu seconds) for every process, or None when it can't be listed (then nothing counts as idle)."""
    if os.path.exists('/proc/self/stat'):
        return _proc_table()
    try:
        listed = subprocess.run(['ps', '-Ao', 'pid=,ppid=,time='], capture_output=True, text=True, timeout=5, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    table = {}
    for line in listed.splitlines():
        try:
            pid, ppid, cpu = line.split()
            table[int(pid)] = (int(ppid), _cpu_seconds(cpu))
        except ValueError:
            continue
    return table or None


def _tree_cpu(table, children, root):
    total, stack, seen = 0.0, [root], set()
    while stack:
        pid = stack.pop()
        if pid in seen or pid not in table:
            continue
        seen.add(pid)
        total += table[pid][1]
        stack.extend(children.get(pid, ()))
    return total


# A reason that ends the whole run, so its process may be stopped; any other reason drops only the row.
RUN = 'run: '


def _stale(row, table, children, now):
    """Why a row no longer holds its slots, or None. Rows from older clients lack holder/owner and keep the old rule."""
    if not lane.alive(row['pid']):
        return 'its process is gone'
    if type(row.get('holder')) is int and not lane.alive(row['holder']):
        # Only this grant: one broker serves a whole run, and it may not have read the EOF yet (J206 review).
        return 'its holder ' + str(row['holder']) + ' is gone'
    if type(row.get('owner')) is int and not lane.alive(row['owner']):
        return RUN + 'its owner ' + str(row['owner']) + ' is gone'
    if isinstance(row.get('repo'), str) and not os.path.isdir(row['repo']):
        return RUN + 'its checkout ' + row['repo'] + ' is gone'
    owner = row.get('owner')
    if table is None or type(owner) is not int or owner not in table:
        return None
    if table[owner][0] != 1:
        row.pop('idle', None)
        return None
    cpu = _tree_cpu(table, children, owner)
    sample = row.get('idle')
    if not isinstance(sample, dict) or sample.get('cpu') != cpu:
        row['idle'] = {'cpu': cpu, 'at': now}
        return None
    if now - sample.get('at', now) >= ORPHAN_IDLE_SECONDS:
        return RUN + 'its owner ' + str(owner) + ' is orphaned and idle ' + str(round(now - sample['at'])) + ' s'
    return None


def _stop(row, why, kept):
    """Signal a reclaimed row's process for a run-level reason only, when none of its grants survive, and only while
    it is still a CPU admission process (pid reuse)."""
    print('cpu admission: reclaimed ' + str(row.get('slots')) + ' slot(s) of pid ' + str(row['pid']) + ': ' + why.removeprefix(RUN), file=sys.stderr)
    if not why.startswith(RUN) or row['pid'] in kept or not lane.alive(row['pid']) or row['pid'] == os.getpid():
        return
    try:
        command = subprocess.run(['ps', '-o', 'command=', '-p', str(row['pid'])], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return
    if 'cpu-broker.py' in command or 'cpu-admission.py' in command:
        try:
            os.kill(row['pid'], signal.SIGTERM)
        except OSError:
            pass


def _prune(entry, pending, active):
    """FL30: drop rows whose holder, owner or checkout is gone, or whose orphaned run is idle; stop their process."""
    table, children, now = None, {}, time.time()
    if time.monotonic() - _sampled[0] >= SAMPLE_SECONDS and any(row['token'] != entry['token'] for row in active):
        _sampled[0] = time.monotonic()
        table = _process_table()
        for pid, (ppid, _cpu) in (table or {}).items():
            children.setdefault(ppid, []).append(pid)
    reclaimed = []
    for rows in (pending, active):
        kept = []
        for row in rows:
            why = None if row['token'] == entry['token'] else _stale(row, table, children, now)
            if why is None:
                kept.append(row)
            else:
                reclaimed.append((row, why))
        rows[:] = kept
    return reclaimed


def acquire_cpu(root, entry, capacity, deadline):
    """One policy for command owners and the run-owned socket broker."""
    with lane.scheduler(root, deadline) as state:
        known = state.setdefault('cpuCapacity', capacity)
        if known != capacity:
            raise RuntimeError('CPU admission policy differs from the active scheduler')
        pending = state.setdefault('cpuQueue', [])
        active = state.setdefault('cpuActive', [])
        reclaimed = _prune(entry, pending, active)
        kept = {row['pid'] for row in pending + active}
        for row, why in reclaimed:
            _stop(row, why, kept)
        if not any(row['token'] == entry['token'] for row in pending):
            entry['ticket'] = state.setdefault('cpuNext', 0)
            state['cpuNext'] += 1
            pending.append(entry)
        head = min(pending, key=lambda row: row['ticket'])
        if head['token'] != entry['token'] or sum(row['slots'] for row in active) + entry['slots'] > capacity:
            return False
        pending[:] = [row for row in pending if row['token'] != entry['token']]
        active.append(entry)
    # GVS G10 (J230): the grant is saved, so a store prune's scan sees it; only now check the prune's
    # reservation. One of the two always sees the other. While a prune runs, give the grant back and wait.
    if lane.store_reservation() is not None:
        release_cpu(root, entry['token'])
        return False
    return True


def release_cpu(root, token):
    with lane.scheduler(root) as state:
        for key in ('cpuQueue', 'cpuActive'):
            state[key] = [row for row in state.get(key, []) if row['token'] != token and lane.alive(row['pid'])]



PARENT_CONTEXT = 'WS_CPU_PARENT_GRANT'
PARENT_REFUSAL = 'Inherited CPU grant is unavailable or is not an actual ancestor grant'


def cpu_root(env=None):
    env = os.environ if env is None else env
    return Path(env.get('WS_CPU_ROOT', env.get('WS_HEAVY_SCHEDULER_ROOT', str(Path.home() / '.wildshard-heavy-lanes')))).resolve()


def parent_cpu_context(proof, env=None, owner_pid=None):
    token = proof.get('lease')
    if not isinstance(token, str) or not 0 < len(token) <= 128:
        raise RuntimeError(PARENT_REFUSAL)
    return json.dumps({'version': 1, 'root': str(cpu_root(env)), 'lease': token,
                       'ownerPid': os.getpid() if owner_pid is None else owner_pid})


def _regular_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022 or not 0 < info.st_size <= 1024 * 1024:
            raise ValueError(PARENT_REFUSAL)
        with os.fdopen(fd, 'rb', closefd=False) as reader:
            data = reader.read(1024 * 1024 + 1)
        if len(data) != info.st_size:
            raise ValueError(PARENT_REFUSAL)
        return json.loads(data)
    finally:
        os.close(fd)


def ancestor_cpu_budget(env=None, requester=None):
    """Read one canonical ledger; a context alone never grants a budget.

    A deliberately different private scheduler has its own domain. In the
    same domain, malformed, expired or non-ancestor evidence fails closed.
    No exception includes the capability or its raw input.
    """
    env = os.environ if env is None else env
    raw = env.get(PARENT_CONTEXT)
    if raw is None:
        return None
    try:
        if not isinstance(raw, str) or not 0 < len(raw) <= 8192:
            raise ValueError()
        context = json.loads(raw)
        if not isinstance(context, dict) or set(context) != {'version', 'root', 'lease', 'ownerPid'} or type(context['version']) is not int or context['version'] != 1:
            raise ValueError()
        owner = context['ownerPid']
        if not isinstance(context['root'], str) or not isinstance(context['lease'], str) or not 0 < len(context['lease']) <= 128 or type(owner) is not int or owner <= 1:
            raise ValueError()
        root = cpu_root(env)
        if context['root'] != str(root):
            return None
        state = _regular_json(root / 'queue.json')
        if not isinstance(state, dict) or type(state.get('cpuCapacity')) is not int or state['cpuCapacity'] < 1 or not isinstance(state.get('cpuActive'), list):
            raise ValueError()
        matches = [row for row in state['cpuActive'] if isinstance(row, dict) and row.get('token') == context['lease']]
        if len(matches) != 1:
            raise ValueError()
        grant = matches[0]
        if grant.get('holder') != owner or type(grant.get('pid')) is not int or grant['pid'] <= 1 or type(grant.get('slots')) is not int or not 1 <= grant['slots'] <= state['cpuCapacity']:
            raise ValueError()
        output = subprocess.run(['ps', '-Ao', 'pid=,ppid=,uid='], capture_output=True, text=True, timeout=3, check=True).stdout
        if len(output) > 4 * 1024 * 1024:
            raise ValueError()
        inventory = {}
        for line in output.splitlines():
            parts = line.split()
            if len(parts) == 3 and all(part.isdigit() for part in parts):
                pid, parent, uid = map(int, parts)
                inventory[pid] = (parent, uid)
        uid = os.getuid()
        if inventory.get(grant['pid'], (None, None))[1] != uid or inventory.get(owner, (None, None))[1] != uid:
            raise ValueError()
        pid = os.getpid() if requester is None else requester
        # requester starts at its parent: a sibling holding the capability
        # cannot borrow; Python inspection is itself a child of the Node owner.
        cursor, seen = inventory.get(pid, (0, 0))[0], set()
        while cursor > 1 and cursor not in seen:
            if cursor == owner:
                return {'slots': grant['slots'], 'capacity': state['cpuCapacity'], 'parentPid': owner}
            seen.add(cursor)
            cursor = inventory.get(cursor, (0, 0))[0]
        raise ValueError()
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        raise RuntimeError(PARENT_REFUSAL) from None


def borrow_parent(weight):
    """A pipe watches an existing ancestor grant; it never enters the FIFO."""
    budget = ancestor_cpu_budget(requester=os.getppid())
    if budget is None:
        raise RuntimeError(PARENT_REFUSAL)
    slots = budget['capacity'] if weight == 'all' else int(weight)
    if not 1 <= slots <= budget['slots']:
        raise RuntimeError('Inherited CPU budget cannot satisfy this workload')
    context = json.loads(os.environ[PARENT_CONTEXT])
    print(json.dumps({'lease': context['lease'], 'slots': budget['slots'],
                      'capacity': budget['capacity'], 'queueSeconds': 0}), flush=True)
    while True:
        ready, _, _ = select.select([sys.stdin], [], [], .2)
        if ready and not os.read(sys.stdin.fileno(), 1):
            return 0
        if ancestor_cpu_budget(requester=os.getppid()) != budget:
            raise RuntimeError(PARENT_REFUSAL)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['hold', 'run', 'inspect-parent', 'borrow'])
    parser.add_argument('--slots', default='1')
    parser.add_argument('--repo', default=os.getcwd())
    parser.add_argument('--capacity', type=int)
    argv = sys.argv[1:]
    split = argv.index('--') if '--' in argv else len(argv)
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if args.mode == 'inspect-parent':
        try:
            print(json.dumps(ancestor_cpu_budget(requester=os.getppid())))
            return 0
        except RuntimeError:
            print(PARENT_REFUSAL, file=sys.stderr)
            return 2
    if args.mode == 'borrow':
        def cancelled(_signal, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, cancelled)
        signal.signal(signal.SIGINT, cancelled)
        try:
            return borrow_parent(args.slots)
        except (RuntimeError, ValueError):
            print(PARENT_REFUSAL, file=sys.stderr)
            return 2
        except KeyboardInterrupt:
            return 130
    try:
        ancestor = ancestor_cpu_budget() if args.mode == 'run' else None
    except RuntimeError:
        print(PARENT_REFUSAL, file=sys.stderr)
        return 2
    maximum = max(1, (os.cpu_count() or 1) - 2)
    capacity = args.capacity if args.capacity is not None else ancestor['capacity'] if ancestor is not None else maximum
    if not 1 <= capacity <= maximum:
        parser.error('capacity may only lower the machine budget')
    slots = capacity if args.slots == 'all' else int(args.slots)
    if not 1 <= slots <= capacity or args.mode == 'run' and not command:
        parser.error('give a valid weight and a command for run')
    root = Path(os.environ.get('WS_CPU_ROOT', os.environ.get('WS_HEAVY_SCHEDULER_ROOT', str(Path.home() / '.wildshard-heavy-lanes')))).resolve()
    root.mkdir(parents=True, exist_ok=True)
    owner = os.getppid()
    # The process that started this one holds the grant (its pipe) and owns the run.
    entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': owner, 'owner': owner, 'repo': str(Path(args.repo).resolve()), 'slots': slots}
    began = time.monotonic()
    deadline = began + 300
    child = None

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if ancestor is not None:
            if capacity != ancestor['capacity'] or slots > ancestor['slots']:
                raise RuntimeError('Inherited CPU budget cannot satisfy this workload')
            # Nested command wrappers spend the verified held budget, never
            # wait for another FIFO grant while their parent holds one.
            child = subprocess.Popen(command, env={**os.environ, 'WS_CPU_SLOTS': str(ancestor['slots'])}, start_new_session=True)
            while True:
                try:
                    code = child.wait(timeout=.2)
                    return code if code >= 0 else 128 - code
                except subprocess.TimeoutExpired:
                    if ancestor_cpu_budget() != ancestor:
                        raise RuntimeError(PARENT_REFUSAL)
        while True:
            if os.getppid() != owner:
                return 130
            if acquire_cpu(root, entry, capacity, deadline):
                break
            if time.monotonic() >= deadline:
                raise TimeoutError('CPU admission exceeded five minutes waiting for owned work')
            time.sleep(.01)
        if args.mode == 'hold':
            print(json.dumps({'lease': entry['token'], 'slots': slots, 'capacity': capacity, 'queueSeconds': time.monotonic() - began}), flush=True)
            # The actual worker owns this pipe. EOF releases even after a kill.
            sys.stdin.buffer.read()
            return 0
        env = {**os.environ, 'WS_CPU_SLOTS': str(slots),
               PARENT_CONTEXT: parent_cpu_context({'lease': entry['token']}, owner_pid=owner)}
        child = subprocess.Popen(command, env=env, start_new_session=True)
        code = child.wait()
        return code if code >= 0 else 128 - code
    except KeyboardInterrupt:
        lane.terminate(child)
        return 130
    except (TimeoutError, RuntimeError) as error:
        lane.terminate(child)
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if ancestor is None:
            release_cpu(root, entry['token'])


if __name__ == '__main__':
    raise SystemExit(main())
