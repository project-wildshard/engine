#!/usr/bin/env python3
"""Real owned command clocks and lifecycle controls; no suite or network work."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


HARNESS = r'''
import importlib.util,json,pathlib,subprocess,sys,time
wrapper=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(wrapper.parent))
spec=importlib.util.spec_from_file_location('owned_heavy_lane',wrapper)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
record=module.record_full_test;remove=module.remove_ticket
burn="import time; end=time.process_time()+.12\nwhile time.process_time()<end: pass"
def busy(): subprocess.run([sys.executable,'-c',burn],check=True)
def observed(root,entry,event,**metrics):
 if event=='acquire': busy()
 return record(root,entry,event,**metrics)
def removed(*args,**kwargs):
 busy()
 return remove(*args,**kwargs)
module.record_full_test=observed;module.remove_ticket=removed
if sys.argv[5]=='no-counters': module.child_cpu=lambda: None
if sys.argv[5]=='admission-jitter':
 acquire=module.acquire;delayed=False
 def delayed_acquire(*args,**kwargs):
  global delayed
  if not delayed:
   delayed=True;time.sleep(.12);return None
  return acquire(*args,**kwargs)
 module.acquire=delayed_acquire
sys.argv=[str(wrapper),'full-test','--admission-wait-seconds',sys.argv[6],'--max',sys.argv[4],'--',*json.loads(sys.argv[3])]
sys.exit(module.main())
'''

ACTOR = r'''
import json,os,pathlib,resource,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
(root/'actor-pid').write_text(str(os.getpid()))
if mode=='timeout': time.sleep(30)
if mode=='sleep': time.sleep(.20)
else:
 end=time.process_time()+.18
 while time.process_time()<end: pass
 if mode=='busy':
  subprocess.run([sys.executable,'-c','import time;end=time.process_time()+.08\nwhile time.process_time()<end: pass'],check=True)
self=resource.getrusage(resource.RUSAGE_SELF);children=resource.getrusage(resource.RUSAGE_CHILDREN)
(root/'independent.json').write_text(json.dumps({'pid':os.getpid(),'userSeconds':self.ru_utime+children.ru_utime,'systemSeconds':self.ru_stime+children.ru_stime}))
sys.exit(7 if mode=='nonzero' else 0)
'''


def run_case(wrapper, parent, mode):
    root = parent / mode
    root.mkdir()
    leases = root / 'leases'
    leases.mkdir()
    actor = root / 'actor.py'
    actor.write_text(ACTOR)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('WS_HEAVY_', 'WS_PUSH_')) and key not in ('CI', 'GITHUB_ACTIONS')}
    env.update(WS_HEAVY_ROOT=str(leases), WS_HEAVY_SCHEDULER_ROOT=str(leases),
               WS_PUSH_GATE_PROFILE='full-v1', WS_FULL_SUITE='1',
               WS_STORE_RESERVATION=str(root / 'store-maintenance.lock'), PYTHONDONTWRITEBYTECODE='1')
    command = [sys.executable, str(actor), str(root), mode]
    if mode == 'launch-failed':
        command = [str(root / 'absent-executable')]
    lock = None
    if mode == 'refused':
        lock = (leases / 'full-test.lock').open('a+')
        fcntl.flock(lock, fcntl.LOCK_EX)
        (leases / 'full-test.active.json').write_text(json.dumps({
            'pid': os.getpid(), 'runnerPid': os.getpid(), 'childPid': os.getpid(),
            'token': 'held-fixture', 'resources': ['full-test'], 'command': ['fixture-holder'],
            'startedAt': time.time(), 'queuedAt': time.time(), 'lane': 'owned-fixture'}))
    try:
        # Only the deliberately held lane uses the short admission deadline.
        # The owned-timeout case must first admit and launch its real actor.
        result = subprocess.run([sys.executable, '-c', HARNESS, str(wrapper), str(leases),
                                 json.dumps(command), '.003' if mode == 'timeout' else '.2',
                                 'no-counters' if mode == 'no-counters' else 'admission-jitter' if mode == 'timeout' else 'normal',
                                 '.08' if mode == 'refused' else '5'],
                                env=env, capture_output=True, text=True, timeout=15)
    finally:
        if lock:
            lock.close()
    expected = 124 if mode in ('timeout', 'refused') else 1 if mode == 'launch-failed' else 7 if mode == 'nonzero' else 0
    assert result.returncode == expected, (mode, result.returncode, result.stderr[-1500:])
    records = [json.loads(line) for line in (leases / 'full-test-day.log').read_text().splitlines()]
    end = records[-1]
    usage = end['commandUsage']
    if mode in ('refused', 'launch-failed'):
        assert usage is None, (mode, usage)
        assert not (root / 'actor-pid').exists()
        return {'mode': mode, 'exitCode': result.returncode, 'noInventedCommand': True}
    assert usage is not None, (mode, end, result.stderr[-1500:])
    assert usage['pid'] == int((root / 'actor-pid').read_text())
    assert usage['reaped'] is True and usage['wallSeconds'] > 0
    assert usage['identity'] and usage['scope'] == 'owned-child-and-descendants-reaped-by-it'
    if mode == 'no-counters':
        assert usage['state'] == 'unavailable'
        assert usage['userSeconds'] is None and usage['systemSeconds'] is None
    else:
        assert usage['state'] == 'measured'
        assert usage['userSeconds'] >= 0 and usage['systemSeconds'] >= 0
    if mode in ('busy', 'sleep', 'nonzero'):
        independent = json.loads((root / 'independent.json').read_text())
        for field in ('userSeconds', 'systemSeconds'):
            assert abs(usage[field] - independent[field]) < .05 + independent[field] * .12, (mode, field, usage, independent)
        cpu = usage['userSeconds'] + usage['systemSeconds']
        legacy = end['userSeconds'] + end['systemSeconds']
        assert legacy - cpu > .18, (mode, 'bookkeeping credited to command', usage, end)
        if mode == 'sleep':
            assert cpu < usage['wallSeconds'] * .75
    assert not json.loads((leases / 'queue.json').read_text())['queue']
    assert not (leases / 'full-test.active.json').exists()
    try:
        os.kill(usage['pid'], 0)
    except ProcessLookupError:
        pass
    else:
        raise AssertionError(('owned actor was not reaped', mode, usage['pid']))
    row = {'mode': mode, 'exitCode': result.returncode, 'userSeconds': usage['userSeconds'],
           'systemSeconds': usage['systemSeconds'], 'wallSeconds': usage['wallSeconds'], 'reaped': True}
    if mode in ('busy', 'sleep', 'nonzero'):
        row.update(independentUserSeconds=independent['userSeconds'], independentSystemSeconds=independent['systemSeconds'],
                   leaseUserSeconds=end['userSeconds'], leaseSystemSeconds=end['systemSeconds'],
                   bookkeepingCpuExcluded=legacy-cpu)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wrapper', required=True, type=Path)
    parser.add_argument('--scratch', required=True, type=Path)
    args = parser.parse_args()
    args.scratch = args.scratch.resolve()
    args.scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='command-proof-', dir=args.scratch) as temporary:
        rows = [run_case(args.wrapper.resolve(), Path(temporary), mode)
                for mode in ('busy', 'sleep', 'nonzero', 'timeout', 'refused', 'launch-failed', 'no-counters')]
    print(json.dumps({'cases': rows, 'bookkeepingExcluded': True, 'independentClocksAgree': True,
                      'oldLeaseTotalsRetained': True, 'lifecyclePreserved': True}))


if __name__ == '__main__':
    main()
