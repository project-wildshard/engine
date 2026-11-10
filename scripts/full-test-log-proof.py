"""Manual actual lease/child proof; no full suite or production scheduler."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', type=Path, default=Path(__file__).resolve().parent.parent)
args = parser.parse_args()
engine = args.engine.resolve()
began = time.monotonic()
with tempfile.TemporaryDirectory(dir=engine / 'tmp', prefix='full-test-log-proof-') as folder:
    work = Path(folder)
    scheduler = work / 'scheduler'
    env = {key: value for key, value in os.environ.items() if not key.startswith(('WS_HEAVY_', 'WS_CPU_'))}
    env.update(WS_FULL_SUITE='1', WS_HEAVY_ROOT=str(scheduler),
               WS_HEAVY_SCHEDULER_ROOT=str(scheduler), WS_LANE_NAME='lease-log-proof')
    lane = [sys.executable, str(engine / 'scripts/heavy-lane.py'), 'full-test']
    subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], env=env, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
    log = scheduler / 'full-test-day.log'
    assert log.exists(), 'An actual full-test acquire/release must be recorded'
    redacted = subprocess.run([*lane, '--', sys.executable, '-c', 'pass',
                              'Authorization: Bearer public-redaction-control',
                              '--eval=public-inline-control'], env=env, check=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
    assert 'public-redaction-control' not in log.read_text(), 'Authorization values must never reach the log'
    assert 'public-inline-control' not in log.read_text(), 'Attached inline program text must never reach the log'
    holder = None
    waiter = None
    terminated = None
    try:
        ready = work / 'ready'
        nested = [*lane, '--', sys.executable, '-c', 'pass']
        command = ('import pathlib,subprocess,sys;subprocess.run(' + repr(nested) +
                   ',check=True);pathlib.Path(' + repr(str(ready)) +
                   ').write_text("ready");sys.stdin.read()')
        holder = subprocess.Popen([*lane, '--', sys.executable, '-c', command], env=env,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        until = time.monotonic() + 3
        while not ready.exists() and time.monotonic() < until:
            time.sleep(.01)
        assert ready.exists(), 'Actual inherited lease child must finish'
        waiter = subprocess.Popen([*lane, '--', sys.executable, '-c', 'raise SystemExit(7)'],
                                  env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        until = time.monotonic() + 3
        queued = False
        while time.monotonic() < until:
            state = json.loads((scheduler / 'queue.json').read_text())
            queued = any(row['pid'] == waiter.pid for row in state['queue'])
            if queued:
                break
            time.sleep(.01)
        assert queued, 'Second actual lease must wait behind the owner'
        refused = subprocess.run([*lane, '--admission-wait-seconds', '.05', '--',
                                  sys.executable, '-c', 'pass'], env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
        assert refused.returncode == 124, 'An admission timeout is not a command execution'
        time.sleep(.08)
        holder.stdin.close()
        holder.stdin = None
        holder.communicate(timeout=3)
        assert holder.returncode == 0
        waiter.communicate(timeout=3)
        assert waiter.returncode == 7, 'Observation must preserve the real child verdict'
        timed = subprocess.run([*lane, '--max', '.003', '--', sys.executable, '-c',
                                'import time;time.sleep(30)'], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=4)
        assert timed.returncode == 124
        signal_ready = work / 'signal-ready'
        signal_command = 'import pathlib,time;pathlib.Path(' + repr(str(signal_ready)) + ').write_text("ready");time.sleep(30)'
        terminated = subprocess.Popen([*lane, '--', sys.executable, '-c', signal_command], env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        until = time.monotonic() + 3
        while time.monotonic() < until:
            if signal_ready.exists():
                break
            time.sleep(.01)
        assert signal_ready.exists(), 'Signal control must target the actually started child'
        os.kill(terminated.pid, signal.SIGTERM)
        terminated.communicate(timeout=4)
        assert terminated.returncode == 130
        rows = [json.loads(line) for line in log.read_text().splitlines()]
        acquires = [row for row in rows if row['event'] == 'acquire']
        releases = [row for row in rows if row['event'] == 'release']
        assert len(acquires) == len(releases) == 6, 'Inherited execution must not invent another lease'
        assert {row['token'] for row in acquires} == {row['token'] for row in releases}
        assert sorted(row['exitCode'] for row in releases) == [0, 0, 0, 7, 124, 130]
        assert max(row['queueSeconds'] for row in acquires) >= .07
        assert all(row['machine'] and row['cwd'] and row['command'] for row in acquires)
        assert all(row['heldSeconds'] >= 0 and row['userSeconds'] >= 0 and
                   row['systemSeconds'] >= 0 for row in releases)
        assert len([row for row in rows if row['event'] == 'not-acquired']) == 1
        assert all(row['lane'] == 'lease-log-proof' for row in rows)
        assert all('<redacted>' in row['command'] for row in acquires)
        # Two real linked worktrees share one machine log, not one log per checkout.
        repo = work / 'repo'
        subprocess.run(['git', 'init', '--quiet', '-b', 'main', str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), 'config', 'user.name', 'Lease proof'], check=True)
        subprocess.run(['git', '-C', str(repo), 'config', 'user.email', 'proof@example.invalid'], check=True)
        (repo / 'input.txt').write_text('actual local fixture\n')
        subprocess.run(['git', '-C', str(repo), 'add', 'input.txt'], check=True)
        subprocess.run(['git', '-C', str(repo), 'commit', '--quiet', '-m',
                        'test: record lease fixture\n\nAssisted-by: Codex:gpt-6.1-sol', '--', 'input.txt'], check=True)
        trees = [work / 'tree-a', work / 'tree-b']
        for tree in trees:
            subprocess.run(['git', '-C', str(repo), 'worktree', 'add', '--quiet', '--detach', str(tree)], check=True)
            subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=tree, env=env,
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
        copied = work / 'transferred-machine.log'
        copied.write_bytes(log.read_bytes())
        damaged = work / 'damaged.log'
        damaged.write_text('{not-json}\n' + json.dumps({'schema': 'full-test-day/1', 'event': 'release',
                           'machine': 'incomplete', 'token': 'not-a-proof', 'epoch': time.time()}) + '\n')
        reported = subprocess.run([sys.executable, str(engine / 'scripts/full-test-report.py'),
                                  '--log', str(log), '--log', str(copied), '--log', str(damaged),
                                  '--log', str(work / 'unavailable-machine.log')],
                                 text=True, capture_output=True, check=True, timeout=3)
        report = json.loads(reported.stdout)
        assert report['totals']['leases'] == 8 and report['duplicateEvents'] > 0
        assert report['notAcquired'] == 1 and len(report['invalid']) == 2
        assert len(report['unavailable']) == 1 and report['incomplete'] == []
        assert {str(tree) for tree in trees}.issubset({row['worktree'] for row in report['groups']})
        assert all(row['machine'] for row in report['groups'])
        # A refused observation write cannot change an actual red command or overwrite its target.
        bad_root = work / 'unsafe-scheduler'
        bad_root.mkdir()
        sentinel = work / 'sentinel'
        sentinel.write_text('unchanged')
        (bad_root / 'full-test-day.log').symlink_to(sentinel)
        bad_env = {**env, 'WS_HEAVY_ROOT': str(bad_root), 'WS_HEAVY_SCHEDULER_ROOT': str(bad_root)}
        failed = subprocess.run([*lane, '--', sys.executable, '-c', 'raise SystemExit(7)'],
                                env=bad_env, capture_output=True, text=True, timeout=3)
        assert failed.returncode == 7 and sentinel.read_text() == 'unchanged'
        assert 'observation unavailable' in failed.stderr
        # A FIFO in Git metadata must not delay admission or suppress lease events.
        fifo_cwd = work / 'metadata-fifo'
        (fifo_cwd / '.git').mkdir(parents=True)
        os.mkfifo(fifo_cwd / '.git/HEAD')
        subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=fifo_cwd,
                       env=env, check=True, capture_output=True, timeout=2)
        actual_rows = [json.loads(line) for line in log.read_text().splitlines()]
        assert actual_rows[-1]['event'] == 'release' and actual_rows[-1]['identityUnavailable']
        missing = subprocess.run([*lane, '--', str(work / 'nonexistent-command')], env=env,
                                 capture_output=True, timeout=2)
        assert missing.returncode != 0
        actual_rows = [json.loads(line) for line in log.read_text().splitlines()]
        assert actual_rows[-1]['event'] == 'release' and actual_rows[-1]['exitCode'] == missing.returncode
        fifo_source = work / 'fifo.log'
        os.mkfifo(fifo_source)
        utf8_source = work / 'invalid-utf8.log'
        utf8_source.write_bytes(bytes([255]))
        plan_source = work / 'invalid-plan.log'
        plan_row = {**acquires[0], 'plan': [], 'token': 'invalid-plan'}
        plan_source.write_text(json.dumps(plan_row) + '\n')
        conflict_source = work / 'conflict.log'
        conflict_row = {**releases[0], 'exitCode': 7}
        conflict_source.write_text(json.dumps(conflict_row) + '\n')
        merged = []
        for inputs in ([copied, conflict_source], [conflict_source, copied]):
            argv = [sys.executable, str(engine / 'scripts/full-test-report.py')]
            for source in [*inputs, fifo_source, utf8_source, plan_source]:
                argv.extend(['--log', str(source)])
            result = subprocess.run(argv, capture_output=True, text=True, check=True, timeout=2)
            merged.append(json.loads(result.stdout))
        assert merged[0]['totals'] == merged[1]['totals']
        assert merged[0]['totals']['leases'] == 7
        assert len(merged[0]['unavailable']) == 2 and len(merged[0]['sourceErrors']) == 2
        assert len(merged[0]['invalid']) == 2 and len(merged[0]['incomplete']) == 1
        # Worker allowlisting intentionally strips the lane env: recover only
        # the exact owned queue record, including private batch candidates.
        scope = work / 'push-queue/scope'
        job_id = '000000001-1234abcd'
        snapshot = scope / 'snapshots' / job_id
        subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', str(repo), str(snapshot)], check=True)
        job = {'id': job_id, 'lane': 'queue-source-lane', 'source': str(trees[0]), 'snapshot': str(snapshot)}
        (scope / (job_id + '.json')).write_text(json.dumps(job))
        queue_env = {key: value for key, value in env.items() if not key.startswith('HERDR_') and key not in
                     ('WS_LANE_NAME', 'SERVE_OWNER', 'CLAUDE_CODE_SESSION_ID', 'CODEX_SESSION_ID')}
        subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=snapshot, env=queue_env,
                       check=True, capture_output=True, timeout=2)
        observed = json.loads(log.read_text().splitlines()[-1])
        assert observed['lane'] == 'queue-source-lane' and observed['queueJob'] == job_id
        assert observed['ownerSource'] == str(trees[0])
        wrong_id = '000000002-deadbeef'
        (scope / (job_id + '.json')).write_text(json.dumps({**job, 'id': wrong_id,
                                                'snapshot': str(scope / 'snapshots' / wrong_id)}))
        subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=snapshot, env=queue_env,
                       check=True, capture_output=True, timeout=2)
        observed = json.loads(log.read_text().splitlines()[-1])
        assert observed['lane'] == 'unknown' and 'queueJob' not in observed
        candidate = scope / 'snapshots/batch-proof/candidate-proof/0'
        subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', str(repo), str(candidate)], check=True)
        (candidate.parent / 'result.json').write_text(json.dumps(job))
        subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=candidate, env=queue_env,
                       check=True, capture_output=True, timeout=2)
        observed = json.loads(log.read_text().splitlines()[-1])
        assert observed['lane'] == 'queue-source-lane' and observed['queueJob'] == job_id
        assert observed['worktree'] == str(candidate) and observed['ownerSource'] == str(trees[0])
        (candidate.parent / 'result.json').write_text(json.dumps({**job, 'snapshot': '/not-this-queue'}))
        subprocess.run([*lane, '--', sys.executable, '-c', 'pass'], cwd=candidate, env=queue_env,
                       check=True, capture_output=True, timeout=2)
        observed = json.loads(log.read_text().splitlines()[-1])
        assert observed['lane'] == 'unknown' and 'ownerSource' not in observed
        result = subprocess.run([sys.executable, str(engine / 'scripts/full-test-report.py'), '--log', str(log)],
                                capture_output=True, text=True, check=True, timeout=2)
        owned_group = [row for row in json.loads(result.stdout)['groups'] if row['lane'] == 'queue-source-lane']
        assert len(owned_group) == 1 and owned_group[0]['worktree'] == str(trees[0]) and owned_group[0]['leases'] == 2
        invalid_source = work / 'invalid-owner-source.log'
        invalid_source.write_text(''.join(json.dumps({**acquires[0], 'ownerSource': value, 'token': 'bad-' + str(i)})+'\n'
                                          for i, value in enumerate([None, '', 'relative'])))
        result = subprocess.run([sys.executable, str(engine / 'scripts/full-test-report.py'), '--log', str(invalid_source)],
                                capture_output=True, text=True, check=True, timeout=2)
        assert len(json.loads(result.stdout)['invalid']) == 3
        print(json.dumps({'actualLeases': 15, 'inheritedNotDoubleCounted': True,
                          'fifoWaitMeasured': True, 'realFailureTimeoutSignalPreserved': True,
                          'twoRealLinkedWorktrees': True, 'transferredEventsDeduplicated': True,
                          'unavailableAndDamagedSourcesNamed': True, 'refusedLogDoesNotChangeVerdict': True,
                          'unsafeGitMetadataCannotBlock': True, 'conflictingEventsNeverContributeVerdicts': True,
                          'sanitizedQueueAndBatchOwnerRecovered': True,
                          'seconds': time.monotonic() - began}))
    finally:
        for process in (holder, waiter, terminated):
            if process is not None and process.poll() is None:
                process.terminate()
                process.communicate(timeout=4)
