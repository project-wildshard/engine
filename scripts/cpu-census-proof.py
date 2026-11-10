#!/usr/bin/env python3
"""Manual quick outer-edge proof: real busy/sleeping descendants and an orphan writer."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time


def wait_for(test, seconds=3):
    deadline = time.monotonic() + seconds
    while not test():
        if time.monotonic() >= deadline:
            raise TimeoutError('census control readiness deadline')
        time.sleep(.005)


def actor(kind, work):
    helper = None
    if kind == 'busy':
        ready = threading.Event()
        native_ids = [threading.get_native_id()]
        def sleeping_thread():
            native_ids.append(threading.get_native_id())
            ready.set()
            wait_for(lambda: (work / 'go').exists())
            time.sleep(.9)
        helper = threading.Thread(target=sleeping_thread)
        helper.start()
        assert ready.wait(timeout=1)
        (work / 'busy-thread-ids').write_text(json.dumps(native_ids))
    (work / f'{kind}-ready').write_text(str(os.getpid()))
    wait_for(lambda: (work / 'go').exists())
    began = time.process_time_ns()
    if kind == 'busy':
        while time.process_time_ns() - began < 750_000_000:
            pass
        helper.join(timeout=1)
        assert not helper.is_alive()
    elif kind == 'sleeper':
        time.sleep(.9)
    else:
        wait_for(lambda: (work / 'after-observer').exists())
        (work / 'writer-survived').write_text('observer never signalled the writer')
    completed = work / f'{kind}-cpu'
    temporary = work / f'{kind}-cpu.partial'
    temporary.write_text(str(time.process_time_ns() - began))
    temporary.replace(completed)  # Publish only after the actor's final write is closed.


def fixture(work, leak):
    kinds = ['writer'] if leak else ['busy', 'sleeper']
    children = [subprocess.Popen([sys.executable, __file__, '--actor', kind, str(work)]) for kind in kinds]
    def interrupted(_signum, _frame):
        raise SystemExit(2)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        wait_for(lambda: all((work / f'{kind}-ready').exists() for kind in kinds))
        (work / 'ready').write_text(json.dumps([child.pid for child in children]))
        wait_for(lambda: (work / 'go').exists())
        if not leak:
            for child in children:
                assert child.wait(timeout=3) == 0
    finally:
        if not leak:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                child.wait(timeout=2)


def check(work, leak, refusal=None):
    work.mkdir()
    root = subprocess.Popen([sys.executable, __file__, '--fixture', str(work), str(int(leak))],
                            start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    observer = None
    try:
        wait_for(lambda: (work / 'ready').exists())
        actor_pids = json.loads((work / 'ready').read_text())
        report = work / 'census.jsonl'
        command = [sys.executable, 'scripts/cpu-census.py', '--pid', str(root.pid),
                   '--report', str(report), '--interval', '.05', '--seconds', '6', '--drain-seconds', '.2']
        if refusal is not None:
            command += refusal[:2]
        observer = subprocess.Popen(command, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True)
        if refusal is not None:
            stdout, stderr = observer.communicate(timeout=3)
            assert observer.returncode == 2 and refusal[2] in stderr, (stdout, stderr)
            assert root.poll() is None, 'a budget refusal never signals the actual target'
            return {'namedRefusal': refusal[2], 'targetStillAlive': True}
        readable, _, _ = select.select([observer.stdout], [], [], 3)
        assert readable, 'actual census must start before the owned workload'
        first = json.loads(observer.stdout.readline())
        assert first['started'].split(':')[-1] != ''
        wait_for(lambda: report.exists() and len(report.read_text().splitlines()) >= 2)
        (work / 'go').touch()
        # Reap our actual root as the ordinary heavy-lane parent does. Waiting
        # only for the observer would retain a zombie with unreadable libproc
        # identity, which must remain uncertain instead of being called drained.
        deadline = time.monotonic() + 7
        while observer.poll() is None:
            root.poll()
            if time.monotonic() > deadline:
                raise TimeoutError('census observer control deadline')
            time.sleep(.01)
        stdout, stderr = observer.communicate()
        rows = [json.loads(line) for line in report.read_text().splitlines()]
        end = rows[-1]
        assert rows[0]['type'] == 'start' and end['type'] == 'end', (stdout, stderr)
        observed = {row['pid'] for row in end['observedProcesses']}
        assert {root.pid, *actor_pids} <= observed, 'actual children must be observed, not inferred from slots'
        if leak:
            assert observer.returncode == 2, stderr
            assert end['reason'] == 'live observed descendants after root exit', end
            assert any(row['pid'] == actor_pids[0] for row in end['remaining'])
            (work / 'after-observer').touch()
            wait_for(lambda: (work / 'writer-survived').exists() and (work / 'writer-cpu').exists())
            assert root.wait(timeout=1) == 0
            return {'orphanWriterReported': True, 'writerNotSignalled': True, 'writerFinishedAllWrites': True,
                    'samples': end['samples'], 'seconds': end['seconds']}
        assert observer.returncode == 0 and end['remaining'] == [], (end, stderr)
        assert root.wait(timeout=1) == 0
        samples = [row for row in rows if row['type'] == 'sample']
        totals = {pid: sum(process['cpuDeltaNsLowerBound'] for sample in samples
                           for process in sample['processes'] if process['pid'] == pid) for pid in actor_pids}
        busy, sleeper = actor_pids
        expected = int((work / 'busy-cpu').read_text())
        assert expected * .6 <= totals[busy] <= expected * 1.15, (totals, expected)
        assert totals[sleeper] < 50_000_000, totals
        assert any(process['activeThreads'] for sample in samples
                   for process in sample['processes'] if process['pid'] == busy)
        peak_threads = max(process['threads'] for sample in samples
                           for process in sample['processes'] if process['pid'] == busy)
        native_ids = {str(value) for value in json.loads((work / 'busy-thread-ids').read_text())}
        observed_thread_ids = {ident.split(':')[0] for sample in samples
                               for process in sample['processes'] if process['pid'] == busy
                               for ident in process['threadIds']}
        assert observed_thread_ids == native_ids, (observed_thread_ids, native_ids)
        thread_cpu = {}
        for sample in samples:
            for process in sample['processes']:
                if process['pid'] == busy:
                    for thread in process['activeThreads']:
                        thread_cpu[thread['id']] = thread_cpu.get(thread['id'], 0) + thread['cpuNs']
        assert peak_threads >= 2 and thread_cpu, 'real sleeping and busy native threads must both exist'
        assert expected * .6 <= max(thread_cpu.values()) <= expected * 1.15, (thread_cpu, expected)
        assert sum(thread_cpu.values()) - max(thread_cpu.values()) < 50_000_000, thread_cpu
        return {'busyCpuNsIndependent': expected, 'busyCpuNsSampledLowerBound': totals[busy],
                'sleepCpuNsSampled': totals[sleeper], 'clock': rows[0]['clock'],
                'busyProcessPeakThreads': peak_threads, 'activeThreadCpuNs': thread_cpu,
                'kernelIdsMatchNativeIds': True,
                'allObservedChildrenDrained': True, 'samples': end['samples'], 'seconds': end['seconds']}
    finally:
        # Only our actual Popen owners are signalled. The intentional orphan has
        # a bounded control wait and exits naturally after this acknowledgement.
        if leak:
            (work / 'after-observer').touch()
        if observer is not None and observer.poll() is None:
            observer.terminate()
            observer.wait(timeout=2)
        if root.poll() is None:
            root.terminate()
        root.wait(timeout=2)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--actor':
        actor(sys.argv[2], Path(sys.argv[3]))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '--fixture':
        fixture(Path(sys.argv[2]), bool(int(sys.argv[3])))
        return
    began = time.monotonic()
    directory = Path('tmp/cpu-census-proof')
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        work = Path(temporary)
        result = {'normal': check(work / 'normal', False), 'orphan': check(work / 'orphan', True),
                  'pidBudget': check(work / 'pid-budget', False,
                                     ['--max-processes', '2', 'census PID inventory exceeds cap']),
                  'threadBudget': check(work / 'thread-budget', False,
                                        ['--max-threads', '1', 'census thread inventory exceeds cap'])}
    print(json.dumps({**result, 'seconds': time.monotonic() - began}))


if __name__ == '__main__':
    main()
