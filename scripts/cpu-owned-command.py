#!/usr/bin/env python3
"""One kernel-bound command group, published before it may execute work."""
import errno
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys

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


def terminate_command(child):
    """The Popen child cannot reuse its PID before this owner reaps it."""
    if child is None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        child.wait()
        return
    try:
        child.wait(timeout=STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


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
