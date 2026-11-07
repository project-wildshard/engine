import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo=Path.cwd()
worker=Path(sys.argv[1]).resolve()
(repo/'tmp').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=repo/'tmp',prefix='ratchet-head-test-') as folder:
 root=Path(folder); staged=root/'staged'; staged.mkdir()
 env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 def git(*args):
  return subprocess.check_output(['git',*args],cwd=root,env=env)
 git('init','-q'); git('config','user.email','fixture@example.invalid');git('config','user.name','fixture');git('config','core.hooksPath','/dev/null')
 (root/'src').mkdir(); (root/'lint').mkdir()
 (root/'src/old.ts').write_text('18')
 (root/'src/listed.ts').write_text('1')
 baseline={'budgets':{'custom-sections/total':0},'wildshard/generator-imports':{'src/listed.ts':1}}
 (root/'lint/ratchet.json').write_text(json.dumps(baseline))
 (root/'.oxlintrc.json').write_text('{}'); (root/'.oxlintrc.ratchet.json').write_text('{"rules":{}}')
 git('add','.');git('commit','-qm','baseline')
 for name in ['src/old.ts','src/listed.ts','lint/ratchet.json','.oxlintrc.json','.oxlintrc.ratchet.json']:
  dest=staged/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((root/name).read_bytes())
 (staged/'.commit-baseline-ratchet.json').write_text(json.dumps(baseline))
 checker=root/'checker.mjs'
 checker.write_text('''#!/usr/bin/env node
import {readFileSync} from 'node:fs';
const files=process.argv.slice(2).filter(x=>x.startsWith('src/'));
const diagnostics=files.flatMap(filename=>Array.from({length:Number(readFileSync(filename,'utf8'))},()=>({code:'wildshard(generator-imports)',filename})));
console.log(JSON.stringify({diagnostics}));process.exitCode=diagnostics.length ? 1 : 0;
''');checker.chmod(0o755)
 def check(files,expected=None):
  (staged/'.commit-files.json').write_text(json.dumps(files))
  result=subprocess.run(['node',str(worker),'ratchet',str(checker),str(root)],cwd=staged,env=env,text=True,capture_output=True)
  if expected is None:
   assert result.returncode==0,result.stdout+result.stderr
  else:
   assert result.returncode!=0 and expected in result.stderr,result.stdout+result.stderr
  # The outer hook owns this subtree in production; isolate fixture invocations.
  import shutil
  shutil.rmtree(staged/'.commit-head',ignore_errors=True)
 check(['src/old.ts'])
 (staged/'src/old.ts').write_text('17');check(['src/old.ts'])
 (staged/'src/old.ts').write_text('19');check(['src/old.ts'],'was 18, now 19')
 (staged/'src/new.ts').write_text('1');check(['src/new.ts'],'was 0, now 1')
 policy={'budgets':{'custom-sections/total':0},'wildshard/generator-imports':{'src/listed.ts':1,'src/new.ts':1}}
 (staged/'lint/ratchet.json').write_text(json.dumps(policy))
 check(['src/new.ts'],'Missing ratchet approval')
 env['WS_COMMIT_MESSAGE']='fix(test): fixture\n\nRatchet-Approved: wildshard-new wildshard/generator-imports src/new.ts +1'
 check(['src/new.ts'])
 policy['wildshard/generator-imports']['src/listed.ts']=2
 (staged/'lint/ratchet.json').write_text(json.dumps(policy));check(['src/listed.ts'],'Missing ratchet approval')
 policy['wildshard/generator-imports']['src/old.ts']=0
 (staged/'lint/ratchet.json').write_text(json.dumps(policy));check(['src/old.ts'],'was 0, now 19')
 (staged/'.oxlintrc.json').write_text(json.dumps({'overrides':[{'files':['src/**'],'rules':{'wildshard/generator-imports':'error'}}]}))
 policy['wildshard/generator-imports']['src/old.ts']=19
 (staged/'lint/ratchet.json').write_text(json.dumps(policy));check(['src/old.ts'],'was 0, now 19')
 print('9 staged ratchet regressions passed')
