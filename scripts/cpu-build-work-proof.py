#!/usr/bin/env python3
"""Real private-group service work: completion, helper loss and owner loss."""
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('cpu-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)
owned = admission.owned_command
root = Path(sys.argv[1]).resolve() / ('run-' + str(os.getpid()))
root.mkdir(parents=True)
actors, records, controls = [], [], []


def until(predicate):
    deadline = time.monotonic() + 8
    while not predicate():
        assert time.monotonic() < deadline, 'build-work fixture did not reach its bounded state'
        time.sleep(.02)


def line(actor):
    assert select.select([actor.stdout], [], [], 5)[0], 'missing actual service acknowledgment'
    value = actor.stdout.readline()
    assert value, 'actual service exited before acknowledgment'
    return json.loads(value)


helper = (Path.cwd() / 'scripts/cpu-admission.mjs').as_uri()
program = '''import {holdBuildCpu} from HELPER;
import {spawn} from 'node:child_process';import {once} from 'node:events';
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
await once(child.stdout,'data');console.log(JSON.stringify({preparing:true,descendant:child.pid}));
const lease=await holdBuildCpu();
console.log(JSON.stringify({ready:true,helper:lease.pid,owner:process.pid}));
void lease.lost.then(async()=>{child.kill('SIGKILL');await once(child,'exit');process.exit(130);});
process.stdin.once('data',async()=>{child.kill('SIGKILL');await once(child,'exit');await lease.release();console.log(JSON.stringify({idle:true}));});
process.stdin.resume();
'''.replace('HELPER', json.dumps(helper))
try:
    for mode in ('complete', 'helper-loss', 'owner-loss'):
        work = root / mode
        work.mkdir()
        env = {key: value for key, value in os.environ.items() if not key.startswith(('WS_CPU_', 'WS_HEAVY_'))}
        env['WS_CPU_ROOT'] = str(work)
        # Seed one real three-slot policy. The admitted build uses two on a
        # two-slot machine or three here; an exclusive successor must wait.
        maximum = max(1, (os.cpu_count() or 1) - 2)
        capacity = min(3, maximum)
        with admission.lane.scheduler(work) as state:
            state['cpuCapacity'] = capacity
        actor = subprocess.Popen([sys.argv[2], '--input-type=module', '-e', program],
                                 env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 start_new_session=True)
        actors.append(actor)
        record = owned.capture(actor.pid)
        records.append(record)
        preparing = line(actor)
        descendant = owned.capture(preparing['descendant'])
        records.append(descendant)
        ready = line(actor)
        assert ready['owner'] == actor.pid
        state = json.loads((work / 'queue.json').read_text())
        assert len(state['cpuActive']) == 1
        row = state['cpuActive'][0]
        assert row['pid'] == actor.pid and row['ownedCommand']['selfWork'] is True
        assert row['ownedCommand']['child']['pid'] == actor.pid
        request = {'token': uuid.uuid4().hex, 'pid': os.getpid(), 'holder': os.getpid(),
                   'owner': os.getppid(), 'repo': str(work), 'slots': capacity}
        assert not admission.acquire_cpu(work, request, capacity, time.monotonic() + 10)
        if mode == 'complete':
            actor.stdin.write(b'R')
            actor.stdin.flush()
            assert line(actor) == {'idle': True}
            assert admission.acquire_cpu(work, request, capacity, time.monotonic() + 10)
            assert actor.poll() is None
            controls.append('explicit completed work releases CPU while the actual service stays alive')
        elif mode == 'helper-loss':
            os.kill(ready['helper'], signal.SIGKILL)
            # The actual service still owns the charged row until its lost
            # handler stops the work. Killing a pipe helper cannot free it.
            until(lambda: admission.acquire_cpu(work, request, capacity, time.monotonic() + 10))
            assert actor.wait(timeout=5) == 130
            assert not owned.same_process(descendant)
            controls.append('lost admission helper stops actual work before exclusive CPU succeeds')
        else:
            actor.kill()
            actor.wait(timeout=5)
            until(lambda: admission.acquire_cpu(work, request, capacity, time.monotonic() + 10))
            assert not owned.same_process(descendant)
            controls.append('killed service retains CPU through its ignored-TERM descendant')
        admission.release_cpu(work, request['token'])
finally:
    for record in records:
        if owned.same_process(record):
            os.killpg(record['group'], signal.SIGKILL)
    for actor in actors:
        actor.wait(timeout=5)

assert all(owned.group_stopped(record['group']) for record in records)
print(json.dumps({'controls': controls, 'actualServicesAndHelpersDrained': True}))
