#!/usr/bin/env python3
"""Observe one existing owner's process tree; never signal it or change its environment.

Manual HS8 instrumentation, outside hooks. CPU deltas describe sampled intervals,
not simultaneous cores. Short-lived processes/threads can escape observation.
"""
from __future__ import annotations

import argparse
import ctypes as c
from dataclasses import dataclass
import errno
import json
import os
from pathlib import Path
import sys
import time


class CensusRefused(Exception):
    pass


@dataclass
class Process:
    pid: int
    parent: int
    uid: int
    identity: str
    born_ns: int
    name: str
    zombie: bool


class Darwin:
    """Read-only libproc counters, with exact result-size checks.

    Apple XNU's PROC_PIDLISTTHREADIDS (28) supplies unique IDs instead of reused
    pthread handles. Unsupported systems refuse; this is a manual observer.
    Process times are Mach ticks; proc_threadinfo already reports nanoseconds.
    """
    class BSD(c.Structure):
        _fields_ = [(name, c.c_uint32) for name in (
            'flags', 'status', 'xstatus', 'pid', 'parent', 'uid', 'gid',
            'ruid', 'rgid', 'svuid', 'svgid', 'reserved')]
        _fields_ += [('comm', c.c_char * 16), ('name', c.c_char * 32)]
        _fields_ += [(name, c.c_uint32) for name in ('files', 'pgid', 'jobc', 'tty', 'tpgid')]
        _fields_ += [('nice', c.c_int32), ('seconds', c.c_uint64), ('micros', c.c_uint64)]

    class Task(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in (
            'virtual', 'resident', 'user', 'system', 'threads_user', 'threads_system')]
        _fields_ += [(name, c.c_int32) for name in (
            'policy', 'faults', 'pageins', 'cow', 'sent', 'received', 'mach',
            'unix', 'switches', 'threads', 'running', 'priority')]

    class Thread(c.Structure):
        _fields_ = [('user', c.c_uint64), ('system', c.c_uint64)]
        _fields_ += [(name, c.c_int32) for name in (
            'cpu', 'policy', 'state', 'flags', 'sleep', 'curpri', 'priority', 'maxpri')]
        _fields_ += [('name', c.c_char * 64)]

    class Timebase(c.Structure):
        _fields_ = [('numer', c.c_uint32), ('denom', c.c_uint32)]

    def __init__(self, max_processes=65536, max_threads=16384):
        self.max_processes, self.max_threads, self.unreadable = max_processes, max_threads, {}
        self.lib = c.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        self.lib.proc_pidinfo.argtypes = [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]
        self.lib.proc_pidinfo.restype = c.c_int
        self.lib.proc_listallpids.argtypes = [c.c_void_p, c.c_int]
        self.lib.proc_listallpids.restype = c.c_int
        system = c.CDLL('/usr/lib/libSystem.B.dylib')
        system.mach_timebase_info.argtypes = [c.POINTER(self.Timebase)]
        system.mach_timebase_info.restype = c.c_int
        self.timebase = self.Timebase()
        if system.mach_timebase_info(c.byref(self.timebase)) != 0 or not self.timebase.numer or not self.timebase.denom:
            raise OSError('Mach census clock calibration unavailable')
        self.quantum_ns = (self.timebase.numer + self.timebase.denom - 1) // self.timebase.denom
        self.clock = {'processUnit': 'Mach absolute ticks', 'numer': self.timebase.numer,
                      'denom': self.timebase.denom, 'threadUnit': 'nanoseconds',
                      'threadQuantumNs': 1000, 'threadIdentity': 'kernel unique ID (28/15)'}

    def nanoseconds(self, ticks):
        return ticks * self.timebase.numer // self.timebase.denom

    def read(self, pid, flavor, kind, arg=0):
        value = kind()
        c.set_errno(0)
        actual = self.lib.proc_pidinfo(pid, flavor, arg, c.byref(value), c.sizeof(value))
        if actual != c.sizeof(value):
            raise OSError(c.get_errno(), 'libproc census unavailable or owner exited')
        return value

    def processes(self):
        count = self.lib.proc_listallpids(None, 0)
        if count <= 0:
            raise CensusRefused('libproc census PID inventory unavailable')
        if count >= self.max_processes:
            raise CensusRefused('census PID inventory exceeds cap')
        buffer = (c.c_int * min(self.max_processes, count + 512))()
        actual = self.lib.proc_listallpids(buffer, c.sizeof(buffer))
        if actual < 0 or actual >= len(buffer):
            raise CensusRefused('census PID inventory exceeds cap or cannot be read')
        self.unreadable = {}
        rows, present = {}, set(buffer[:actual])
        for pid in buffer[:actual]:
            if pid <= 0:
                continue
            try:
                row = self.read(pid, 3, self.BSD)
                born = row.seconds * 1_000_000_000 + row.micros * 1000
                rows[pid] = Process(pid, row.parent, row.uid, f'{pid}:{born}', born,
                                    (row.name or row.comm).decode(errors='replace'), row.status == 5)
            except OSError as error:
                # An unrelated PID can end or be inaccessible during enumeration.
                self.unreadable[pid] = error.errno
                continue
        return rows, present

    def usage(self, process):
        task = self.read(process.pid, 4, self.Task)
        if not 0 <= task.threads <= self.max_threads:
            raise CensusRefused('census thread inventory exceeds cap')
        ids = (c.c_uint64 * min(self.max_threads + 1, task.threads + 128))()
        c.set_errno(0)
        size = self.lib.proc_pidinfo(process.pid, 28, 0, ids, c.sizeof(ids))
        if size <= 0:
            raise OSError(c.get_errno() or errno.EIO, 'libproc census thread inventory unavailable')
        if size % 8 or size >= c.sizeof(ids) or size // 8 > self.max_threads:
            raise CensusRefused('census thread inventory exceeds cap or is incomplete')
        threads, names, missing = {}, {}, 0
        for ident in ids[:size // 8]:
            try:
                row = self.read(process.pid, 15, self.Thread, ident)
                threads[str(ident)] = row.user + row.system
                names[str(ident)] = row.name.decode(errors='replace')
            except OSError as error:
                if error.errno not in (errno.ESRCH, errno.ENOENT):
                    raise CensusRefused(f'required thread counters unavailable: errno {error.errno}') from error
                missing += 1
        if not threads:
            raise OSError(errno.ESRCH, 'no thread counter was readable')
        after = self.read(process.pid, 3, self.BSD)
        if f'{after.pid}:{after.seconds * 1_000_000_000 + after.micros * 1000}' != process.identity:
            raise OSError(errno.ESRCH, 'libproc census PID identity changed')
        return self.nanoseconds(task.user + task.system), task.resident, threads, names, missing


class Linux:
    def __init__(self, max_processes=65536, max_threads=16384):
        self.max_processes, self.max_threads, self.unreadable = max_processes, max_threads, {}
        self.hz = os.sysconf('SC_CLK_TCK')
        self.quantum_ns = 1_000_000_000 // self.hz
        self.clock = {'processUnit': 'proc clock ticks', 'threadUnit': 'proc clock ticks',
                      'hz': self.hz, 'threadQuantumNs': self.quantum_ns,
                      'threadIdentity': 'TID plus kernel start ticks'}
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.epoch_ns = next(int(line.split()[1]) for line in Path('/proc/stat').read_text().splitlines()
                             if line.startswith('btime ')) * 1_000_000_000

    def stat(self, path):
        text = path.read_text()
        left, right = text.index('('), text.rindex(')')
        return text[left + 1:right], text[right + 2:].split()

    def processes(self):
        rows, present = {}, set()
        self.unreadable = {}
        with os.scandir('/proc') as directories:
            for directory in directories:
                if not directory.name.isdecimal():
                    continue
                if len(present) >= self.max_processes:
                    raise CensusRefused('census PID inventory exceeds cap')
                present.add(int(directory.name))
                try:
                    uid = directory.stat().st_uid
                    name, fields = self.stat(Path(directory.path) / 'stat')
                    pid, born = int(directory.name), int(fields[19])
                    rows[pid] = Process(pid, int(fields[1]), uid, f'{self.boot}:{pid}:{born}',
                                        self.epoch_ns + born * self.quantum_ns, name, fields[0] == 'Z')
                except (OSError, ValueError, IndexError) as error:
                    self.unreadable[int(directory.name)] = error.errno if isinstance(error, OSError) else None
                    continue
        return rows, present

    def usage(self, process):
        directory = Path('/proc') / str(process.pid)
        _, fields = self.stat(directory / 'stat')
        if f'{self.boot}:{process.pid}:{fields[19]}' != process.identity:
            raise OSError(errno.ESRCH, 'proc census PID identity changed')
        if not 0 <= int(fields[17]) <= self.max_threads:
            raise CensusRefused('census thread inventory exceeds cap')
        cpu = (int(fields[11]) + int(fields[12])) * self.quantum_ns
        rss = int(fields[21]) * os.sysconf('SC_PAGE_SIZE')
        threads, names, missing = {}, {}, 0
        with os.scandir(directory / 'task') as members:
            for index, member in enumerate(members):
                if index >= self.max_threads:
                    raise CensusRefused('census thread inventory exceeds cap')
                try:
                    name, row = self.stat(Path(member.path) / 'stat')
                    key = f'{member.name}:{row[19]}'
                    threads[key] = (int(row[11]) + int(row[12])) * self.quantum_ns
                    names[key] = name[:256]
                except (OSError, ValueError, IndexError) as error:
                    if not isinstance(error, OSError) or error.errno not in (errno.ESRCH, errno.ENOENT):
                        raise CensusRefused('required thread counters unavailable') from error
                    missing += 1
        if not threads:
            raise OSError(errno.ESRCH, 'no thread counter was readable')
        _, after = self.stat(directory / 'stat')
        if f'{self.boot}:{process.pid}:{after[19]}' != process.identity:
            raise OSError(errno.ESRCH, 'proc census PID identity changed')
        return cpu, rss, threads, names, missing


def observe(backend, pid, report, interval, seconds, drain):
    began = time.monotonic()
    observer_cpu = time.process_time_ns()
    inventory = backend.processes()[0]
    # Validate required APIs even when the eventual target is idle or exits.
    # An unsupported flavor must never become a green, empty census.
    try:
        self_process = inventory.get(os.getpid())
        if self_process is None or not backend.usage(self_process)[2]:
            raise CensusRefused('required CPU counters unavailable to the observer')
    except OSError as error:
        raise CensusRefused('required CPU counters unavailable to the observer') from error
    initial = inventory.get(pid)
    if initial is None or initial.zombie or initial.uid != os.getuid() or pid == os.getpid():
        raise ValueError('census root must be an existing live process owned by this UID')
    known, previous = {initial.identity: initial}, {}
    last_time, root_ended = began, None
    samples, incomplete, peak = 0, 0, {'processes': 0, 'threads': 0, 'activeThreads': 0,
                                     'summedRssBytes': 0, 'intervalCpuCoresLowerBound': 0.0}
    writer = report.open('x', encoding='utf8')
    with writer:
        def emit(row):
            text = json.dumps(row, separators=(',', ':')) + '\n'
            if writer.tell() + len(text.encode()) > 64 * 1024 * 1024:
                raise OSError('census report exceeds its 64 MiB observation budget')
            writer.write(text)
            writer.flush()
        emit({'schema': 'engine-cpu-census/1', 'type': 'start', 'platform': sys.platform,
              'root': initial.__dict__, 'startedAtMs': time.time_ns() / 1e6,
              'intervalSeconds': interval, 'processQuantumNs': backend.quantum_ns,
              'maxProcesses': backend.max_processes, 'maxThreads': backend.max_threads,
              'clock': backend.clock,
              'limits': 'Sampled CPU deltas, not simultaneous cores. Exited/short-lived processes and '
                        'threads can be missed. RSS sums include shared pages. No signals or environment changes.'})
        print(json.dumps({'started': initial.identity, 'report': str(report)}), flush=True)
        remaining, ended = [], 'observer deadline'
        while True:
            now = time.monotonic()
            inventory, present = backend.processes()
            unknown = [row for row in known.values() if row.pid in present and row.pid not in inventory]
            if any(backend.unreadable.get(row.pid) not in (errno.ESRCH, errno.ENOENT) for row in unknown):
                raise CensusRefused('required known process identity unavailable')
            live = {row.pid for key, row in known.items()
                    if row.pid in inventory and inventory[row.pid].identity == key and not inventory[row.pid].zombie}
            for _ in range(len(inventory) + 1):
                found = {row.pid for row in inventory.values() if row.parent in live and not row.zombie
                         and row.uid == os.getuid() and row.pid != os.getpid()}
                if found <= live:
                    break
                live |= found
            rows, errors, delta, active = [], [], 0, 0
            for current in sorted(live):
                process = inventory[current]
                known[process.identity] = process
                if len(known) > 8192:
                    raise OSError('census exceeds 8192 observed process identities')
                try:
                    cpu, rss, threads, names, missing = backend.usage(process)
                    old = previous.get(process.identity)
                    if old is not None and old[2] != samples - 1:
                        old = None  # A collection gap cannot masquerade as one interval's CPU.
                    reset = old is not None and cpu < old[0]
                    if reset:
                        old = None  # Exec/counter discontinuity is censored, not negative CPU.
                    observed = cpu - old[0] if old else 0
                    resets = sum(value < old[1][key] for key, value in threads.items()
                                 if old is not None and key in old[1])
                    active_threads = [{'id': key, 'cpuNs': value - old[1][key]}
                                      for key, value in threads.items()
                                      if old is not None and key in old[1] and value > old[1][key]]
                    rows.append({'pid': process.pid, 'identity': process.identity, 'parent': process.parent,
                                 'name': process.name, 'cpuNs': cpu, 'cpuDeltaNsLowerBound': observed,
                                 'rssBytes': rss, 'threads': len(threads), 'threadIds': list(threads),
                                 'threadNames': names,
                                 'activeThreads': active_threads,
                                 'unreadThreads': missing, 'threadCounterResets': resets,
                                 'processCounterReset': reset,
                                 'newThreadBaselines': len(threads) if old is None
                                 else len(threads.keys() - old[1].keys())})
                    previous[process.identity] = (cpu, threads, samples)
                    delta += observed
                    active += len(active_threads)
                    incomplete += missing + resets + int(reset)
                except (OSError, ValueError, IndexError) as error:
                    if not isinstance(error, OSError) or error.errno not in (errno.ESRCH, errno.ENOENT):
                        raise CensusRefused('required live process counters unavailable') from error
                    errors.append({'pid': current, 'error': type(error).__name__})
                    incomplete += 1
            # Each per-process interval lies within this wider read window.
            # Dividing its incomplete CPU sum by that whole window is a lower bound,
            # not an inferred simultaneous core count.
            span = time.monotonic() - last_time
            metrics = {'processes': len(rows), 'threads': sum(row['threads'] for row in rows),
                       'activeThreads': active, 'summedRssBytes': sum(row['rssBytes'] for row in rows),
                       'intervalCpuCoresLowerBound': delta / 1e9 / span if samples else 0.0}
            for key, value in metrics.items():
                peak[key] = max(peak[key], value)
            errors += [{'pid': row.pid, 'error': 'identity currently unreadable'} for row in unknown]
            emit({'type': 'sample', 'seconds': now - began, 'wallTimeMs': time.time_ns() / 1e6,
                  'intervalSeconds': span,
                  'readSeconds': time.monotonic() - now, 'metrics': metrics, 'processes': rows, 'errors': errors})
            samples += 1
            root_unknown = any(row.identity == initial.identity for row in unknown)
            root_live = root_unknown or (pid in inventory and inventory[pid].identity == initial.identity and not inventory[pid].zombie)
            if not root_live and root_ended is None:
                root_ended = now
            remaining = [inventory[current].__dict__ for current in live]
            remaining += [{**row.__dict__, 'status': 'identity currently unreadable'} for row in unknown]
            incomplete += len(unknown)
            if not root_live and not remaining:
                ended = 'observed tree drained'
                break
            if root_ended is not None and now - root_ended >= drain:
                ended = 'live observed descendants after root exit'
                break
            if now - began >= seconds:
                break
            last_time = now
            time.sleep(interval)
        result = {'type': 'end', 'reason': ended, 'seconds': time.monotonic() - began,
                  'observerCpuNs': time.process_time_ns() - observer_cpu,
                  'samples': samples, 'incompleteReads': incomplete, 'peak': peak,
                  'observedProcesses': [row.__dict__ for row in known.values()], 'remaining': remaining}
        result['rootMeasured'] = initial.identity in previous
        emit(result)
        print(json.dumps(result), flush=True)
        return 0 if ended == 'observed tree drained' and result['rootMeasured'] else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--interval', default=2.0, type=float)
    parser.add_argument('--seconds', default=1200.0, type=float)
    parser.add_argument('--drain-seconds', default=10.0, type=float)
    parser.add_argument('--max-processes', default=65536, type=int)
    parser.add_argument('--max-threads', default=16384, type=int)
    args = parser.parse_args()
    if args.pid <= 1 or not .05 <= args.interval <= 10 or not 1 <= args.seconds <= 3600 or not 0 <= args.drain_seconds <= 30:
        parser.error('give a real PID and bounded observation/drain intervals')
    if not 1 <= args.max_processes <= 65536 or not 1 <= args.max_threads <= 16384:
        parser.error('inventory caps may only lower the fixed process/thread limits')
    if sys.platform not in ('darwin', 'linux'):
        parser.error('census supports the public Darwin libproc or Linux proc APIs only')
    try:
        backend = (Darwin if sys.platform == 'darwin' else Linux)(args.max_processes, args.max_threads)
        return observe(backend, args.pid,
                       args.report, args.interval, args.seconds, args.drain_seconds)
    except (OSError, ValueError, CensusRefused) as error:
        print(f'cpu-census refused: {type(error).__name__}: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
