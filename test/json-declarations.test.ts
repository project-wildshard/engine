// oxlint-disable-next-line import/no-nodejs-modules -- use the real compiler on complete original JSON payloads
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- own only the bounded native type fixture under repository tmp
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- resolve exact declaration and compiler inputs
import {resolve} from 'node:path';
import {expect,test} from 'vitest';
import {largeJsonInputs,jsonDeclarations,jsonDeclarationInputs} from '../scripts/json-declarations.mjs';

test('complete companion types equal native JSON and preserve mutable and negative contracts',()=>{
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/json-declarations-'));
 try{
  const rows=jsonDeclarations(largeJsonInputs()), source:string[]=[
   'type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;',
  ];
  for(const [index,row]of rows.entries()){
   if(row.declaration===null){expect(existsSync(row.file)).toBe(false);continue;}
   expect(readFileSync(row.file,'utf8')).toBe(row.declaration);
   const native=resolve(root,`native-${index}.json`);writeFileSync(native,readFileSync(row.json));
   source.push(`import native${index} from ${JSON.stringify(native)};import declared${index} from ${JSON.stringify(resolve(row.json))};`,
    `const equal${index}:Equal<typeof native${index},typeof declared${index}>=true;void equal${index};`);
  }
  const original=resolve(root,'sample.json');
  writeFileSync(original,JSON.stringify({rows:[{value:1,label:'a'},{value:2}],enabled:true,nested:{names:['a']},left:{count:1,total:2},right:{count:3,total:4}}));
  const [sample]=jsonDeclarations([original]);if(sample?.declaration===null || sample===undefined)throw new Error('Missing mutable fixture type');
  writeFileSync(sample.file,sample.declaration);
  const good=`${source.join('\n')}\nimport sample from './sample.json';sample.enabled=false;sample.rows.push({value:3});sample.nested.names.push('new');const indexed:Record<string,number>=sample.left;void indexed;\n`;
  const probe=resolve(root,'probe.ts');writeFileSync(probe,good);
  writeFileSync(resolve(root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,noEmit:true,skipLibCheck:true,module:'esnext',moduleResolution:'bundler',target:'es2022',allowArbitraryExtensions:true,resolveJsonModule:true,types:[]},files:[probe]}));
  const run=()=>spawnSync(resolve('node_modules/.bin/tsc'),['--noEmit','-p',root],{encoding:'utf8'});
  const accepted=run();expect(accepted.status,accepted.stdout+accepted.stderr).toBe(0);
  writeFileSync(probe,`${good}sample.enabled="bad";sample.nested.names.push(3);\n`);
  const refused=run();expect(refused.status).not.toBe(0);expect(refused.stdout).toContain('TS2322');expect(refused.stdout).toContain('TS2345');
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('managed JSON shrinking below the threshold stays fresh and orphaned declarations refuse',()=>{
 const root=mkdtempSync(resolve('tmp/json-declaration-freshness-'));
 try{
  const json=resolve(root,'small.json'),companion=resolve(root,'small.d.json.ts');
  writeFileSync(json,'{"flag":true}');
  const before=jsonDeclarations([json])[0];
  if(before?.declaration===null || before===undefined)throw new Error('Missing complete native type');
  writeFileSync(companion,before.declaration);
  expect(jsonDeclarationInputs([json],[companion])).toEqual([json]);
  writeFileSync(json,'{"flag":"changed"}');
  const after=jsonDeclarations(jsonDeclarationInputs([json],[companion]))[0];
  expect(after?.declaration).not.toBe(before.declaration);
  expect(after?.declaration).toContain('flag: string');
  rmSync(json);
  expect(()=>jsonDeclarationInputs([],[companion])).toThrow('Orphaned JSON declaration');
 }finally{rmSync(root,{recursive:true,force:true});}
});
