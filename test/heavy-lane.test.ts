import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real flock leases in an isolated owned fixture.
import { execFileSync } from 'node:child_process';

test('queue and scheduler deadlines name holders without launching or taking their locks', () => {
  const result = execFileSync('python3', ['-c', `
import contextlib, fcntl, importlib.util, json, os, pathlib, subprocess, sys, tempfile, time, types
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
spec = importlib.util.spec_from_file_location('heavy_lane', 'scripts/heavy-lane.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
assert module.WAIT_SECONDS == 300
module.WAIT_SECONDS = .02
# The real lock remains held. Only elapsed admission time is virtual: a busy
# machine cannot turn the scheduler's immediate refusal into a timing failure.
class Clock:
 def __init__(self): self.now = 0.0; self.sleeps = []
 def monotonic(self): return self.now
 def sleep(self, seconds):
  assert 0 < seconds <= module.WAIT_SECONDS, seconds
  self.sleeps.append(seconds); self.now += seconds
clock = Clock()
module.time = types.SimpleNamespace(monotonic=clock.monotonic, sleep=clock.sleep, time=time.time)
with tempfile.TemporaryDirectory(prefix='deadline-test-', dir='tmp') as temporary:
 root = pathlib.Path(temporary).resolve()
 owner = {'pid':os.getpid(), 'command':['node','owned-build.mjs'], 'startedAt':time.time()}
 owner['lane'] = 'fixture-lane'
 with (root/'scheduler.lock').open('w+') as lock:
  json.dump(owner,lock); lock.flush(); fcntl.flock(lock,fcntl.LOCK_EX)
  started = clock.monotonic()
  try:
   with module.scheduler(root): raise AssertionError('stole scheduler lock')
  except TimeoutError as error:
   message = str(error)
   assert all(value in message for value in ('5 min','slot=scheduler','pid='+str(os.getpid()),'owned-build.mjs','start=20','lane=fixture-lane','age=')), message
  assert clock.monotonic()-started < 1
  assert clock.sleeps == [module.WAIT_SECONDS], clock.sleeps
 # Main exercises the actual FIFO/resource admission and its ticket cleanup.
 (root/'queue.json').write_text(json.dumps({'next':1,'queue':[dict(owner,token='older',ticket=0,resources=['build'],priority=1,queuedAt=time.time())]}))
 for slot in module.BUILD_SLOTS: (root/(slot+'.active.json')).write_text(json.dumps(owner))
 saved_env = dict(os.environ)
 os.environ.clear(); os.environ.update({k:v for k,v in saved_env.items() if not k.startswith('WS_HEAVY_')})
 os.environ['WS_HEAVY_ROOT'] = str(root)
 sys.argv = ['scripts/heavy-lane.py','build','--',sys.executable,'-c',"raise AssertionError('launched queued child')"]
 try:
  assert module.main() == 124
  queue = json.loads((root/'queue.json').read_text())['queue']
  assert len(queue)==1 and queue[0]['token']=='older', queue
  (root/'queue.json').write_text(json.dumps({'next':1,'queue':[]}))
  with contextlib.ExitStack() as stack:
   locks = [stack.enter_context((root/(slot+'.lock')).open('a+')) for slot in module.BUILD_SLOTS]
   for lock in locks: fcntl.flock(lock,fcntl.LOCK_EX)
   assert module.main() == 124
   assert json.loads((root/'queue.json').read_text())['queue'] == []
   for lock in locks: fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
 finally:
  os.environ.clear(); os.environ.update(saved_env)
print(json.dumps(True))
`], { encoding: 'utf8', timeout: 5000 });
  expect(JSON.parse(result)).toBe(true);
});

test('three build slots queue FIFO, inherit leases and keep reporting', () => {
  const result = execFileSync('python3', ['-c', `
import json, os, pathlib, subprocess, sys, tempfile, time
repo = pathlib.Path.cwd()
wrapper = str(repo / 'scripts/heavy-lane.py')
guard = "import {assertHeavyLease as current} from './scripts/heavy-lane-lease.mjs';import {assertHeavyLease as legacy} from './test/fixtures/legacy-heavy-lane-lease.mjs';current('build');legacy('build')"
with tempfile.TemporaryDirectory(prefix='capacity-test-', dir=repo / 'tmp') as temporary:
 root = pathlib.Path(temporary)
 env = {k: v for k, v in os.environ.items() if k not in ('WS_HEAVY_TOKEN', 'WS_HEAVY_GATE', 'WS_HEAVY_SCHEDULER_ROOT')}
 env['WS_HEAVY_ROOT'] = str(root)
 worker = root / 'worker.py'
 worker.write_text("import pathlib, subprocess, sys\\nroot=pathlib.Path(sys.argv[1]); name=sys.argv[2]\\nsubprocess.run(['node','--input-type=module','-e',sys.argv[3]],check=True)\\n(root/(name+'.started')).write_text('yes')\\nassert sys.stdin.read(1) == 'r', 'owner closed before release'\\n")
 processes = []
 releases = {}
 def launch(kind, name):
  process = subprocess.Popen([sys.executable, wrapper, kind, '--', sys.executable, str(worker), str(root), name, guard], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
  processes.append(process)
  releases[name] = process
  return process
 def release(name):
  process = releases[name]
  process.stdin.write('r'); process.stdin.flush(); process.stdin.close(); process.stdin = None
 def wait_for(predicate):
  while not predicate():
   for process in processes:
    if process.poll() not in (None, 0):
     out, err = process.communicate()
     raise AssertionError((process.returncode, out, err))
   time.sleep(.01)
 def queue_size(n):
  try: return len(json.loads((root/'queue.json').read_text())['queue']) >= n
  except (OSError, ValueError): return False
 try:
  a = launch('build', 'a'); wait_for(lambda: (root/'a.started').exists())
  b = launch('build', 'b'); wait_for(lambda: (root/'b.started').exists())
  copied = dict(env, WS_HEAVY_TOKEN=json.loads((root/'build-2.active.json').read_text())['token'])
  assert subprocess.run(['node','--input-type=module','-e',guard], env=copied, capture_output=True).returncode != 0
  c = launch('build', 'c'); wait_for(lambda: (root/'c.started').exists())
  d = launch('build', 'd'); wait_for(lambda: queue_size(1))
  e = launch('build', 'e'); wait_for(lambda: queue_size(2))
  assert not (root/'d.started').exists() and not (root/'e.started').exists()
  release('a'); wait_for(lambda: (root/'d.started').exists())
  assert not (root/'e.started').exists()
  state = json.loads(subprocess.check_output([sys.executable,wrapper,'status'], env=env))
  assert len([entry for entry in state['active'] if entry['resource'] in ('build','build-2','build-3')]) == 3
  release('c'); wait_for(lambda: (root/'e.started').exists())
  release('b'); release('d'); release('e')
  for process in processes:
   out, err = process.communicate(timeout=6)
   assert process.returncode == 0, (out, err)
  records = [json.loads(line) for line in (root/'build-day.log').read_text().splitlines()]
  assert records[0]['schema'] == 'build-day/1' and len(records) == 6
  assert all(row['buildSeconds'] > 0 and row['queueSeconds'] >= 0 and len(row['loadStart']) == 3 for row in records[1:])
  assert max(row['queueSeconds'] for row in records[1:]) > 0
  nested = subprocess.run([sys.executable,wrapper,'build','--',sys.executable,wrapper,'build','--','node','--input-type=module','-e',guard],env=env,capture_output=True,text=True)
  assert nested.returncode == 0, nested.stderr
  records = [json.loads(line) for line in (root/'build-day.log').read_text().splitlines()]
  assert any(row.get('inherited') for row in records[1:])
  records[0]['expiresAt'] = 0
  (root/'build-day.log').write_text(''.join(json.dumps(row)+'\\n' for row in records))
  before = (root/'build-day.log').read_text()
  final = subprocess.run([sys.executable,wrapper,'build','--','node','--input-type=module','-e',guard],env=env,capture_output=True,text=True)
  assert final.returncode == 0, final.stderr
  after = [json.loads(line) for line in (root/'build-day.log').read_text().splitlines()]
  assert len(after) == len(records)+1 and after[-1]['exitCode'] == 0
  assert (root/'build-day.log').read_text().startswith(before)
  (root/'build-day.log').write_text('[]')
  report_only = subprocess.run([sys.executable,wrapper,'build','--','node','--input-type=module','-e',guard],env=env,capture_output=True,text=True)
  assert report_only.returncode == 0 and 'observation unavailable' in report_only.stderr
  assert not json.loads(subprocess.check_output([sys.executable,wrapper,'status'],env=env))['active']
 finally:
  for process in processes:
   if process.poll() is None: process.terminate()
  for process in processes: process.wait(timeout=6)
print(json.dumps(True))
`], { encoding: 'utf8', timeout: 20000 });
  expect(JSON.parse(result)).toBe(true);
}, 25000);

test('build children retain the normal caller priority', () => {
  const result = execFileSync('python3', ['-c', `
import json, os, pathlib, subprocess, sys, tempfile
repo = pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='priority-test-', dir=repo / 'tmp') as temporary:
 env = {k:v for k,v in os.environ.items() if not k.startswith('WS_HEAVY_')}
 env['WS_HEAVY_ROOT'] = temporary
 parent = os.getpriority(os.PRIO_PROCESS, 0)
 for kind in ('build',):
  child = subprocess.run([sys.executable,str(repo/'scripts/heavy-lane.py'),kind,'--',sys.executable,'-c','import os; print(os.getpriority(os.PRIO_PROCESS, 0))'],env=env,capture_output=True,text=True,check=True)
  assert int(child.stdout) == parent, (kind, parent, child.stdout, child.stderr)
print(json.dumps(True))
`], { encoding: 'utf8' });
  expect(JSON.parse(result)).toBe(true);
});

test('foreground builds keep normal QoS and background builds yield', () => {
  const result = execFileSync('python3', ['-c', `
import json, runpy
from unittest.mock import patch
module = runpy.run_path('scripts/heavy-lane.py')
launch = module['launch_command']
command = ['node', 'fixture.mjs']
with patch.object(module['shutil'], 'which', return_value='/usr/bin/taskpolicy'):
 assert launch('build', command, {'WS_HEAVY_RULER':'1'}) == command
 assert launch('build', command, {}) == command
 assert launch('check', command, {}) == command
 assert launch('build', command, {'WS_HEAVY_RULER':'0'}) == command
 assert launch('build', command, {'WS_HEAVY_BACKGROUND':'1'}) == ['taskpolicy', '-c', 'utility', *command]
 assert launch('build', command, {'WS_HEAVY_BACKGROUND':'1','WS_HEAVY_RULER':'1'}) == command
 assert launch('full-test', command, {'WS_HEAVY_RULER':'1'}) == ['taskpolicy', '-c', 'utility', 'nice', '-n', '10', *command]
with patch.object(module['shutil'], 'which', return_value=None):
 assert launch('build', command, {}) == command
print(json.dumps(True))
`], { encoding: 'utf8' });
  expect(JSON.parse(result)).toBe(true);
});


test('the background CLI flag reaches its owned build child', () => {
  const result = execFileSync('python3', ['-c', `
import json, os, pathlib, subprocess, sys, tempfile
repo = pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='background-build-test-', dir=repo/'tmp') as temporary:
 root = pathlib.Path(temporary)
 env = {key:value for key,value in os.environ.items() if not key.startswith('WS_HEAVY_')}
 env['WS_HEAVY_ROOT'] = str(root/'leases')
 command = [sys.executable,str(repo/'scripts/heavy-lane.py'),'build','--background','--',sys.executable,'-c',"import os; print(os.environ.get('WS_HEAVY_BACKGROUND'))"]
 child = subprocess.run(command,env=env,capture_output=True,text=True,check=True)
 assert child.stdout.strip()=='1', child.stdout+child.stderr
print(json.dumps(True))
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  expect(JSON.parse(result)).toBe(true);
});

// The two G10 cases never sample a moment: the guarded command touches a marker when it runs, so "it did not run
// while the prune held the store" is checked by the marker's absence, and the hold is released explicitly. A lease
// or grant that is written and then given back in between can't make them flaky (main run 43079645530).
test('GVS G10: a store-prune reservation keeps leases queued, outlives a killed prune owner, and ends with its last child', () => {
  const result = execFileSync('python3', ['-c', `
import json, os, pathlib, subprocess, sys, tempfile, time
repo = pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='store-reservation-test-', dir=repo/'tmp') as temporary:
 root = pathlib.Path(temporary)
 env = {key:value for key,value in os.environ.items() if not key.startswith('WS_HEAVY_')}
 env['WS_HEAVY_ROOT'] = str(root/'leases')
 lock = root/'store-maintenance.lock'
 env['WS_STORE_RESERVATION'] = str(lock)
 marker = root/'ran'
 # A prune owner takes the lock, starts its long child with the lock inherited, then is killed.
 owner = subprocess.Popen([sys.executable,'-c',
  "import fcntl,subprocess,sys,time\\nf=open(sys.argv[1],'a+')\\nfcntl.flock(f,fcntl.LOCK_EX)\\nc=subprocess.Popen(['sleep','60'],pass_fds=(f.fileno(),))\\nprint(c.pid,flush=True)\\ntime.sleep(60)",
  str(lock)], stdout=subprocess.PIPE, text=True)
 child = int(owner.stdout.readline())
 owner.kill(); owner.wait()
 build = subprocess.Popen([sys.executable,str(repo/'scripts/heavy-lane.py'),'build','--',sys.executable,'-c',"import pathlib,sys; pathlib.Path(sys.argv[1]).touch()",str(marker)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 queue = root/'leases'/'queue.json'
 def queued():
  try: return any(row.get('pid') == build.pid for row in json.loads(queue.read_text()).get('queue', []))
  except (OSError, ValueError): return False
 deadline = time.monotonic() + 30
 while not queued() and build.poll() is None and time.monotonic() < deadline: time.sleep(0.05)
 time.sleep(1)  # many admission attempts, all against the held lock
 waited = queued() and build.poll() is None and not marker.exists()
 os.kill(child, 9)
 out, err = build.communicate(timeout=60)
 print(json.dumps({'waited': waited, 'ran': build.returncode == 0 and marker.exists()}))
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  expect(JSON.parse(result)).toEqual({ waited: true, ran: true });
}, 120_000);

test('GVS G10: CPU admission gives its grant back and waits while a store prune holds the store', () => {
  const result = execFileSync('python3', ['-c', `
import fcntl, json, os, pathlib, subprocess, sys, tempfile, time
repo = pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='cpu-reservation-test-', dir=repo/'tmp') as temporary:
 root = pathlib.Path(temporary)
 env = {key:value for key,value in os.environ.items() if not key.startswith('WS_HEAVY_') and key != 'WS_CPU_ROOT'}
 env['WS_CPU_ROOT'] = str(root/'cpu')
 lock = root/'store-maintenance.lock'
 env['WS_STORE_RESERVATION'] = str(lock)
 marker = root/'ran'
 held = open(lock, 'a+'); fcntl.flock(held, fcntl.LOCK_EX)
 run = subprocess.Popen([sys.executable,str(repo/'scripts/cpu-admission.py'),'run','--slots','1','--capacity','1','--',sys.executable,'-c',"import pathlib,sys; pathlib.Path(sys.argv[1]).touch()",str(marker)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 queue = root/'cpu'/'queue.json'
 def seen():
  try:
   state = json.loads(queue.read_text())
   return any(row.get('pid') == run.pid for row in [*state.get('cpuQueue', []), *state.get('cpuActive', [])]) or state.get('cpuNext', 0) > 0
  except (OSError, ValueError): return False
 deadline = time.monotonic() + 30
 while not seen() and run.poll() is None and time.monotonic() < deadline: time.sleep(0.05)
 time.sleep(1)  # many admission attempts, all against the held lock
 waited = seen() and run.poll() is None and not marker.exists()
 fcntl.flock(held, fcntl.LOCK_UN); held.close()
 out, err = run.communicate(timeout=60)
 print(json.dumps({'waited': waited, 'ran': run.returncode == 0 and marker.exists()}))
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  expect(JSON.parse(result)).toEqual({ waited: true, ran: true });
}, 120_000);

// A SIGKILLed push gate leaves its `full-test-<checkout>.active.json` behind with both pids dead. Its flock went with it, so the slot
// is free, but the timeout named it as the holder (2.8 h on 2026-11-13, hiding the real one). Both pids dead and the lock free: free,
// and the file is reaped. A lock an orphaned grandchild still holds (it inherited the fd) stays named.
test('a lease whose runner and child are both dead counts as free and is reaped', () => {
  const result = execFileSync('python3', ['-c', `
import fcntl, importlib.util, json, os, pathlib, subprocess, sys, tempfile, time
spec = importlib.util.spec_from_file_location('heavy_lane', 'scripts/heavy-lane.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
gone = subprocess.Popen([sys.executable, '-c', '0']); gone.wait()
dead = gone.pid
with tempfile.TemporaryDirectory(prefix='dead-lease-test-', dir='tmp') as temporary:
 root = pathlib.Path(temporary).resolve()
 lease = lambda pid, child, name: {'token': name, 'pid': pid, 'runnerPid': pid, 'childPid': child, 'resources': ['full-test'],
   'command': ['node', name + '.mjs'], 'startedAt': time.time(), 'lane': name}
 (root/'full-test-dead.active.json').write_text(json.dumps(lease(dead, dead, 'killed-gate')))
 (root/'full-test-live.active.json').write_text(json.dumps(lease(os.getpid(), os.getpid(), 'live-gate')))
 (root/'full-test-orphan.active.json').write_text(json.dumps(lease(dead, dead, 'orphan-gate')))
 with (root/'full-test-live.lock').open('a+') as live, (root/'full-test-orphan.lock').open('a+') as orphan:
  fcntl.flock(live, fcntl.LOCK_EX); fcntl.flock(orphan, fcntl.LOCK_EX)
  entry = {'token': 'me', 'ticket': 1, 'resources': ['full-test'], 'checkout': '/elsewhere'}
  (root/'queue.json').write_text(json.dumps({'next': 2, 'queue': []}))
  message = str(module.queue_timeout(root, entry))
 print(json.dumps({'named': [name for name in ('killed-gate', 'live-gate', 'orphan-gate') if name in message],
   'kept': sorted(path.name for path in root.glob('full-test-*.active.json'))}))
`], { encoding: 'utf8', timeout: 10_000 });
  expect(JSON.parse(result)).toEqual({ named: ['live-gate', 'orphan-gate'], kept: ['full-test-live.active.json', 'full-test-orphan.active.json'] });
});
