#!/usr/bin/env python3
"""Actual private-ledger provider-loss controls, including surviving descendants."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('cpu-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)
owned = admission.owned_command


def until(predicate, seconds=10):
    deadline = time.monotonic() + seconds
    while not predicate():
        assert time.monotonic() < deadline, 'owned reclaim fixture did not reach its bounded state'
        time.sleep(.02)


def provider(root):
    entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
             'owner': os.getppid(), 'repo': str(root / 'repo'), 'slots': 2,
             'ownedCommand': owned.ownership()}
    assert admission.acquire_cpu(root, entry, 2, time.monotonic() + 10)
    marker = root / 'command.json'
    descendant = "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"
    command = ('import subprocess,sys,time,json,os;from pathlib import Path;'
               'p=subprocess.Popen([sys.executable,"-c",' + repr(descendant) + ']);'
               # Wait for the grandchild to install its TERM handler.
               'time.sleep(.15);Path(' + repr(str(marker)) + ').write_text(json.dumps('
               '{"root":os.getpid(),"descendant":p.pid}));time.sleep(60)')
    child = owned.start_command([sys.executable, '-c', command], dict(os.environ), (),
                                lambda record: admission.publish_cpu_child(root, entry['token'], record))
    (root / 'grant.json').write_text(json.dumps({'provider': owned.capture(os.getpid()),
                                                'child': owned.capture(child.pid), 'token': entry['token']}))
    try:
        child.wait()
        # Leave descendant reclamation to the ledger in this counterexample.
        # A provider that eagerly cleans it itself would hide that seam.
        until(lambda: owned.group_stopped(child.pid))
    finally:
        owned.terminate_command(child)
        admission.release_cpu(root, entry['token'])


if len(sys.argv) > 1 and sys.argv[1] == 'provider':
    provider(Path(sys.argv[2]))
    raise SystemExit(0)
if len(sys.argv) > 1 and sys.argv[1] == 'caller':
    raise SystemExit(subprocess.call([sys.executable, str(Path(__file__).resolve()), 'provider', sys.argv[2]]))

root = Path(sys.argv[1]).resolve() / ('run-' + str(os.getpid()))
root.mkdir(parents=True)
children, groups, descendants, providers, controls = [], [], [], [], []
try:
    for mode in ('provider-loss', 'caller-loss', 'checkout-loss', 'premature-release'):
        work = root / mode
        (work / 'repo').mkdir(parents=True)
        caller = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'caller', str(work)])
        children.append(caller)
        until(lambda: (work / 'command.json').exists() and (work / 'grant.json').exists())
        grant = json.loads((work / 'grant.json').read_text())
        providers.append(grant['provider'])
        command = json.loads((work / 'command.json').read_text())
        groups.append(grant['child'])
        descendant = owned.capture(command['descendant'])
        descendants.append(descendant)
        assert descendant['group'] == grant['child']['group']
        request = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
                   'owner': os.getppid(), 'repo': str(root), 'slots': 2}
        assert not admission.acquire_cpu(work, request, 2, time.monotonic() + 10)
        if mode == 'provider-loss':
            os.kill(grant['provider']['pid'], signal.SIGKILL)
            caller.wait(timeout=5)
        elif mode == 'caller-loss':
            caller.kill()
            caller.wait(timeout=5)
        elif mode == 'checkout-loss':
            (work / 'repo').rmdir()
        else:
            assert admission.release_cpu(work, grant['token']) is False
        assert not admission.acquire_cpu(work, request, 2, time.monotonic() + 10)
        # TERM killed the root; its ignored-TERM descendant keeps the charge.
        until(lambda: not owned.same_process(grant['child']))
        assert owned.same_process(descendant)
        assert not admission.acquire_cpu(work, request, 2, time.monotonic() + 10)
        state = json.loads((work / 'queue.json').read_text())
        assert any(row['token'] == grant['token'] for row in state['cpuActive'])
        # Releasing another grant must not discard the dead provider's row.
        admission.release_cpu(work, 'different-token')
        assert any(row['token'] == grant['token'] for row in json.loads((work / 'queue.json').read_text())['cpuActive'])
        until(lambda: admission.acquire_cpu(work, request, 2, time.monotonic() + 10))
        assert not owned.same_process(descendant) and owned.group_stopped(grant['child']['group'])
        assert admission.release_cpu(work, request['token'])
        until(lambda: not owned.same_process(grant['provider']))
        controls.append(mode + ': exclusive blocked until root and ignored-TERM descendant drained')

    # A real unrelated private group never authorizes a signal using stale birth
    # evidence. This is a trusted local ledger corruption/refusal control.
    work = root / 'forged'
    work.mkdir()
    unrelated = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
    children.append(unrelated)
    actual = owned.capture(unrelated.pid)
    wrong = {**actual, 'parent': os.getpid(), 'identity': 'stale-birth'}
    entry = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
             'owner': os.getppid(), 'repo': str(work), 'slots': 2,
             'ownedCommand': {**owned.ownership(), 'child': wrong}}
    assert admission.acquire_cpu(work, entry, 2, time.monotonic() + 10)
    for patch in ({}, {'child': {**wrong, 'uid': os.getuid() + 1}}, {'child': {**wrong, 'pid': True}}):
        with admission.lane.scheduler(work) as state:
            state['cpuActive'][0]['ownedCommand'] = {**entry['ownedCommand'], **patch}
        assert not admission.release_cpu(work, entry['token'])
        assert unrelated.poll() is None and owned.same_process(actual)
    controls.append('forged or reused child identity retains capacity and never signals unrelated work')
    # Publication cannot resurrect a missing/released grant.
    try:
        admission.publish_cpu_child(work, 'absent-token', actual)
        raise AssertionError('publication accepted a missing grant')
    except RuntimeError:
        pass
    controls.append('missing grant publication refuses before execution')
finally:
    for record in groups + descendants:
        if owned.same_process(record):
            os.killpg(record['group'], signal.SIGKILL)
    for record in providers:
        if owned.same_process(record):
            os.kill(record['pid'], signal.SIGTERM)
    for child in children:
        if child.poll() is None:
            child.terminate()
        child.wait(timeout=5)

assert all(owned.group_stopped(record['group']) for record in groups)
print(json.dumps({'controls': controls, 'allActualCommandGroupsDrained': True,
                  'reservationRetainedThroughReclaim': True}))
