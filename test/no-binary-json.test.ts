// oxlint-disable-next-line import/no-nodejs-modules -- Exercise exact immutable Git and staged-input policy in owned fixtures.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own disposable source fixtures only.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths within ignored tmp.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Drop inherited Git index variables in owned fixtures.
import { env as processEnv, execPath } from 'node:process';
import { expect, test } from 'vitest';
import { binaryJsonCounts, binaryJsonFailures, binaryJsonPolicy, binaryPolicyIncreases,
  checkBinaryRevision, checkBinaryTree } from '../scripts/no-binary-json.mjs';

import { commitCheckFailed } from '../scripts/precommit-jobs.mjs';

const payload = 'a'.repeat(1024);
const path = 'public/assets/example/rows.json';
const source = 'a'.repeat(40);
const policy = (files = {}) => binaryJsonPolicy({ schema: 'no-binary-json/1', source, files });

test('decoded strings, keys and data URIs cannot hide behind JSON escaping', () => {
  const empty = policy();
  expect(binaryJsonFailures(path, JSON.stringify({ text: 'ordinary rows', short: 'a'.repeat(1023) }), empty)).toEqual([]);
  expect(binaryJsonFailures(path, `{"text":"${String.raw`\u0061`.repeat(1024)}"}`, empty)).toHaveLength(1);
  expect(binaryJsonFailures(path, JSON.stringify({ [payload]: 'key' }), empty)).toHaveLength(1);
  expect(binaryJsonCounts({ nested: [{ url: 'DATA:application/octet-stream;base64,AA==' }] })).toEqual({ base64Chars: 0, dataUris: 1 });
  expect(binaryJsonFailures(path, '{// config\n"value": NaN,"name":"Infinity",}', empty)).toEqual([]);
  expect(() => binaryJsonFailures(path, '{broken', empty)).toThrow('invalid JSON');
});

test('exact path caps only shrink; allowance cannot move or change binary representation', () => {
  const before = policy({ [path]: { base64Chars: 1024, dataUris: 1 } });
  expect(binaryJsonFailures(path, JSON.stringify({ text: payload }), before)).toEqual([]);
  expect(binaryJsonFailures('public/assets/example/new.json', JSON.stringify({ text: payload }), before)).toHaveLength(1);
  expect(binaryJsonFailures(path, JSON.stringify({ text: `${payload}a` }), before)).toHaveLength(1);
  expect(binaryPolicyIncreases(before, policy({ [path]: { base64Chars: 1023, dataUris: 0 } }))).toEqual([]);
  expect(binaryPolicyIncreases(before, policy({ [path]: { base64Chars: 1023, dataUris: 2 } }))).toHaveLength(1);
  expect(commitCheckFailed({ name: 'binary JSON', code: 124, timedOut: true, output: 'BINARY-JSON public/rows.json: observed refusal' })).toBe(true);
  expect(binaryPolicyIncreases(before, policy({ 'public/other.json': { base64Chars: 1024, dataUris: 0 } }))).toHaveLength(1);
  expect(() => policy({ '../escape.json': { base64Chars: 1024, dataUris: 0 } })).toThrow('invalid allowance');
});

test('wide and deep authored rows do not overflow the traversal call stack', () => {
  const wide = Array.from({ length: 200_000 }, () => 1);
  let deep: unknown = payload;
  for (let level = 0; level < 20_000; level++) deep = [deep];
  expect(binaryJsonCounts([wide, deep])).toEqual({ base64Chars: 1024, dataUris: 0 });
});

function fixture(run: (root: string, git: (...args: string[]) => string, put: (name: string, value: string) => void) => void): void {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/binary-json-test-'));
  const env = Object.fromEntries(Object.entries(processEnv).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
  const put = (name: string, value: string): void => {
    const target = resolve(root, name); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, value);
  };
  const outerMessage=processEnv['WS_COMMIT_MESSAGE']; delete processEnv['WS_COMMIT_MESSAGE'];
  try {
    git('init', '-q'); git('config', 'core.hooksPath', '/dev/null'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('lint/no-binary-json.json', JSON.stringify(policy())); git('add', '.'); git('commit', '-qm', 'fixture');
    run(root, git, put);
  } finally {
    if (outerMessage===undefined) delete processEnv['WS_COMMIT_MESSAGE']; else processEnv['WS_COMMIT_MESSAGE']=outerMessage;
    rmSync(root, { recursive: true, force: true });
  }
}

function datedCommit(root: string, message: string, daysAgo: number): void {
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const env = Object.fromEntries(Object.entries(processEnv).filter(([key]) => !key.startsWith('GIT_')));
  execFileSync('git', ['commit', '-qm', message], { cwd: root, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

test('staged checks read exact index assets and reject self-approved caps', () => fixture((root, git, put) => {
  put(path, JSON.stringify({ text: payload })); git('add', path);
  put(path, '{}');
  expect(checkBinaryRevision(root, ':', 'HEAD', [path])).toHaveLength(1);
  put('lint/no-binary-json.json', JSON.stringify(policy({ [path]: { base64Chars: 1024, dataUris: 0 } })));
  git('add', 'lint/no-binary-json.json');
  expect(checkBinaryRevision(root, ':', 'HEAD', [path, 'lint/no-binary-json.json'])).toEqual([
    expect.stringContaining('allowance grew'),
  ]);
}));

test('a published rollback restores four exact debt rows while new values still refuse', () => fixture((root, git, put) => {
  const output = 'src/shards/fixture/data/contracts.generated.json', producer = 'src/shards/fixture/generators/bake-contracts.mjs', reader = 'src/shards/fixture/generators/contracts.ts';
  const policies = ['lint/base64-debt.json', 'lint/generated-import-debt.json', 'lint/generated-source-debt.json', 'lint/no-binary-json.json'];
  const debt = (schema: string, files: Record<string, number> | string[]): string => JSON.stringify({ schema, source, files });
  const original = [debt('no-base64/1', { [producer]: 1 }), debt('no-generated-import/1', { [reader]: 2 }),
    debt('generated-source/1', [output]), JSON.stringify(policy({ [output]: { base64Chars: 15704, dataUris: 0 } }))];
  const write = (values: readonly string[]): void => { for (const [index, file] of policies.entries()) { const value = values[index]; if (value === undefined) throw new Error('Missing policy fixture'); put(file, value); } git('add', ...policies); };
  write(original); datedCommit(root, 'published original producer', 2);
  write([debt('no-base64/1', {}), debt('no-generated-import/1', {}), debt('generated-source/1', []), JSON.stringify(policy())]);
  git('commit', '-qm', 'published producer retirement'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(original);
  expect(checkBinaryRevision(root, ':', 'HEAD', policies)).toEqual([]);
  put('lint/base64-debt.json', debt('no-base64/1', { [producer]: 2 })); git('add', ...policies);
  expect(checkBinaryRevision(root, ':', 'HEAD', policies).join('\n')).toContain('source debt allowance grew');
  write(original); put('lint/no-binary-json.json', JSON.stringify(policy({ [output]: { base64Chars: 15705, dataUris: 0 } }))); git('add', ...policies);
  expect(checkBinaryRevision(root, ':', 'HEAD', policies).join('\n')).toContain('missing Binary-JSON-Approved');
}));

test('unpublished policy history cannot authorize a rollback', () => fixture((root, git, put) => {
  const file = 'lint/base64-debt.json', producer = 'scripts/bake-local.mjs';
  const debt = (count: number): string => JSON.stringify({ schema: 'no-base64/1', source, files: count === 0 ? {} : { [producer]: count } });
  put(file, debt(0)); git('add', file); git('commit', '-qm', 'published empty debt'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  put(file, debt(1)); git('add', file); git('commit', '-qm', 'unpublished local allowance');
  put(file, debt(0)); git('add', file); git('commit', '-qm', 'local removal');
  put(file, debt(1)); git('add', file);
  expect(checkBinaryRevision(root, ':', 'HEAD', [file]).join('\n')).toContain('source debt allowance grew');
}));

test('an allowance removed from published main more than a day ago cannot return', () => fixture((root, git, put) => {
  const file = 'lint/base64-debt.json', producer = 'scripts/bake-old.mjs';
  const debt = (count: number): string => JSON.stringify({ schema: 'no-base64/1', source, files: count === 0 ? {} : { [producer]: count } });
  put(file, debt(1)); git('add', file); datedCommit(root, 'old published allowance', 3);
  put(file, debt(0)); git('add', file); datedCommit(root, 'old published removal', 2);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD'); put(file, debt(1)); git('add', file);
  expect(checkBinaryRevision(root, ':', 'HEAD', [file]).join('\n')).toContain('source debt allowance grew');
}));

test('immutable commit checks cannot be fooled by a clean index or later deletion', () => fixture((root, git, put) => {
  const parent = git('rev-parse', 'HEAD');
  put(path, JSON.stringify({ text: payload })); git('add', path); git('commit', '-qm', 'binary fixture');
  const bad = git('rev-parse', 'HEAD');
  put(path, '{}'); git('add', path); git('commit', '-qm', 'clean fixture');
  expect(checkBinaryRevision(root, bad, parent, [path])).toHaveLength(1);
  expect(checkBinaryRevision(root, 'HEAD', bad, [path])).toEqual([]);
  git('rm', 'lint/no-binary-json.json');
  expect(checkBinaryRevision(root, ':', 'HEAD', ['lint/no-binary-json.json'])).toHaveLength(1);
}));

test('CI includes ignored generator outputs and refuses symlink inputs', () => fixture((root, git, put) => {
  put('.gitignore', '*.generated.json\n'); git('add', '.gitignore'); git('commit', '-qm', 'ignore fixture');
  put('src/shards/example/data/new.generated.json', JSON.stringify({ text: payload }));
  expect(checkBinaryTree(root)).toEqual([expect.stringContaining('new.generated.json')]);
  // A tracked JSON symlink is a refused input, never followed outside its tree.
  symlinkSync(resolve(root, 'lint/no-binary-json.json'), resolve(root, 'src/policy.json'));
  git('add', 'src/policy.json');
  expect(() => checkBinaryTree(root)).toThrow('symlink');
}));




test('a debt correction needs exact unique final-footer approval, including at committed Git checks', () => fixture((root, git, put) => {
  const before = policy(), after = policy({ [path]: { base64Chars: 13960, dataUris: 0 } });
  const line = `Binary-JSON-Approved: wildshard-new ${path} 13960 0`;
  const message = `fix: record measured debt\n\n${line}\n\nAssisted-by: fixture:model`;
  expect(binaryPolicyIncreases(before, after, message)).toEqual([]);
  for (const text of [message.replace('13960', '13961'), message.replace('wildshard-new', 'other'),
    `fix: bad\n\n${line}\n\nbody after approval`, `fix: bad\n\n${line}\n${line}`])
    expect(binaryPolicyIncreases(before, after, text).length).toBeGreaterThan(0);
  expect(binaryPolicyIncreases(before, before, message).length).toBeGreaterThan(0);
  const parent = git('rev-parse', 'HEAD');
  put('lint/no-binary-json.json', JSON.stringify(after)); put(path, JSON.stringify({ text: 'a'.repeat(13960) }));
  git('add', '.'); git('commit', '-qm', message);
  expect(checkBinaryRevision(root, 'HEAD', parent, ['lint/no-binary-json.json', path])).toEqual([]);
}));


test('source/tool base64 debt cannot grow, move or disappear from exact Git policy',()=>fixture((root,git,put)=>{
  const file='lint/base64-debt.json';
  const debt=(files:Record<string,number>)=>JSON.stringify({schema:'no-base64/1',source,files});
  put(file,debt({'src/old.ts':2,'scripts/old.mjs':1}));git('add',file);git('commit','-qm','seed source debt');
  put(file,debt({'src/old.ts':1}));git('add',file);
  expect(checkBinaryRevision(root,':','HEAD',[file])).toEqual([]);
  const cases:Record<string,number>[]=[{'src/old.ts':3},{'src/new.ts':1},{'scripts/new.mjs':1}];
  for(const files of cases){
    put(file,debt(files));git('add',file);
    expect(checkBinaryRevision(root,':','HEAD',[file]).join(' ')).toContain('source debt allowance grew');
  }
  git('rm','-f',file);
  expect(checkBinaryRevision(root,':','HEAD',[file]).join(' ')).toContain('source debt policy deleted');
}));

test('protocol source debt needs exact unique approval in the committed final footer',()=>fixture((root,git,put)=>{
  const file='lint/base64-debt.json', transport='scripts/parity/fast-png.mjs';
  const debt=(count:number)=>JSON.stringify({schema:'no-base64/1',source,files:count===0?{}:{[transport]:count}});
  put(file,debt(0));git('add',file);git('commit','-qm','seed source policy');
  const parent=git('rev-parse','HEAD'), line=`Base64-Approved: wildshard-new ${transport} 1`;
  put(file,debt(1));git('add',file);
  git('commit','-qm',`fix: protocol boundary\n\n${line}\n\nAssisted-by: fixture:model`);
  expect(checkBinaryRevision(root,'HEAD',parent,[file])).toEqual([]);
  for(const message of [line.replace('wildshard-new','other'),line.replace(' 1',' 2'),
    `${line}\n${line}`,`${line}\n\nbody after approval`,line.replace(transport,'scripts/other.mjs')]) {
    put(file,debt(1));git('add',file);git('commit','--allow-empty','-qm',`fix: not approved\n\n${message}`);
    expect(checkBinaryRevision(root,'HEAD',parent,[file]).join(' ')).toMatch(/approval|allowance grew/u);
  }
  put(file,debt(2));git('add',file);git('commit','-qm',`fix: count mismatch\n\n${line}`);
  expect(checkBinaryRevision(root,'HEAD',parent,[file]).join(' ')).toContain('allowance grew');
}));


test('generated import debt and app table exemptions cannot grow or be deleted',()=>fixture((root,git,put)=>{
  const file='lint/generated-import-debt.json';
  const debt=(files:Record<string,number>,sources=['src/game/table.generated.ts'])=>JSON.stringify({schema:'no-generated-import/1',source,files,sources});
  put(file,debt({'src/old.ts':2,'test/old.test.ts':1}));git('add',file);git('commit','-qm','seed import debt');
  put(file,debt({'src/old.ts':1}));git('add',file);
  expect(checkBinaryRevision(root,':','HEAD',[file])).toEqual([]);
  put(file,debt({'src/new.ts':1}));git('add',file);
  expect(checkBinaryRevision(root,':','HEAD',[file]).join(' ')).toContain('source debt allowance grew');
  put(file,debt({},['src/game/table.generated.ts','src/game/new.generated.ts']));git('add',file);
  expect(checkBinaryRevision(root,':','HEAD',[file]).join(' ')).toContain('app source exemption grew');
  git('rm','-f',file);
  expect(checkBinaryRevision(root,':','HEAD',[file]).join(' ')).toContain('source debt policy deleted');
}));

test('a debt row follows its file across a side move, and only there',()=>fixture((root,git,put)=>{
  const file='lint/generated-import-debt.json', old='src/game/quest/rows.ts', moved='src/server/game/quest/rows.ts', table='src/game/boot/table.generated.ts';
  const debt=(files:Record<string,number>,sources=[table])=>JSON.stringify({schema:'no-generated-import/1',source,files,sources});
  const grew=(files:Record<string,number>,sources=[table]):string=>{put(file,debt(files,sources));git('add',file);return checkBinaryRevision(root,':','HEAD',[file]).join(' ');};
  put(file,debt({[old]:2}));git('add',file);git('commit','-qm','seed import debt');
  // A move carries its count, equal or lower, and its exemption.
  expect(grew({[moved]:2})).toBe('');
  expect(grew({[moved]:1})).toBe('');
  expect(grew({[old]:2},['src/client/game/boot/table.generated.ts'])).toBe('');
  // Real growth still refuses: a raised count, a row beside the old one, another file, another layer.
  expect(grew({[moved]:3})).toContain(`source debt allowance grew for ${moved}`);
  expect(grew({[old]:2,[moved]:1})).toContain('source debt allowance grew');
  expect(grew({'src/server/game/quest/other.ts':1})).toContain('source debt allowance grew');
  expect(grew({'src/server/engine/quest/rows.ts':1})).toContain('source debt allowance grew');
  expect(grew({'src/sharddev/server/game/quest/rows.ts':1})).toContain('source debt allowance grew');
  expect(grew({[old]:2},[table,'src/client/game/boot/table.generated.ts'])).toContain('app source exemption grew');
}));

test('generated import debt grows only with its own exact approval in the final footer',()=>fixture((root,git,put)=>{
  const file='lint/generated-import-debt.json', entry='src/client/app/entry.ts';
  const debt=(count:number)=>JSON.stringify({schema:'no-generated-import/1',source,files:{[entry]:count},sources:[]});
  put(file,debt(1));git('add',file);git('commit','-qm','seed import debt');
  const parent=git('rev-parse','HEAD'), line=`Generated-Import-Approved: wildshard-new ${entry} 2`;
  put(file,debt(2));git('add',file);
  git('commit','-qm',`refactor: visible title import\n\n${line}\n\nAssisted-by: fixture:model`);
  expect(checkBinaryRevision(root,'HEAD',parent,[file])).toEqual([]);
  for(const message of [line.replace('Generated-Import-Approved','Base64-Approved'),line.replace(' 2',' 3'),`${line}\n${line}`,`${line}\n\nbody after approval`]) {
    git('commit','--allow-empty','-qm',`refactor: not approved\n\n${message}`);
    expect(checkBinaryRevision(root,'HEAD',parent,[file]).join(' ')).toMatch(/approval|allowance grew/u);
  }
}));


test('the binary CLI refuses missing range operands before any Git traversal', () => {
  for (const args of [['--range'], ['--range', 'HEAD']]) {
    const result = spawnSync(execPath, [resolve('scripts/no-binary-json.mjs'), ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usage: no-binary-json.mjs');
    expect(result.stderr).not.toContain('bad revision');
  }
});


test.each(['exact','unregistered','other-producer','kept-ts','missing-json','old-json','wrong-path'] as const)('discovery source migration requires the exact registered same-revision manifest conversion: %s', mode => fixture((root,git,put)=>{
  const file='lint/generated-import-debt.json',folder='src/shards/orchard',discoveryPath=`${folder}/discovery.generated.ts`;
  const debt=(sources:string[])=>JSON.stringify({schema:'no-generated-import/1',source,files:{},sources});
  put(file,debt([]));put(`${folder}/manifest.ts`,'export default {};');
  if(mode==='old-json')put(`${folder}/manifest.json`,'{}');
  git('add','.');git('commit','-qm','native manifest');
  if(mode!=='kept-ts')git('rm',`${folder}/manifest.ts`);
  if(mode!=='missing-json')put(`${folder}/manifest.json`,'{}');
  put('scripts/source-generation-outputs.json',JSON.stringify({schema:'source-generation-outputs/1',producers:{
    [mode==='other-producer'?'scripts/other.mjs':'scripts/gen-shards.mjs']:mode==='unregistered'?[]:[discoveryPath],
  }}));
  put(file,debt([mode==='wrong-path'?`${folder}/other.generated.ts`:discoveryPath]));git('add','.');
  const failures=checkBinaryRevision(root,':','HEAD',[file,'scripts/source-generation-outputs.json',`${folder}/manifest.ts`,`${folder}/manifest.json`]);
  if(mode==='exact')expect(failures).toEqual([]);
  else expect(failures.join(' ')).toContain('app source exemption grew');
}));
