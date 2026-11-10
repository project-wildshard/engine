// Fixed test-only entry; the ordinary cook sandbox and worker URLs stay in use.
// oxlint-disable-next-line import/no-nodejs-modules -- Hash actual compiler inputs and outputs.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the fixed source closure and its package metadata.
import {existsSync,readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed physics binding exactly as the normal loader does.
import {createRequire} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Bound the fixed entry to its owned output directory.
import {basename,dirname,isAbsolute,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve each original module's own URL semantics.
import {pathToFileURL} from 'node:url';
import ts from '@typescript/typescript6';
import {build} from 'rolldown';

const digest=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
const [root,directory,...extra]=process.argv.slice(2);
if(root===undefined||directory===undefined||extra.length!==0||!isAbsolute(root)
  ||dirname(directory)!==resolve(root,'tmp')||!basename(directory).startsWith('compiled-cook-'))throw new Error('Expected an owned fixed-cook compilation');
const require=createRequire(resolve(root,'package.json')),inputs=new Map<string,string|undefined>();
const remember=(file:string,bytes:Uint8Array):void=>{
  const hash=digest(bytes),prior=inputs.get(file);
  if(inputs.has(file)&&prior!==hash)throw new Error('Cook preparation source changed during compilation');
  inputs.set(file,hash);
};
remember(import.meta.filename,readFileSync(import.meta.filename));
for(const file of ['package.json','pnpm-lock.yaml'])remember(resolve(root,file),readFileSync(resolve(root,file)));
for(const name of ['rolldown','@typescript/typescript6']){
  const file=require.resolve(`${name}/package.json`);remember(file,readFileSync(file));
}
const packages=new Set<string>();
const packageAt=(file:string):void=>{
  let at=dirname(file);
  while(!packages.has(at)){
    packages.add(at);const metadata=resolve(at,'package.json');
    if(existsSync(metadata)){remember(metadata,readFileSync(metadata));return;}
    inputs.set(metadata,undefined);const parent=dirname(at);if(parent===at)return;at=parent;
  }
};
const bundle=await build({cwd:root,input:resolve(root,'scripts/cook-job.mjs'),platform:'node',transform:{target:'node24'},plugins:[{
  name:'fixed-cook-worker',
  resolveId(source){
    if(/^\.\/rapier_wasm3d(?:\.js)?$/u.test(source))return resolve(root,'src/server/engine/physics/rapierBindings.ts');
    if(source==='@dimforge/rapier3d-simd')return require.resolve('@dimforge/rapier3d-simd/rapier.js');
    return null;
  },
  load(id){
    if(!isAbsolute(id)||!/\.(?:[cm]?[jt]sx?|json)$/u.test(id))return null;
    const bytes=readFileSync(id),text=bytes.toString('utf8');remember(id,bytes);packageAt(id);
    // Bundling must not move encoder Worker URLs, renderer roots or relative
    // package resolution to the temporary output folder. Replace syntax nodes,
    // never a string/comment containing the words import.meta.
    const source=ts.createSourceFile(id,text,ts.ScriptTarget.Latest,true),edits:{from:number;end:number;value:string}[]=[];
    const visit=(node:ts.Node):void=>{
      if(ts.isPropertyAccessExpression(node)&&ts.isMetaProperty(node.expression)&&node.expression.keywordToken===ts.SyntaxKind.ImportKeyword){
        const name=node.name.text;
        if(name==='url'||name==='dirname'||name==='filename')edits.push({from:node.getStart(source),end:node.end,
          value:JSON.stringify(name==='url'?pathToFileURL(id).href:name==='dirname'?dirname(id):id)});
        else if(name==='env'&&id.endsWith('.ts'))edits.push({from:node.getStart(source),end:node.end,value:'({DEV:false,PROD:true,MODE:"production"})'});
      }else ts.forEachChild(node,visit);
    };
    visit(source);let code=text;
    for(const edit of edits.sort((a,b)=>b.from-a.from))code=code.slice(0,edit.from)+edit.value+code.slice(edit.end);
    return {code};
  },
}],external:['pg-native'],output:{file:resolve(directory,'cook-job.mjs'),format:'esm',codeSplitting:false,minify:false}});
if(bundle.output.length!==1||bundle.output.some(row=>row.type!=='chunk'||row.fileName!=='cook-job.mjs'))throw new Error('Cook preparation must emit one fixed entry');
for(const [file,hash]of inputs){
  if(hash===undefined){if(!existsSync(file))continue;}
  else try{if(digest(readFileSync(file))===hash)continue;}catch{/* Missing inputs refuse. */}
  throw new Error('Cook preparation source changed');
}
const output=resolve(directory,'cook-job.mjs');
console.info(JSON.stringify({inputs:[...inputs].map(([file,hash])=>({file,hash:hash??null})),output:{file:output,hash:digest(readFileSync(output))}}));
