#!/usr/bin/env python3
"""TS12a outer-edge proof: real gate argv, measured descendants and an unsignalled orphan."""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


bench = module('bench', ROOT / 'src/scripts/vitest-bench.py')
controls = module('controls', ROOT / 'src/scripts/cpu-census-proof.py')
GATE_BODY = ("import {existsSync,writeFileSync} from 'node:fs';\n"
             "writeFileSync(process.argv[2],'ready');\n"
             "setInterval(()=>{if(existsSync(process.argv[3]))process.exit(0);},10);\n")


def cli(work, *options):
    return [sys.executable, str(ROOT / 'src/scripts/vitest-bench.py'), 'observe',
            '--out', str(work / 'summary.json'), '--interval', '.05', '--seconds', '6',
            '--drain-seconds', '.2', *options]


def first_sample(work):
    reports = list(work.glob('summary.*.jsonl'))
    return any('"type":"sample"' in report.read_text() for report in reports)


def finish(observer, work, expected):
    stdout, stderr = observer.communicate(timeout=8)
    assert observer.returncode == expected, (stdout, stderr)
    data = json.loads((work / 'summary.json').read_text())
    assert data['schema'] == 'vitest-gate-census/2' and len(data['observations']) == 1, data
    row = data['observations'][0]
    assert row['gateKind'] == 'unverified' and row['exactGateCpu'] is None, row
    assert 'cpuSeconds' not in row and 'userSeconds' not in row and 'systemSeconds' not in row, row
    assert row['samples'] >= 2 and row['peakSummedRssMB'] > 0, row
    raw = ROOT / row['rawReport']
    assert raw.is_file()
    first = json.loads(raw.read_text().splitlines()[0])
    assert row['selectedRootIdentity'] == row['root']['identity'] == first['expectedRootIdentity'], row
    return row


def descendants(work, leak):
    work.mkdir()
    root = subprocess.Popen([sys.executable, str(ROOT / 'src/scripts/cpu-census-proof.py'),
                             '--fixture', str(work), str(int(leak))], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    observer = None
    try:
        controls.wait_for(lambda: (work / 'ready').exists())
        children = json.loads((work / 'ready').read_text())
        observer = subprocess.Popen(cli(work, '--pid', str(root.pid)), cwd=ROOT,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        controls.wait_for(lambda: first_sample(work))
        (work / 'go').touch()
        # The real gate parent reaps its owner. Retaining a zombie would make
        # the recorder correctly report an unreadable, uncertain identity.
        assert root.wait(timeout=4) == 0
        row = finish(observer, work, 2 if leak else 0)
        if leak:
            assert row['reason'] == 'live observed descendants after root exit', row
            assert not row['allObservedChildrenDrained'], row
            assert any(child['pid'] == children[0] for child in row['remaining']), row
            (work / 'after-observer').touch()
            controls.wait_for(lambda: (work / 'writer-survived').exists() and (work / 'writer-cpu').exists())
            return {'orphanReported': True, 'writerNotSignalled': True}
        assert row['allObservedChildrenDrained'] and not row['remaining'], row
        assert row['processesByKind'].get('python', 0) >= 3, row
        busy_cpu = int((work / 'busy-cpu').read_text()) / 1e9
        assert row['sampledCpuSecondsLowerBound'] >= busy_cpu * .6, row
        assert row['sampledCpuSecondsLowerBound'] < busy_cpu + .5, row
        return {'sampledCpuLowerBound': row['sampledCpuSecondsLowerBound'],
                'busyCpuIndependent': busy_cpu, 'drained': True, 'exactTotalAbsent': True}
    finally:
        (work / 'go').touch()
        (work / 'after-observer').touch()
        if observer is not None and observer.poll() is None:
            observer.terminate()
            observer.wait(timeout=2)
        if root.poll() is None:
            root.terminate()
        root.wait(timeout=2)


def observer_faults(work, owner):
    """Fault only the controller-to-recorder handoff; actual owner/kernel refusal remain real."""
    args = argparse.Namespace(pid=owner.pid, root=bench.GATE_ROOT, out=work / 'wrong-owner.json',
                              interval=.05, wait_seconds=.1, seconds=6, drain_seconds=.2, count=1)
    real_run = subprocess.run
    def shifted(command, **options):
        assert Path(command[1]).name == 'cpu-census.py'
        expected = command.index('--expected-identity') + 1
        assert command[expected]
        changed = [*command]
        changed[expected] = 'wrong-kernel-owner'
        return real_run(changed, **options)
    with patch.object(bench.subprocess, 'run', shifted), contextlib.redirect_stdout(io.StringIO()):
        try:
            bench.command_observe(args)
        except SystemExit as error:
            assert 'identity changed before observation' in str(error), error
        else:
            raise AssertionError('wrong recorder identity must refuse')
    assert owner.poll() is None and not args.out.exists()
    assert not list(work.glob('wrong-owner.*.jsonl')), 'wrong owner must never be observed'

    args.out = work / 'timeout.json'
    evidence = []
    def timed_out(command, **options):
        assert Path(command[1]).name == 'cpu-census.py'
        raw = Path(command[command.index('--report') + 1])
        raw.write_text('owned partial timeout fixture\n')
        evidence.append(raw)
        raise subprocess.TimeoutExpired(command, options['timeout'])
    with patch.object(bench.subprocess, 'run', timed_out), contextlib.redirect_stdout(io.StringIO()):
        try:
            bench.command_observe(args)
        except SystemExit as error:
            assert 'recorder timed out' in str(error) and str(evidence[0]) in str(error), error
        else:
            raise AssertionError('recorder timeout must never publish a green summary')
    assert owner.poll() is None and not args.out.exists() and evidence[0].is_file()
    return {'identityMismatchRefused': True, 'timeoutEvidenceRetained': True}


def newborn_discovery(work):
    """Start actual Node owners between the first kernel snapshot and the real ps invocation."""
    (work / '.githooks').mkdir(parents=True)
    script = work / '.githooks/push-checks.mjs'
    script.write_text(GATE_BODY)
    node = shutil.which('node')
    pattern = '^' + re.escape(node) + r'\s+' + re.escape(str(script)) + r'(?:\s|$)'
    real_run = subprocess.run
    for label, seconds in [('retry', 2), ('deadline', 0)]:
        ready, stop = work / (label + '.ready'), work / (label + '.stop')
        owners, calls = [], []
        def born(command, **options):
            assert command[:2] == ['ps', '-axo']
            calls.append(command)
            if not owners:
                owners.append(subprocess.Popen([node, str(script), str(ready), str(stop)], cwd=work))
                controls.wait_for(ready.exists)
            return real_run(command, **options)
        args = argparse.Namespace(pid=None, root=pattern, wait_seconds=seconds, interval=.05)
        began = time.monotonic()
        try:
            with patch.object(bench.subprocess, 'run', born):
                if seconds:
                    selected = bench.observe_root(args)
                    assert selected.pid == owners[0].pid and selected.identity
                    assert len(calls) == 2 and time.monotonic() - began < seconds
                else:
                    try:
                        bench.observe_root(args)
                    except SystemExit as error:
                        assert 'discovery deadline' in str(error), error
                    else:
                        raise AssertionError('a newborn candidate cannot extend an expired deadline')
                    assert len(calls) == 1
            assert owners[0].poll() is None, 'discovery must never signal its candidate'
        finally:
            stop.touch()
            for owner in owners:
                if owner.poll() is None:
                    try:
                        owner.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        owner.terminate()
                owner.wait(timeout=2)
    return {'newbornRetried': True, 'newbornDeadlineRetained': True}


def discovery(work):
    (work / '.githooks').mkdir(parents=True)
    script = work / '.githooks/push-checks.mjs'
    stop = work / 'stop'
    script.write_text(GATE_BODY)
    node = shutil.which('node')
    owners, observer = [], None
    try:
        newborn = newborn_discovery(work / 'newborn')
        # Older than both Node roots, with the old regex embedded in its argv.
        owners.append(subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)',
                                        'node', '.githooks/push-checks.mjs'], cwd=work))
        for entry, label in [(str(script), 'absolute'), ('.githooks/push-checks.mjs', 'relative')]:
            owners.append(subprocess.Popen([node, entry, str(work / label), str(stop)], cwd=work))
        controls.wait_for(lambda: (work / 'absolute').exists() and (work / 'relative').exists())
        table = subprocess.check_output(['ps', '-p', ','.join(str(owner.pid) for owner in owners),
                                         '-o', 'pid=,uid=,command='], text=True)
        roots = bench.gate_candidates(table, re.compile(bench.GATE_ROOT))
        assert roots == sorted(owner.pid for owner in owners[1:]), (roots, table)
        try:
            bench.choose_gate(roots)
        except SystemExit as error:
            assert 'ambiguous' in str(error)
        else:
            raise AssertionError('ambiguous real gate owners must refuse')
        missing = subprocess.run(cli(work, '--root', '^TS12a-impossible-root$', '--wait-seconds', '.05'),
                                 capture_output=True, text=True, timeout=2)
        assert missing.returncode != 0 and 'discovery deadline' in missing.stderr, missing
        legacy = work / 'summary.json'
        legacy.write_text('{"schema":1,"gates":[]}')
        incompatible = subprocess.run(cli(work, '--pid', str(owners[1].pid)),
                                      capture_output=True, text=True, timeout=2)
        assert incompatible.returncode != 0 and 'incompatible census summary' in incompatible.stderr
        legacy.unlink()
        faults = observer_faults(work, owners[1])
        # Exercise bounded discovery through the CLI on the real absolute Node root.
        pattern = '^' + re.escape(node) + r'\s+' + re.escape(str(script)) + r'(?:\s|$)'
        observer = subprocess.Popen(cli(work, '--root', pattern, '--wait-seconds', '.5'), cwd=ROOT,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        controls.wait_for(lambda: first_sample(work))
        stop.touch()
        for owner in owners[1:]:
            assert owner.wait(timeout=2) == 0
        row = finish(observer, work, 0)
        assert row['root']['pid'] == owners[1].pid and row['allObservedChildrenDrained'], row
        return {'relativeAndAbsoluteRoots': True, 'wrapperExcluded': True, 'ambiguousRefused': True,
                'missingBounded': True, 'legacySummaryRefused': True, 'actualCliDiscovery': True, **faults, **newborn}
    finally:
        stop.touch()
        if observer is not None and observer.poll() is None:
            observer.terminate()
            observer.wait(timeout=2)
        for owner in owners:
            if owner.poll() is None:
                owner.terminate()
            owner.wait(timeout=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--case', choices=['all', 'ownership'], default='all')
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    began = time.monotonic()
    with tempfile.TemporaryDirectory(dir=args.scratch) as temporary:
        work = Path(temporary)
        result = {'discovery': discovery(work / 'discovery')}
        if args.case == 'all':
            result['normal'] = descendants(work / 'normal', False)
        result['orphan'] = descendants(work / 'orphan', True)
    print(json.dumps({**result, 'seconds': time.monotonic() - began}))


if __name__ == '__main__':
    main()
