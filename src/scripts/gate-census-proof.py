#!/usr/bin/env python3
"""Actual Git/lease/producer/recorder fixtures, never an engine full-suite census."""
import argparse
import contextlib
import copy
from dataclasses import replace
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
import gate_census_qualification as qualification
from gate_census_qualification import QualificationReader, join_census, qualify_files, timestamp

ENGINE = Path(__file__).resolve().parent.parent.parent


def unreaped_root(parent, deadline=False):
    """Keep a real zombie across samples, exposing Linux's readable state on Darwin too."""
    root = parent / ('unreaped-deadline' if deadline else 'unreaped-root')
    root.mkdir()
    go = root / 'go'
    actor = subprocess.Popen([sys.executable, '-c',
        'import pathlib,sys,time;p=pathlib.Path(sys.argv[1])\nwhile not p.exists(): time.sleep(.005)', str(go)])
    spec = importlib.util.spec_from_file_location('_census_reap_control', ENGINE / 'src/scripts/cpu-census.py')
    census = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = census
    spec.loader.exec_module(census)
    native = census.process_backend()
    selected = census.owned_process(native, actor.pid)
    zombies, errors, reaped = [], [], []
    sampled = threading.Event()

    class LinuxShape:
        def __getattr__(self, name):
            return getattr(native, name)

        def processes(self):
            inventory, present = native.processes()
            if actor.pid in present:
                state = subprocess.run(['ps', '-o', 'stat=', '-p', str(actor.pid)],
                                       capture_output=True, text=True, timeout=1).stdout.strip()
                if state.startswith('Z'):
                    # Linux already returns this record. Darwin cannot read a
                    # zombie's BSD info; retain only our known, unreaped child.
                    current = inventory.get(actor.pid)
                    assert current is None or current.identity == selected.identity
                    inventory[actor.pid] = replace(selected, zombie=True)
                    zombies.append(time.monotonic())
                    if len(zombies) >= 3:
                        sampled.set()
            return inventory, present

        def usage(self, process):
            value = native.usage(process)
            if process.identity == selected.identity:
                go.touch()  # Root first has a real CPU baseline, then exits.
            return value

    def reap():
        if deadline:
            def ended():
                try:
                    return json.loads(report.read_text().splitlines()[-1]).get('type') == 'end'
                except (OSError, ValueError, IndexError):
                    return False
            wait_for(ended, [], seconds=2)
        elif not sampled.wait(timeout=2):
            errors.append('census ended before three actual zombie samples')
        reaped.append(time.time_ns() / 1e6)
        if actor.wait(timeout=2) != 0:
            errors.append('observer changed the owned command exit')

    report = root / 'raw.jsonl'
    reaper = threading.Thread(target=reap)
    reaper.start()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            code = census.observe(LinuxShape(), actor.pid, report, .01, .5 if deadline else 3, .1, selected.identity)
        reaper.join(timeout=3)
        assert not reaper.is_alive() and not errors, errors
        rows = [json.loads(line) for line in report.read_text().splitlines()]
        end = rows[-1]
        assert code == (2 if deadline else 0), end
        assert end['reason'] == ('observer deadline' if deadline else 'observed tree drained'), end
        assert len(zombies) >= 3, end
        assert (end['endedAtMs'] <= reaped[0]) if deadline else (end['endedAtMs'] >= reaped[0]), end
        assert end['remaining'] == [] and end['rootMeasured'] is True, end
        return {'actualZombieSamples': len(zombies), 'drainedOnlyAfterReap': not deadline, 'unreapedDeadlineRefused': deadline,
                'rootCpuMeasured': True, 'observerNeverSignalledOwner': True}
    finally:
        go.touch()
        reaper.join(timeout=3)
        if actor.poll() is None:
            actor.terminate()
        actor.wait(timeout=2)


def parsed(path):
    """The JSON a fixture wrote, or None while it is missing or only partly written."""
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def wait_for(predicate, processes, seconds=10):
    until = time.monotonic() + seconds
    while not predicate():
        for process in processes:
            if process.poll() is not None:
                out, err = process.communicate()
                raise AssertionError(('fixture exited early', process.returncode, out[-500:], err[-1500:]))
        if time.monotonic() >= until:
            raise AssertionError('fixture startup exceeded its deadline')
        time.sleep(.01)


def fixture(parent, name, observer=False):
    root = parent / name
    repo = root / 'repo'
    repo.mkdir(parents=True)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('GIT_', 'WS_HEAVY_', 'WS_PUSH_')) and key not in ('CI', 'GITHUB_ACTIONS')}
    env.update(GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1', PYTHONDONTWRITEBYTECODE='1',
               WS_HEAVY_ROOT=str(root / 'leases'), WS_HEAVY_SCHEDULER_ROOT=str(root / 'leases'),
               WS_STORE_RESERVATION=str(root / 'store.lock'), WS_FULL_SUITE='1', WS_PUSH_GATE_PROFILE='full-v1')
    def git(*args):
        subprocess.run(['git', '-c', 'user.name=Census fixture', '-c', 'user.email=census@example.test', *args],
                       cwd=repo, env=env, check=True, capture_output=True)
    git('init', '--quiet')
    installer = (ENGINE / 'src/scripts/proof-fixture-install.mjs').as_uri()
    subprocess.run(['node', '--input-type=module', '-e',
                    'import {installProofFixture} from ' + json.dumps(installer) +
                    ';installProofFixture(process.argv[1]);', str(repo)],
                   cwd=ENGINE, env=env, check=True, capture_output=True)
    (repo / 'value.json').write_text('{"value":1}')
    git('add', 'value.json')
    git('commit', '--quiet', '-m', 'fixture')
    gate = root / 'gate.mjs'
    cache = (ENGINE / 'src/scripts/push-proof-cache.mjs').as_uri()
    gate.write_text('''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {capturePushTree,readPushProof,writePushProof} from ''' + json.dumps(cache) + ''';
const root=process.argv[2],mode=process.argv[3],env={...process.env},began=performance.now();
const profile=mode==='split'?'split-v1':'full-v1';
const selection={mode:['docs','related'].includes(mode)?mode:'full',files:['value.json']};
const before=capturePushTree(profile,env);assert.ok(before);
let proof;
if(mode==='reused'){
 assert.equal(JSON.parse(readFileSync('value.json','utf8')).value,1);
 const checked=capturePushTree(profile,env);assert.ok(checked);assert.equal(checked.tree,before.tree);assert.equal(checked.runtime,before.runtime);
 proof=writePushProof(before,selection,(performance.now()-began)/1000);
}
// The parent uses the file's presence as its readiness signal.
const ready=root+'/ready.json';
writeFileSync(ready+'.pending',JSON.stringify({pid:process.pid}));
renameSync(ready+'.pending',ready);
while(!existsSync(root+'/go'))await setTimeout(5);
if(mode==='orphan'){
 const program="const fs=require('node:fs'),root=process.argv[1];fs.writeFileSync(root+'/orphan-ready',String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(root+'/orphan-release')){clearInterval(timer);fs.writeFileSync(root+'/orphan-finished','natural completion');}},10);";
 const writer=spawn(process.execPath,['-e',program,root],{detached:true,stdio:'ignore'});writer.unref();
 while(!existsSync(root+'/orphan-detach'))await setTimeout(5);
}
assert.equal(JSON.parse(readFileSync('value.json','utf8')).value,1);
const until=performance.now()+200;while(performance.now()<until){}
const after=capturePushTree(profile,env);assert.ok(after);assert.equal(after.tree,before.tree);assert.equal(after.runtime,before.runtime);
if(mode==='reused'){assert.equal(readPushProof(after,selection)?.run,proof.run);}
else proof=writePushProof(before,selection,(performance.now()-began)/1000);
writeFileSync(root+'/producer.json',JSON.stringify({file:before.file,proof}));
if(mode==='failed')process.exitCode=7;
''')
    launch = [sys.executable, str(ENGINE / 'src/scripts/heavy-lane.py'), 'full-test', '--max', '.3',
              '--', 'node', str(gate), str(root), name]
    if name == 'reap-delay':
        harness = "import importlib.util,json,sys,time\nfrom pathlib import Path\np=Path(sys.argv[1]);root=Path(sys.argv[2]);sys.path.insert(0,str(p.parent))\ns=importlib.util.spec_from_file_location('delayed_parent',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nold=m.command_usage\ndef delayed(*a,**k):\n deadline=time.monotonic()+3\n while True:\n  try:\n   rows=(root/'raw.jsonl').read_text().splitlines()\n   if rows and json.loads(rows[-1]).get('type')=='end':break\n  except (OSError,ValueError):pass\n  if time.monotonic()>deadline:raise AssertionError('recorder did not finish while parent bookkeeping was delayed')\n  time.sleep(.005)\n return old(*a,**k)\nm.command_usage=delayed\nsys.argv=[str(p),*sys.argv[3:]]\nsys.exit(m.main())\n"
        launch = [sys.executable, '-c', harness, str(ENGINE / 'src/scripts/heavy-lane.py'), str(root), *launch[2:]]
    elif name == 'tail-delay':
        harness = "import importlib.util,sys,time;from pathlib import Path; p=Path(sys.argv[1]);sys.path.insert(0,str(p.parent));s=importlib.util.spec_from_file_location('tail_fixture',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);old=m.remove_ticket\ndef delayed(*a,**k): time.sleep(.2);return old(*a,**k)\nm.remove_ticket=delayed;sys.argv=sys.argv[1:];sys.exit(m.main())"
        launch = [sys.executable, '-c', harness, *launch[1:]]
    wrapper = subprocess.Popen(launch, cwd=repo, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    recorder = None
    try:
        # the fixture's writeFileSync creates the file before it fills it: a busy runner read it empty (run 44291731549)
        wait_for(lambda: parsed(root / 'ready.json') is not None, [wrapper])
        ready = parsed(root / 'ready.json')
        owner = json.loads(subprocess.check_output([sys.executable, str(ENGINE / 'src/scripts/cpu-census.py'),
                                                   '--pid', str(ready['pid']), '--owner-only'], env=env, text=True))
        raw = root / 'raw.jsonl'
        if observer:
            command = [sys.executable, str(ENGINE / 'src/scripts/vitest-bench.py'), 'observe', '--pid', str(owner['pid']),
                       '--out', str(root / 'summary.json'), '--interval', '.05', '--seconds', '10',
                       '--drain-seconds', '.1' if name == 'orphan' else '.5',
                       '--proof-root', str(repo / '.git/wildshard-push-proofs'), '--command-log', str(root / 'leases/full-test-day.log')]
        else:
            command = [sys.executable, str(ENGINE / 'src/scripts/cpu-census.py'), '--pid', str(owner['pid']),
                       '--expected-identity', owner['identity'], '--report', str(raw),
                       '--interval', '.05', '--seconds', '10', '--drain-seconds', '.3']
        if observer and name in ('missing-log', 'missing-proof', 'legacy'):
            if name == 'missing-log':
                command = command[:-2]
            elif name == 'missing-proof':
                command = command[:-4] + command[-2:]
            else:
                command = command[:-4]
        recorder = subprocess.Popen(command,
                                    cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if observer and name in ('missing-log', 'missing-proof'):
            out, err = recorder.communicate(timeout=3)
            assert recorder.returncode == 2 and 'requires both --proof-root and --command-log' in err, (out, err)
            assert wrapper.poll() is None and not (root / 'summary.json').exists()
            assert not list(root.glob('summary.*.jsonl')) and not raw.exists()
            os.kill(owner['pid'], 0)  # Liveness probe only; never deliver a signal.
            (root / 'go').touch()
            out, err = wrapper.communicate(timeout=15)
            assert wrapper.returncode == 0, (out, err)
            return {'mode': name, 'qualified': False, 'exitCode': 2,
                    'rawRetained': False, 'ownerAliveAtRefusal': True}
        wait_for(lambda: any(root.glob('summary.*.jsonl')) if observer else raw.exists() and raw.stat().st_size > 0,
                 [wrapper, recorder])
        (root / 'go').touch()
        if name == 'orphan':
            def sampled_writer():
                pid = parsed(root / 'orphan-ready')
                if pid is None:
                    return False
                for report in root.glob('summary.*.jsonl'):
                    for line in report.read_text().splitlines(keepends=True):
                        if not line.endswith('\n'):
                            continue
                        row = json.loads(line)
                        if row['type'] == 'sample' and any(process['pid'] == pid for process in row['processes']):
                            return True
                return False
            # Prove this really is a known descendant before detaching it.
            wait_for(sampled_writer, [wrapper, recorder], seconds=5)
            (root / 'orphan-detach').touch()
        out, err = wrapper.communicate(timeout=15)
        assert wrapper.returncode == (7 if name == 'failed' else 0), (out, err)
        out, err = recorder.communicate(timeout=12)
        expected = 2 if observer and name in ('docs', 'related', 'split', 'reused', 'failed', 'orphan') else 0
        assert recorder.returncode == expected, (name, out, err)
        if observer:
            summary = json.loads((root / 'summary.json').read_text())['observations'][0]
            qualified = expected == 0 and name != 'legacy'
            if name == 'legacy':
                assert 'producerQualification' not in summary
            else:
                assert summary['producerQualification']['qualified'] == qualified, summary
                assert summary['qualificationWallSeconds'] >= 0 and summary['qualificationCpuSeconds'] >= 0
            assert (summary['exactGateCpu'] is not None) == qualified, summary
            assert summary['gateKind'] == ('full' if qualified else 'unverified')
            assert summary['allObservedChildrenDrained'] is (name != 'orphan')
            assert (ENGINE / summary['rawReport']).exists()
            if name == 'orphan':
                assert summary['remaining'] and not (root / 'orphan-finished').exists()
                (root / 'orphan-release').touch()
                wait_for(lambda: (root / 'orphan-finished').exists(), [], seconds=5)
            outcome = {'mode': name, 'qualified': qualified, 'exitCode': expected, 'rawRetained': True}
            if name == 'orphan':
                outcome['writerFinishedNaturally'] = True
            return outcome
        producer = json.loads((root / 'producer.json').read_text())
        log = root / 'leases/full-test-day.log'
        result = qualify_files(raw, Path(producer['file']), log)
        records = [json.loads(line) for line in raw.read_text().splitlines()]
        if not result['qualified']:
            end = records[-1]
            details = {key: end[key] for key in ('reason', 'rootMeasured', 'remaining', 'incompleteReads', 'samples')}
            details['sampleErrors'] = [row['errors'] for row in records if row.get('type') == 'sample' and row['errors']]
            details['unreadThreads'] = sum(p['unreadThreads'] for row in records if row.get('type') == 'sample' for p in row['processes'])
            details['counterResets'] = sum(p['threadCounterResets'] + int(p['processCounterReset']) for row in records if row.get('type') == 'sample' for p in row['processes'])
            raise AssertionError((result, details))
        release = next(row for row in (json.loads(line) for line in log.read_text().splitlines()) if row['event'] == 'release')
        return {'root': root, 'raw': raw, 'proofFile': Path(producer['file']), 'proof': producer['proof'],
                'log': log, 'start': records[0], 'end': records[-1], 'release': release, 'qualified': result}
    finally:
        if name == 'orphan':
            (root / 'orphan-release').touch()
        for process in (recorder, wrapper):
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        if name == 'orphan' and (root / 'orphan-ready').exists():
            wait_for(lambda: (root / 'orphan-finished').exists(), [], seconds=5)


def mutations(actual):
    count = 0
    for path, value in [
            (('start', 'machine'), 'foreign-machine'),
            (('start', 'expectedRootIdentity'), 'wrong-owner'),
            (('end', 'remaining'), [{'pid': 999999}]),
            (('end', 'unresolvedIdentityReads'), 1),
            (('proof', 'measurement', 'owner', 'identity'), 'wrong-owner'),
            (('proof', 'measurement', 'owner', 'uid'), -1),
            (('proof', 'measurement', 'lease', 'token'), 'wrong-lease'),
            (('proof', 'measurement', 'lease', 'childPid'), None),
            (('proof', 'measurement', 'profile'), 'split-v1'),
            (('proof', 'mode'), 'related'),
            (('proof', 'mode'), 'docs'),
            (('proof', 'exclusions', 'files'), ['omitted.test.ts']),
            (('proof', 'finished'), '2000-01-01T00:00:00Z'),
            (('release', 'exitCode'), 7),
            (('release', 'commandUsage', 'exitCode'), 7),
            (('release', 'commandUsage', 'identity'), 'other-command'),
            (('release', 'commandUsage', 'platform'), 'foreign-platform'),
            (('release', 'commandUsage', 'state'), 'unavailable'),
            (('release', 'commandUsage', 'reaped'), False),
            (('release', 'commandUsage', 'userSeconds'), float('nan')),
            (('release', 'commandUsage', 'systemSeconds'), -1),
            (('release', 'commandUsage', 'startedAt'), time.time() + 100),
    ]:
        data = copy.deepcopy({key: actual[key] for key in ('start', 'end', 'proof', 'release')})
        parent = data
        for key in path[:-1]:
            parent = parent[key]
        parent[path[-1]] = value
        result = join_census(data['start'], data['end'], data['proof'], data['release'])
        assert not result['qualified'], (path, value, result)
        count += 1
    q = actual['qualified']
    for key in ('proofKey', 'commandKey'):
        result = join_census(actual['start'], actual['end'], actual['proof'], actual['release'], {q[key]})
        assert not result['qualified'] and 'already accounted' in result['reason']
        count += 1
    legacy = copy.deepcopy(actual['proof'])
    del legacy['measurement']
    assert not join_census(actual['start'], actual['end'], legacy, actual['release'])['qualified']
    censored = copy.deepcopy(actual['end'])
    censored['counterReadsIncomplete'] += 1
    censored['incompleteReads'] += 1
    same = join_census(actual['start'], censored, actual['proof'], actual['release'])
    assert same['qualified'] and same['cpuSeconds'] == actual['qualified']['cpuSeconds']
    assert same['sampledCounterReadMisses'] == censored['counterReadsIncomplete']
    censored['identityReadsIncomplete'] += 1
    censored['incompleteReads'] += 1
    resolved = join_census(actual['start'], censored, actual['proof'], actual['release'])
    assert resolved['qualified'] and resolved['cpuSeconds'] == actual['qualified']['cpuSeconds']
    assert resolved['sampledIdentityReadMisses'] == censored['identityReadsIncomplete']
    return count + 1


def directory_controls(actual):
    directory = actual['root'] / 'receipt-directory'
    directory.mkdir()
    matching = directory / 'matching.json'
    matching.write_bytes(actual['proofFile'].read_bytes())
    (directory / 'malformed.json').write_text('{broken')
    (directory / 'link.json').symlink_to(actual['proofFile'])
    unsafe = directory / 'writable.json'
    unsafe.write_text('{}')
    unsafe.chmod(0o666)
    unrelated = copy.deepcopy(actual['proof'])
    unrelated['measurement']['owner']['identity'] = 'unrelated-owner'
    (directory / 'unrelated.json').write_text(json.dumps(unrelated))
    result = qualify_files(actual['raw'], directory, actual['log'])
    assert result['qualified'], result
    diagnostics = result['evidence']['proofDiscovery']
    assert diagnostics['entries'] == 5 and diagnostics['malformed'] == 1, diagnostics
    assert diagnostics['unsafe'] == 2 and diagnostics['unrelated'] == 1, diagnostics
    malformed = copy.deepcopy(actual['proof'])
    malformed['measurement']['profile'] = 'split-v1'
    matching.write_text(json.dumps(malformed))
    assert not qualify_files(actual['raw'], directory, actual['log'])['qualified']
    matching.write_text('{broken own receipt')
    assert not qualify_files(actual['raw'], directory, actual['log'])['qualified']
    matching.write_bytes(actual['proofFile'].read_bytes())
    duplicate = directory / 'duplicate.json'
    duplicate.write_bytes(matching.read_bytes())
    assert not qualify_files(actual['raw'], directory, actual['log'])['qualified']
    duplicate.unlink()
    directory.chmod(0o777)
    assert not qualify_files(actual['raw'], directory, actual['log'])['qualified']
    directory.chmod(0o755)
    return {'validOwnerWithUnrelatedInvalidEntries': True, 'diagnostics': diagnostics,
            'malformedMatchedRefused': True, 'ambiguousMatchedRefused': True,
            'unsafeDirectoryRefused': True}


def tail_controls(actual, foreign):
    root = actual['root'] / 'tail-controls'
    root.mkdir()
    token = actual['release']['token']
    initial = b''.join(line + b'\n' for line in actual['log'].read_bytes().splitlines()
                       if json.loads(line).get('token') != token or json.loads(line).get('event') != 'release')
    release = json.dumps(actual['release']).encode() + b'\n'
    unrelated = json.dumps(foreign['release']).encode() + b'\n'

    def reader(name):
        log = root / name
        log.write_bytes(initial)
        value = QualificationReader(actual['raw'], actual['proofFile'], log)
        assert value.poll().get('pending') is True
        return value, log

    value, log = reader('appends.log')
    for _ in range(8):
        with log.open('ab') as stream:
            stream.write(unrelated)
        result = value.poll()
        assert result.get('pending') is True, result
        assert result['settling']['receiptDiscoveries'] == 1
        assert result['settling']['commandLogBytesRead'] == log.stat().st_size
    halfway = len(release) // 2
    with log.open('ab') as stream:
        stream.write(release[:halfway])
    partial = value.poll()
    assert partial.get('pending') and 'incomplete tail' in partial['reason'], partial
    with log.open('ab') as stream:
        stream.write(release[halfway:])
    result = value.poll()
    assert result['qualified'], result
    assert result['settling'] == {'receiptDiscoveries': 2, 'commandLogBytesRead': log.stat().st_size,
                                  'finalValidationPasses': 1}, result
    value, log = reader('metadata.log')
    log.chmod(0o600)
    assert value.poll().get('pending') is True
    with log.open('ab') as stream:
        stream.write(release)
    assert value.poll()['qualified']
    late_results = []
    for name, row, expected in (('foreign-append', unrelated, True), ('duplicate-release', release, False)):
        value, log = reader(name + '.log')
        with log.open('ab') as stream:
            stream.write(release)
        native_read, appended = qualification.owned_bytes, []

        def append_during_final(path, limit, **options):
            if path == log and options.get('prefix') is not None and not appended:
                with log.open('ab') as stream:
                    stream.write(row)
                appended.append(True)
            return native_read(path, limit, **options)

        qualification.owned_bytes = append_during_final
        try:
            result = value.poll()
        finally:
            qualification.owned_bytes = native_read
        assert appended and result['qualified'] is expected, (name, result)
        assert result['settling']['finalValidationPasses'] == 1, result
        late_results.append(name)
    refused = []
    for name in ('truncate', 'rotate', 'rewrite', 'rewrite-append', 'proof-change', 'raw-change'):
        value, log = reader(name + '.log')
        old_raw, old_proof = actual['raw'].read_bytes(), actual['proofFile'].read_bytes()
        try:
            if name == 'truncate':
                log.write_bytes(b'')
            elif name == 'rotate':
                log.rename(log.with_suffix('.old'))
                log.write_bytes(initial + release)
            elif name in ('rewrite', 'rewrite-append'):
                changed = initial.replace(b'acquire', b'changed', 1)
                assert changed != initial
                log.write_bytes(changed + (release if name.endswith('append') else b''))
            else:
                path = actual['proofFile'] if name == 'proof-change' else actual['raw']
                path.write_bytes(path.read_bytes() + b' ')
                with log.open('ab') as stream:
                    stream.write(release)
            result = value.poll()
            assert not result['qualified'] and not result.get('pending'), (name, result)
            refused.append(name)
        finally:
            actual['raw'].write_bytes(old_raw)
            actual['proofFile'].write_bytes(old_proof)
    return {'unrelatedAppends': 8, 'partialTailStayedPending': True, 'actualReleaseQualified': True,
            'cachedBytesReadExactlyOnce': True, 'finalValidationPasses': 1,
            'lateFinalAppendControls': late_results, 'metadataOnlyChangeAccepted': True, 'changedInputsRefused': refused}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True, type=Path)
    parser.add_argument('--case', choices=['join', 'observer'], default='join')
    args = parser.parse_args()
    args.scratch = args.scratch.resolve()
    args.scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gate-census-proof-', dir=args.scratch) as directory:
        root = Path(directory)
        if args.case == 'observer':
            cases = [fixture(root, mode, observer=True) for mode in ('full', 'tail-delay', 'docs', 'related', 'split', 'reused', 'failed', 'missing-log', 'missing-proof', 'legacy', 'orphan')]
            print(json.dumps({'observerCases': cases, 'fixtureOnly': True}))
            return
        actual = fixture(root, 'actual')
        foreign = fixture(root, 'foreign')
        assert not qualify_files(actual['raw'], foreign['proofFile'], foreign['log'])['qualified']
        count = mutations(actual)
        delayed = fixture(root, 'reap-delay')
        delay_ms = delayed['release']['commandUsage']['reapedAt'] * 1000 - delayed['end']['endedAtMs']
        assert delay_ms > 0, delay_ms
        assert delayed['qualified']['cpuSeconds'] == (delayed['release']['commandUsage']['userSeconds']
                                                      + delayed['release']['commandUsage']['systemSeconds'])
        end = copy.deepcopy(actual['end'])
        end['endedAtMs'] = actual['start']['startedAtMs']
        assert not join_census(actual['start'], end, actual['proof'], actual['release'])['qualified']
        release = copy.deepcopy(actual['release'])
        release['commandUsage']['reapedAt'] = timestamp(actual['proof']['finished']) - .001
        assert not join_census(actual['start'], actual['end'], actual['proof'], release)['qualified']
        alias = actual['root'] / 'raw-alias.jsonl'
        alias.symlink_to(actual['raw'])
        assert not qualify_files(alias, actual['proofFile'], actual['log'])['qualified']
        truncated = actual['root'] / 'truncated.jsonl'
        truncated.write_text(actual['raw'].read_text().rsplit('\n', 2)[0] + '\n')
        assert not qualify_files(truncated, actual['proofFile'], actual['log'])['qualified']
        deep = actual['root'] / 'deep-proof.json'
        deep.write_text('[' * 2000 + '0' + ']' * 2000)
        assert not qualify_files(actual['raw'], deep, actual['log'])['qualified']
        assert actual['raw'].exists() and actual['proofFile'].exists() and actual['log'].exists()
        print(json.dumps({'realProducerJoins': 2, 'metadataRefusals': count, 'foreignOwnerRefused': True,
                          'proofDirectory': directory_controls(actual), 'tailReader': tail_controls(actual, foreign),
                          'unreapedRoot': unreaped_root(root), 'unreapedDeadline': unreaped_root(root, deadline=True),
                          'actualDelayedParentQualified': True, 'parentEndStampAfterCensusMs': delay_ms,
                          'additionalProofWindowRefusals': 2, 'commandCpuPreserved': True,
                          'unsafeAndIncompleteRefused': True, 'evidenceRetained': True,
                          'sampledCounterCensoringSeparate': True,
                          'commandCpuSeconds': actual['qualified']['cpuSeconds'],
                          'scope': 'Complete owned fixture gate, not an engine full-suite or ten-gate census.'}))


if __name__ == '__main__':
    main()
