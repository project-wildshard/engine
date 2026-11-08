import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after,test} from 'node:test';
import {rendererRevision} from './renderer-revision.mjs';
import {stampBuildDocuments} from './app-build/buildIdentity.mjs';
import {assertProductionBuild} from './check-devserver.mjs';

const root=mkdtempSync(join(tmpdir(),'renderer-identity-'));
after(()=>rmSync(root,{recursive:true,force:true}));
mkdirSync(join(root,'src/client'),{recursive:true});
mkdirSync(join(root,'public'));
writeFileSync(join(root,'package.json'),JSON.stringify({version:'1.0.0',dependencies:{three:'fixed'}}));
writeFileSync(join(root,'pnpm-lock.yaml'),'lockfileVersion: 9');
writeFileSync(join(root,'src/client/material.ts'),'export const material = "first";');
writeFileSync(join(root,'public/host.bin'),'host bytes');
execFileSync('git',['-C',root,'init','-q']);execFileSync('git',['-C',root,'add','public/host.bin','src/client/material.ts','pnpm-lock.yaml']);

test('renderer identity changes for actual client or shipped host bytes',()=>{
  const first=rendererRevision(root);
  writeFileSync(join(root,'src/client/material.ts'),'export const material = "second";');
  const second=rendererRevision(root);assert.notEqual(first,second);
  writeFileSync(join(root,'public/host.bin'),'new host bytes');
  assert.notEqual(rendererRevision(root),second);
});
test('release version, shell identity and generated product tables do not rename the renderer',()=>{
  const first=rendererRevision(root);
  writeFileSync(join(root,'package.json'),JSON.stringify({version:'2.0.0',dependencies:{three:'fixed'}}));
  writeFileSync(join(root,'src/client/data.generated.ts'),'different product table');
  assert.equal(rendererRevision(root),first);
});
test('actual document stamping exposes the renderer independently of shell build id',()=>{
  const out=join(root,'document');mkdirSync(out);
  writeFileSync(join(out,'index.html'),'<html><head></head><body></body></html>');
  const renderer=rendererRevision(root);
  writeFileSync(join(out,'version.json'),JSON.stringify({build:'shell-commit',rendererRevision:renderer}));
  stampBuildDocuments(out);
  const html=readFileSync(join(out,'index.html'),'utf8');
  assert.ok(html.includes(`globalThis.__WS_RENDERER_REVISION__="${renderer}"`));
  assert.ok(html.includes('globalThis.__WS_BUILD_ID__="shell-commit"'));
});
test('capture-only artifact is refused by the real production gate',()=>{
  const out=join(root,'capture');mkdirSync(out);
  writeFileSync(join(out,'build-flags.json'),JSON.stringify({devserver:false}));
  writeFileSync(join(out,'version.json'),JSON.stringify({preparationOnly:true}));
  assert.throws(()=>assertProductionBuild(out),/Preparation-only/u);
  writeFileSync(join(out,'version.json'),JSON.stringify({preparationOnly:false}));
  assert.doesNotThrow(()=>assertProductionBuild(out));
});
test('malformed renderer metadata never enters executable document source',()=>{
  const out=join(root,'invalid');mkdirSync(out);
  const html='<html><head></head><body></body></html>';
  writeFileSync(join(out,'index.html'),html);
  writeFileSync(join(out,'version.json'),JSON.stringify({build:'valid-build',rendererRevision:'</script>'}));
  assert.throws(()=>stampBuildDocuments(out),/Invalid renderer identity/u);
  assert.equal(readFileSync(join(out,'index.html'),'utf8'),html);
});
