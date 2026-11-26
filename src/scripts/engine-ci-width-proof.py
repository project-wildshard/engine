#!/usr/bin/env python3
"""Observe real fork concurrency through the production CI configuration."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

root = Path.cwd()
if len(sys.argv) > 2:
    raise SystemExit('usage: python3 -I src/scripts/engine-ci-width-proof.py [output-directory]')
node = shutil.which('node')
if node is None:
    raise SystemExit('engine CI width proof requires Node')
directory = Path(sys.argv[1] if len(sys.argv) == 2 else 'tmp/engine-ci-width').resolve()
directory.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='run-', dir=directory))
spec = importlib.util.spec_from_file_location('owned', root / 'src/scripts/cpu-owned-command.py')
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)
children = []
controls = []


def interrupted(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    for name in ['scripts', 'src', 'vite']:
        (work / name).symlink_to(root / name, target_is_directory=True)
    (work / 'test').mkdir()
    (work / 'test/setup.ts').symlink_to(root / 'test/setup.ts')
    (work / 'package.json').write_text(json.dumps({'type': 'module', 'private': True, 'version': '0.0.0'}))
    subprocess.run([node, '--input-type=module', '-e',
                    'import{linkNodeModules}from' + json.dumps((root / 'src/scripts/link-node-modules.mjs').as_uri()) +
                    ';linkNodeModules(process.argv[1],process.argv[2]);', str(root), str(work)], check=True)
    epoch = int(time.time())
    stamp = lambda seconds: datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    inventory = b'[]\n'
    (work / 'test/lift-pending.json').write_bytes(inventory)
    (work / 'test/lift-pending-policy.json').write_text(json.dumps({
        'schema': 1, 'owner': 'codex-worker-proof', 'registeredAt': stamp(epoch),
        'deadline': stamp(epoch + 86400), 'inventorySha256': hashlib.sha256(inventory).hexdigest(),
        'reason': 'Fresh owned fixture with an empty migration inventory for real worker dispatch proof.',
    }))
    events = work / 'events.jsonl'
    files = ['test/' + name + '.test.mjs' for name in ['a', 'b', 'c']]
    for file in files:
        (work / file).write_text("""import {test} from 'vitest';
import {appendFileSync,existsSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
test('actual worker dispatch',async()=>{
 const home=process.env.WIDTH_PROOF_HOME,events=join(home,'events.jsonl');
 appendFileSync(events,JSON.stringify({kind:'start',pid:process.pid,file:import.meta.url})+'\\n');
 try{
  if(process.env.WS_CI_PHASE==='ordinary'){
   writeFileSync(join(home,'ready-'+process.pid),'ready');
   const until=Date.now()+10000,target=Number(process.env.WIDTH_PROOF_TARGET);
   while(!existsSync(join(home,'release'))){
    if(readdirSync(home).filter(name=>name.startsWith('ready-')).length>=target)writeFileSync(join(home,'release'),'go');
    if(Date.now()>until)throw Error('Actual configured worker pool did not reach the declared width');
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }
  await new Promise(resolve=>setTimeout(resolve,100));
 }finally{appendFileSync(events,JSON.stringify({kind:'end',pid:process.pid,file:import.meta.url})+'\\n');}
});
""")
    env = {key: value for key, value in os.environ.items() if not key.startswith(('WS_CPU_', 'WS_HEAVY_', 'WS_PUSH_', 'WS_CI_', 'WILDSHARD_'))}
    env.update(CI='true', GITHUB_ACTIONS='true', GIT_AUTHOR_DATE=stamp(epoch), GIT_COMMITTER_DATE=stamp(epoch),
               NODE_COMPILE_CACHE=str(work / 'compile'), VITEST_TMP_ROOT=str(work / 'tmp/vitest'))
    def git(args):
        return subprocess.check_output(['git', '-c', 'user.name=Worker proof', '-c', 'user.email=proof@example.test', *args], cwd=work, env=env, text=True).strip()
    git(['init', '--quiet'])
    tracked = ['package.json', 'test/lift-pending.json', 'test/lift-pending-policy.json', *files]
    git(['add', *tracked])
    git(['commit', '--quiet', '-m', 'fixture', '--', *tracked])
    sha = git(['rev-parse', 'HEAD'])
    digest = hashlib.sha256(json.dumps(sorted(files), separators=(',', ':')).encode()).hexdigest()
    for label, phase, width, target in [('ordinary-three', 'ordinary', 3, 3), ('native-one', 'native', 3, 1), ('legacy-two', 'ordinary', None, 2), ('invalid-zero', 'ordinary', 0, 2), ('invalid-four', 'ordinary', 4, 2)]:
        for path in work.glob('ready-*'):
            path.unlink()
        (work / 'release').unlink(missing_ok=True)
        events.write_text('')
        plan = {'version': 1, 'sha': sha, 'ring': 'full', 'inventoryHash': digest, 'files': files, 'unknown': [],
                'count': 1, 'setupSeconds': 70, 'factor': 1.35, 'curve': [],
                'shards': [{'index': 1, 'native': files if phase == 'native' else [],
                            'ordinary': files if phase == 'ordinary' else [], 'expectedSeconds': 100}]}
        if width is not None:
            plan['ordinaryWorkers'] = width
        plan_file = work / 'plan.json'
        plan_file.write_text(json.dumps(plan))
        child_env = {**env, 'WS_CI_PLAN': str(plan_file), 'WS_CI_SHARD': '1', 'WS_CI_PHASE': phase,
                     'WIDTH_PROOF_HOME': str(work), 'WIDTH_PROOF_TARGET': str(target)}
        with (directory / (label + '.log')).open('w') as output:
            stdout, stderr = os.dup(1), os.dup(2)
            try:
                os.dup2(output.fileno(), 1)
                os.dup2(output.fileno(), 2)
                os.chdir(work)
                child = owned.start_command([node, str(root / 'node_modules/vitest/vitest.mjs'), 'run', *files,
                                             '--root', str(work), '--config', str(root / 'src/scripts/engine-ci.config.ts'), '--project=node'],
                                            child_env, (), lambda record: None)
                children.append(child)
                os.chdir(root)
                code = child.wait(timeout=45)
            finally:
                os.chdir(root)
                os.dup2(stdout, 1)
                os.dup2(stderr, 2)
                os.close(stdout)
                os.close(stderr)
        owned.terminate_command(child)
        records = [json.loads(line) for line in events.read_text().splitlines()]
        active, peak = set(), 0
        for record in records:
            key = (record['pid'], record['file'])
            if record['kind'] == 'start':
                active.add(key)
                peak = max(peak, len(active))
            else:
                active.remove(key)
        result = {'control': label, 'exit': code, 'peak': peak, 'starts': len(records) // 2, 'drained': owned.group_stopped(child.pid)}
        controls.append(result)
        (directory / 'result.json').write_text(json.dumps({'controls': controls}, indent=2) + '\n')
        if label.startswith('invalid'):
            assert code != 0 and not records, 'Invalid plan executed a worker'
        else:
            assert code == 0 and peak == target and len(records) == 6 and not active, result
finally:
    for child in children:
        owned.terminate_command(child)
    assert all(owned.group_stopped(child.pid) for child in children)
    shutil.rmtree(work)
print(json.dumps({'controls': controls, 'actualProductionConfig': True, 'allChildrenDrained': True}))
