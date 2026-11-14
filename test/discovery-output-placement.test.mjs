// oxlint-disable-next-line import/no-nodejs-modules -- Execute the original policy CLI against owned artifact fixtures.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture files are bounded and owned by this test.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve actual module edges without running shard code.
import {dirname,resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';
import {authoredManifestSource,productManifestPath} from '../scripts/authored-manifest.mjs';
import {relocateDiscoverySource,shardSource,manifestClosure} from '../scripts/gen-shards.mjs';
import {outputManifest,shardProducts} from '../scripts/shard-outputs.mjs';
import {pushTables} from '../scripts/push-tables.mjs';

const root=process.cwd(),policyPath='lint/generated-source-debt.json';
const names=['fossil-badlands','jungle-ziggurat','patchwork-fairground','saltwind-lighthouse'];
const selected=shardProducts(root,['open-plots']).filter(row=>names.some(name=>row.slug===`open-plot-${name}`));
const oldPath=row=>`src/shards/open-plots/discovery.${row.slug}.generated.ts`;
const text=row=>authoredManifestSource(root,row.slug,{folder:row.folder,composed:outputManifest(root,row.folder,row.output)});
function fixture(run){
 mkdirSync('tmp',{recursive:true});const directory=mkdtempSync(resolve('tmp/discovery-output-placement-'));
 const put=(path,value)=>{const file=resolve(directory,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);};
 try{return run(directory,put);}finally{rmSync(directory,{recursive:true,force:true});}
}
// Independent source projection: normalize only parsed module specifiers to physical targets.
function graph(source,directory){
 const parsed=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true),edits=[];
 const visit=node=>{
  const ref=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier
   :ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:undefined;
  if(ref!==undefined&&ts.isStringLiteral(ref)&&ref.text.startsWith('.'))edits.push({start:ref.getStart(parsed),end:ref.getEnd(),value:JSON.stringify(resolve(directory,ref.text))});
  ts.forEachChild(node,visit);
 };visit(parsed);
 let output=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.value+output.slice(edit.end);
 return output;
}

test('ungrandfathered discoveries leave src while reviewed paths and authored factories remain unchanged',()=>fixture((directory,put)=>{
 put(policyPath,JSON.stringify({schema:'generated-source/1',source:'a'.repeat(40),files:['src/shards/source/discovery.old.generated.ts']}));
 const row=slug=>({slug,folder:'source',output:{slug}});
 expect(productManifestPath(directory,row('old'))).toBe('src/shards/source/discovery.old.generated.ts');
 expect(productManifestPath(directory,row('new'))).toBe('out/.app/discovery.source.new.generated.ts');
 put('lint/generated-import-debt.json',JSON.stringify({schema:'no-generated-import/1',sources:['src/shards/source/discovery.reviewed.generated.ts']}));
 expect(productManifestPath(directory,row('reviewed'))).toBe('src/shards/source/discovery.reviewed.generated.ts');
 expect(productManifestPath(directory,row('new'))).toBe('out/.app/discovery.source.new.generated.ts');
 put('src/shards/factory/manifest.ts','export default {};');
 expect(productManifestPath(directory,{slug:'factory',folder:'factory',output:null})).toBe('src/shards/factory/manifest.ts');
}));

test('relative static and lazy imports move, authored data that resembles an import remains exact',()=>{
 const row=selected[0];if(row===undefined)throw new Error('Missing actual NU3 rows');
 const source='import x from "./data/a.json" with {type:"json"};\nconst data={note:\'import("./untouched")\'};\nexport const lazy=()=>import("./runtime");\n';
 const result=relocateDiscoverySource(root,row,source);
 expect(result).toContain('note:\'import("./untouched")\'');
 expect(graph(result,resolve(root,'out/.app'))).toBe(graph(source,resolve(root,'src/shards/open-plots')));
});

test('all four actual NU3 wrappers keep complete code, manifest rows and physical dependency graphs',()=>{
 expect(selected).toHaveLength(4);
 const composition=shardSource(root),closure=manifestClosure(root);
 const catalogue=JSON.parse(readFileSync(resolve(root,'scripts/source-generation-outputs.json'),'utf8')).producers['scripts/gen-shards.mjs'];
 for(const row of selected){
  const source=text(row),file=productManifestPath(root,row),moved=relocateDiscoverySource(root,row,source);
  expect(file.startsWith('out/.app/')).toBe(true);
  expect(catalogue).toContain(file);
  expect(catalogue).not.toContain(oldPath(row));
  expect(graph(moved,resolve(root,dirname(file)))).toBe(graph(source,resolve(root,'src/shards/open-plots')));
  expect(moved).toContain(`defineAuthoredShard(data, ${JSON.stringify(row.slug)}, rows, native,`);
  expect(composition).toContain(`../${file.slice(0,-3)}`);
  expect(closure[row.slug]).toContain(file);
  expect(closure[row.slug]).toContain('src/client/game/shard/manifest.ts');
  const card=outputManifest(root,row.folder,row.output).card;
  expect(Object.keys(card).sort()).toEqual(['landscape','portrait','thumb']);
  for(const image of Object.values(card)){
   expect(image).toMatch(/^\/src\/shards\/open-plots\/thumbs\/[a-z0-9-]+\.jpg$/u);
   expect(closure[row.slug]).toContain(image.slice(1));
  }
  expect(closure[row.slug]).not.toContain(oldPath(row));
 }
});

test('the unchanged original all-files guard refuses actual src wrappers and accepts their relocated bytes',()=>fixture((directory,put)=>{
 for(const file of ['lint/no-binary-json.json',policyPath,'lint/generated-import-debt.json'])put(file,readFileSync(resolve(root,file)));
 put('scripts/source-generation-outputs.json',JSON.stringify({schema:'source-generation-outputs/1',producers:{}}));
 put('.push-tracked.json',JSON.stringify(['lint/no-binary-json.json',policyPath,'lint/generated-import-debt.json']));
 for(const row of selected)put(oldPath(row),text(row));
 const command=()=>spawnSync(process.execPath,[resolve(root,'scripts/no-binary-json.mjs'),'--all'],{cwd:directory,encoding:'utf8'});
 const red=command();expect(red.status).toBe(1);
 for(const row of selected)expect(red.stderr).toContain(`GENERATED-SOURCE ${oldPath(row)}`);
 for(const row of selected){put(productManifestPath(root,row),relocateDiscoverySource(root,row,text(row)));rmSync(resolve(directory,oldPath(row)));}
 const green=command();expect(green.status,green.stderr).toBe(0);
 for(const row of selected)expect(existsSync(resolve(directory,productManifestPath(root,row)))).toBe(true);
}));

test('the normal push metadata writer emits complete relocated wrappers without a product build',()=>fixture((directory,put)=>{
 for(const path of ['src/shards/open-plots/manifest.json','src/shards/open-plots/data/budgets.json'])put(path,readFileSync(resolve(root,path)));
 put('src/shards/open-plots/outputs.json',JSON.stringify({outputs:selected.map(row=>row.output)}));
 pushTables(directory);
 for(const row of selected){
  const file=productManifestPath(directory,row),source=authoredManifestSource(directory,row.slug,{folder:row.folder,composed:outputManifest(directory,row.folder,row.output),generation:true,metadataOnly:true});
  expect(readFileSync(resolve(directory,file),'utf8')).toBe(relocateDiscoverySource(directory,row,source));
  expect(existsSync(resolve(directory,oldPath(row)))).toBe(false);
 }
}));
