#!/usr/bin/env python3
"""One kernel-bound command group, published before it may execute work."""
import errno
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

SCHEMA = 'cpu-owned-command/1'
STOP_GRACE_SECONDS = 3
_backend = None


def identity_backend():
    global _backend
    if _backend is None:
        name = '_wildshard_cpu_owned_census'
        if name not in sys.modules:
            spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name('cpu-census.py'))
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            try:
                spec.loader.exec_module(module)
            except BaseException:
                del sys.modules[name]
                raise
        _backend = sys.modules[name].process_backend()
    return _backend


def process_record(pid):
    """None means proven absent/stopped; unreadable identity refuses instead."""
    backend = identity_backend()
    try:
        before = backend.process(pid)
        group = os.getpgid(pid)
        after = backend.process(pid)
    except OSError as error:
        if error.errno in (errno.ESRCH, errno.ENOENT):
            return None
        raise RuntimeError('Owned CPU process identity is unavailable') from None
    if before.identity != after.identity:
        raise RuntimeError('Owned CPU process identity changed while reading')
    if after.zombie:
        return None
    return {'pid': pid, 'identity': after.identity, 'uid': after.uid,
            'group': group, 'parent': after.parent}


def valid_record(record):
    return (isinstance(record, dict) and set(record) == {'pid', 'identity', 'uid', 'group', 'parent'}
            and type(record['pid']) is int and 1 < record['pid'] < 2 ** 31
            and isinstance(record['identity'], str) and 0 < len(record['identity']) <= 256
            and type(record['uid']) is int and record['uid'] == os.getuid()
            and type(record['group']) is int and record['group'] > 1
            and type(record['parent']) is int and record['parent'] >= 1)


def same_process(record):
    if not valid_record(record):
        return False
    actual = process_record(record['pid'])
    return (actual is not None and actual['identity'] == record['identity']
            and actual['uid'] == record['uid'] and actual['group'] == record['group'])


def capture(pid):
    record = process_record(pid)
    if not valid_record(record):
        raise RuntimeError('Owned CPU process must be live and owned by this UID')
    return record


def ownership():
    return {'schema': SCHEMA, 'provider': capture(os.getpid()),
            'caller': capture(os.getppid()), 'child': None}


def valid_ownership(owned, provider_pid):
    if not isinstance(owned, dict) or owned.get('schema') != SCHEMA:
        return False
    provider, caller, child = (owned.get(key) for key in ('provider', 'caller', 'child'))
    return (valid_record(provider) and provider['pid'] == provider_pid
            and valid_record(caller) and provider['parent'] == caller['pid']
            and (child is None or valid_record(child)
                 and child['group'] == child['pid']
                 and (child['parent'] == provider_pid
                      or owned.get('selfWork') is True and child == provider)))


def stale_reason(owned, provider_pid, repo):
    # Malformed evidence cannot free a reservation or authorize a signal.
    if not valid_ownership(owned, provider_pid):
        return None
    try:
        for key in ('provider', 'caller'):
            if not same_process(owned[key]):
                return 'owned command ' + key + ' is gone'
    except (OSError, RuntimeError, ValueError):
        return None
    if isinstance(repo, str) and not os.path.isdir(repo):
        return 'owned command checkout is gone'
    return None


def group_absent(group):
    try:
        os.killpg(group, 0)
        return False
    except ProcessLookupError:
        return True
    except PermissionError:
        return False


def group_stopped(group):
    if group_absent(group):
        return True
    # An orphaned zombie can retain a PGID until init reaps it. It cannot do
    # work. Only a complete PID inventory with every group member readable
    # can establish this; inaccessible members retain the reservation.
    try:
        backend = identity_backend()
        inventory, present = backend.processes()
        for pid in present:
            try:
                if os.getpgid(pid) != group:
                    continue
                before = inventory.get(pid)
                after = backend.process(pid)
                if before is None or before.identity != after.identity or not after.zombie:
                    return False
            except ProcessLookupError:
                continue
        return True
    except Exception:
        return False


def group_members(group, previous):
    authenticated = [record for record in previous
                     if valid_record(record) and record['group'] == group and same_process(record)]
    if not authenticated:
        return []
    _inventory, present = identity_backend().processes()
    members = {record['pid']: record for record in authenticated}
    for pid in present:
        if pid <= 0:
            continue  # Darwin listallpids can include the kernel sentinel.
        # The machine census can race unrelated process exit/exec. Only
        # members of this authenticated private group need a fresh identity.
        # A live but unreadable member still refuses; never ignore it.
        try:
            if os.getpgid(pid) != group:
                continue
        except ProcessLookupError:
            continue
        record = process_record(pid)
        if record is not None and record['uid'] == os.getuid() and record['group'] == group:
            members[record['pid']] = record
            if len(members) > 512:
                raise RuntimeError('Owned CPU command group exceeds its inventory cap')
    return list(members.values()) if any(same_process(record) for record in authenticated) else []


def reclaim(owned, provider_pid):
    """Advance shutdown without waiting. True only after the group is absent.

    Private ledger rows are trusted local provider publications. Kernel birth
    checks still precede every signal; an unreadable or reused identity retains
    capacity. Remember group members before TERM so an exited root cannot hide
    its still-running descendants. Never signal an unauthenticated group.
    """
    if not valid_ownership(owned, provider_pid):
        return False
    child = owned['child']
    if child is None:
        return True  # No publication means the barrier never ran actual work.
    try:
        group = child['group']
        state = owned.setdefault('reclaim', {'started': time.monotonic(), 'members': owned.get('members', [child])})
        now = time.monotonic()
        if now < state.get('nextCheck', 0):
            return False
        state['nextCheck'] = now + .1
        if group_stopped(group):
            return True
        # Inventory is from the same census backend. No subprocess waits under
        # the scheduler lock; incomplete inventory never establishes absence.
        try:
            members = group_members(group, state['members'])
        except Exception:
            return False
        state['members'] = members
        # Recheck after inventory: a stored PID may have exited or been reused.
        if not any(same_process(record) for record in members):
            return False
        os.killpg(group, signal.SIGKILL if now - state['started'] >= STOP_GRACE_SECONDS else signal.SIGTERM)
    except (OSError, RuntimeError, ValueError, KeyError, TypeError):
        return False
    return False


def terminate_command(child):
    """The Popen child cannot reuse its PID before this owner reaps it."""
    if child is None:
        return
    if child.returncode is not None:
        # After reap the PID can be reused. Ledger reclaim authenticates any
        # remaining descendants; this Popen handle no longer authorizes killpg.
        return
    record = process_record(child.pid)
    if record is None:
        child.wait()
        return
    if record['parent'] != os.getpid() or record['group'] != child.pid:
        raise RuntimeError('Owned CPU child group cannot be authenticated for termination')
    members = group_members(child.pid, [record])
    try:
        if not same_process(record):
            child.wait()
            return
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        child.wait()
        return
    try:
        child.wait(timeout=STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        pass
    try:
        if any(same_process(member) for member in members):
            os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=STOP_GRACE_SECONDS)


def start_command(command, env, pass_fds, publish):
    """Own one child. Failed publication closes its barrier without executing it."""
    read_fd, write_fd = os.pipe()
    child = None
    try:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                                  'child', str(read_fd), '--', *command],
                                 env=env, start_new_session=True,
                                 pass_fds=(*pass_fds, read_fd))
        os.close(read_fd)
        read_fd = None
        record = capture(child.pid)
        if record['parent'] != os.getpid() or record['group'] != child.pid:
            raise RuntimeError('Owned CPU command has no private child group')
        publish(record)
        os.write(write_fd, b'G')
        return child
    except BaseException:
        os.close(write_fd)
        write_fd = None
        terminate_command(child)
        raise
    finally:
        if read_fd is not None:
            os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)


def child_main(args):
    if len(args) < 4 or args[0] != 'child' or args[2] != '--':
        raise ValueError('expected an owned child barrier and command')
    fd = int(args[1])
    if fd < 3:
        raise ValueError('owned child barrier must be a separate descriptor')
    try:
        ready = os.read(fd, 1)
    finally:
        os.close(fd)
    if ready != b'G':
        return 130
    os.execvpe(args[3], args[3:], os.environ)


if __name__ == '__main__':
    raise SystemExit(child_main(sys.argv[1:]))
