#!/usr/bin/env python3
"""The one kernel footprint reader (ENGINE-MEMORY EM2). macOS only, no root.

`phys_footprint` is what jetsam compares to a process's limit. This reads it with proc_pid_rusage (RUSAGE_INFO_V4),
with the kernel's interval high-water mark (reset by proc_rlimit_control flavor 4) and lifetime maximum, so a peak
between two samples is never lost. src/scripts/memory/footprint.mjs drives it; the Python callers import it.

  footprint.py read <pid>...                one JSON object {pid: reading | {"error": ...}}
  footprint.py procs                        one JSON array of every readable process: pid, ppid, rpid, name, path
  footprint.py sample <every-ms> <pid>...   one JSON line per sample, {"t": ms, "p": {pid: [footprint, interval max]}};
                                            the interval is reset after each read, so each sample's high-water covers
                                            the time since the previous one. stdin takes commands, one per line:
                                            `mark <name>` (prints {"t", "mark"}), `add <pid>`, `stop`.
"""
import ctypes
import json
import os
import select
import sys
import time

FIELDS = (
    'user_time', 'system_time', 'pkg_idle_wkups', 'interrupt_wkups', 'pageins', 'wired_size', 'resident_size',
    'phys_footprint', 'proc_start_abstime', 'proc_exit_abstime', 'child_user_time', 'child_system_time',
    'child_pkg_idle_wkups', 'child_interrupt_wkups', 'child_pageins', 'child_elapsed_abstime', 'diskio_bytesread',
    'diskio_byteswritten', 'cpu_time_qos_default', 'cpu_time_qos_maintenance', 'cpu_time_qos_background',
    'cpu_time_qos_utility', 'cpu_time_qos_legacy', 'cpu_time_qos_user_initiated', 'cpu_time_qos_user_interactive',
    'billed_system_time', 'serviced_system_time', 'logical_writes', 'lifetime_max_phys_footprint', 'instructions',
    'cycles', 'billed_energy', 'serviced_energy', 'interval_max_phys_footprint', 'runnable_time')


class RUsageInfo(ctypes.Structure):
    # macOS SDK sys/resource.h, rusage_info_v4.
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(name, ctypes.c_uint64) for name in FIELDS]


class ProcBsdInfo(ctypes.Structure):
    # macOS SDK sys/proc_info.h, struct proc_bsdinfo (PROC_PIDTBSDINFO): the kernel's proc record only.
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'pbi_flags', 'pbi_status', 'pbi_xstatus', 'pbi_pid', 'pbi_ppid', 'pbi_uid', 'pbi_gid', 'pbi_ruid',
        'pbi_rgid', 'pbi_svuid', 'pbi_svgid', 'rfu_1')] + [
        ('pbi_comm', ctypes.c_char * 16), ('pbi_name', ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in ('pbi_nfiles', 'pbi_pgid', 'pbi_pjobc', 'e_tdev', 'e_tpgid')] + [
        ('pbi_nice', ctypes.c_int32), ('pbi_start_tvsec', ctypes.c_uint64), ('pbi_start_tvusec', ctypes.c_uint64)]


class Kernel:
    def __init__(self):
        if sys.platform != 'darwin':
            raise RuntimeError('the kernel footprint reader needs macOS')
        self.proc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        self.proc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        self.proc.proc_pid_rusage.restype = ctypes.c_int
        self.proc.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.proc.proc_listallpids.restype = ctypes.c_int
        self.proc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        self.proc.proc_pidinfo.restype = ctypes.c_int
        self.proc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        self.proc.proc_pidpath.restype = ctypes.c_int
        self.system = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        self.system.proc_rlimit_control.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        self.system.proc_rlimit_control.restype = ctypes.c_int
        # The process that launched an XPC service (WebKit's WebContent and GPU processes are parented to launchd).
        self.responsible = getattr(self.system, 'responsibility_get_pid_responsible_for_pid', None)
        if self.responsible is not None:
            self.responsible.argtypes = [ctypes.c_int]
            self.responsible.restype = ctypes.c_int

    def reset_interval(self, pid):
        # Apple XNU bsd/sys/resource.h + kern_resource.c: flavor 4 resets only the accounting interval (flag 1). It
        # does not set or relax a memory limit.
        return self.system.proc_rlimit_control(pid, 4, ctypes.c_void_p(1)) == 0

    def sample(self, pid):
        usage = RUsageInfo()
        if self.proc.proc_pid_rusage(pid, 4, ctypes.byref(usage)) != 0:
            raise RuntimeError(f'cannot read PID {pid}: errno {ctypes.get_errno()}')
        if not usage.proc_start_abstime or usage.proc_exit_abstime:
            raise RuntimeError(f'PID {pid} has exited')
        return {
            'pid': pid, 'startAbstime': usage.proc_start_abstime,
            'physicalFootprintBytes': usage.phys_footprint,
            'residentBytes': usage.resident_size,
            'intervalMaxPhysicalFootprintBytes': usage.interval_max_phys_footprint,
            'lifetimeMaxPhysicalFootprintBytes': usage.lifetime_max_phys_footprint,
        }

    def path(self, pid, fallback=''):
        buffer = ctypes.create_string_buffer(4096)
        length = self.proc.proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
        return buffer.raw[:length].decode('utf-8', 'replace') if length > 0 else fallback

    def processes(self, with_paths=True):
        """Every readable process: {pid: {'ppid', 'rpid', 'name', 'path'}}. libproc in-process, never `ps` (SF57)."""
        count = self.proc.proc_listallpids(None, 0)
        if count <= 0:
            raise RuntimeError(f'proc_listallpids failed: errno {ctypes.get_errno()}')
        pids = (ctypes.c_int * (count + 256))()
        count = self.proc.proc_listallpids(pids, ctypes.sizeof(pids))
        info, size, rows = ProcBsdInfo(), ctypes.sizeof(ProcBsdInfo), {}
        for pid in pids[:count]:
            if pid > 0 and self.proc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) == size:
                name = (info.pbi_name or info.pbi_comm).decode('utf-8', 'replace')
                rpid = self.responsible(pid) if self.responsible is not None else -1
                rows[pid] = {'pid': pid, 'ppid': info.pbi_ppid, 'rpid': rpid, 'name': name,
                             'path': self.path(pid, name) if with_paths else name}
        return rows


def read(kernel, pids):
    out = {}
    for pid in pids:
        try:
            out[str(pid)] = kernel.sample(pid)
        except RuntimeError as error:
            out[str(pid)] = {'error': str(error)}
    return out


def sample_loop(kernel, every_ms, pids):
    pids = list(dict.fromkeys(pids))
    for pid in pids:
        kernel.reset_interval(pid)
    stdin = sys.stdin.fileno()
    open_stdin = True
    next_at = time.monotonic()
    while True:
        row = {}
        for pid in pids:
            try:
                usage = kernel.sample(pid)
                row[str(pid)] = [usage['physicalFootprintBytes'], usage['intervalMaxPhysicalFootprintBytes']]
                kernel.reset_interval(pid)
            except RuntimeError:
                row[str(pid)] = None
        print(json.dumps({'t': round(time.time() * 1000, 1), 'p': row}), flush=True)
        next_at += every_ms / 1000
        wait = max(0.0, next_at - time.monotonic())
        if wait == 0.0:
            next_at = time.monotonic()
        if not open_stdin:
            time.sleep(wait)
            continue
        ready, _, _ = select.select([stdin], [], [], wait)
        if not ready:
            continue
        line = sys.stdin.readline()
        if line == '':
            open_stdin = False
            continue
        command, _, argument = line.strip().partition(' ')
        if command == 'stop':
            return
        if command == 'add' and argument.isdigit():
            pid = int(argument)
            if pid not in pids:
                pids.append(pid)
                kernel.reset_interval(pid)
        elif command == 'mark':
            # The sample above already reset every interval, so the high-water after this line belongs to the mark.
            print(json.dumps({'t': round(time.time() * 1000, 1), 'mark': argument}), flush=True)


def main(argv):
    if len(argv) < 1:
        print(__doc__, file=sys.stderr)
        return 64
    kernel = Kernel()
    if argv[0] == 'read':
        print(json.dumps(read(kernel, [int(a) for a in argv[1:]])))
        return 0
    if argv[0] == 'procs':
        print(json.dumps(list(kernel.processes().values())))
        return 0
    if argv[0] == 'sample' and len(argv) >= 2:
        sample_loop(kernel, float(argv[1]), [int(a) for a in argv[2:]])
        return 0
    print(__doc__, file=sys.stderr)
    return 64


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        os._exit(0)
