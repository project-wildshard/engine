#!/usr/bin/env python3
"""E261: fail a Simulator WebContent run above a native memory budget. macOS only."""
import argparse
import ctypes
import datetime
import json
import math
import pathlib
import subprocess
import sys
import time

GIB = 1024 ** 3
GB = 1000 ** 3
# The one memory switch (@wildshard/format's memoryGates.json, G433): phase budgets and whether a budget overrun fails the run.
# In report-only mode an overrun is recorded and printed, never a failure; a vanished or restarted WebContent still fails.
MEMORY_GATES = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'node_modules' / '@wildshard' / 'format' / 'src' / 'format' / 'memoryGates.json').read_text())
LOADING_BUDGET = int(MEMORY_GATES['loadingMB'] * 1_000_000)
WORLD_BUDGET = int(MEMORY_GATES['explorerMB'] * 1_000_000)
REPORT_ONLY = MEMORY_GATES['mode'] == 'report-only'


class RUsageInfo(ctypes.Structure):
    # macOS SDK sys/resource.h, rusage_info_v4. Do not substitute JS heap size.
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [
        (name, ctypes.c_uint64) for name in (
            'user_time', 'system_time', 'pkg_idle_wkups', 'interrupt_wkups',
            'pageins', 'wired_size', 'resident_size', 'phys_footprint',
            'proc_start_abstime', 'proc_exit_abstime', 'child_user_time',
            'child_system_time', 'child_pkg_idle_wkups', 'child_interrupt_wkups',
            'child_pageins', 'child_elapsed_abstime', 'diskio_bytesread',
            'diskio_byteswritten', 'cpu_time_qos_default', 'cpu_time_qos_maintenance',
            'cpu_time_qos_background', 'cpu_time_qos_utility', 'cpu_time_qos_legacy',
            'cpu_time_qos_user_initiated', 'cpu_time_qos_user_interactive',
            'billed_system_time', 'serviced_system_time', 'logical_writes',
            'lifetime_max_phys_footprint', 'instructions', 'cycles', 'billed_energy',
            'serviced_energy', 'interval_max_phys_footprint', 'runnable_time')]


class NativeMemory:
    def __init__(self):
        if sys.platform != 'darwin':
            raise RuntimeError('Native memory sampling requires macOS, not an iOS JS heap API')
        self.lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        self.lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        self.lib.proc_pid_rusage.restype = ctypes.c_int
        self.system = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        self.system.proc_rlimit_control.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        self.system.proc_rlimit_control.restype = ctypes.c_int

    def reset_interval(self, pid):
        # Apple XNU bsd/sys/resource.h + kern_resource.c: flavor 4 resets only
        # the accounting interval (flag 1). It does not set/relax a memory limit.
        if self.system.proc_rlimit_control(pid, 4, ctypes.c_void_p(1)) != 0:
            raise RuntimeError(f'Cannot reset native footprint interval for PID {pid}: errno {ctypes.get_errno()}')

    def sample(self, pid):
        usage = RUsageInfo()
        if self.lib.proc_pid_rusage(pid, 4, ctypes.byref(usage)) != 0:
            raise RuntimeError(f'Cannot read PID {pid}: errno {ctypes.get_errno()} (exit or access failure)')
        if not usage.proc_start_abstime or usage.proc_exit_abstime:
            raise RuntimeError(f'PID {pid} has exited or has no valid start identity')
        return {
            'pid': pid, 'startAbstime': usage.proc_start_abstime,
            'physicalFootprintBytes': usage.phys_footprint,
            'residentBytes': usage.resident_size,
            'lifetimeMaxPhysicalFootprintBytes': usage.lifetime_max_phys_footprint,
            'intervalMaxPhysicalFootprintBytes': usage.interval_max_phys_footprint,
        }


def command(args):
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=10)
    return result.stdout.strip()


class ProcBsdInfo(ctypes.Structure):
    # macOS SDK sys/proc_info.h, struct proc_bsdinfo (PROC_PIDTBSDINFO). It reads only the kernel's proc
    # record, never the target's memory.
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'pbi_flags', 'pbi_status', 'pbi_xstatus', 'pbi_pid', 'pbi_ppid', 'pbi_uid', 'pbi_gid', 'pbi_ruid',
        'pbi_rgid', 'pbi_svuid', 'pbi_svgid', 'rfu_1')] + [
        ('pbi_comm', ctypes.c_char * 16), ('pbi_name', ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in ('pbi_nfiles', 'pbi_pgid', 'pbi_pjobc', 'e_tdev', 'e_tpgid')] + [
        ('pbi_nice', ctypes.c_int32), ('pbi_start_tvsec', ctypes.c_uint64), ('pbi_start_tvusec', ctypes.c_uint64)]


_LIBPROC = None


def _libproc():
    global _LIBPROC
    if _LIBPROC is None:
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        lib.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.proc_listallpids.restype = ctypes.c_int
        lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        lib.proc_pidinfo.restype = ctypes.c_int
        lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        lib.proc_pidpath.restype = ctypes.c_int
        _LIBPROC = lib
    return _LIBPROC


def process_table():
    """Every readable process as {pid: (ppid, name)}, from libproc in-process.

    SF57 (2026-10-09): this replaced a `ps -axo pid=,ppid=,comm=` fork per call. `ps` reads each process's
    arguments out of its memory (KERN_PROCARGS2), so one busy or swapping process could hold a 1 Hz sampler
    for seconds; a 9 s native-sampler gap during boot loading failed a qualifying soak's sampling that way.
    """
    lib = _libproc()
    count = lib.proc_listallpids(None, 0)
    if count <= 0:
        raise RuntimeError(f'proc_listallpids failed: errno {ctypes.get_errno()}')
    pids = (ctypes.c_int * (count + 256))()
    count = lib.proc_listallpids(pids, ctypes.sizeof(pids))
    if count <= 0:
        raise RuntimeError(f'proc_listallpids failed: errno {ctypes.get_errno()}')
    info, size, rows = ProcBsdInfo(), ctypes.sizeof(ProcBsdInfo), {}
    for pid in pids[:count]:
        if pid > 0 and lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) == size:
            rows[pid] = (info.pbi_ppid, (info.pbi_name or info.pbi_comm).decode('utf-8', 'replace'))
    return rows


def process_path(pid, fallback):
    buffer = ctypes.create_string_buffer(4096)
    length = _libproc().proc_pidpath(pid, buffer, ctypes.sizeof(buffer))
    return buffer.raw[:length].decode('utf-8', 'replace') if length > 0 else fallback


def simulator_processes(manager_pid, executable_name='com.apple.WebKit.WebContent'):
    # All WebContent processes under this Simulator's launchd, including prewarmed
    # processes. Avoid desktop Safari and every other booted Simulator.
    rows = process_table()
    selected = {}
    for pid, (_, name) in rows.items():
        # The kernel keeps 31 characters of the name; the executable path settles a longer one.
        if name != executable_name[:31]:
            continue
        ancestor = pid
        visited = set()
        while ancestor in rows and ancestor not in visited:
            visited.add(ancestor)
            ancestor = rows[ancestor][0]
            if ancestor == manager_pid:
                path = process_path(pid, executable_name)
                if pathlib.PurePath(path).name == executable_name:
                    selected[pid] = path
                break
    return selected


class BudgetRun:
    def __init__(self, budget_bytes):
        self.budget_bytes = budget_bytes
        self.identities = {}
        self.peak_footprint = 0
        self.peak_resident = 0
        self.peak_interval_sum = 0
        self.samples = 0
        self.overruns = []

    def observe(self, readings):
        current = {row['pid']: row['startAbstime'] for row in readings}
        for pid, started in self.identities.items():
            if current.get(pid) != started:
                return f'WebContent process disappeared or restarted: PID {pid}'
        self.identities.update(current)
        footprint = sum(row['physicalFootprintBytes'] for row in readings)
        resident = sum(row['residentBytes'] for row in readings)
        # Sum of per-process highs is a conservative upper bound, not necessarily
        # a simultaneously resident total. Single --pid mode is an exact native high.
        interval_sum = sum(max(row['physicalFootprintBytes'], row.get('intervalMaxPhysicalFootprintBytes', 0)) for row in readings)
        self.peak_footprint = max(self.peak_footprint, footprint)
        self.peak_resident = max(self.peak_resident, resident)
        self.peak_interval_sum = max(self.peak_interval_sum, interval_sum)
        if readings:
            self.samples += 1
        over = None
        if footprint > self.budget_bytes:
            over = f'Physical footprint {footprint:,} bytes ({footprint / GB:.3f} GB) exceeds {self.budget_bytes:,} byte budget'
        elif interval_sum > self.budget_bytes:
            over = f'Native interval high-water sum {interval_sum:,} bytes ({interval_sum / GB:.3f} GB) exceeds {self.budget_bytes:,} byte budget'
        if over is not None and REPORT_ONLY:
            if not self.overruns or self.overruns[-1]['budgetBytes'] != self.budget_bytes:
                self.overruns.append({'budgetBytes': self.budget_bytes, 'first': over})
            self.overruns[-1]['peakBytes'] = max(self.overruns[-1].get('peakBytes', 0), footprint, interval_sum)
            return None
        return over


class PhaseBudget:
    """External test driver marks the transition; absence can never pass phase mode."""
    def __init__(self, world_phase_file):
        self.world_phase_file = world_phase_file
        self.phase = 'loading'
        if world_phase_file.exists():
            raise RuntimeError('World phase file already exists; use a fresh marker for this run')

    def update(self):
        if self.world_phase_file.exists():
            self.phase = 'world'
        return WORLD_BUDGET if self.phase == 'world' else LOADING_BUDGET


def positive_number(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError('must be a finite positive number')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True, help='Booted Simulator UDID (never a physical iPhone)')
    budget = parser.add_mutually_exclusive_group()
    budget.add_argument('--budget-gib', type=positive_number, help='Single budget in binary GiB; defaults to 4 GiB outside phase mode')
    budget.add_argument('--budget-gb', type=positive_number, help='Single budget in decimal GB (1 GB = 1,000,000,000 bytes)')
    budget.add_argument('--world-phase-file', type=pathlib.Path, help='Two-phase mode: the loading / Explorer budgets of memoryGates.json in @wildshard/format (decimal), Explorer once the test driver creates this new marker')
    parser.add_argument('--duration', type=positive_number, default=120, help='Seconds to watch AFTER first WebContent sample')
    parser.add_argument('--interval', type=positive_number, default=0.1, help='Sampling interval in seconds; default 0.1; brief bursts can still be missed')
    parser.add_argument('--start-timeout', type=positive_number, default=30, help='Fail if no WebContent appears within this many seconds')
    parser.add_argument('--pid', type=int, help='Optional single WebContent PID, validated as belonging to this Simulator')
    parser.add_argument('--url', help='Optionally open this URL in Simulator Safari after the watchdog starts')
    parser.add_argument('--out', type=pathlib.Path, required=True, help='New JSONL output path (refuses to overwrite)')
    args = parser.parse_args()
    initial_budget = LOADING_BUDGET if args.world_phase_file else int(
        args.budget_gb * GB if args.budget_gb is not None else (args.budget_gib or 4) * GIB)
    run = BudgetRun(initial_budget)
    phase_budget = None
    phase_peaks = {}
    gpu_peak_footprint = 0
    started = time.monotonic()
    attached = None
    result = 'error'
    reason = 'No samples recorded'
    code = 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x') as output:
        def emit(kind, **fields):
            row = {'type': kind, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), **fields}
            output.write(json.dumps(row) + '\n')
            output.flush()
        try:
            if args.world_phase_file:
                phase_budget = PhaseBudget(args.world_phase_file)
            native = NativeMemory()
            manager = int(command(['xcrun', 'simctl', 'spawn', args.device, 'launchctl', 'managerpid']))
            manager_identity = native.sample(manager)['startAbstime']
            emit('start', device=args.device, simulatorLaunchdPid=manager,
                 simulatorLaunchdStartAbstime=manager_identity, budgetBytes=run.budget_bytes,
                 durationSeconds=args.duration, intervalSeconds=args.interval,
                 phaseBudgetsBytes={'loading': LOADING_BUDGET, 'world': WORLD_BUDGET} if phase_budget else None,
                 memoryGates=MEMORY_GATES['mode'],
                 worldPhaseFile=str(args.world_phase_file) if args.world_phase_file else None,
                 scope='single Simulator WebContent PID' if args.pid else 'sum of all Simulator WebContent processes',
                 metric='macOS proc_pid_rusage RUSAGE_INFO_V4 physical footprint + kernel interval high-water', url=args.url)
            print(f'Watching Simulator {args.device}; initial native footprint budget {initial_budget:,} bytes', flush=True)
            initial_processes = simulator_processes(manager)
            for pid in initial_processes:
                if args.pid is None or args.pid == pid:
                    before = native.sample(pid)
                    native.reset_interval(pid)
                    emit('interval-reset', phase='loading' if phase_budget else 'single', before=before)
            if args.url:
                command(['xcrun', 'simctl', 'openurl', args.device, args.url])
            while True:
                tick = time.monotonic()
                if native.sample(manager)['startAbstime'] != manager_identity:
                    raise RuntimeError('Simulator launchd restarted; monitoring continuity lost')
                processes = simulator_processes(manager)
                gpu_processes = simulator_processes(manager, 'com.apple.WebKit.GPU')
                gpu_readings = [{**native.sample(pid), 'executable': path} for pid, path in sorted(gpu_processes.items())]
                gpu_peak_footprint = max(gpu_peak_footprint, sum(row['physicalFootprintBytes'] for row in gpu_readings))
                if args.pid:
                    processes = {pid: path for pid, path in processes.items() if pid == args.pid}
                readings = [{**native.sample(pid), 'executable': path} for pid, path in sorted(processes.items())]
                if phase_budget:
                    previous_phase = phase_budget.phase
                    next_budget = phase_budget.update()
                    if previous_phase != phase_budget.phase:
                        old_failure = run.observe(readings)
                        ending_high = sum(max(row['physicalFootprintBytes'], row['intervalMaxPhysicalFootprintBytes']) for row in readings)
                        phase_peaks[previous_phase] = max(phase_peaks.get(previous_phase, 0), ending_high)
                        emit('phase-end', phase=previous_phase, budgetBytes=run.budget_bytes, processes=readings)
                        if old_failure:
                            result, reason, code = 'fail', old_failure, 1
                            break
                        for row in readings:
                            native.reset_interval(row['pid'])
                            emit('interval-reset', phase=phase_budget.phase, before=row)
                        readings = [{**native.sample(pid), 'executable': path} for pid, path in sorted(processes.items())]
                    run.budget_bytes = next_budget
                phase = phase_budget.phase if phase_budget else 'single'
                footprint = sum(row['physicalFootprintBytes'] for row in readings)
                interval_sum = sum(max(row['physicalFootprintBytes'], row['intervalMaxPhysicalFootprintBytes']) for row in readings)
                phase_peaks[phase] = max(phase_peaks.get(phase, 0), interval_sum)
                failure = run.observe(readings)
                emit('sample', elapsedSeconds=round(time.monotonic() - started, 3), processes=readings,
                     phase=phase, budgetBytes=run.budget_bytes, physicalFootprintBytes=footprint,
                     intervalHighWaterSumBytes=interval_sum,
                     gpuProcesses=gpu_readings,
                     residentBytes=sum(row['residentBytes'] for row in readings))
                if failure:
                    result, reason, code = 'fail', failure, 1
                    break
                now = time.monotonic()
                if readings and attached is None:
                    attached = now
                    print('Attached to PID(s): ' + ', '.join(str(row['pid']) for row in readings), flush=True)
                if attached is None and now - started >= args.start_timeout:
                    raise RuntimeError('No matching Simulator WebContent process; refusing an empty pass')
                if attached is not None and now - attached >= args.duration:
                    if phase_budget and phase_budget.phase != 'world':
                        raise RuntimeError('World phase was never marked; refusing to pass a loading-only run')
                    result, reason, code = 'pass', 'Observed native memory stayed within budget for the requested window', 0
                    if run.overruns:
                        reason = 'REPORT-ONLY (@wildshard/format memoryGates.json, G433): over budget but not failed: ' + '; '.join(row['first'] for row in run.overruns)
                    break
                time.sleep(max(0, args.interval - (time.monotonic() - tick)))
        except KeyboardInterrupt:
            result, reason, code = 'interrupted', 'Run interrupted before completion; not a pass', 130
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
            result, reason, code = 'error', str(error), 2
        emit('result', result=result, reason=reason, exitCode=code, samples=run.samples,
             elapsedSeconds=round(time.monotonic() - started, 3),
             peakPhysicalFootprintBytes=run.peak_footprint, peakResidentBytes=run.peak_resident,
             peakIntervalHighWaterSumBytes=run.peak_interval_sum, phasePeakIntervalHighWaterSumBytes=phase_peaks,
             gpuPeakSampledPhysicalFootprintBytes=gpu_peak_footprint,
             processIdentities=run.identities, memoryGates=MEMORY_GATES['mode'], reportOnlyOverruns=run.overruns)
        print(f'{result.upper()}: {reason}; sampled footprint peak {run.peak_footprint / GB:.3f} GB; '
              f'native interval high-water sum {run.peak_interval_sum / GB:.3f} GB; report {args.out}', flush=True)
    return code


if __name__ == '__main__':
    sys.exit(main())
