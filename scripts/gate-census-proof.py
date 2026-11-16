#!/usr/bin/env python3
"""Actual Git/lease/producer/recorder fixtures, never an engine full-suite census."""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
from gate_census_qualification import join_census, qualify_files

ENGINE = Path(__file__).resolve().parent.parent


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


def fixture(parent, name):
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
    (repo / 'value.json').write_text('{"value":1}')
    git('add', 'value.json')
    git('commit', '--quiet', '-m', 'fixture')
    gate = root / 'gate.mjs'
    cache = (ENGINE / 'scripts/push-proof-cache.mjs').as_uri()
    gate.write_text('''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {setTimeout} from 'node:timers/promises';
import {capturePushTree,writePushProof} from ''' + json.dumps(cache) + ''';
const root=process.argv[2],env={...process.env},began=performance.now();
const before=capturePushTree('full-v1',env);assert.ok(before);
writeFileSync(root+'/ready.json',JSON.stringify({pid:process.pid}));
while(!existsSync(root+'/go'))await setTimeout(5);
assert.equal(JSON.parse(readFileSync('value.json','utf8')).value,1);
const until=performance.now()+200;while(performance.now()<until){}
const after=capturePushTree('full-v1',env);assert.ok(after);assert.equal(after.tree,before.tree);assert.equal(after.runtime,before.runtime);
const proof=writePushProof(before,{mode:'full',files:['value.json']},(performance.now()-began)/1000);
writeFileSync(root+'/producer.json',JSON.stringify({file:before.file,proof}));
''')
    wrapper = subprocess.Popen([sys.executable, str(ENGINE / 'scripts/heavy-lane.py'), 'full-test', '--max', '.3',
                                '--', 'node', str(gate), str(root)], cwd=repo, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    recorder = None
    try:
        wait_for(lambda: (root / 'ready.json').exists(), [wrapper])
        ready = json.loads((root / 'ready.json').read_text())
        owner = json.loads(subprocess.check_output([sys.executable, str(ENGINE / 'scripts/cpu-census.py'),
                                                   '--pid', str(ready['pid']), '--owner-only'], env=env, text=True))
        raw = root / 'raw.jsonl'
        recorder = subprocess.Popen([sys.executable, str(ENGINE / 'scripts/cpu-census.py'), '--pid', str(owner['pid']),
                                     '--expected-identity', owner['identity'], '--report', str(raw),
                                     '--interval', '.05', '--seconds', '10', '--drain-seconds', '.3'],
                                    cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        wait_for(lambda: raw.exists() and raw.stat().st_size > 0, [wrapper, recorder])
        (root / 'go').touch()
        out, err = wrapper.communicate(timeout=15)
        assert wrapper.returncode == 0, (out, err)
        out, err = recorder.communicate(timeout=12)
        assert recorder.returncode == 0, (out, err)
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
        for process in (recorder, wrapper):
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


def mutations(actual):
    count = 0
    for path, value in [
            (('start', 'machine'), 'foreign-machine'),
            (('start', 'expectedRootIdentity'), 'wrong-owner'),
            (('end', 'remaining'), [{'pid': 999999}]),
            (('end', 'identityReadsIncomplete'), 1),
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
    return count + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', required=True, type=Path)
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gate-census-proof-', dir=args.scratch) as directory:
        root = Path(directory)
        actual = fixture(root, 'actual')
        foreign = fixture(root, 'foreign')
        assert not qualify_files(actual['raw'], foreign['proofFile'], foreign['log'])['qualified']
        count = mutations(actual)
        alias = actual['root'] / 'raw-alias.jsonl'
        alias.symlink_to(actual['raw'])
        assert not qualify_files(alias, actual['proofFile'], actual['log'])['qualified']
        truncated = actual['root'] / 'truncated.jsonl'
        truncated.write_text(actual['raw'].read_text().rsplit('\n', 2)[0] + '\n')
        assert not qualify_files(truncated, actual['proofFile'], actual['log'])['qualified']
        assert actual['raw'].exists() and actual['proofFile'].exists() and actual['log'].exists()
        print(json.dumps({'realProducerJoins': 2, 'metadataRefusals': count, 'foreignOwnerRefused': True,
                          'unsafeAndIncompleteRefused': True, 'evidenceRetained': True,
                          'sampledCounterCensoringSeparate': True,
                          'commandCpuSeconds': actual['qualified']['cpuSeconds'],
                          'scope': 'Complete owned fixture gate, not an engine full-suite or ten-gate census.'}))


if __name__ == '__main__':
    main()
