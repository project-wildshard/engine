"""An old verified test cache cannot replace current staged ownership."""
import hashlib,json,os,runpy,subprocess,sys,tempfile,time
from pathlib import Path
repo=Path.cwd(); source=runpy.run_path(sys.argv[1]); staged_source=source['staged_source']
cache_api=runpy.run_path(str(repo/'scripts/push_input_cache.py'))
with tempfile.TemporaryDirectory(dir=repo/'tmp',prefix='staged-vocabulary-') as folder:
 root=Path(folder);env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 def git(*args):return subprocess.check_output(['git',*args],cwd=root,env=env)
 def put(name,text):p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','fixture');git('config','core.hooksPath','/dev/null')
 for name in ['git-source-view.mjs','gen-shard-words.mjs','shard-outputs.mjs']:
  put('scripts/'+name,(repo/'scripts'/name).read_text())
 put('package.json','{"type":"module"}')
 put('scripts/precommit-source.py','pass\n');put('scripts/push_input_cache.py','pass\n');put('scripts/precommit-checks.mjs','export {};\n')
 put('lint/ratchet.json','{}');put('.oxlintrc.json','{}')
 manifest='src/shards/example/manifest.json'
 base='public/assets/example/**';committed='public/assets/baked/example/navmesh.bin';staged='public/assets/baked/example/new.bin'
 def declaration(assets):return json.dumps({'slug':'example','name':'Example','assetGlobs':assets})
 put(manifest,declaration([base]));put('src/unit.ts','export const file = "original";\n')
 git('add','.');git('commit','-qm','old product ownership')
 old=git('rev-parse','HEAD').decode().strip();records=[row for row in git('ls-tree','-rz',old).split(b'\0') if row]
 stale=json.dumps({'slugs':['example'],'words':['Example','example'],'sharedAssets':[],
  'shards':{'example':{'name':'Example','ids':[],'settings':[],'assets':[base]}}})
 digest=hashlib.sha256(stale.encode()).hexdigest();put('tmp/push-input-cache/blobs/'+digest,stale)
 put('tmp/push-input-cache/entries.json',json.dumps({'schema':'push-type-inputs/3','revision':old,'roots':['src','scripts','lint'],
  'key':cache_api['source_key'](records,['src','scripts','lint']),'files':{'lint/shard-words.generated.json':digest},'testFiles':{},'post':True}))
 put(manifest,declaration([base,committed]));git('add',manifest);git('commit','-qm','new committed asset ownership')
 put(manifest,declaration([base,committed,staged]));git('add',manifest)
 put('src/unit.ts',f'export const file = "/{staged}";\n');git('add','src/unit.ts')
 put(manifest,declaration(['public/assets/foreign/**']))
 # Node resolves installed packages through the fixture's repository ancestors.
 spec={'files':['src/unit.ts'],'changed':['src/unit.ts'],'closed':False,'deleted':False,'guards':[]}
 tree=root/'tmp/candidate';staged_source(root,tree,time.time()+5,specification=spec)
 value=json.loads((tree/'lint/shard-words.generated.json').read_text())
 assert value['shards']['example']['assets']==[base,committed,staged],value
 assert 'public/assets/foreign/**' not in value['shards']['example']['assets']
 assert 'public/assets/unowned/**' not in value['shards']['example']['assets']
 tree=root/'tmp/baseline';staged_source(root,tree,time.time()+5,'HEAD',spec)
 assert json.loads((tree/'lint/shard-words.generated.json').read_text())['shards']['example']['assets']==[base,committed]
 assert json.loads((root/'tmp/push-input-cache/entries.json').read_text())['revision']==old
 print('stale cache / staged ownership / HEAD ownership / loose refusal passed')
