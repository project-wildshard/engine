import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path.cwd()
game_source, docs_source = (Path(name).read_text() for name in sys.argv[1:])
with tempfile.TemporaryDirectory(dir=repo/'tmp', prefix='gen-docs-test-') as folder:
    root = Path(folder)
    def put(name, text):
        path = root/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    def module(name, exports):
        put('scripts/'+name+'.mjs', "import {appendFileSync} from 'node:fs';\n" + exports)
    def record(name):
        return "appendFileSync('calls.txt'," + json.dumps(name+'\n') + ");"
    module('quiet-cli', 'export function quietCli() {}')
    module('generation-scheduling', 'export function generationConcurrency(){return 1}')
    module('source-table-cache', 'export async function sourceTablesCached(root,step,run){return run()}')
    module('generated-source', 'export function checkGeneratedSourceTree(){return []}')
    module('heavy-lane-lease', 'export function assertHeavyLease(){}')
    program_tables = 'export function programInputPlan(root,plan){return plan}export async function emitProgramTables(root,plan,{inputsOnly,writeTables,build}){await writeTables();if(!inputsOnly)await build(root,plan)}'
    module('gen-programs', 'import {resolve} from "node:path";export function generationPlan(){return {products:["fixture"],folders:["fixture"],legacy:["fixture"],scoped:false}}export function prepareProgramInputs(){'+record('prepareGeneration')+'}export function buildPrograms(root){if(root!==resolve(root))throw Error("product receipt root is not canonical");'+record('programs')+'}'+program_tables)
    module('bake-loader', record('loader'))
    module('shard-public', 'export function publishShardFiles(){'+record('publish')+'}')
    module('gen-shards', 'export function refreshDiscovery(){'+record('discovery')+'}export function genShardInputs(){'+record('shard-inputs')+'}export function genShards(){'+record('shards')+'}')
    for file, function in [('gen-budget-derivations','genBudgetDerivations'),('generate','prepareGeneration'),('gen-starter-arm-clips','genStarterArmClips'),('gen-starter-weapons','genStarterWeapons'),('gen-starter-bag','genStarterBag'),('gen-starter-effects','genStarterEffects'),('gen-format-schema','writeFormatJsonSchemas'),('gen-shard-words','genShardWords')]:
        module(file, 'export function '+function+'(){'+record(function)+'}')
    module('push-post-inputs', 'export function beginPushInputs(){return ()=>{'+record('seal')+'}}')
    module('source-input-proof', 'export function beginProgramInputProof(){return ()=>{'+record('program-proof')+'}}')
    put('scripts/app-build/gen.ts', "import {appendFileSync} from 'node:fs';export function generateBootTables(){"+record('boot')+'}')
    put('scripts/gen.mjs', game_source)
    put('scripts/docs.mjs', docs_source)
    for file, function in [('gen-api','writeApiDocs'),('gen-host-catalogue','writeHostCatalogue')]:
        module(file, 'export function '+function+'(root){if(root!==new URL("../",import.meta.url).pathname.replace(/\\/$/,""))throw Error("wrong docs root");'+record(function)+'}')
    env = {key:value for key,value in os.environ.items() if key not in {'WS_QUIET','WS_QUIET_ACTIVE','WS_PRECOMMIT_BOOT_CACHE'}}
    def run(script, *args):
        (root/'calls.txt').write_text('')
        result = subprocess.run(['node',script,*args], cwd=root, env=env, text=True, capture_output=True)
        return result, (root/'calls.txt').read_text().splitlines()
    docs_steps = ['writeApiDocs','writeHostCatalogue']
    for mode in [[],['--parallel'],['--proof'],['--build-inputs'],['--inputs-only']]:
        result,calls = run('scripts/gen.mjs',*mode)
        assert result.returncode == 0,result.stderr
        assert not set(calls)&set(docs_steps),calls
        assert calls[-1]=='seal' and calls.count('shard-inputs')==1 and calls.count('shards')==1,calls
        assert calls.index('writeFormatJsonSchemas') < calls.index('genShardWords') < calls.index('shard-inputs') < calls.index('boot') < calls.index('shards'),calls
        expected_programs = 0 if any(flag in mode for flag in ['--proof','--build-inputs','--inputs-only']) else 1
        assert calls.count('programs') == expected_programs,calls
        if expected_programs:
            assert calls.index('programs') > calls.index('boot') and calls.index('programs') > calls.index('genBudgetDerivations'),calls
    module('gen-programs', 'export function generationPlan(){return {products:[],folders:[],scoped:false}}export function buildPrograms(){throw Error("actual program refusal")}'+program_tables)
    result,calls = run('scripts/gen.mjs')
    assert result.returncode!=0 and 'actual program refusal' in result.stderr,result
    assert 'seal' not in calls,calls
    put('package.json', json.dumps({'name':'docs-command-fixture','private':True,'scripts':{'docs':'node scripts/docs.mjs'}}))
    (root/'calls.txt').write_text('')
    result = subprocess.run(['pnpm','run','docs'], cwd=root, env=env, text=True, capture_output=True)
    calls = (root/'calls.txt').read_text().splitlines()
    assert result.returncode==0,result.stderr
    assert calls == ['loader',*docs_steps],calls
    module('gen-host-catalogue', 'export function writeHostCatalogue(){throw Error("actual docs refusal")}')
    result,calls = run('scripts/docs.mjs')
    assert result.returncode!=0 and 'actual docs refusal' in result.stderr,result
    assert calls==['loader','writeApiDocs'],calls
    print('6 generation/docs separation regressions passed')
