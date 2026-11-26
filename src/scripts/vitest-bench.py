#!/usr/bin/env python3
"""Per-file Vitest benchmark (VITEST-BENCH-PLAN row 1): one file at a time, one worker, under a CPU-admission grant.

Records, per test file: wall seconds, user and system CPU seconds of the whole process tree (wait4 rusage, which on
macOS and Linux includes every reaped descendant), the largest single-process max RSS, the peak summed RSS of the tree
(ps sampling), the child processes the run spawned (by kind), Vitest's own file duration and case counts, and with
--profile the top self-time functions from V8 CPU profiles of every Node process in the tree.

    python3 src/scripts/vitest-bench.py run [--out tmp/vitest-bench/results.json] [--slots 2] [FILE ...]
    python3 src/scripts/vitest-bench.py table [--in tmp/vitest-bench/results.json] [--top 30]
    python3 src/scripts/vitest-bench.py pack [--in ...] [--workers 4,5,6,10]
    python3 src/scripts/vitest-bench.py observe --out tmp/YOUR-LANE/census.json [--pid PID | --count 3]
    (passive identity-aware census; sampled CPU lower bounds, not exact full-gate totals)
    Add --proof-root RECEIPT_OR_DIRECTORY --command-log FULL_TEST_DAY_LOG to request a strict producer join.

`run` resumes: files already in the results JSON at the same commit are skipped. The bench is the machine's
lowest-priority caller. It starts a file only while no full-test lease is held or queued, nobody else waits for
CPU-broker slots and load is under --max-load. It holds its grant through `cpu-admission.py hold`, so the grant dies
with the bench. If any of that changes mid-file it freezes and kills the file's whole tree at once, gives the grant
back and measures the file again later. A file is killed after --timeout (at most 150 s), well inside the broker's
five-minute admission deadline. Wall is measured from the grant; queueing is recorded apart. Discovery (`vitest list`)
runs the same way. Residual: a descendant that deliberately calls setsid() and is never sampled can escape cleanup.

Profiling is default-deny: --cpu-prof once deadlocked Vitest inside OpenSSL's provider lock, and the Vitest config
reaches OpenSSL in every file, so --profile also needs --profile-accept-openssl-risk.
It never edits a test, config, cap or source file.
"""
import argparse
import atexit
import collections
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / 'tmp' / 'vitest-bench' / 'results.json'
# The same root resolution as heavy-lane.py, so a held lease is never missed.
LANES = Path(os.environ.get('WS_HEAVY_SCHEDULER_ROOT', os.environ.get('WS_HEAVY_ROOT', str(Path.home() / '.wildshard-heavy-lanes'))))
# cpu-admission.py honours WS_CPU_ROOT before WS_HEAVY_SCHEDULER_ROOT; the broker state lives there.
CPU_ROOT = Path(os.environ.get('WS_CPU_ROOT', os.environ.get('WS_HEAVY_SCHEDULER_ROOT', str(Path.home() / '.wildshard-heavy-lanes'))))
CANCEL = threading.Event()  # set by SIGTERM/SIGINT/SIGHUP; every wait and launch checks it
VITEST_DIR = os.path.realpath(ROOT / 'node_modules' / 'vitest')
MAXRSS_SCALE = 1 if sys.platform == 'darwin' else 1024  # ru_maxrss: bytes on macOS, KiB on Linux

# Static source signals; a hint for triage, not a verdict.
SIGNALS = {
    'spawn': re.compile(r"\b(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(|node:child_process"),
    'browser': re.compile(r"\b(?:chromium|playwright|puppeteer)\b", re.I),
    'sleep': re.compile(r"setTimeout\s*\(\s*(?:resolve|r|res)\b|\bsleep\s*\(|\bdelay\s*\(\s*\d"),
    'busyWait': re.compile(r"while\s*\(\s*(?:Date\.now|performance\.now)\s*\("),
    'cook': re.compile(r"\bcook[A-Z]\w*\s*\(|cook-worker|\bcookShard\b"),
    'perCaseSetup': re.compile(r"\bbeforeEach\s*\("),
    'fakeTimers': re.compile(r"useFakeTimers"),
}


def git_sha():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def list_files(args, scratch):
    """Vitest's own file list. Discovery loads the Vitest config, so it runs like a file: under a grant, in its own
    session, yielding to any gate. Returns None when it yielded; the caller retries after a quiet wait."""
    work = Path(tempfile.mkdtemp(prefix='list-', dir=scratch))
    target = work / 'files.json'
    try:
        run = run_supervised(['node', 'node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json=' + str(target)],
                             dict(os.environ), work / 'out.log', args.slots, min(args.timeout, 120), args.sample)
        if run['yielded']:
            return None
        if run['timedOut'] or os.waitstatus_to_exitcode(run['status']) != 0:
            tail = (work / 'out.log').read_text(errors='replace')[-1500:]
            raise SystemExit(f'vitest list failed ({"timeout" if run["timedOut"] else run["status"]}):\n{tail}')
        rows = json.loads(target.read_text())
        return {os.path.relpath(row['file'], ROOT): row.get('projectName') for row in rows}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def alive(pid):
    try:
        pid = int(pid)
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def full_test_holders():
    """Live full-test lease holders: their commands. A lease survives through childPid after its runner dies."""
    holders = []
    for path in LANES.glob('full-test*.active.json'):
        try:
            entry = json.loads(path.read_text())
        except FileNotFoundError:
            continue
        except (OSError, ValueError):
            holders.append('unreadable lease marker')  # fail closed
            continue
        if alive(entry.get('pid')) or alive(entry.get('childPid')) or alive(entry.get('runnerPid')):
            holders.append(entry.get('command'))
    return holders


def read_state(root):
    try:
        return json.loads((root / 'queue.json').read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return None


def contention(own_pids=()):
    """Why the bench must yield now, or None. The bench is the lowest-priority caller on the machine: it runs only
    while no full-test lease is held or queued and no other caller waits for CPU-broker slots."""
    if full_test_holders():
        return 'a full-test lease is held'
    for root in {LANES, CPU_ROOT}:
        state = read_state(root)
        if state is None:
            return 'scheduler state unreadable'
        if any('full-test' in row.get('resources', ()) and alive(row.get('pid')) for row in state.get('queue', [])):
            return 'a full-test lease is queued'
        waiting = [row for row in state.get('cpuQueue', []) if alive(row.get('pid')) and row.get('pid') not in own_pids]
        if waiting:
            return f'{len(waiting)} caller(s) wait for CPU slots'
    return None


def wait_for_quiet_machine(log, max_load):
    """Pause while any gate holds or waits for full-test, anyone else waits for CPU slots, or load is high."""
    waited = 0.0
    while True:
        if CANCEL.is_set():
            raise SystemExit(130)
        reason = contention()
        load = os.getloadavg()[0]
        if reason is None and load <= max_load:
            return waited
        if waited % 60 == 0:
            log(f'paused: {reason or f"load {load:.1f}"}')
        CANCEL.wait(5)
        waited += 5


def process_table(timeout=10.0):
    out = subprocess.run(['ps', '-axo', 'pid=,ppid=,rss=,comm='], capture_output=True, text=True,
                         timeout=max(0.2, timeout)).stdout
    table = {}
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            table[int(parts[0])] = (int(parts[1]), int(parts[2]) * 1024, parts[3])
    return table


def kind_of(command):
    name = os.path.basename(command).lower()
    if 'chrom' in name or 'headless_shell' in name: return 'browser'
    if name in ('node', 'node24'): return 'node'
    if name.startswith('python'): return 'python'
    if name in ('esbuild', 'oxlint', 'tsgo', 'tsc'): return name
    if name in ('sh', 'bash', 'zsh', 'env'): return 'shell'
    return 'native:' + name[:24]


class TreeSampler(threading.Thread):
    """Samples the descendant tree of one pid: distinct children by kind and peak summed RSS."""

    def __init__(self, root, interval):
        super().__init__(daemon=True)
        self.root, self.interval, self.stop = root, interval, threading.Event()
        self.seen, self.peak_rss, self.peak_procs = {}, 0, 0

    def run(self):
        while not self.stop.is_set():
            table = process_table()
            children = collections.defaultdict(list)
            for pid, (ppid, _rss, _comm) in table.items():
                children[ppid].append(pid)
            tree, stack = [], [self.root]
            while stack:
                pid = stack.pop()
                if pid in table:
                    tree.append(pid)
                stack.extend(children.get(pid, ()))
            self.peak_rss = max(self.peak_rss, sum(table[pid][1] for pid in tree))
            self.peak_procs = max(self.peak_procs, len(tree))
            for pid in tree:
                if pid != self.root:
                    self.seen.setdefault(pid, table[pid][2])
            self.stop.wait(self.interval)


def summarize_profiles(directory, top):
    """Self time per function across every .cpuprofile in directory, plus self time by code origin."""
    by_function, by_origin, total = collections.Counter(), collections.Counter(), 0.0
    for path in Path(directory).glob('*.cpuprofile'):
        try:
            profile = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        nodes = {node['id']: node['callFrame'] for node in profile.get('nodes', [])}
        for sample, delta in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
            frame = nodes.get(sample)
            if frame is None or frame['functionName'] == '(idle)':
                continue
            seconds = max(delta, 0) / 1e6
            url = frame.get('url', '')
            short = re.sub(r'^file://', '', url).replace(str(ROOT) + '/', '')
            short = re.sub(r'.*/node_modules/\.pnpm/[^/]+/node_modules/', 'nm:', short)
            short = re.sub(r'.*/node_modules/', 'nm:', short)
            name = frame['functionName'] or '(anonymous)'
            by_function[f"{name} {short}:{frame.get('lineNumber', -1) + 1}" if short else name] += seconds
            by_origin[origin_of(name, short)] += seconds
            total += seconds
    return {'sampledSeconds': round(total, 3),
            'origins': {key: round(value, 3) for key, value in by_origin.most_common()},
            'top': [[key, round(value, 3)] for key, value in by_function.most_common(top)]}


def origin_of(name, short):
    if name == '(garbage collector)': return 'gc'
    if name == '(program)': return 'program'
    if short.startswith('wasm://'): return 'wasm'
    if short.startswith(('test/', 'src/test/')) or '.test.' in short: return 'test'
    if short.startswith('src/'): return 'engine'
    if short.startswith('src/scripts/'): return 'scripts'
    if short.startswith('nm:'):
        pkg = short[3:].split('/')
        package = '/'.join(pkg[:2]) if pkg[0].startswith('@') else pkg[0]
        return 'nm:' + package
    if short.startswith('node:') or not short: return 'node-internal'
    return 'other'


# --cpu-prof once deadlocked a Vitest main process inside OpenSSL's provider lock (crypto.getCiphers); never profile a
# file that reaches TLS or OpenSSL, directly or as a known case.
OPENSSL = re.compile(r"node:crypto|from 'crypto'|node:tls|node:https|\bcreateHash\b|\bcreateHmac\b|randomBytes|webcrypto|crypto\.subtle|getCiphers")
PROFILE_DENY = {'test/trade-handoff.test.ts'}


def profile_risk(file):
    """Default-deny. Every engine file reaches OpenSSL through the Vitest config itself (the module cache hashes with
    createHash), so no file is provably safe under --cpu-prof; profiling needs --profile-accept-openssl-risk, and
    files whose own source reaches TLS or OpenSSL stay unprofiled even then."""
    if file in PROFILE_DENY:
        return True
    try:
        return bool(OPENSSL.search((ROOT / file).read_text()))
    except OSError:
        return True


def static_signals(file):
    try:
        text = (ROOT / file).read_text()
    except OSError:
        return []
    return [name for name, pattern in SIGNALS.items() if pattern.search(text)]


ACTIVE = set()  # Popen objects whose trees this harness owns; killed on any exit path
ACTIVE_LOCK = threading.Lock()
# Vitest stops forks with SIGTERM and V8 writes a profile only on a clean exit. Vitest's own --cpu-prof work-around
# (nodejs/node#55094) covers only its execArgv; mirror it for Vitest processes alone, with a captured exit, and leave
# every other Node child's signal behaviour unchanged.
def exit_hook_text():
    """Only processes whose entry script resolves inside this checkout's Vitest package (its CLI and its fork workers)."""
    return ("import {realpathSync} from 'node:fs';const exit=process.exit.bind(process);"
            f"let entry='';try{{entry=realpathSync(process.argv[1]??'')}}catch{{}}"
            f"if(entry.startsWith({json.dumps(VITEST_DIR + os.sep)}))process.on('SIGTERM',()=>exit(143));\n")


def tree_of(root, table):
    found, stack = [], [root]
    while stack:
        pid = stack.pop()
        if pid in table:
            found.append(pid)
        stack.extend(other for other, row in table.items() if row[0] == pid)
    return found


def kill_tree(root, session=None, deadline=3.0):
    """Freeze, then kill, every descendant of root and every process still in its session, within one absolute
    deadline. SIGSTOP first so nothing spawns during teardown. If the process table cannot be read in time, fall
    back to killing the session's process group (the file is its group leader). A process that deliberately calls
    setsid() and is never sampled can escape; that residual is documented, not handled."""
    stop_at = time.monotonic() + deadline
    doomed = set()
    try:
        while time.monotonic() < stop_at:
            table = process_table(stop_at - time.monotonic())
            members = set(tree_of(root, table))
            if session is not None:
                for pid in table:
                    try:
                        if os.getsid(pid) == session:
                            members.add(pid)
                    except OSError:
                        pass
            fresh = members - doomed - {os.getpid()}
            if not fresh:
                break
            for pid in fresh:
                doomed.add(pid)
                try:
                    os.kill(pid, signal.SIGSTOP)
                except OSError:
                    pass
    except (OSError, subprocess.SubprocessError, ValueError):
        pass  # fall through to the known pids and the group kill
    for pid in doomed | {root}:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    if session is not None:
        try:
            os.killpg(session, signal.SIGKILL)
        except OSError:
            pass
    return len(doomed)


def reap_session(session, budget=3.0):
    """Kill until the session is empty or the absolute budget ends; return the survivors (SIGKILLed, so they
    cannot run; only a process in uninterruptible sleep outlives that)."""
    stop_at = time.monotonic() + budget
    survivors = []
    while time.monotonic() < stop_at:
        try:
            survivors = session_members(session, stop_at - time.monotonic())
        except (OSError, subprocess.SubprocessError, ValueError):
            survivors = ['unreadable']
            break
        if not survivors:
            return []
        for pid in survivors:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        time.sleep(0.05)
    return survivors


def session_members(session, timeout=10.0):
    members = []
    for pid in process_table(timeout):
        try:
            if os.getsid(pid) == session:
                members.append(pid)
        except OSError:
            pass
    return members


def kill_all_active(*_):
    with ACTIVE_LOCK:
        owned = list(ACTIVE)
    # Files first, then grants: a holder released through its pipe removes its own broker entry.
    for child in sorted(owned, key=lambda proc: not getattr(proc, 'session', False)):
        try:
            if getattr(child, 'session', False):
                kill_tree(child.pid, session=child.pid)
                child.kill()
            else:
                release_grant(child)
        except (OSError, subprocess.SubprocessError):
            pass


def install_cleanup():
    atexit.register(kill_all_active)

    def stop(_signum, _frame):
        # Only set the flag: cleanup takes locks and runs ps, which is unsafe inside a handler. The watcher kills
        # the running file and returns its grant within half a second; waits and the file loop see the flag.
        CANCEL.set()
    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(name, stop)


def acquire_grant(slots, timeout):
    """Hold a CPU-broker grant through cpu-admission.py's hold protocol. The grant lives exactly as long as the
    returned pipe: closing stdin, or this process dying, releases it. While queued, any contention or cancellation
    withdraws the request at once. Returns (holder, queueSeconds) or (None, reason)."""
    holder = subprocess.Popen(['python3', 'src/scripts/cpu-admission.py', 'hold', '--slots', str(slots)], cwd=ROOT,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    with ACTIVE_LOCK:
        ACTIVE.add(holder)
    line = []
    reader = threading.Thread(target=lambda: line.append(holder.stdout.readline()), daemon=True)
    reader.start()
    began = time.monotonic()
    while reader.is_alive():
        reason = 'cancelled' if CANCEL.is_set() else contention(own_pids={holder.pid})
        if reason or time.monotonic() - began > timeout:
            release_grant(holder)
            return None, reason or f'no CPU grant within {timeout:.0f} s'
        reader.join(0.2)
    if not line or not line[0].strip():
        release_grant(holder)
        return None, 'CPU admission refused'
    return holder, json.loads(line[0])['queueSeconds']


def release_grant(holder):
    # EOF releases a held grant. A request still queued is not reading stdin, so SIGTERM it: cpu-admission removes
    # its own queue entry on interruption, and the bench never sits ahead of a gate in the broker's FIFO.
    try:
        holder.stdin.close()
    except OSError:
        pass
    for stop in (None, holder.terminate, holder.kill):
        if stop:
            stop()
        try:
            holder.wait(2 if stop is None else 5)
            break
        except subprocess.TimeoutExpired:
            continue
    with ACTIVE_LOCK:
        ACTIVE.discard(holder)


def run_supervised(command, env, log_path, slots, timeout, sample):
    """Run one command as the machine's lowest-priority caller. Take a CPU-broker grant (withdrawn on contention),
    recheck, launch in a fresh session, and watch every half second: on contention, cancellation or the hard clock
    (at most 150 s, inside the broker's five-minute admission deadline) kill the whole session, verify it is gone and
    return the grant at once. Any error in the check counts as contention. Returns the wait4 status and rusage."""
    holder, queued = acquire_grant(slots, 60)
    if holder is None:
        return {'yielded': queued}
    reason = 'cancelled' if CANCEL.is_set() else contention(own_pids={holder.pid})
    if reason:  # recheck between the grant and the launch
        release_grant(holder)
        return {'yielded': reason}
    yielded, timed_out, cleanup = [], [], []
    try:
        began = time.monotonic()
        with open(log_path, 'wb') as log:
            child = subprocess.Popen(command, cwd=ROOT, env={**env, 'WS_CPU_SLOTS': str(slots)}, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            child.session = True
            with ACTIVE_LOCK:
                ACTIVE.add(child)
            sampler = TreeSampler(child.pid, sample)
            sampler.start()
            done = threading.Event()

            def stop(why, bucket):
                # Kill and verify within one absolute budget, then return the grant unconditionally: a gate waiting
                # on the broker outranks cleanup verification (that wait is what turned a gate red). Survivors were
                # SIGKILLed and cannot run; they are reported, and the run stops.
                bucket.append(why)
                try:
                    kill_tree(child.pid, session=child.pid, deadline=2.0)
                    cleanup.extend(reap_session(child.pid, budget=2.0))
                except Exception as error:  # noqa: BLE001 - the grant still goes back
                    cleanup.append(f'cleanup error: {error}')
                finally:
                    release_grant(holder)

            def watch():
                while not done.wait(0.5):
                    try:
                        reason = 'cancelled' if CANCEL.is_set() else contention(own_pids={holder.pid, child.pid})
                    except Exception as error:  # noqa: BLE001 - fail closed
                        reason = f'contention check failed: {error}'
                    if reason:
                        stop(reason, yielded)
                        return
                    if time.monotonic() - began > timeout:
                        stop('timeout', timed_out)
                        return
            watcher = threading.Thread(target=watch, daemon=True)
            watcher.start()
            try:
                _, status, usage = os.wait4(child.pid, 0)
            except BaseException:
                kill_tree(child.pid, session=child.pid)
                raise
            wall = time.monotonic() - began
            # Nothing the file started may outlive it: kill and verify its session, and any sampled descendant that
            # left the session, before the grant is released.
            leftovers = len(session_members(child.pid, 3.0))
            kill_tree(child.pid, session=child.pid, deadline=3.0)
            table = process_table(3.0)
            for pid, comm in list(sampler.seen.items()):
                row = table.get(pid)
                if row and row[2] == comm:
                    leftovers += 1
                    kill_tree(pid, deadline=1.0)
            cleanup.extend(reap_session(child.pid, budget=3.0))
            done.set()
            watcher.join(5)
            sampler.stop.set()
            sampler.join(5)
            with ACTIVE_LOCK:
                ACTIVE.discard(child)
    finally:
        release_grant(holder)
    if cleanup:  # surfaced after the grant is back
        raise RuntimeError(f'processes survived cleanup of session {child.pid}: {cleanup[:5]}')
    return {'yielded': yielded[0] if yielded else None, 'timedOut': bool(timed_out), 'status': status, 'usage': usage,
            'wall': wall, 'queued': queued, 'sampler': sampler, 'leftovers': leftovers}


def run_one(file, project, args, scratch):
    work = Path(tempfile.mkdtemp(prefix='bench-', dir=scratch))
    report = work / 'report.json'
    env = {**os.environ, 'WS_VITEST_MAX_WORKERS': '1', 'FORCE_COLOR': '0'}
    profile = args.profile and not profile_risk(file)
    if profile:
        prof = work / 'prof'
        prof.mkdir()
        exit_hook, exit_hook_source = Path(scratch) / "cpu-prof-exit.mjs", exit_hook_text()
        exit_hook.write_text(exit_hook_source)
        env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + f' --import={exit_hook.as_uri()}'
                               f' --cpu-prof --cpu-prof-dir={prof} --cpu-prof-interval={args.profile_interval}').strip()
    vitest = ['node', 'node_modules/vitest/vitest.mjs', 'run', file, '--reporter=json', '--outputFile=' + str(report)]
    began_epoch = time.time()
    run = run_supervised(vitest, env, work / 'out.log', args.slots, args.timeout, args.sample)
    if run['yielded']:
        shutil.rmtree(work, ignore_errors=True)
        return {'file': file, 'yielded': run['yielded']}
    status, usage, wall, queued, sampler, leftovers = (run['status'], run['usage'], run['wall'], run['queued'],
                                                       run['sampler'], run['leftovers'])
    timed_out = run['timedOut']
    code = os.waitstatus_to_exitcode(status)
    row = {'file': file, 'project': project, 'exit': code, 'timedOut': timed_out, 'wallSeconds': round(wall, 3),
           'queueSeconds': round(queued, 3), 'userSeconds': round(usage.ru_utime, 3), 'systemSeconds': round(usage.ru_stime, 3),
           'cpuSeconds': round(usage.ru_utime + usage.ru_stime, 3),
           'maxRssMB': round(usage.ru_maxrss * MAXRSS_SCALE / 2**20, 1),
           'peakTreeRssMB': round(sampler.peak_rss / 2**20, 1), 'peakProcesses': sampler.peak_procs,
           'leftoverProcesses': leftovers,
           'children': dict(collections.Counter(kind_of(comm) for comm in sampler.seen.values())),
           'signals': static_signals(file), 'profiled': profile, 'measuredAt': int(time.time())}
    try:
        data = json.loads(report.read_text())
        result = data['testResults'][0] if data.get('testResults') else {}
        cases = result.get('assertionResults', [])
        if data.get('startTime'):  # Node and Vitest config start, before Vitest's run clock
            row['startupSeconds'] = round(data['startTime'] / 1000 - began_epoch - queued, 3)
        row.update({'tests': data.get('numTotalTests'), 'passed': data.get('numPassedTests'),
                    'failed': data.get('numFailedTests'), 'skipped': data.get('numPendingTests', 0) + data.get('numTodoTests', 0),
                    'vitestFileSeconds': round((result.get('endTime', 0) - result.get('startTime', 0)) / 1000, 3) if result else None,
                    'slowCases': sorted(([case.get('fullName', case.get('title')), round((case.get('duration') or 0) / 1000, 3)]
                                         for case in cases), key=lambda pair: -pair[1])[:3]})
    except (OSError, ValueError, KeyError, IndexError):
        row['report'] = 'missing'
    if code != 0:
        row['tail'] = (work / 'out.log').read_text(errors='replace')[-1500:]
    if profile:
        row['profile'] = summarize_profiles(work / 'prof', args.top_functions)
    elif args.profile:
        row['profileSkipped'] = 'reaches TLS or OpenSSL'
    shutil.rmtree(work, ignore_errors=True)
    return row


def load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=1) + '\n')
    tmp.replace(path)


def command_run(args):
    if args.profile and not args.profile_accept_openssl_risk:
        raise SystemExit('--profile needs --profile-accept-openssl-risk: the Vitest config reaches OpenSSL in every file, '
                         'and --cpu-prof once deadlocked there; the contention watcher bounds what a stall costs a gate')
    if not 0 < args.timeout <= 150:
        raise SystemExit('--timeout must be in (0, 150] seconds: inside the broker\'s five-minute admission deadline')
    install_cleanup()
    sha = git_sha()
    log = lambda message: print(time.strftime('%H:%M:%S'), message, flush=True)
    scratch = ROOT / 'tmp' / 'vitest-bench' / 'work'
    scratch.mkdir(parents=True, exist_ok=True)
    projects = None
    while projects is None:  # discovery loads the Vitest config too: supervised like a file, retried on contention
        wait_for_quiet_machine(log, args.max_load)
        projects = list_files(args, scratch)
    files = args.files or sorted(projects)
    data = load(args.out)
    if not data or data.get('sha') != sha or data.get('profiled') != bool(args.profile):
        data = {'schema': 1, 'sha': sha, 'host': os.uname().nodename, 'cpuCount': os.cpu_count(), 'slots': args.slots,
                'workers': 1, 'profiled': bool(args.profile), 'node': subprocess.check_output(['node', '-v'], text=True).strip(),
                'startedAt': int(time.time()), 'files': {}}
    def stale(row):
        return ((args.retry_failed and row.get('exit')) or
                (args.remeasure_queued is not None and
                 (row.get('startupSeconds') or 0) + (row.get('queueSeconds') or 0) > args.remeasure_queued))
    todo = [file for file in files if file not in data['files'] or stale(data['files'][file])]
    scratch = ROOT / 'tmp' / 'vitest-bench' / 'work'
    scratch.mkdir(parents=True, exist_ok=True)
    done = len(files) - len(todo)
    log(f'{len(todo)} files to measure, {done} already recorded at {sha[:7]}')

    def task(file):
        paused = 0.0
        for attempt in range(20):
            if CANCEL.is_set():
                raise SystemExit(130)
            paused += wait_for_quiet_machine(log, args.max_load)
            context = {'loadAtStart': round(os.getloadavg()[0], 1), 'pausedSeconds': paused, 'yields': attempt}
            row = run_one(file, projects.get(file), args, scratch)
            if 'yielded' not in row:
                return {**row, **context}
            log(f"yielded {file}: {row['yielded']}")
        return {'file': file, 'project': projects.get(file), 'exit': None, 'skipped': 'yielded 20 times', 'wallSeconds': 0,
                'userSeconds': 0, 'systemSeconds': 0, 'cpuSeconds': 0, 'maxRssMB': 0, 'children': {}, 'signals': []}

    for file in todo:  # one file at a time (Jake, 2026-11-10)
        if CANCEL.is_set():
            break
        row = task(file)
        data['files'][row['file']] = row
        done += 1
        save(args.out, data)
        log(f"[{done}/{len(files)}] {row['file']} wall={row['wallSeconds']}s cpu={row['cpuSeconds']}s "
            f"rss={row['maxRssMB']}MB exit={row['exit']}")
    if CANCEL.is_set():
        log('cancelled; the running file was killed and its grant returned')
        raise SystemExit(143)
    data['finishedAt'] = int(time.time())
    save(args.out, data)


def command_table(args):
    data = load(args.inp)
    rows = sorted(data['files'].values(), key=lambda row: -row['cpuSeconds'])
    print("| # | File | CPU s | User s | Sys s | Wall s | CPU/wall | Max RSS MB | Children | Signals | Top self-time |")
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for index, row in enumerate(rows[:args.top], 1):
        ratio = row['cpuSeconds'] / row['wallSeconds'] if row['wallSeconds'] else 0
        children = ', '.join(f'{k} {v}' for k, v in sorted(row['children'].items()) if k not in ('node', 'python')) or '-'
        top = (row.get('profile') or {}).get('top', [])[:1]
        top = top[0][0].split(' ')[0] + f' ({top[0][1]}s)' if top else '-'
        print(f"| {index} | `{row['file']}` | {row['cpuSeconds']:.1f} | {row['userSeconds']:.1f} | {row['systemSeconds']:.1f} | "
              f"{row['wallSeconds']:.1f} | {ratio:.2f} | {row['maxRssMB']:.0f} | {children} | {', '.join(row['signals']) or '-'} | {top} |")


def pack(durations, workers):
    """Longest-processing-time-first list schedule: the wall of files alone on N workers."""
    loads = [0.0] * workers
    for duration in sorted(durations, reverse=True):
        loads[loads.index(min(loads))] += duration
    return max(loads)


def command_pack(args):
    data = load(args.inp)
    every = list(data['files'].values())
    rows = [row for row in every if row.get('exit') == 0 and not row.get('timedOut') and row.get('wallSeconds')]
    if len(rows) < len(every):
        print(f'excluded {len(every) - len(rows)} failed, timed-out or unmeasured rows', file=sys.stderr)
    net = [max(row['wallSeconds'] - args.overhead, 0.05) for row in rows]
    cpu = sum(row['cpuSeconds'] for row in rows)
    wall = sum(row['wallSeconds'] for row in rows)
    print(json.dumps({'files': len(rows), 'cpuSeconds': round(cpu, 1), 'serialWallSeconds': round(wall, 1),
                      'packedWallSeconds': {n: round(pack(net, n), 1) for n in args.workers}}, indent=1))


# Match the executable and its entry script, not a wrapper that mentions the gate.
# --pid remains available for launchers/options whose argv ps cannot disambiguate.
GATE_ROOT = r'^(?:\S*/)?node(?:24)?(?:\s+--[^\s]+)*\s+(?:\S*/)?\.githooks/push-checks\.mjs(?:\s|$)'


def gate_candidates(output, pattern):
    roots = []
    for line in output.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            pid, uid = map(int, parts[:2])
            if pid > 1 and pid != os.getpid() and uid == os.getuid() and pattern.search(parts[2]):
                roots.append(pid)
    return sorted(set(roots))


def choose_gate(roots):
    if len(roots) > 1:
        raise SystemExit('ambiguous gate roots; give --pid for the intended owner')
    return roots[0] if roots else None


def cpu_census():
    name = '_vitest_cpu_census'
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT / 'src/scripts/cpu-census.py')
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # Dataclasses resolve their annotations through the module table.
        try:
            # Read the maintained API without writing a bytecode cache beside the source.
            exec(compile(spec.loader.get_source(name), str(spec.origin), 'exec'), module.__dict__)
        except BaseException:
            del sys.modules[name]
            raise
    return sys.modules[name]


def observe_root(args):
    census = cpu_census()
    try:
        backend = census.process_backend()
        return select_owner(args, census, backend)
    except (OSError, ValueError, subprocess.CalledProcessError, census.CensusRefused) as error:
        raise SystemExit(f'census owner refused: {error}') from error


def select_owner(args, census, backend):
    if args.pid is not None:
        return census.owned_process(backend, args.pid)
    pattern = re.compile(args.root)
    until = time.monotonic() + args.wait_seconds
    while True:
        before = backend.processes()[0]
        try:
            output = subprocess.run(['ps', '-axo', 'pid=,uid=,command='], check=True,
                                    capture_output=True, text=True,
                                    timeout=max(.05, min(5, until - time.monotonic()))).stdout
        except subprocess.TimeoutExpired:
            raise SystemExit('process inventory exceeded discovery deadline; give --pid or retry later')
        root = choose_gate(gate_candidates(output, pattern))
        if root is not None:
            if root not in before:
                if time.monotonic() >= until:
                    raise SystemExit('no matching gate before discovery deadline; give --pid or retry later')
                time.sleep(min(args.interval, max(0, until - time.monotonic())))
                continue  # A newly born candidate needs its own before/after identity snapshots.
            after = backend.processes()[0]
            first = census.owned_process(backend, root, before)
            current = census.owned_process(backend, root, after)
            if first.identity != current.identity:
                raise SystemExit('census owner identity changed during discovery; retry explicitly')
            return current
        if time.monotonic() >= until:
            raise SystemExit('no matching gate before discovery deadline; give --pid or retry later')
        time.sleep(min(args.interval, max(0, until - time.monotonic())))


def census_summary(report, status, recorder_error):
    start, end, cpu, cpu_by_kind, samples = None, None, 0, collections.Counter(), 0
    with report.open() as reader:
        for line in reader:
            row = json.loads(line)
            if row['type'] == 'start':
                start = row
            elif row['type'] == 'sample':
                samples += 1
                for process in row['processes']:
                    delta = process['cpuDeltaNsLowerBound'] / 1e9
                    cpu += delta
                    cpu_by_kind[kind_of(process['name'])] += delta
            elif row['type'] == 'end':
                end = row
    if start is None or end is None:
        raise SystemExit(f'incomplete census; raw observation retained at {report}\n{recorder_error.strip()}'.rstrip())
    kinds = collections.Counter(kind_of(process['name']) for process in end['observedProcesses'])
    return {'root': start['root'], 'startedAtMs': start['startedAtMs'],
            'machine': start.get('machine'), 'platform': start['platform'], 'endedAtMs': end.get('endedAtMs'),
            'gateKind': 'unverified', 'rawReport': os.path.relpath(report, ROOT),
            'observationWallSeconds': end['seconds'], 'sampledCpuSecondsLowerBound': cpu,
            'averageObservedCpuCoresLowerBound': cpu / end['seconds'] if end['seconds'] else None,
            'peakIntervalCpuCoresLowerBound': end['peak']['intervalCpuCoresLowerBound'],
            'peakSummedRssMB': end['peak']['summedRssBytes'] / 2**20,
            'peakProcesses': end['peak']['processes'], 'processes': len(end['observedProcesses']),
            'processesByKind': dict(kinds), 'sampledCpuSecondsByKindLowerBound': dict(cpu_by_kind),
            'remaining': end['remaining'], 'reason': end['reason'], 'incompleteReads': end['incompleteReads'],
            'identityReadsIncomplete': end.get('identityReadsIncomplete'),
            'counterReadsIncomplete': end.get('counterReadsIncomplete'),
            'unresolvedIdentityReads': end.get('unresolvedIdentityReads'),
            'allObservedChildrenDrained': status == 0 and end['rootMeasured'] and not end['remaining']
                                          and end['reason'] == 'observed tree drained',
            'samples': samples, 'observerCpuSeconds': end['observerCpuNs'] / 1e9,
            'limits': start['limits'],
            'exactGateCpu': None,
            'qualification': 'Not an exact full-gate total: attach full/split provenance and reaped-tree '
                             'user/system rusage separately. A sampled empty tree does not prove '
                             'that every short-lived descendant was observed.'}


def qualify_observation(args, report, used):
    """Read-only producer tail settling, bounded by the existing drain budget; never signal an owner."""
    if args.proof_root is None or args.command_log is None:
        return {'qualified': False, 'reason': 'qualification requires both --proof-root and --command-log'}
    name = '_gate_census_qualification'
    if name not in sys.modules:
        try:
            spec = importlib.util.spec_from_file_location(name, ROOT / 'src/scripts/gate_census_qualification.py')
            module = importlib.util.module_from_spec(spec)
            exec(compile(spec.loader.get_source(name), str(spec.origin), 'exec'), module.__dict__)
            sys.modules[name] = module
        except (OSError, ValueError, ImportError, AttributeError, TypeError, SyntaxError) as error:
            return {'qualified': False, 'reason': f'qualifier unavailable: {error}'}
    reader = sys.modules[name].QualificationReader(report, args.proof_root, args.command_log, used)
    until = time.monotonic() + args.drain_seconds
    result = reader.poll()
    while result.get('pending') and time.monotonic() < until:
        try:
            size = args.command_log.stat().st_size
        except OSError:
            break
        while time.monotonic() < until:
            time.sleep(min(.05, max(0, until - time.monotonic())))
            try:
                if args.command_log.stat().st_size != size:
                    break
            except OSError:
                break
        result = reader.poll()
    return result


def command_observe(args):
    """Observe existing owners through the identity-aware recorder; never launch or signal a gate."""
    schema = 'vitest-gate-census/2'
    if args.out.exists():
        data = json.loads(args.out.read_text())
        if data.get('schema') != schema or not isinstance(data.get('observations'), list):
            raise SystemExit('incompatible census summary; use a new --out path for version 2 observations')
    else:
        data = {'schema': schema, 'observations': []}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    used = set()
    for observation in data['observations']:
        if not isinstance(observation, dict):
            raise SystemExit('incompatible census observation; retain it and use a new --out')
        qualification = observation.get('producerQualification', {})
        if not isinstance(qualification, dict):
            raise SystemExit('incompatible census producer history; retain it and use a new --out')
        if qualification.get('qualified') is True:
            if not all(isinstance(qualification.get(key), str) and qualification[key] for key in ('proofKey', 'commandKey')):
                raise SystemExit('qualified census history is missing producer keys; retain it and use a new --out')
            used.update(qualification[key] for key in ('proofKey', 'commandKey'))
    for _ in range(args.count):
        owner = observe_root(args)
        root = owner.pid
        report = args.out.with_name(f'{args.out.stem}.{time.time_ns()}.{root}.jsonl')
        command = [sys.executable, str(ROOT / 'src/scripts/cpu-census.py'), '--pid', str(root),
                   '--report', str(report), '--interval', str(args.interval), '--seconds', str(args.seconds),
                   '--drain-seconds', str(args.drain_seconds), '--expected-identity', owner.identity]
        print(f'observing root pid {root}; raw report {report}', flush=True)
        try:
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=args.seconds + args.drain_seconds + args.interval + 15)
        except subprocess.TimeoutExpired as error:
            evidence = f'raw observation retained at {report}' if report.exists() else f'no raw observation published at {report}'
            raise SystemExit(f'census recorder timed out; {evidence}; target was not signalled') from error
        if not report.exists():
            raise SystemExit(result.stderr.strip() or 'census refused before observation')
        row = census_summary(report, result.returncode, result.stderr)
        row['selectedRootIdentity'] = owner.identity
        requested = args.proof_root is not None or args.command_log is not None
        if requested:
            qualification_began, qualification_cpu = time.monotonic(), time.process_time()
            qualification = qualify_observation(args, report, used)
            row['qualificationWallSeconds'] = time.monotonic() - qualification_began
            row['qualificationCpuSeconds'] = time.process_time() - qualification_cpu
            row['producerQualification'] = qualification
            if qualification['qualified']:
                row['gateKind'] = 'full'
                row['exactGateCpu'] = {key: qualification[key] for key in
                                       ('userSeconds', 'systemSeconds', 'cpuSeconds', 'commandWallSeconds', 'scope')}
                row['qualification'] = ('Qualified owned-command rusage, including descendants reaped by that command. '
                                        'Pre-attach or short-lived reparented children may escape counters and orphan detection; '
                                        'observed CPU/parallelism stay sampled lower bounds.')
                used.update(qualification[key] for key in ('proofKey', 'commandKey'))
            else:
                row['qualification'] = f"Unqualified: {qualification['reason']}; raw evidence retained."
        data['observations'].append(row)
        save(args.out, data)
        message = {'root': root, 'sampledCpuSecondsLowerBound': row['sampledCpuSecondsLowerBound'],
                   'allObservedChildrenDrained': row['allObservedChildrenDrained'], 'reason': row['reason']}
        if requested:
            message.update(qualifiedCommandCpu=row['producerQualification']['qualified'],
                           commandCpuSeconds=row['exactGateCpu']['cpuSeconds'] if row['exactGateCpu'] else None,
                           qualification=row['qualification'])
        print(json.dumps(message), flush=True)
        if result.returncode != 0:
            raise SystemExit(result.returncode)
        if requested and not row['producerQualification']['qualified']:
            raise SystemExit(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run')
    run.add_argument('files', nargs='*')
    run.add_argument('--out', default=str(DEFAULT_OUT))
    run.add_argument('--slots', type=int, default=2, help='CPU-admission weight per file (default 2)')
    run.add_argument('--profile', action='store_true', help='V8 CPU profile every Node process in the tree')
    run.add_argument('--profile-accept-openssl-risk', action='store_true',
                     help='required with --profile; see profile_risk()')
    run.add_argument('--profile-interval', type=int, default=5000, help='sampling interval in microseconds')
    run.add_argument('--top-functions', type=int, default=12)
    run.add_argument('--sample', type=float, default=0.25, help='process-tree sampling interval in seconds')
    run.add_argument('--retry-failed', action='store_true')
    run.add_argument('--remeasure-queued', type=float, metavar='SECONDS',
                     help='re-run files whose CPU-grant queue plus start exceeded this (a gate held the broker)')
    run.add_argument('--timeout', type=float, default=150, help='kill a file\'s whole tree after this many seconds')
    run.add_argument('--max-load', type=float, default=20, help='pause while the 1-minute load average is above this')
    table = sub.add_parser('table')
    table.add_argument('--in', dest='inp', default=str(DEFAULT_OUT))
    table.add_argument('--top', type=int, default=30)
    packer = sub.add_parser('pack')
    packer.add_argument('--in', dest='inp', default=str(DEFAULT_OUT))
    packer.add_argument('--workers', type=lambda text: [int(n) for n in text.split(',')], default=[2, 4, 5, 6, 8, 10])
    packer.add_argument('--overhead', type=float, default=0.0, help='per-process startup seconds to subtract')
    observe = sub.add_parser('observe')
    roots = observe.add_mutually_exclusive_group()
    roots.add_argument('--root', default=GATE_ROOT, help='anchored process-command regex; refuses ambiguous roots')
    roots.add_argument('--pid', type=int, help='existing owner PID; observation never launches or signals it')
    observe.add_argument('--out', type=Path, required=True, help='version-2 summary in your owned repository scratch')
    observe.add_argument('--wait-seconds', type=float, default=120, help='discovery deadline, at most 120 seconds')
    observe.add_argument('--seconds', type=float, default=1200, help='observation deadline, at most 3600 seconds')
    observe.add_argument('--drain-seconds', type=float, default=10)
    observe.add_argument('--interval', type=float, default=0.5)
    observe.add_argument('--count', type=int, default=1)
    observe.add_argument('--proof-root', type=Path, help='one producer receipt or bounded receipt directory; optional strict qualification')
    observe.add_argument('--command-log', type=Path, help='matching full-test-day.log; required with --proof-root')
    args = parser.parse_args()
    if args.command == 'observe':
        if (args.proof_root is None) != (args.command_log is None):
            parser.error('qualification requires both --proof-root and --command-log')
        if not .05 <= args.interval <= 10 or not 0 <= args.wait_seconds <= 120 or not 1 <= args.seconds <= 3600 or not 0 <= args.drain_seconds <= 30 or args.count < 1:
            parser.error('give bounded observation/discovery intervals and a positive count')
        if args.pid is not None and (args.pid <= 1 or args.pid == os.getpid() or args.count != 1):
            parser.error('--pid needs one existing owner and --count=1')
        try:
            re.compile(args.root)
        except re.error as error:
            parser.error(f'invalid --root expression: {error}')
    {'run': command_run, 'table': command_table, 'pack': command_pack, 'observe': command_observe}[args.command](args)


if __name__ == '__main__':
    main()
